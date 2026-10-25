# Overhead

Live aircraft around you, in the browser: 2D map, tilted 3D map with altitude, and a
"Sky" dome showing what is above you — all rotatable to match the direction you face.

```bash
python3 overhead/server.py      # http://localhost:8795
```

No build step, no dependencies beyond Python 3 stdlib. MapLibre GL + deck.gl load from unpkg;
basemap tiles from OpenFreeMap.

## Why a backend?

None of the open ADS-B APIs send CORS headers, so `server.py` proxies them. It also
normalizes the three formats to one shape, caches per area (one upstream call shared by
all tabs), backs off on HTTP 429, and serves stale data during outages so the client can
keep interpolating. Only a location rounded to ~1 km (2 decimals) is sent upstream.

| Provider | Updates | Notes |
| --- | --- | --- |
| **adsb.fi** (default) | ~1 s | Open data, includes registry info (type description, owner, year) |
| adsb.lol | polled every 5 s | ODbL. Anonymous limit 60 req/min, 500 req/day per IP |
| OpenSky Network | polled every 15 s | ~400 anon credits/day; set `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` for 4000 |

## Timing modes

- **Live** — newest fix for each aircraft, dead-reckoned forward along track/speed between
  updates (toggle in Settings). When a new fix corrects the estimate, the icon eases to it
  over ~0.3 s instead of jumping.
- **Smooth** — renders `now − delay` (auto = 2 × poll interval + 2 s, or set manually), so
  every frame sits *between* two real fixes. Positions use cubic Hermite interpolation with
  each fix's reported velocity, so turns curve instead of zig-zagging. Falls back to linear
  when velocity and chord disagree (MLAT noise). Most useful with OpenSky's slow updates.

## Views

- **2D** — top-down, icons by size class (light, jet, heavy, high-performance, rotorcraft).
- **3D** — procedural low-poly meshes at altitude (exaggeration adjustable), pitched for
  climb/descent and banked from turn rate, with drop lines and ground shadows. Right-drag
  or two fingers to orbit/tilt.
- **Sky** — polar plot: centre is straight up, rim is the horizon (square-root elevation
  scale, since most traffic is within 10° of the horizon). Not mirrored: an aircraft on your
  right when you face that way is on the right. Elevation corrects for earth curvature and
  your elevation (Settings).

**Recentre** with ⌖ under the compass, `H`, or right-click the map (long-press on touch) for a
menu: recentre on your location, centre here, face toward this point, or set your location here.

**Rotation** is shared by all views: drag/scroll the compass dial, Q/E, N for north-up,
right-drag the map, or on a phone tap ◉ to follow the device compass so the top of the
screen is the way you face. The details card tells you where to look ("40° left, 12° up").

## Origin / destination

ADS-B carries no flight plan, so `/api/routes` looks callsigns up in two community route
databases — [adsbdb](https://www.adsbdb.com) and adsb.lol's copy of the Virtual Radar Server
standing data — cached per callsign for 12 h (misses 3 h). They are *schedules*: flight numbers
get reused across legs and days, and the two sources often disagree.

So the client grades every candidate leg against what the aircraft is doing: distance off the
great circle and progress along it, heading toward the destination, low and close to one end of
the leg, climbing out / descending in, on the ground at a different airport. Result is
**likely**, **possible** or **unlikely**; unlikely routes are not shown, only explained in the
details card. Likely/possible routes appear in labels and the list (`SFO→DFW`), in the details
card with progress, and as a dashed great-circle line to the destination (descending to field
elevation in 3D, across your sky in Sky view). Settings: route lines for selected / all / off,
route in labels on/off.

## Airports, runways in use

Airports and runways come from [OurAirports](https://ourairports.com/data/) (public domain),
downloaded once into `data/` and refreshed monthly. Runways are drawn to scale; at higher zoom
runway-end numbers appear.

Which runways are in use is inferred from live traffic over the last 20 minutes:

- **arrival** — aligned with a runway (±20°), on its extended centreline within 10 nm, at or
  below roughly a 3° glide path and not climbing;
- **departure** — aligned, past the far end of the runway, climbing.

Each aircraft counts once per pass, on its best-aligned runway (so parallels don't double
count); helicopters and slow movers are ignored. Active runways turn green (landing) or blue
(taking off), with dashed guides for the final approach (sloping at 3° in 3D) and the climb-out.
The **Runways in use** card shows each busy airport's flow ("DAL · NW flow ↓31R 31L ↑31L") and
tells you when your location sits under an active approach or departure path, with roughly how
high arrivals pass. Click an airport to fly there.

## Sun, sky and heatmap

- **Sun lighting (3D)** — the sun's real position lights the aircraft meshes (warm and low at
  golden hour, off at night), aircraft cast shadows on the ground away from the sun, and the
  tilted view gets a matching sky and horizon. The compass dial shows a sun marker.
- **Map style "Auto"** — light basemap from just before sunrise to just after sunset, dark at night.
- **Sky view** — the dome takes the sky's colour for the time of day and shows the sun.
- **Traffic heatmap** — `server.py` counts every fresh position into a ~500 m grid in
  `data/heat.sqlite` (by altitude band and 10-minute slot) whenever it is polling. Show the last
  hour, 6 h, 24 h, 7 days or everything, filtered to ground (taxiways), below 10,000 ft
  (approach/departure corridors) or en route.

## Filters

Search (callsign/reg/hex/type/owner/squawk), altitude range, include-ground, size class
(ADS-B emitter category, falling back to type designator), operator kind (airline, cargo,
charter/fractional, private/GA, military/gov, no callsign), climbing/level/descending,
airline (from ICAO callsign prefix; chips show what is in range), type prefix list
(`B738, A32, B77`), airport (`DFW` either end, `>DFW` arriving, `<DAL` departing), min speed, max distance, military flag. Colour by altitude, size,
operator or airline.

## Keys

`1` `2` `3` views · `L` live · `S` smooth · `Q`/`E` rotate · `N` north up · `H` recentre ·
`F` filters · `T` cycle trail length · `Esc` deselect

## Files

- `server.py` — static server, `/api/aircraft` proxy, `/api/routes`, `/api/airports`, `/api/heat`
- `airports.py` — OurAirports download, parse and nearby lookup
- `heat.py` — traffic density recorder (SQLite)
- `js/store.js` — polling, per-aircraft history, interpolation / dead reckoning
- `js/mapview.js` — MapLibre + deck.gl layers (icons, meshes, trails, runways, heatmap, lighting)
- `js/skyview.js` — canvas sky dome
- `js/meshes.js` — procedural aircraft meshes
- `js/classify.js` — size class, operator kind, airline names
- `js/routes.js` — origin/destination lookup and plausibility grading
- `js/runways.js` — runway-in-use detection, approach/departure guides
- `js/sun.js` — solar position and time-of-day lighting/sky colours
- `js/main.js` — UI, filters, render loop
