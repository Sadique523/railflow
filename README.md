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
| Drag / right-drag / wheel | Pan / rotate / zoom (also `WASD`, `Q`/`E`). |
| `Space`, `1`–`4` | Pause, game speed. |

Trains shuttle back and forth between their first and last stop and call at every stop in between.

## Scoring

- **Happiness**: rolling average over delivered passengers. Short waits, on-time arrivals, comfortable trains and seats for everyone push it up. Passengers who wait more than 6 h give up and drag it down.
- **Punctuality**: share of the last 60 arrivals that were within 5 minutes of the timetable.
- **Score**: every delivered passenger adds points scaled by trip length and happiness, with a bonus for on-time arrivals.
- **Rating**: A+ to E, from happiness and punctuality combined.
- **Funds** (₹ Cr): fares come in, and track, trains and per-hour running costs go out.

Single lines are split into ~50 km signal blocks with crossing loops between them. Opposing trains have to wait at a loop to cross. Doubling a line lets them pass freely and lets trains follow closely. Random fog, monsoon rain, signal failures and festival rushes keep things interesting.

## Code map

- `src/data`: cities (lat/lon/population), coastline and projection, train presets (`trainTypes.ts`; add new types here for custom trains later)
- `src/sim`: pure simulation: `network.ts` (track graph, Dijkstra), `train.ts` (path, blocks, timetable), `game.ts` (signalling, passengers, economy, events, save/load)
- `src/render`: Three.js scene: `stage.ts` (camera, lights, AO), `world.ts` (land, stations, buildings), `tracks.ts`, `trains.ts`
- `src/ui`: HUD and panels (`app.ts` controller, `builder.ts` train builder, `inspector.ts`)

Progress autosaves to `localStorage` every 15 seconds.
