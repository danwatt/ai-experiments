The dark card a Leaflet marker opens, the dot that opens it, and the basemap switcher that sits beside them.

Leaflet ships a light popup; the app overrides `.leaflet-popup-content-wrapper` and `.leaflet-popup-tip` to `chrome` with a `field-border`, `radius-6` and `shadow-popup` so a popup reads as part of the app rather than part of the map.

## When to use

Three shapes, all over a map:

- **Place popup** (170px) — a place from the offline GeoNames index: name in 13px 600 `ink-strong`, region, country and a meta line stepping down through `#bbb`, `ink-soft`, `ink-dim`.
- **Source photo popup** (150px) — shown on a guess marker: a 150×150 cover thumbnail flush to the top corners, then the filename in `micro` and its timestamp in 11px 600 `ink-muted`. Its wrapper zeroes the popup's padding so the image can bleed.
- **`.place-dot`** — a 10px `marker` circle with a 1.5px black ring and a soft black shadow, so an amber dot survives both a satellite tile and a pale street tile.

The **basemap switcher** is a `rgba(30,30,30,.92)` control with `shadow-control`: stacked 11px buttons on a `hairline` divider, the current one filled `accent-fill` with an `accent-text` label.

## What the consumer provides

The content and Leaflet's `className` on the popup options (`map-popup-wrap`, `source-popup-wrap`). Keep the width fixed — a popup that resizes to its content jumps the map.

## Don't

- Don't let a popup inherit Leaflet's default light styling on a new map.
- Don't put an action in a place popup; it is a read-out.
- Don't use `accent` for a map marker — over blue water it disappears. That is why the dot is `marker` amber.
