# Railflow

A minimal, top-down train network game set in India. Lay track between real Indian cities, build trains from presets, and keep passengers happy and trains on time. There is no end goal; you just keep improving your score.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

## Play

| Key | Action |
| --- | --- |
| `T` | Track tool: click a city, then another. Keep clicking to chain lines. Right-click/Esc cancels. |
| `N` | New train: pick a preset, number of coaches and stops (click cities on the map or use the list). |
| `V` / `Esc` | Select: click a station, train or line to inspect it. |
| `R` | Research: unlock train types, faster track and Kavach, one project at a time. |
| `C` | Traffic view: every line coloured from green (quiet) to red (trains queueing). |
| `M` | Money: profit per hour, a 24 h chart of fares vs running costs, and profit by train. Also opens from the Funds panel. |
| Drag / right-drag / wheel | Pan / rotate / zoom (also `WASD`, `Q`/`E`). |
| `Space`, `1`–`4` | Pause, game speed. |

You start with MEMU and Express trains on 110 km/h track. Research unlocks LHB coaches (Shatabdi, Rajdhani), 130 km/h track, Kavach train protection, Vande Bharat, 160 km/h track and finally high-speed lines with the bullet train. A train only runs as fast as the line allows, so new trains need upgraded lines. Upgrading or doubling a line means days of works: the line drops to a quarter of its speed (and to one track if it was double), and trains divert by the fastest way round if you have built one. Lines above 110 km/h without Kavach see signal incidents.

Freight pays the bills, as on the real Indian Railways. Goods trains load coal at Dhanbad, Ranchi, Raipur and Nagpur; steel and ore at Ranchi, Raipur, Bhubaneswar and Visakhapatnam; grain in Punjab and Madhya Pradesh; and containers at the ports and inland depots. They earn by tonne and distance when they unload (coal trains usually come back empty; containers fill both ways), but they are slow and hold up passenger trains on shared lines. Research unlocks WAG-12 heavy haul, dedicated freight corridors (a separate double-track freight line built alongside an existing one, without disrupting it) and double-stack container trains that only run on corridors.

Passengers come in three classes. Most travel general class and only board cheap trains (MEMU, Express); a smaller AC crowd and a thin premium crowd pay more, ride the premium trains and care most about speed. Faster and more frequent service between two stations brings more passengers.

Trains shuttle back and forth between their first and last stop and call at every stop in between. At the end of the line they stop under the station's train shed and change ends (push-pull) instead of running round.

## Scoring

- **Happiness**: rolling average over delivered passengers. Short waits, on-time arrivals, comfortable trains and seats for everyone push it up. Passengers who wait more than 6 h give up and drag it down.
- **Punctuality**: share of the last 60 arrivals that were within 5 minutes of the timetable.
- **Score**: every delivered passenger adds points scaled by trip length and happiness, with a bonus for on-time arrivals.
- **Rating**: A+ to E, from happiness and punctuality combined.
- **Upkeep**: every km of track costs money each day, more for double and faster lines, so do not build lines nobody uses.
- **Funds** (₹ Cr): fares come in when passengers get off (a green `+₹` pops up at the station), and track, trains and per-hour running costs go out. The arrow next to Funds is your profit per hour.

Single lines are split into ~50 km signal blocks with crossing loops between them. Opposing trains have to wait at a loop to cross. Doubling a line lets them pass freely and lets trains follow closely. Random fog, monsoon rain, signal failures and festival rushes keep things interesting.

## Code map

- `src/data`: cities (lat/lon/population), freight flows (`freight.ts`), projection, world and play-area extents (`geo.ts`), country borders and rivers (`mapdata.json`), train presets (`trainTypes.ts`; add new types here for custom trains later)
- `src/sim`: pure simulation: `network.ts` (track graph, Dijkstra), `train.ts` (path, blocks, timetable), `game.ts` (signalling, passengers, economy, events, save/load), `ledger.ts` (money booked by flow and hour); `src/data/research.ts` holds the research tree and line speed classes
- `src/render`: Three.js scene: `stage.ts` (camera, lights, AO), `terrain.ts` (endless sea, land plates, painted map, haze), `world.ts` (stations, buildings), `tracks.ts`, `trains.ts`
- `src/ui`: HUD and panels (`app.ts` controller, `builder.ts` train builder, `inspector.ts`)

`mapdata.json` is generated from [Natural Earth](https://www.naturalearthdata.com/) (public domain) by `scripts/build-mapdata.mjs`; see the script header for how to rebuild it.

Progress autosaves to `localStorage` every 15 seconds.
