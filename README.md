# Space Launch & Starlink Tracker (MCP server)

An MCP server that gives Grok Bot (or any MCP client) live space data:

- **Upcoming launches worldwide** with live countdowns, from The Space Devs Launch Library 2
- **Starship status**: next flights, recent flight outcomes and latest headlines (Launch Library 2 + Spaceflight News API)
- **ISS / Tiangong / Hubble / any satellite** pass predictions for any lat/lon, with naked-eye visibility
- **Visible Starlink trains** for any location

It uses CelesTrak TLEs and SGP4 via [satellite.js](https://github.com/shashwatak/satellite-js). All data is public and needs no API keys. Every output cites its source URL and fetch timestamp.

## Tools

| Tool | Purpose | Key inputs |
|---|---|---|
| `upcoming_launches` | Next N launches with countdowns, provider, rocket, pad and status | `limit`, `search` (e.g. "SpaceX", "ISRO", "Artemis"), `tz` |
| `next_launch` | Countdown and details for the next launch, optionally filtered | `search`, `tz` |
| `starship_status` | Next Starship flights, last 3 flight outcomes, latest news | `tz`, `newsLimit` |
| `satellite_passes` | Passes over a location: rise/max/set, direction, duration, visible or not | `lat`, `lon`, `satellite` (ISS default) or `noradId`, `hours`, `minElevationDeg`, `visibleOnly` |
| `starlink_passes` | Visible Starlink passes grouped into trains | `lat`, `lon`, `hours`, `minElevationDeg`, `mode` (`recent-trains` or `all`) |

`tz` takes any IANA timezone (for example `Africa/Lagos`). UTC is always shown alongside it.

## Example prompts

- "When's the next SpaceX launch and how long until liftoff? Show Lagos time."
- "What's the latest on Starship? When's the next flight?"
- "Can I see the ISS from London this week? When, and in which direction should I look?"
- "Any Starlink trains visible from New York in the next two nights?"
- "List the next 10 launches from anywhere in the world."

## How it's calculated

- **Passes**: SGP4 propagation (satellite.js) at 20 s steps (30 s for Starlink), with rise and set refined to about 1 s by bisection. Accuracy is about ±1 min with fresh TLEs.
- **Visible** means the satellite is sunlit (cylindrical Earth-shadow model) and the sun is below −6° (civil twilight or darker) at the observer at maximum elevation.
- **Sun position**: low-precision Astronomical Almanac formula (~0.01°).
- **Starlink "recent trains"**: satellites from the 6 most recent Starlink launches, by international designator. These are the low, bright trains people notice. `mode: "all"` checks up to 3,000 Starlinks, limited to 6 h.

## Polite use of public APIs

- In-memory caching per URL:
  - Launch Library 2: 10 min. The free tier allows 15 requests per hour per IP. Set `LL2_BASE_URL=https://lldev.thespacedevs.com/2.3.0` for development.
  - CelesTrak: 2 h, which is their requested minimum re-download interval.
  - Spaceflight News: 10 min.
- Concurrent identical requests are merged into one.
- If upstream fails or rate-limits (HTTP 429), the last cached copy is returned and clearly marked STALE.
- Requests send a descriptive User-Agent.

## Run locally

```bash
npm install
npm test             # unit tests (vitest; mocked network)
npm run build
npm start            # Streamable HTTP at http://localhost:3000/mcp
npm run start:stdio  # stdio for desktop MCP clients
npm run smoke        # live: lists tools and calls every tool against the local HTTP server
```

## Deploy to Vercel

1. Push to GitHub and import it at vercel.com/new (Framework preset: Other). No environment variables are required.
2. `api/mcp.ts` is the function. `vercel.json` rewrites `/mcp` to it. The MCP URL is `https://<project>.vercel.app/mcp`.
3. Check it with `node scripts/smoke.mjs https://<project>.vercel.app/mcp`.

The server is stateless with JSON responses. On serverless, the cache only lasts per warm instance. All Vercel functions share egress IPs, so if Launch Library 2 rate-limits the deployment, use a Space Devs API key: their Patreon tiers raise the limit. `starlink_passes` with `mode: "all"` is CPU-heavy, so keep the default mode on Hobby.

## Testing instructions for marketplace reviewers

No credentials needed.

1. List tools. You should see 5.
2. `upcoming_launches` with `{"limit": 5, "tz": "Africa/Lagos"}`: a table of launches with T- countdowns and a "Source: The Space Devs Launch Library 2 … fetched <timestamp>" line.
3. `starship_status` with `{}`: next flights, recent flight outcomes and 5 linked headlines.
4. `satellite_passes` with `{"lat": 51.5, "lon": -0.12, "hours": 120, "tz": "Europe/London"}`: visible ISS passes with rise time, max elevation and direction. Add `"visibleOnly": false` to see every pass, with a reason when one isn't visible.
5. `starlink_passes` with `{"lat": 40.71, "lon": -74.0, "hours": 48, "minElevationDeg": 15}`: Starlink trains (or a clear "none visible" explanation).
6. Bad input, such as `satellite_passes` with `{"lat": 100, "lon": 0}`, returns a validation error.

## Data sources and attribution

- [The Space Devs, Launch Library 2](https://thespacedevs.com/llapi)
- [Spaceflight News API](https://spaceflightnewsapi.net)
- [CelesTrak](https://celestrak.org) (Dr. T.S. Kelso)

Predictions are for information only.

## License

MIT
