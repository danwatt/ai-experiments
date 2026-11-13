The title band above a group of tiles: what the group is, how big it is, and what you can do to all of it at once.

Built by `faceGroupHeader()` in `face-grid.js`. A flex row with a `face-group-label` on the left, an inline `face-group-meta` after it, and a `face-group-btns` cluster on the right, wrapping under at narrow widths.

## When to use

At the top of every `GroupSection`. Pick the tint by what the group *is*, because this — not the section tint — is where colour carries meaning:

- **default** (`accent-header` / `accent-quiet`) — a neutral grouping: a day, an event, a cluster.
- **`.green`** (`success-surface` / `success-quiet`) — already labeled or already geotagged.
- **`.blue`** — a machine suggestion awaiting review.
- **`.amber`** (`warn-surface` / `warn-quiet`) — a crowd, or a come-back queue: deferred, not dismissed.
- **`.grey`** (`pane` / `ink-dim`) — ignored or excluded.

## What the consumer provides

The label, an optional meta string (count, place, time span) and the bulk actions. Buttons inside the header run at 11px; icon-only ones use `.icon-btn` and always carry a `title`.

## Don't

- Don't put a per-item action here — these buttons act on the whole group.
- Don't use a tint the section's content contradicts; a green header over unlabeled faces is a bug, not a style choice.
- Don't let the meta carry a fact the label doesn't already imply.
