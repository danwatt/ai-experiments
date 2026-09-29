# Selah — Worship Planner (UI mockup)

Static HTML/CSS/JS mockup of a worship-planning app for churches of Christ (a cappella congregational singing).
No build step and no dependencies.

## Run

Open `index.html` directly, or serve the folder:

```bash
python3 -m http.server 5178
```

- `index.html` — **desktop app** (cross-platform desktop target)
- `fluent/index.html` — the **same desktop app restyled with Fluent** (Uno Platform / WinUI look). See `fluent/UNO-FLUENT-MAPPING.md` for the control-by-control mapping to XAML.
- `mobile.html` — **mobile companion** (metadata only, no sheet-music slides)

## Desktop: what to try

- **Order of service** (middle column): drag to reorder, click a row to edit, `⋯` for duplicate/move/remove. Services aren't timed, so there are no durations or clock times.
  Sections follow a typical Church of Christ assembly (Gathering, The Lord's Supper, Giving, The Word, Response).
- **Empty song slot** (“Choose invitation song…”): click it. The library opens pre-filtered for that purpose and sorted by longest-since-sung.
- **Hymn library** (right): full-text search across title, first line, lyrics, tune, author, scripture reference and hymnal number
  (`blood`, `Eph 2`, `SFP 236`). Topic chips, key/time/meter/hymnal filters, sort, list or slide-grid view.
  Arrow keys move through results, Enter adds, drag a result into the order.
- **Preview**: sheet-music slide for each verse/refrain, start pitch (with a playable tone), meter, tune, hymnal numbers, scripture, topics, 12-month usage history, license.
- **Selected item**: choose slides to include, shift the starting pitch, pick the hymnal number to announce, assign people, add notes.
- **Plan check**: flags open slots, recently sung hymns, big key jumps between songs, unassigned items.
- **Slide deck / Present** (`F5`): the assembled deck, including hymn slides, scripture, communion and prayer slides.
- `⌘K` / `Ctrl+K` or `/` focuses search. Light/dark toggle in the top bar.

## Mobile: what to try

Plan (view/reorder, add hymns), Hymns (metadata search), Live (song-leader view with start pitch + announce number), Me (accept/decline assignments).

## Notes

- Sheet-music slides are generated procedurally in `js/notation.js` so the mockup shows realistic hymn-slide layouts. Real slides would be images from the slide database.
  Clef glyphs use Unicode music symbols and rely on a system font that has them (macOS/Windows have one).
- Data in `js/data.js` is **sample data**: hymnal numbers, usage history, and slide counts are illustrative. Lyrics are limited to public-domain hymns; licensed songs carry no lyrics.
- Not implemented: real persistence, sync, accounts, team management, PPTX export (buttons show a confirmation toast).
