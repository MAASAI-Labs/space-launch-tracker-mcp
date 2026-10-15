import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as S from "./space.js";

const tz = z.string().optional().describe("IANA timezone for display, e.g. Africa/Lagos, America/New_York. UTC always shown too.");
const lat = z.number().min(-90).max(90).describe("Observer latitude, decimal degrees");
const lon = z.number().min(-180).max(180).describe("Observer longitude, decimal degrees (east positive)");

const run = (fn: (a: any) => Promise<{ markdown: string } & Record<string, unknown>>) => async (a: any) => {
  try { const r = await fn(a); return { content: [{ type: "text" as const, text: r.markdown }, { type: "text" as const, text: "```json\n" + JSON.stringify({ ...r, markdown: undefined }, null, 2) + "\n```" }] }; }
  catch (e) { return { isError: true, content: [{ type: "text" as const, text: (e as Error).message }] }; }
};

export function createServer() {
  const server = new McpServer({ name: "space-launch-tracker-mcp", version: "1.0.0" });
  const ro = { readOnlyHint: true, openWorldHint: true };
  server.registerTool("upcoming_launches", { title: "Upcoming launches", annotations: ro,
    description: "Upcoming orbital launches worldwide from Launch Library 2 with live countdowns, provider, rocket, pad and status. Optional search (e.g. 'SpaceX', 'Falcon 9', 'Artemis', 'ISRO').",
    inputSchema: { limit: z.number().int().min(1).max(25).optional(), search: z.string().max(80).optional(), tz, includeRecent: z.boolean().optional() } }, run(S.upcomingLaunches));
  server.registerTool("next_launch", { title: "Next launch countdown", annotations: ro,
    description: "Countdown and details for the very next launch, optionally filtered (e.g. 'Starship', 'Rocket Lab').",
    inputSchema: { search: z.string().max(80).optional(), tz } }, run(S.nextLaunch));
  server.registerTool("starship_status", { title: "Starship status", annotations: ro,
    description: "SpaceX Starship: next scheduled flights with countdowns, most recent flight outcomes, and latest news headlines.",
    inputSchema: { tz, newsLimit: z.number().int().min(1).max(10).optional() } }, run(S.starshipStatus));
  server.registerTool("satellite_passes", { title: "ISS and satellite passes", annotations: ro,
    description: "Predict passes of the ISS (default), Tiangong, Hubble, or any satellite by name/NORAD id over a location, with naked-eye visibility (satellite sunlit, sky dark). Uses CelesTrak TLEs + SGP4.",
    inputSchema: { lat, lon, altitudeM: z.number().optional(), satellite: z.string().optional().describe("ISS (default), Tiangong, Hubble, or a CelesTrak name"), noradId: z.string().regex(/^\d{1,9}$/).optional(), hours: z.number().min(1).max(240).optional(), minElevationDeg: z.number().min(0).max(89).optional(), visibleOnly: z.boolean().optional().describe("default true"), tz, start: z.string().datetime().optional() } }, run(S.satellitePasses));
  server.registerTool("starlink_passes", { title: "Visible Starlink passes", annotations: ro,
    description: "Visible Starlink passes and 'trains' over a location. Default checks satellites from the 6 most recent Starlink launches (the bright, low trains); mode 'all' checks up to 3000 Starlinks over max 6 h.",
    inputSchema: { lat, lon, altitudeM: z.number().optional(), hours: z.number().min(1).max(48).optional(), minElevationDeg: z.number().min(0).max(89).optional(), maxResults: z.number().int().min(1).max(30).optional(), mode: z.enum(["recent-trains", "all"]).optional(), tz, start: z.string().datetime().optional() } }, run(S.starlinkPasses));
  return server;
}
