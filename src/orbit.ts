/** Satellite pass prediction from TLEs with satellite.js (SGP4), plus a solar ephemeris for visibility. */
import * as sat from "satellite.js";

const DEG = Math.PI / 180;
export interface Observer { lat: number; lon: number; altKm?: number; }
export interface Pass {
  name: string; noradId: string;
  rise: string; culminate: string; set: string; durationSec: number;
  maxElevationDeg: number; riseAzimuthDeg: number; setAzimuthDeg: number;
  riseDirection: string; setDirection: string;
  visible: boolean; visibility: string;
}

/** Low-precision solar position (Astronomical Almanac, ~0.01 deg). Returns ECI unit vector (TEME-ish, good enough) and RA/Dec. */
export function sunEci(date: Date) {
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * DEG;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  const AU = 149597870.7;
  const r = (1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g)) * AU;
  return { x: r * Math.cos(lambda), y: r * Math.cos(eps) * Math.sin(lambda), z: r * Math.sin(eps) * Math.sin(lambda) };
}

export function sunElevationDeg(date: Date, obs: Observer) {
  const s = sunEci(date);
  const gmst = sat.gstime(date);
  const ecf = sat.eciToEcf(s, gmst);
  const look = sat.ecfToLookAngles({ latitude: obs.lat * DEG, longitude: obs.lon * DEG, height: obs.altKm ?? 0 }, ecf);
  return look.elevation / DEG;
}

/** Cylindrical Earth-shadow test. */
export function isSunlit(posEci: { x: number; y: number; z: number }, date: Date) {
  const s = sunEci(date); const sm = Math.hypot(s.x, s.y, s.z);
  const u = { x: s.x / sm, y: s.y / sm, z: s.z / sm };
  const dot = posEci.x * u.x + posEci.y * u.y + posEci.z * u.z;
  if (dot > 0) return true;
  const perp = Math.hypot(posEci.x - dot * u.x, posEci.y - dot * u.y, posEci.z - dot * u.z);
  return perp > 6378.137;
}

export function compass(az: number) {
  const d = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return d[Math.round(((az % 360) + 360) % 360 / 22.5) % 16];
}

export interface Tle { name: string; line1: string; line2: string; }
export function parseTles(text: string): Tle[] {
  const lines = text.split(/\r?\n/).map(l => l.trimEnd()).filter(Boolean);
  const out: Tle[] = [];
  for (let i = 0; i + 2 < lines.length; ) {
    if (lines[i + 1]?.startsWith("1 ") && lines[i + 2]?.startsWith("2 ")) { out.push({ name: lines[i].trim(), line1: lines[i + 1], line2: lines[i + 2] }); i += 3; }
    else i++;
  }
  return out;
}

function look(satrec: sat.SatRec, t: Date, obs: Observer) {
  const pv = sat.propagate(satrec, t);
  if (!pv || !pv.position || typeof pv.position === "boolean") return null;
  const gmst = sat.gstime(t);
  const ecf = sat.eciToEcf(pv.position, gmst);
  const la = sat.ecfToLookAngles({ latitude: obs.lat * DEG, longitude: obs.lon * DEG, height: obs.altKm ?? 0 }, ecf);
  return { el: la.elevation / DEG, az: la.azimuth / DEG, eci: pv.position };
}

/** Find passes by stepping (default 20 s) then refining rise/set to ~1 s by bisection. */
export function findPasses(tle: Tle, obs: Observer, start: Date, hours: number, opts: { minElevationDeg?: number; stepSec?: number } = {}): Pass[] {
  const satrec = sat.twoline2satrec(tle.line1, tle.line2);
  const minEl = opts.minElevationDeg ?? 10; const step = (opts.stepSec ?? 20) * 1000;
  const end = start.getTime() + hours * 3600000;
  const passes: Pass[] = [];
  const elAt = (ms: number) => look(satrec, new Date(ms), obs)?.el ?? -90;
  const refine = (a: number, b: number, rising: boolean) => { for (let k = 0; k < 15; k++) { const m = (a + b) / 2; const up = elAt(m) >= minEl; if (up === rising) b = m; else a = m; } return Math.round((a + b) / 2); };
  let prevUp = elAt(start.getTime()) >= minEl; let riseMs: number | null = prevUp ? start.getTime() : null;
  let best = { el: -90, ms: 0, az: 0, eci: { x: 0, y: 0, z: 0 } };
  for (let t = start.getTime(); t <= end; t += step) {
    const l = look(satrec, new Date(t), obs); if (!l) continue;
    const up = l.el >= minEl;
    if (up && !prevUp) { riseMs = refine(t - step, t, true); best = { el: -90, ms: 0, az: 0, eci: l.eci }; }
    if (up && l.el > best.el) best = { el: l.el, ms: t, az: l.az, eci: l.eci };
    if (!up && prevUp && riseMs !== null) {
      const setMs = refine(t - step, t, false);
      const r = look(satrec, new Date(riseMs), obs)!, s = look(satrec, new Date(setMs), obs)!;
      const culm = new Date(best.ms);
      const sunEl = sunElevationDeg(culm, obs);
      const lit = isSunlit(best.eci, culm);
      const visible = lit && sunEl < -6;
      passes.push({ name: tle.name, noradId: tle.line1.slice(2, 7).trim(), rise: new Date(riseMs).toISOString(), culminate: culm.toISOString(), set: new Date(setMs).toISOString(),
        durationSec: Math.round((setMs - riseMs) / 1000), maxElevationDeg: +best.el.toFixed(1), riseAzimuthDeg: +r.az.toFixed(0), setAzimuthDeg: +s.az.toFixed(0),
        riseDirection: compass(r.az), setDirection: compass(s.az), visible,
        visibility: visible ? "Visible to the naked eye (satellite sunlit, sky dark)" : !lit ? "Not visible: satellite in Earth's shadow" : "Not visible: sky too bright (sun above -6 deg)" });
      riseMs = null; best = { el: -90, ms: 0, az: 0, eci: { x: 0, y: 0, z: 0 } };
    }
    prevUp = up;
  }
  return passes;
}
