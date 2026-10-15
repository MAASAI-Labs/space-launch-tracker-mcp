import { describe, it, expect, vi, beforeEach } from "vitest";
import { countdown, mapLaunch, upcomingLaunches, fmtTime } from "../src/space";
import { parseTles, findPasses, sunElevationDeg, isSunlit, compass } from "../src/orbit";
import { cachedFetch, clearCache } from "../src/cache";

const ISS = `ISS (ZARYA)
1 25544U 98067A   26286.82178372  .00006592  00000+0  12831-3 0  9991
2 25544  51.6325  73.0089 0006710 259.3258 100.6975 15.48855783590140`;

describe("time helpers", () => {
  it("countdown formats T- and T+", () => {
    const now = new Date("2026-10-15T00:00:00Z");
    expect(countdown("2026-10-16T01:02:03Z", now)).toEqual({ seconds: 90123, text: "T- 1d 1h 2m 3s" });
    expect(countdown("2026-10-14T23:00:00Z", now).text).toBe("T+ 1h 0m 0s");
  });
  it("fmtTime renders timezone and rejects bad zones", () => {
    expect(fmtTime("2026-10-15T12:00:00Z", "Africa/Lagos")).toContain("13:00");
    expect(() => fmtTime("2026-10-15T12:00:00Z", "Mars/Olympus")).toThrow(/Unknown timezone/);
  });
});

describe("orbit math", () => {
  it("parses 3-line TLE sets", () => {
    const t = parseTles(ISS + "\n" + ISS);
    expect(t).toHaveLength(2); expect(t[0].name).toBe("ISS (ZARYA)");
  });
  it("sun is near zenith at 0,0 on the March equinox at noon UTC, and below horizon at midnight", () => {
    expect(sunElevationDeg(new Date("2026-03-20T12:07:00Z"), { lat: 0, lon: 0 })).toBeGreaterThan(87);
    expect(sunElevationDeg(new Date("2026-03-20T00:00:00Z"), { lat: 0, lon: 0 })).toBeLessThan(-80);
  });
  it("shadow model: point on the sun side is lit, point directly behind Earth is dark", () => {
    const d = new Date("2026-06-21T00:00:00Z");
    // At June solstice the sun is near +Y/+Z ECI; -Y at 7000 km is in shadow.
    expect(isSunlit({ x: 0, y: 7000, z: 0 }, d)).toBe(true);
    expect(isSunlit({ x: 0, y: -7000, z: 0 }, d)).toBe(false);
  });
  it("compass", () => { expect(compass(0)).toBe("N"); expect(compass(225)).toBe("SW"); expect(compass(359)).toBe("N"); });
  it("finds plausible ISS passes over Lagos in 48h from TLE epoch", () => {
    const [tle] = parseTles(ISS);
    const passes = findPasses(tle, { lat: 6.5244, lon: 3.3792 }, new Date("2026-10-13T20:00:00Z"), 48, { minElevationDeg: 10 });
    expect(passes.length).toBeGreaterThanOrEqual(2);
    for (const p of passes) {
      expect(p.durationSec).toBeGreaterThan(30); expect(p.durationSec).toBeLessThan(11 * 60);
      expect(p.maxElevationDeg).toBeGreaterThanOrEqual(10); expect(p.maxElevationDeg).toBeLessThanOrEqual(90);
      expect(new Date(p.set).getTime()).toBeGreaterThan(new Date(p.rise).getTime());
    }
    // deterministic
    expect(findPasses(tle, { lat: 6.5244, lon: 3.3792 }, new Date("2026-10-13T20:00:00Z"), 48)).toEqual(passes);
  });
  it("ISS never rises above 10 deg at the South Pole (inclination 51.6)", () => {
    const [tle] = parseTles(ISS);
    expect(findPasses(tle, { lat: -89.9, lon: 0 }, new Date("2026-10-13T20:00:00Z"), 24)).toHaveLength(0);
  });
});

describe("Launch Library 2 mapping and polite caching", () => {
  beforeEach(() => clearCache());
  const fixture = { results: [{ id: "abc", name: "Falcon 9 | Starlink 12-3", net: "2026-10-16T00:00:00Z", net_precision: { name: "Minute" }, status: { name: "Go for Launch" },
    launch_service_provider: { name: "SpaceX" }, rocket: { configuration: { full_name: "Falcon 9 Block 5" } }, pad: { name: "SLC-40", location: { name: "Cape Canaveral, FL, USA" } }, mission: { description: "Starlink", orbit: { name: "LEO" } }, probability: 90 }] };
  it("maps LL2 records", () => {
    const l = mapLaunch(fixture.results[0], new Date("2026-10-15T00:00:00Z"));
    expect(l).toMatchObject({ name: "Falcon 9 | Starlink 12-3", provider: "SpaceX", rocket: "Falcon 9 Block 5", status: "Go for Launch", probability: 90 });
    expect(l.countdown.seconds).toBe(86400);
  });
  it("upcomingLaunches cites source + timestamp and caches (one upstream call)", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(fixture), { status: 200 }));
    const a = await upcomingLaunches({ limit: 5, includeRecent: true });
    const b = await upcomingLaunches({ limit: 5, includeRecent: true });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(a.markdown).toMatch(/Source: The Space Devs Launch Library 2/);
    expect(a.markdown).toContain("Falcon 9 \\| Starlink 12-3");
    expect(b.launches).toHaveLength(1);
    spy.mockRestore();
  });
  it("serves stale cache on 429 and errors clearly when no cache", async () => {
    const ok = vi.fn().mockResolvedValueOnce(new Response("{\"v\":1}", { status: 200 })).mockResolvedValue(new Response("", { status: 429 }));
    await cachedFetch("https://x.test/a", 0, { fetchImpl: ok as any });
    const s = await cachedFetch<any>("https://x.test/a", 0, { fetchImpl: ok as any });
    expect(s.stale).toBe(true); expect(s.data.v).toBe(1);
    await expect(cachedFetch("https://x.test/b", 0, { fetchImpl: ok as any })).rejects.toThrow(/Rate limited/);
  });
  it("de-duplicates concurrent requests", async () => {
    const f = vi.fn().mockImplementation(async () => new Response("{}", { status: 200 }));
    await Promise.all([cachedFetch("https://x.test/c", 1000, { fetchImpl: f as any }), cachedFetch("https://x.test/c", 1000, { fetchImpl: f as any })]);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("Starlink recent-launch selection", () => {
  it("keeps only the N most recent launch designators", async () => {
    const { recentLaunchGroups } = await import("../src/space");
    const mk = (d: string) => ({ name: "STARLINK-" + d, line1: `1 99999U ${d}A   26286.0 ...`, line2: "2" });
    const r = recentLaunchGroups([mk("19029"), mk("26118"), mk("26117"), mk("26118"), mk("25300")], 2);
    expect(r.map(t => t.line1.slice(9, 14))).toEqual(["26118", "26117", "26118"]);
  });
});
