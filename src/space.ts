import { cachedFetch, sourceLine } from "./cache.js";
import { findPasses, parseTles, type Observer, type Pass } from "./orbit.js";

export const LL2 = process.env.LL2_BASE_URL ?? "https://ll.thespacedevs.com/2.3.0";
export const SNAPI = "https://api.spaceflightnewsapi.net/v4";
export const CELESTRAK = "https://celestrak.org/NORAD/elements/gp.php";
const LL2_TTL = 10 * 60_000;   // LL2 free tier: 15 requests/hour
const TLE_TTL = 2 * 3600_000;  // CelesTrak asks clients not to re-download more than every 2 h
const NEWS_TTL = 10 * 60_000;

export function countdown(netIso: string, now = new Date()) {
  let ms = new Date(netIso).getTime() - now.getTime();
  const past = ms < 0; ms = Math.abs(ms);
  const d = Math.floor(ms / 86400000), h = Math.floor(ms / 3600000) % 24, m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  const txt = `${d ? d + "d " : ""}${h}h ${m}m ${s}s`;
  return { seconds: Math.round((past ? -1 : 1) * ms / 1000), text: past ? `T+ ${txt}` : `T- ${txt}` };
}
export function fmtTime(iso: string, tz?: string) {
  const d = new Date(iso);
  const utc = d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  if (!tz) return utc;
  try { return d.toLocaleString("en-GB", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }) + ` (${tz}) / ${utc}`; } catch { throw new Error(`Unknown timezone "${tz}". Use an IANA name like Africa/Lagos.`); }
}

export interface Launch { id: string; name: string; net: string; netPrecision?: string; status: string; provider?: string; rocket?: string; pad?: string; location?: string; mission?: string; orbit?: string; webcastLive?: boolean; probability?: number | null; countdown: { seconds: number; text: string }; url: string; }
export function mapLaunch(r: any, now = new Date()): Launch {
  return {
    id: r.id, name: r.name, net: r.net, netPrecision: r.net_precision?.name, status: r.status?.name ?? "Unknown",
    provider: r.launch_service_provider?.name, rocket: r.rocket?.configuration?.full_name ?? r.rocket?.configuration?.name,
    pad: r.pad?.name, location: r.pad?.location?.name, mission: r.mission?.description, orbit: r.mission?.orbit?.name,
    webcastLive: r.webcast_live, probability: r.probability ?? null, countdown: countdown(r.net, now),
    url: `https://ll.thespacedevs.com/2.3.0/launches/${r.id}/`,
  };
}

export async function upcomingLaunches(o: { limit?: number; search?: string; tz?: string; includeRecent?: boolean }) {
  const limit = o.limit ?? 10;
  const q = new URLSearchParams({ limit: String(Math.min(limit + 10, 50)), mode: "detailed", ordering: "net" });
  if (o.search) q.set("search", o.search);
  const f = await cachedFetch<any>(`${LL2}/launches/upcoming/?${q}`, LL2_TTL);
  const now = new Date();
  let launches = (f.data.results ?? []).map((r: any) => mapLaunch(r, now)) as Launch[];
  if (!o.includeRecent) launches = launches.filter(l => l.countdown.seconds > -3600 || !/Success|Failure/i.test(l.status));
  launches = launches.slice(0, limit);
  let md = `## Upcoming launches${o.search ? ` matching "${o.search}"` : ""}\n\n| # | Launch | Provider | NET | Countdown | Status | Pad |\n|---|---|---|---|---|---|---|\n`;
  launches.forEach((l, i) => md += `| ${i + 1} | ${esc(l.name)} | ${esc(l.provider ?? "-")} | ${fmtTime(l.net, o.tz)}${l.netPrecision && l.netPrecision !== "Second" && l.netPrecision !== "Minute" ? ` (±${l.netPrecision})` : ""} | ${l.countdown.text} | ${l.status} | ${l.location ?? l.pad ?? "-"} |\n`);
  if (!launches.length) md += `| - | No upcoming launches found | | | | | |\n`;
  md += `\n${sourceLine(f, "The Space Devs Launch Library 2")} Countdowns computed at ${now.toISOString()}.`;
  return { launches, source: f.source, fetchedAt: f.fetchedAt, computedAt: now.toISOString(), markdown: md };
}

export async function nextLaunch(o: { search?: string; tz?: string }) {
  const r = await upcomingLaunches({ limit: 5, search: o.search, tz: o.tz });
  const l = r.launches.find(x => x.countdown.seconds > 0) ?? r.launches[0];
  if (!l) throw new Error(`No upcoming launch found${o.search ? ` for "${o.search}"` : ""}.`);
  const md = `## Next launch${o.search ? ` (${o.search})` : ""}: ${l.name}\n\n**${l.countdown.text}** to ${fmtTime(l.net, o.tz)}${l.netPrecision ? ` (precision: ${l.netPrecision})` : ""}\n\n- Provider: ${l.provider ?? "-"}\n- Rocket: ${l.rocket ?? "-"}\n- Pad: ${l.pad ?? "-"}, ${l.location ?? ""}\n- Status: ${l.status}${l.probability != null ? ` (weather go: ${l.probability}%)` : ""}\n- Orbit: ${l.orbit ?? "-"}\n${l.mission ? `- Mission: ${l.mission}\n` : ""}\n${sourceLine({ source: r.source, fetchedAt: r.fetchedAt, cached: false, stale: false }, "The Space Devs Launch Library 2")}`;
  return { launch: l, source: r.source, fetchedAt: r.fetchedAt, markdown: md };
}

