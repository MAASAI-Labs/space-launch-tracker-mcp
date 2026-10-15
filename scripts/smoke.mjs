// Live smoke test: node scripts/smoke.mjs [url]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(process.argv[2] ?? "http://localhost:3000/mcp")));
console.log("tools:", (await client.listTools()).tools.map(t => t.name).join(", "));
const calls = [
  ["upcoming_launches", { limit: 5, tz: "Africa/Lagos" }],
  ["next_launch", { search: "Falcon 9" }],
  ["starship_status", { newsLimit: 3 }],
  ["satellite_passes", { lat: 6.5244, lon: 3.3792, hours: 72, tz: "Africa/Lagos" }],
  ["starlink_passes", { lat: 40.7128, lon: -74.006, hours: 24, tz: "America/New_York", maxResults: 5 }],
];
for (const [name, args] of calls) {
  const t = Date.now(); const r = await client.callTool({ name, arguments: args });
  console.log(`\n===== ${name} (${Date.now() - t} ms)${r.isError ? " ERROR" : ""}\n${r.content[0].text}`);
}
await client.close();