export async function starshipStatus(o: { tz?: string; newsLimit?: number }) {
  const [up, prev, news] = await Promise.allSettled([
    cachedFetch<any>(`${LL2}/launches/upcoming/?search=starship&limit=3&mode=detailed&ordering=net`, LL2_TTL),
    cachedFetch<any>(`${LL2}/launches/previous/?search=starship&limit=3&mode=detailed&ordering=-net`, LL2_TTL),
    cachedFetch<any>(`${SNAPI}/articles/?search=starship&limit=${o.newsLimit ?? 5}&ordering=-published_at`, NEWS_TTL),
  ]);
  const now = new Date();
  const upcoming = up.status === "fulfilled" ? up.value.data.results.map((r: any) => mapLaunch(r, now)) as Launch[] : [];
  const previous = prev.status === "fulfilled" ? prev.value.data.results.map((r: any) => mapLaunch(r, now)) as Launch[] : [];
  const articles = news.status === "fulfilled" ? news.value.data.results.map((a: any) => ({ title: a.title, site: a.news_site, url: a.url, publishedAt: a.published_at, summary: a.summary })) : [];
  if (!upcoming.length && !previous.length && !articles.length) throw new Error("All Starship sources failed: " + [up, prev, news].map(x => x.status === "rejected" ? (x.reason as Error).message : "").filter(Boolean).join("; "));
  let md = `## Starship status\n\n### Next flights\n`;
  md += upcoming.length ? upcoming.map(l => `- **${l.name}**: ${fmtTime(l.net, o.tz)} (${l.countdown.text}), ${l.status}${l.netPrecision ? `, NET precision ${l.netPrecision}` : ""}`).join("\n") : "- None scheduled in Launch Library 2";
  md += `\n\n### Most recent flights\n` + (previous.length ? previous.map(l => `- **${l.name}**: ${fmtTime(l.net, o.tz)}, ${l.status}`).join("\n") : "- unavailable");
  md += `\n\n### Latest news\n` + (articles.length ? articles.map((a: any) => `- [${a.title}](${a.url}): ${a.site}, ${a.publishedAt.slice(0, 10)}`).join("\n") : "- unavailable");
  const srcs = [up, prev, news].filter(x => x.status === "fulfilled").map((x: any) => sourceLine(x.value, x.value.source.includes("spaceflightnews") ? "Spaceflight News API" : "Launch Library 2"));
  md += "\n\n" + srcs.join("\n");
  const errors = [up, prev, news].filter(x => x.status === "rejected").map((x: any) => x.reason.message);
  if (errors.length) md += `\n\n> Partial data: ${errors.join("; ")}`;
  return { upcoming, previous, news: articles, errors, markdown: md };
}

export async function fetchTles(query: { catnr?: string; group?: string; name?: string }) {
  const q = new URLSearchParams({ FORMAT: "tle" });
  if (query.catnr) q.set("CATNR", query.catnr); else if (query.group) q.set("GROUP", query.group); else if (query.name) q.set("NAME", query.name);
  const f = await cachedFetch<string>(`${CELESTRAK}?${q}`, TLE_TTL, { text: true });
  if (/No GP data found/i.test(f.data) || !f.data.trim()) throw new Error(`CelesTrak has no elements for ${JSON.stringify(query)}.`);
  return { tles: parseTles(f.data), f };
}

/** Satellites from the N most recent launches, by international designator (YYNNN) in TLE line 1. */
export function recentLaunchGroups(tles: { name: string; line1: string; line2: string }[], n: number) {
  const key = (t: { line1: string }) => t.line1.slice(9, 14).trim(); // e.g. "26118"
  const sortable = (k: string) => (Number(k.slice(0, 2)) < 57 ? 2000 : 1900) * 1000 + Number(k.slice(0, 2)) * 1000 + Number(k.slice(2));
  const keys = [...new Set(tles.map(key))].filter(k => /^\d{5}$/.test(k)).sort((a, b) => sortable(b) - sortable(a)).slice(0, n);
  return tles.filter(t => keys.includes(key(t)));
}

const esc = (s: string) => s.replace(/\|/g, "\\|");

function passTable(passes: Pass[], tz?: string) {
  let md = `| Satellite | Rise | Max elev. | Set | Duration | Path | Visible? |\n|---|---|---:|---|---:|---|---|\n`;
  for (const p of passes) md += `| ${p.name} | ${fmtTime(p.rise, tz)} | ${p.maxElevationDeg}° | ${fmtTime(p.set, tz).split(" (")[0]} | ${Math.floor(p.durationSec / 60)}m ${p.durationSec % 60}s | ${p.riseDirection} → ${p.setDirection} | ${p.visible ? "Yes" : "No"} |\n`;
  return md;
}

export async function satellitePasses(o: { lat: number; lon: number; altitudeM?: number; satellite?: string; noradId?: string; hours?: number; minElevationDeg?: number; visibleOnly?: boolean; tz?: string; start?: string }) {
  const sel = o.noradId ? { catnr: o.noradId } : !o.satellite || /^iss$/i.test(o.satellite) ? { catnr: "25544" } : /^tiangong|css$/i.test(o.satellite) ? { catnr: "48274" } : /^hubble|hst$/i.test(o.satellite) ? { catnr: "20580" } : { name: o.satellite };
  const { tles, f } = await fetchTles(sel);
  if (!tles.length) throw new Error("No matching satellite found on CelesTrak.");
  const obs: Observer = { lat: o.lat, lon: o.lon, altKm: (o.altitudeM ?? 0) / 1000 };
  const start = o.start ? new Date(o.start) : new Date();
  let passes = tles.slice(0, 5).flatMap(t => findPasses(t, obs, start, o.hours ?? 72, { minElevationDeg: o.minElevationDeg ?? 10 }));
  passes.sort((a, b) => a.rise.localeCompare(b.rise));
  if (o.visibleOnly ?? true) passes = passes.filter(p => p.visible);
  const md = `## ${tles[0].name} passes over ${o.lat.toFixed(3)}, ${o.lon.toFixed(3)} (next ${o.hours ?? 72} h, min ${o.minElevationDeg ?? 10}°${o.visibleOnly ?? true ? ", visible only" : ""})\n\n` + (passes.length ? passTable(passes, o.tz) : "No passes match in this window. Try visibleOnly=false, a lower minElevationDeg or more hours.\n") + `\n${sourceLine(f, "CelesTrak GP elements")} TLE epoch: ${tles[0].line1.slice(18, 32).trim()}. Predictions by SGP4 (satellite.js); accuracy is about ±1 min for fresh TLEs.`;
  return { satellite: tles[0].name, observer: obs, passes, source: f.source, fetchedAt: f.fetchedAt, markdown: md };
}

export async function starlinkPasses(o: { lat: number; lon: number; altitudeM?: number; hours?: number; minElevationDeg?: number; maxResults?: number; tz?: string; mode?: "recent-trains" | "all"; start?: string }) {
  const mode = o.mode ?? "recent-trains";
  const { tles: all, f } = await fetchTles({ group: "starlink" });
  const tles = mode === "all" ? all.slice(0, 3000) : recentLaunchGroups(all, 6);
  if (!tles.length) throw new Error("No recently launched Starlink satellites found on CelesTrak. Try mode=all.");
  const obs: Observer = { lat: o.lat, lon: o.lon, altKm: (o.altitudeM ?? 0) / 1000 };
  const start = o.start ? new Date(o.start) : new Date();
  const hours = Math.min(o.hours ?? 24, mode === "all" ? 6 : 48);
  const passes = tles.flatMap(t => findPasses(t, obs, start, hours, { minElevationDeg: o.minElevationDeg ?? 30, stepSec: 30 })).filter(p => p.visible).sort((a, b) => a.rise.localeCompare(b.rise));
  // group passes within 3 minutes into "trains"
  const trains: { start: string; count: number; maxElevationDeg: number; path: string; satellites: string[] }[] = [];
  for (const p of passes) {
    const last = trains[trains.length - 1];
    if (last && new Date(p.rise).getTime() - new Date(last.start).getTime() < 3 * 60000 + last.count * 60000) { last.count++; last.maxElevationDeg = Math.max(last.maxElevationDeg, p.maxElevationDeg); last.satellites.push(p.name); }
    else trains.push({ start: p.rise, count: 1, maxElevationDeg: p.maxElevationDeg, path: `${p.riseDirection} → ${p.setDirection}`, satellites: [p.name] });
  }
  const shown = trains.slice(0, o.maxResults ?? 10);
  let md = `## Visible Starlink passes over ${o.lat.toFixed(3)}, ${o.lon.toFixed(3)} (next ${hours} h, min ${o.minElevationDeg ?? 30}°, ${mode === "all" ? "all Starlink" : "from the 6 most recent Starlink launches"}; ${tles.length} satellites checked)\n\n`;
  md += shown.length ? `| Starts | Satellites | Max elev. | Path |\n|---|---:|---:|---|\n` + shown.map(t => `| ${fmtTime(t.start, o.tz)} | ${t.count}${t.count > 1 ? " (train)" : ""} | ${t.maxElevationDeg.toFixed(0)}° | ${t.path} |`).join("\n") + "\n" : "No visible Starlink passes in this window (they need a dark sky with the satellites still sunlit, usually 1-2 h after sunset or before sunrise).\n";
  md += `\n${sourceLine(f, "CelesTrak GP elements")} Freshly launched trains are brightest; older Starlinks at operational altitude are faint.`;
  return { trains: shown, totalVisiblePasses: passes.length, satellitesChecked: tles.length, source: f.source, fetchedAt: f.fetchedAt, markdown: md };
}
