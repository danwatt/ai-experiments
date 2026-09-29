# Selah desktop planner: technical handoff

This document specifies the **desktop planner UI** in `index.html` (the non-Fluent version) so it can be implemented against an existing app and database.
It covers the layout, every element on screen, every interaction and the business rules behind them, plus a data model and API sketch that the UI needs.

- Open the mockup with `index.html` (see `README.md`). Everything described below can be observed there.
- The reference implementation is `js/app.js` (UI), `js/core.js` (search, pitch math, plan checks), `js/data.js` (sample data shapes), `js/notation.js` (placeholder slide art), `css/app.css` and `css/tokens.css` (styling).
- The read-only phone app is specified separately in `MOBILE-PLAN.md`. Its publish snapshot is produced from this app's data.
- A Fluent/Uno-styled variant exists in `fluent/`. It has the same behavior and a different skin, and is not covered here.

**Treat the mockup as a behavior spec, not as code to port.** §12 lists shortcuts in the mockup that a real build shouldn't copy.

---

## 1. What the product does

A worship planner for a church of Christ (a cappella congregational singing). A planner builds the **order of service** (songs, prayers, Scripture, the Lord's Supper, giving, the sermon) for a given service. The strongest feature is **finding hymns quickly** in a database of PowerPoint-ready sheet-music slides, adding them to the order, and producing the slide deck.

Domain notes that shape the UI:

- Singing is a cappella, so the **key and starting note** of each hymn are first-class data. The song leader gets a starting pitch (with an audible tone).
- Hymns are announced by **hymnal number**. A hymn can be in several hymnals (e.g. SFP 236, GSC 190), so the planner chooses which number to announce.
- Congregations avoid repeating songs too soon, so **when a hymn was last sung** matters when choosing.
- A service has recognizable parts: Gathering, The Lord's Supper, Giving, The Word, Response. Several song slots have a purpose (opening, communion, invitation, closing).
- Services are **not timed**. There are no durations or clock times anywhere in the product.

## 2. Screen layout

Single window, desktop-first (tested at 1280 to 1480 px wide).

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ TOP BAR (52px)  logo · Selah   Services › Title · Oct 4      sync  theme  Share▾ Export▾ Present F5  Mobile→  avatar │
├───────────┬────────────────────────┬─────────────────────────────────────────────────────────┤
│ SIDEBAR   │ ORDER COLUMN           │ WORKSPACE                                               │
│ 236px     │ 390–440px              │ flexible                                                │
│           │ ┌────────────────────┐ │ ┌─ tabs: Hymn library | Selected item | Slide deck ───┐ │
│ Upcoming  │ │ Service header     │ │ │  (one pane visible at a time)                       │ │
│  • Oct 4  │ │  title, date,      │ │ │                                                     │ │
│  • Oct 4  │ │  item count, tags  │ │ │  LIBRARY pane:                                      │ │
│  • Oct 7  │ ├────────────────────┤ │ │  ┌ context banner ─────────────────────────────┐    │ │
│  • Oct 11 │ │ Order list         │ │ │  │ [search box]                                │    │ │
│ Recent    │ │  GATHERING         │ │ │  │ [topic chips ………………………………………………]         │    │ │
│  • Sep 27 │ │   row  row  row    │ │ │  │ [Filters▾]        Sort ▾  [list|grid]       │    │ │
│           │ │  THE LORD'S SUPPER │ │ │  ├───────────────────────┬─────────────────────┤    │ │
│ Team      │ │   row  row         │ │ │  │ Results (scroll)      │ Preview (scroll)    │    │ │
│ Requests  │ │  GIVING …          │ │ │  │  thumb + metadata     │  big slide, facts,  │    │ │
│ DB card   │ │ [+ Add to order]   │ │ │  │  … [+]                │  pitch ▶, history,  │    │ │
│           │ ├────────────────────┤ │ │  │                       │  [Add to service]   │    │ │
│           │ │ Plan check  (n) ▾  │ │ │  └───────────────────────┴─────────────────────┘    │ │
│           │ └────────────────────┘ │ └─────────────────────────────────────────────────────┘ │
└───────────┴────────────────────────┴─────────────────────────────────────────────────────────┘
```

- Three columns fill the viewport height. **Each column scrolls independently**. The window itself never scrolls at ≥ 980 px.
- **Responsive rules in the mockup:**
  - `< 1360 px`: sidebar collapses to a 64 px icon rail (date tiles only).
  - `< 1180 px`: preview pane is hidden (a production build should make it a slide-over or a collapsible pane instead of removing it).
  - `< 980 px`: columns stack and the page scrolls.
- **Overlays:** a context menu (`#menu`), toasts (bottom center), and a full-screen presenter.
- **Themes:** light and dark, from CSS custom properties in `css/tokens.css`. The theme follows the OS on first load and the top-bar toggle overrides it (persisted per user).

## 3. Screen inventory

### 3.1 Top bar

| Element | Behavior |
|---|---|
| Logo + "Selah / Worship Planner" | Static |
| Breadcrumb `Services › {service title} · {Mon D}` | Read-only; mirrors the current service (updates live while the title is typed) |
| Sync pill "Synced · offline ready" | Click shows a toast with the slide database version and hymn count. In production: real sync status (see §11). |
| Theme toggle | Toggles light/dark, persisted |
| **Share ▾** | Menu: *Publish to mobile app* (notifies the team), *Email assignments*, *Copy read-only link* |
| **Export ▾** | Menu: *PowerPoint (.pptx)* with slide count, *PDF slide handout*, *Song leader sheet* (pitches + keys), *Printable bulletin*, *Copy order as text* |
| **Present** (F5) | Opens the full-screen presenter at slide 1 |
| "Mobile app →" link | Demo link only (mockup) |
| Avatar | Current user; static |

### 3.2 Sidebar (services)

- **Upcoming** list, with "+ New", and **Recent** list (completed services). Sorted by date ascending within each group.
- Each service row: date tile (month + day), service kind (e.g. "Sunday Morning"), item count, and a **status pill**:
  - `Complete` for finished services;
  - otherwise `N open` (warn) when N song slots have no hymn;
  - otherwise `Ready` (ok).
- Selected service is highlighted. Clicking a service loads it, **clears the item selection and search context, and switches to the Hymn library tab**.
- **"+ New"** creates a service from the Sunday-morning template (empty song slots with purposes: opening, general, communion, invitation, closing prayer, and so on), dated the next free Sunday, and opens it.
- Footer: "Team & roles" and "Song requests" (stubs), and a **database card** ("Slide database, N hymns · version · downloaded for offline use").

### 3.3 Order column

**Service header**
- Editable **title** (text input, saves as you type; sidebar and breadcrumb update).
- Meta line: long date, "N items · M songs", optional *Theme* tag, optional sermon *scripture* tag.

**Order list** (the main object)
- Items are grouped under **section headers** (Gathering, The Lord's Supper, Giving, The Word, Response). A header is shown whenever an item's section differs from the previous item's.
- **Row anatomy:** drag grip (visible on hover) · type icon tile · title · subtitle · overflow (⋯) button.
  - Title: hymn title in serif for songs with a hymn, otherwise the item title.
  - Subtitle (dot-separated), by kind:

| Item state | Title | Subtitle |
|---|---|---|
| Song with hymn | Hymn title | leader name (or "No leader") · `Key {K}` · `start {note} ({solfege})` · time signature · `{hymnal code} {number}` (the announced hymnal) · optional warn text `sung {ago}` when sung < 21 days ago |
| Song slot, no hymn ("open slot") | "Choose {purpose}…" | leader · "Search the library →". Dashed border. |
| Other item | Item title | assignee (or "Unassigned", warn color) · scripture reference if any |

- **States:** hover, selected (accent background), open slot (dashed), being dragged (faded), drop indicator (accent line above/below the target row).
- Item **types** and their icon colors: Song, Prayer, Scripture reading, Lord's Supper, Contribution, Sermon/Lesson, Welcome/Announcements, Other.
- Below the list: **"+ Add to order"** button (opens the Add menu) and the hint "Drag hymns from the library straight into the order".

**Plan check dock** (pinned to the bottom of the column): "Plan check" header with a count badge (amber) or a green ✓ "All clear". Clicking toggles an expandable list of findings. Each finding is a button that selects the offending item. Rules are in §7.4.

### 3.4 Workspace tabs

`Hymn library` · `Selected item` · `Slide deck (N)` · right-aligned database note ("N hymns · slide database vX"). Exactly one pane is visible. The tab shows `N` = number of slides in the current deck.

### 3.5 Library pane

Top to bottom:

1. **Context banner** (only when relevant; two variants).
   - *Purpose banner* (amber): "Picking the **invitation song** · showing hymns tagged **Invitation**, **Commitment** · least recently sung first" with a **Show all hymns** button. Shown when an **open slot** is selected.
   - *Insert-position banner* (neutral): "New hymns will be added after **{item title}**" with an **Add to end instead** button. Shown when any other item is selected.
2. **Search box** (autofocus target). Placeholder lists what's searchable. `⌘K` hint.
3. **Topic chips**: every topic, sorted by number of hymns (descending, then A–Z), each with its count. Toggle on/off. Multiple selected chips combine with **AND**.
4. **Toolbar row:** *Filters* button (badge with the count of active secondary filters), *Sort* select, *List/Grid* toggle.
5. **Filters panel** (collapsed by default): selects for **Key**, **Time signature**, **Meter**, **Hymnal**; toggles for **Public domain only** and **Not sung in 8 wks**; and a *Reset* button.
6. **Results / Preview split** (two scrolling panes).

**Results pane**
- Header: "{n} of {total} hymns" and "sorted by {sort}".
- **List view row:** slide thumbnail (16:9, first slide) · title (matched terms highlighted) · "In service" tag if already in the current service · author/composer line · **match note** · chips · last-sung line · circular **+** button.
  - Chips: key (accent), time signature, meter (first token), the first two hymnal entries (`SFP 236`), `Licensed` when not public domain, `No slides yet` when the slide pack is missing.
  - Last-sung line: "Sung 3 wks ago" in amber if < 21 days, neutral if 21–55, green if ≥ 56 days or never ("Never sung").
  - **Match note** (a small italic line) explains *why* a result matched when the match wasn't the title: the matching lyric line (`LYRICS "…"`), first line, tune, author, topic, scripture, meter/key/time, or hymnal numbers.
- **Grid view:** cards with a larger thumbnail, title, chips and last-sung line; no + button (click selects, drag adds).
- **Empty state:** "No hymns match. Try fewer words, or clear a filter" with *Reset filters*.
- Selected result has an accent border. Results are draggable (drag source for adding to the order).

**Preview pane** (for the selected result)
- **Slide frame** (16:9) showing the currently selected slide, with previous/next arrows on hover.
- **Slide pills** ("1 2 3 Refrain"): click to view that slide. Arrows cycle and wrap.
- Title (serif), first line in quotes (italic), credits ("Words: … / Music: …").
- **Fact tiles:**
  - *Start pitch (a cappella)*: large note name, solfege, "Key of X", and a round **▶ play** button that sounds the tone.
  - *Time*: time signature and tempo text.
  - *Meter*: full meter string and tune name.
  - *Slides*: count and format ("16:9 · .pptx").
- **Hymnals**: one tag per hymnal with its number (tooltip = full hymnal name).
- **Scripture**: tags. Clicking one **runs a search** for that reference.
- **Topics**: tags. Clicking one **replaces the topic filter** with just that topic.
- **Congregation history**: 52-week sparkline (one bar per week, oldest left), "N× in 12 months", the three most recent dates.
- **License**: `Public domain` (nothing to report) or `Licensed` plus license text.
- **Sticky action bar:**
  - Primary button, whose label depends on context (§5.2): *Use as {purpose}* / *Add after “{title}”* / *Add to end of service*.
  - *Copy slides*, or *Request slides* when no slide pack exists.
  - A small green "Already in this service" note if the hymn is already in the order.

### 3.6 Selected-item pane

Header: type icon, title, kind line ("Song · opening song"), and two buttons: **Add hymns after this** (goes to the library, insert-after mode) and **Remove**.

**Song, hymn chosen:**
- Hymn card: thumbnail, title, credit, chips, buttons *Replace hymn* and *View in library*.
- **Slides to show**: toggle pills for each verse/refrain. Selected ones appear in the deck, in printed order. Help text "N of M slides included".
- **Starting pitch**: a large note, "Start on F♯ (mi)", a **▶** button, and a **transpose select** (as printed, or ±1 to ±3 half steps, each labelled with the resulting key). Transposition changes the *leader's* pitch and displayed key; slides still print in the original key.
- **Song leader** (person select) and **Announce as** (which hymnal number to announce).
- **Purpose** select (opening, communion, invitation, closing, general).
- **Notes for the song leader** (multi-line).

**Song, open slot:** dashed card "No hymn chosen yet" with *Search the library*, plus Song leader, Purpose, and Notes.

**Other item types:** Title; Assigned to (Speaker for sermons, Reader for Scripture); Scripture reference (scripture, supper, sermon, other); **Servers** (supper) or **Collectors** (giving) multi-select; **Attach PowerPoint** (sermon); Notes (label varies: Prayer focus, Announcements, Outline…).

### 3.7 Slide deck pane

- Header: "{N} slides", service title pill, **Export .pptx**, **Present**.
- Thumbnail grid in deck order, grouped under the same section headers, each with its number and label ("Holy, Holy, Holy — Verse 2"). Empty song slots show a placeholder slide with a "needs hymn" badge.
- Clicking a thumbnail opens the presenter at that slide.
- Deck contents and the rules for building it: §8.

### 3.8 Presenter (full screen)

Black overlay, current slide scaled to fit 16:9, bottom bar with the slide label and "Next: …", counter, previous/next, and close. Keys: →, ↓, Space, Enter, PageDown = next; ←, ↑, PageUp = previous; Home / End; Esc = exit. Clicking the slide advances.

### 3.9 Menus and toasts

- **Row overflow menu:** Edit details · Duplicate · Move up · Move down · Replace hymn… (songs with a hymn only) · Remove.
- **Add menu:** Song (pick from library), Prayer, Scripture reading, Lord's Supper, Contribution, Sermon/Lesson, Welcome/Announcements, Other.
- **Toasts** (auto-dismiss about 3 s): "Added “X” after the selected item", "“X” set as invitation song", "Heads up: sung 9 days ago" (queued 0.4 s after an add of a recently sung hymn), "Removed “X”", export/publish confirmations, "Playing F♯…".
- Menus close on outside click or Esc, and flip above the anchor if there's no room below.

## 4. UI state model

Only client state is listed. Persist what you need.

| State | Meaning | Reset when |
|---|---|---|
| `currentServiceId` | Which service is open | n/a |
| `selectedItemId` | Highlighted order row. Also the **insertion anchor** for new hymns. | Switching service; "Add to end instead"; removal of that item |
| `tab` | `library` / `item` / `deck` | Switching service resets to `library` |
| `query`, `filters`, `sort`, `view` | Library search state | "Reset filters" clears query/filters and the purpose context |
| `context` (purpose) | Set from an open slot's purpose | Cleared by "Show all hymns", by filling the slot, by switching service |
| `previewHymnId`, `previewSlideIndex` | What the preview shows | Preview falls back to the **first result** if the previewed hymn drops out of the results |
| `filtersOpen`, `checkOpen` | Panel expand state | n/a |
| Presenter `slides[]`, `index` | Snapshot taken when opened | On close |

### Selection rules (the most important interaction logic)

| User action | Result |
|---|---|
| Click an **open song slot** | Select it; switch to **library**; set **purpose context** from its role; **clear the query**; focus the search box |
| Click any **other row** | Select it; clear context; switch to **Selected item** tab; if it's a song with a hymn, also point the library preview at that hymn |
| Double-click a row | Select and open the Selected-item tab |
| ⋯ → Edit details | Same as double-click |
| Click "Add hymns after this" | Switch to library, keep selection (insertion anchor), clear purpose context |
| Click "Add to end instead" | Clear selection and context |
| Click a plan-check finding | Select that item (following the rules above) |

## 5. Interaction specifications

### 5.1 Search

- Runs on every keystroke (client-side in the mockup; see §11 for a production approach), re-rendering results and preview. The search box keeps focus.
- **Keys in the search box:** ↓/↑ move the highlighted result (and scroll it into view), **Enter adds the highlighted hymn**, Esc clears the query.
- Global shortcuts: `⌘K` / `Ctrl+K` focus + select the search box and open the library tab. `/` focuses it when no input is focused.

### 5.2 Adding a hymn (button, Enter, or the "+")

Given selection `sel`:

1. **`sel` is an open song slot** → fill that slot: set hymn, include all its slides, reset transposition, clear the purpose context. Toast: “X” set as {purpose}.
2. Otherwise → **insert a new song item**:
   - position: immediately **after `sel`**, or **at the end** if nothing is selected;
   - section: the same as the anchor (`sel`, or the last item);
   - defaults: leader = `sel`'s leader if `sel` is a song, else the current user; purpose = general; all slides selected; no transposition; empty notes;
   - the new item becomes the selection (so repeated adds chain in order);
   - the library tab stays open.
3. If the hymn was sung **fewer than 21 days ago**, show the "Heads up" toast after the confirmation toast.
4. Duplicates are **allowed** (it's a warning, not an error). The result row shows "In service" and the preview shows "Already in this service".

### 5.3 Drag and drop

- **Reorder:** drag a row by anywhere on it. While over another row, show a drop line above (top half) or below (bottom half). On drop the item moves there **and takes the target row's section**. Dropping on empty space below the last row moves it to the end.
- **Add from library:** drag a result (list or grid) into the order. Same drop-line behavior.
  - If dropped **on an open song slot**, the slot is filled (as in §5.2, case 1) instead of inserting.
  - Otherwise a new song item is inserted with the target's section and the current user as leader.
- While a hymn is being dragged, the order list shows a dashed accent outline.
- The same operations are available without dragging (menus, Add button), which is the accessible path.

### 5.4 Item editing

- Text fields (title, scripture reference, notes) update the item **on every keystroke** and refresh the order row, header count and plan check without re-rendering the form (so typing isn't interrupted).
- Selects (leader/assignee, purpose, transposition, announce-as) update on change. Changing **purpose** on an open slot also renames its placeholder title.
- Slide pills, servers/collectors pills toggle on click. Deck count updates immediately.
- **Remove** deletes at once (no confirmation) and shows a toast. *Recommendation: add an Undo action to that toast.*
- **Duplicate** inserts a copy directly after the original.
- **Move up/down** swaps with the neighbour.
- **Replace hymn** empties the slot (keeping purpose, leader, notes) and jumps to the library with the purpose context, exactly as clicking an open slot.

### 5.5 Presenting and exporting

- Present builds the deck (§8) at the moment it's opened. Later edits don't change an open presentation.
- Export items are stubs in the mockup (toast only). Required outputs and semantics are in §8.

### 5.6 Pitch playback

Clicking ▶ plays a pure sine tone at the hymn's start note for about 1.5 s (50 ms fade-in, linear fade-out), one at a time. The math is in §7.3. If audio is unavailable, fail silently.

## 6. Data model the UI needs

Field names follow the mockup's data (`js/data.js`). Map them onto your schema. **Bold** = required for the UI to function.

### Hymn (a catalog record)

| Field | Type | Notes |
|---|---|---|
| **id, title** | | |
| **firstLine** | text | Shown in preview; searched |
| author, composer (or "words by" / "music by") | text | Credits, searched together |
| **tune** | text | Searched |
| **meter** | text | e.g. `8.7.8.7 D`; the *first token* is used for the Meter filter and chips |
| **key** | enum | Major keys: C G D A E B F♯ C♯ F B♭ E♭ A♭ D♭ G♭ |
| **timeSignature** | text | `4/4`, `3/4`, `9/8`… |
| tempo | text | Free text, e.g. "Moderate, ♩ = 72" |
| **startDegree** | int 1–7 | Scale degree of the first note (1 = do, 3 = mi, 5 = sol). Used with `key` to compute the start note. |
| **hymnalEntries[]** | `{hymnalCode, number}` | Hymnals: SFP, GSC, HFW, SS in the sample (any set). A hymn may be in none. |
| **topics[]** | strings | Drives topic chips and purpose presets |
| scriptureRefs[] | strings | Free-text references ("Eph 2:8–9") searched as text |
| **isPublicDomain**, licenseText | bool, text | `Licensed` chip and preview note |
| **sections[]** | ordered list | One per slide: `{label, lyricLines[], slideAsset}`. `label` is a verse number ("1", "2") or a name ("Refrain"). Lyrics may be absent for licensed hymns (search then can't match lyrics). |
| slidePackStatus | enum | `ready` / `pending` (drives "No slides yet" and *Request slides*) |
| **derived:** `lastSungDaysAgo`, `timesSungLast12Mo`, `sungDates[]` | | From usage history (§7.2) |

### Service and item

```
Service:  id, kind ("Sunday Morning"), title, date, status (draft|done), theme?, sermonText?
Item:     id, serviceId, position, section (string or FK), type,
          title, assigneeId?, reference?, notes?,
          -- songs only --
          hymnId?, purpose (opening|communion|invitation|closing|general),
          includedSectionIds[], transposeHalfSteps (−3..+3), announcedHymnal?,
          -- supper/give only --
          helperIds[]
          -- sermon only --
          attachedDeckFile?
Person:   id, name, roles[] (song, prayer, reader, table, give, preacher, welcome, elder)
Item type: song | prayer | scripture | supper | give | sermon | welcome | custom
```

Notes:
- Song item `title` in the mockup is a copy of the hymn title. **Derive it from the hymn instead.**
- `verses` in the mockup is an array of *indexes* into the hymn's sections. **Store section IDs**, so edits to a hymn's sections don't corrupt saved services.
- A single `assignee` per item; `helpers` is a list for servers/collectors. A song's leader is stored as the item's assignee.
- Sections are *labels on items*. If you want editable sections, model them as an ordered list on the service instead. The UI behavior (header when the section changes) stays the same either way.

### Usage history

`(hymnId, serviceId, date)` rows, written when a service is marked done (or when a hymn was actually sung). `lastSungDaysAgo` = days from today to the latest date, or null. `timesSungLast12Mo` = count within 365 days.

## 7. Business rules

### 7.1 Search (exact behavior)

**Tokenization:** lowercase, replace curly quotes with straight, split on whitespace and commas, strip leading/trailing quote characters. Empty query means no term constraints.

**Matching:** every term must match somewhere (**AND across terms**). A term matches a field if it is a **substring** of that field (so "wash" finds "Washed").

**Per-term score** = the weight of the *best* matching field for that term; a hymn's score is the sum over terms.

| Field | Weight |
|---|---|
| Title | 10 |
| Hymnal number (a **numeric-only** term that equals a hymn's number in any hymnal) | 8 |
| First line | 6 |
| Tune | 5 |
| Scripture references | 5 |
| Hymnal code (a term equal to `sfp`, `gsc`, `hfw` or `ss` when the hymn is in that hymnal) | 4 |
| Topics | 4 |
| Author + composer | 3 |
| Lyrics (all sections, joined) | 3 |
| Meter + key + time signature (one combined string) | 2 |

Bonus **+5** if the title starts with the first term. Example queries that must work: `blood`, `Eph 2`, `mighty fortress` (both terms in the title), a tune name, and `SFP 236`.

> **Hymnal code + number is a known weak spot in the mockup.** `sfp` and `236` are scored as two independent terms, so `SFP 236` also returns a hymn that is in SFP under a different number but has 236 in another hymnal. A production search should recognize a *code followed by a number* as a pair and match that exact hymnal entry (ranked first), and fall back to independent terms otherwise.

**Match note:** the first field, in the order the terms matched, that is *not* the title. For lyric matches, show the first lyric line containing a term (only when the title didn't match). Highlight matched terms in the title, author line and note.

**Filters** (all AND together, applied before term matching):
- Topic chips: hymn must have **every** selected topic.
- Purpose context: hymn must have **any** of the context's topics (a *union*). Opening = Praise, Trinity, Worship, Thanksgiving. Communion = Communion, Cross. Invitation = Invitation, Commitment. Closing = Commitment, Assurance, Evangelism. General = no restriction.
- Key = exact. Time signature = exact. Meter = first token starts with the chosen value. Hymnal = hymn has an entry in that hymnal.
- Public domain only. "Not sung in 8 wks" = never sung, or last sung ≥ 56 days ago.

**Sorting** (all tie-break by title A–Z where noted):

| Sort | Rule |
|---|---|
| Relevance | Score descending, then title. With an **empty query**, relevance behaves as **title A–Z** (there are no scores) |
| Title A–Z | |
| Recently sung | `lastSungDaysAgo` ascending; never-sung last |
| Longest since sung | `lastSungDaysAgo` descending; **never-sung first** |
| Most sung (12 mo) | count descending, then title |

**Purpose context override:** when a purpose context is active, the query is empty and sort is "Relevance", results sort as **Longest since sung** instead. The header says so.

### 7.2 Freshness

- `recent`: last sung < 21 days ago (amber; triggers plan-check note and the add-time heads-up toast).
- `warm`: 21–55 days (neutral).
- `fresh`: ≥ 56 days, or never (green).
- Human text: today · yesterday · "N days ago" (< 14 d) · "N wks ago" (< 60 d) · "N mo ago" (< 730 d) · "N yr ago".

### 7.3 Starting pitch

Inputs: `key`, `startDegree`, optional `transposeHalfSteps`.

1. `keySemitone`: C = 0, D = 2, E = 4, F = 5, G = 7, A = 9, B = 11, +1 for ♯, −1 for ♭ (mod 12).
2. `startSemitone = (keySemitone + [0,2,4,5,7,9,11][startDegree − 1]) mod 12`.
3. **Note name**: the letter is the key's letter advanced by `startDegree − 1` steps (key D, degree 3 gives F); add ♯/♭ so the semitone matches. Solfege = `do re mi fa sol la ti`[degree − 1].
4. With transposition ≠ 0: add the shift to the semitone (mod 12) and name it from a flat-preferring table for flat keys and F, otherwise sharps. The displayed key shifts the same way.
5. **Playback pitch:** `midi = 60 + (s > 7 ? s − 12 : s)` (keeps it between about G♯3 and G4), `freq = 440 · 2^((midi − 69) / 12)`.

Test vectors (no transposition):

| Key | Degree | Note | Solfege | MIDI | Hz |
|---|---|---|---|---|---|
| D | 3 | F♯ | mi | 66 | 369.99 |
| G | 5 | D | sol | 62 | 293.66 |
| F | 3 | A | mi | 57 | 220.00 |
| B♭ | 5 | F | sol | 65 | 349.23 |
| E♭ | 3 | G | mi | 67 | 392.00 |
| A♭ | 5 | E♭ | sol | 63 | 311.13 |
| D♭ | 3 | F | mi | 65 | 349.23 |

The mockup handles **major keys only**. For minor or unusual hymns, store an explicit start note.

### 7.4 Plan check

Evaluated on every change. Each finding has a level (`warn` amber, `info` blue), text, and the item it points to.

| Rule | Level | Text |
|---|---|---|
| Song slot with no hymn | warn | No hymn chosen for “{purpose label}”. |
| Hymn sung < 21 days ago | info | “{title}” was sung {ago}. |
| Hymn slide pack pending | warn | “{title}” has no slide pack yet — request one. |
| Non-song item with no assignee | warn | “{title}” has no one assigned. |
| Two consecutive songs (skipping non-song items) whose **printed** keys are ≥ 5 semitones apart (circular distance) | info | Big pitch jump: {A} ({key}) → {B} ({key}). |

The badge shows the total count. Songs do not need an assignee to pass.
*Note:* the pitch-jump rule ignores transposition in the mockup. Decide whether to use the transposed key.

### 7.5 Sidebar status

`Complete` (status done) · `N open` (N songs slots without a hymn) · `Ready`.

## 8. Slide deck composition

Deck order = title slide, then every item in order:

| Item | Slides produced |
|---|---|
| (start) | **Title slide**: service kind, title, long date, theme |
| Song with hymn | One slide per **selected section**, in hymn order (hymn slide image from the database) |
| Song, open slot | One **placeholder** slide "Hymn not chosen yet" (flagged). *Recommendation: warn before export/present, or skip.* |
| Scripture reading | Text slide: reference as the headline, reader's name |
| Lord's Supper | Text slide: item title, reference |
| Prayer | Text slide: title, person |
| Contribution | Text slide "Contribution", "1 Corinthians 16:1–2" |
| Sermon | Text slide: title, `reference · speaker`. If a PowerPoint is attached, its slides are inserted after this slide on **export** |
| Welcome / Announcements | Text slide "Welcome & Announcements" |
| Other | Text slide with the title and reference |

Hymn slides are **images/pptx slides supplied by the slide database**; the mockup draws stand-ins procedurally (`js/notation.js`). Text slides use a dark themed background with a small kicker line, a large headline and a subtitle (colors vary by item type).

Exports:

| Export | Content |
|---|---|
| .pptx | The full deck, hymn slides as pictures (or native slides), attached sermon decks merged after the sermon slide |
| PDF handout | Slides, 4 per page |
| Song leader sheet | Per song: title, key, **start note (solfege)**, time signature, announced hymnal number, notes, leader |
| Printable bulletin | Order of service with assignees and announced hymn numbers |
| Copy as text | Plain-text order |

## 9. Visual design summary

- Font: system UI sans for interface, **serif (Iowan Old Style / Palatino / Georgia)** for hymn titles and the app name.
- Warm neutral palette with an indigo accent. Item-type colors: song indigo, prayer teal, scripture amber, supper burgundy, giving green, sermon violet, welcome/other gray.
- Corners: 10 px cards and rows, 8 px buttons, pill chips. Shadows are subtle.
- Full token list (light and dark) is in `css/tokens.css`. Keep the token *names* so a design pass can retheme.
- Icons are 24×24 outline SVGs at 1.8 px stroke (`js/core.js`, `ICONS`).

## 10. Accessibility

The mockup is partial. A production build should provide:
- Full keyboard operation: every drag action has a menu equivalent (done), rows are focusable (`tabindex`), and the list should support arrow-key navigation, Enter to open, and Alt+↑/↓ to reorder.
- Visible focus rings on all controls (present in the mockup).
- Accessible names on icon-only buttons (Add, ⋯, play, close).
- Toasts announced via a polite live region (present).
- Color is never the only signal (amber "sung recently" also uses text).
- Respect reduced motion and OS contrast settings.

## 11. Integration notes for the existing app and database

1. **Catalog vs. planning data.** The hymn/slide catalog is read-mostly and large; services and items are small, user-edited data. Keep them separate.
2. **Search should run server-side** (or in a local index) over the whole catalog: SQLite FTS5, Postgres full-text plus trigram, or your existing search engine. Requirements: substring/prefix matching, per-field weighting (§7.1), AND across terms, numeric hymnal-number exact match, filters, and the sort modes. Debounce keystrokes about 150 ms, cancel in-flight requests, and virtualize the result list. Return **facet counts** for the topic chips.
3. **Thumbnails** load lazily from image URLs (small variant in lists, full in preview and deck). Cache aggressively; the catalog changes rarely.
4. **Usage history** should be derived from completed services so it stays consistent. Decide whether *planned future* services count toward "sung recently" (the mockup doesn't).
5. **Saving:** the mockup mutates in memory. In production, persist each change immediately (optimistic UI). Suggested operations:

| Operation | Purpose |
|---|---|
| `searchHymns(query, filters, sort, purpose, page)` | Results + score + match note + facet counts |
| `getHymn(id)` | Full record + section slide URLs |
| `listServices(range)` / `createServiceFromTemplate(kind, date)` | Sidebar |
| `getService(id)` | Header + ordered items |
| `addItem(serviceId, afterItemId?, item)` / `fillSlot(itemId, hymnId)` | Add hymn, add other items |
| `updateItem(id, patch)` | Editing fields; transposition; included sections |
| `moveItem(id, targetId, before)` / `moveItemBy(id, ±1)` | Reorder (also updates the section) |
| `duplicateItem(id)` / `deleteItem(id)` | |
| `getPlanCheck(serviceId)` (or compute client-side from §7.4) | Findings |
| `buildDeck(serviceId)` and `export(serviceId, format)` | Deck and exports |
| `publish(serviceId)` | Mobile snapshot (see `MOBILE-PLAN.md`) |

6. **Multi-user editing:** the mockup assumes a single editor. If several planners can edit one service, decide on conflict handling (item-level versions and last-write-wins is enough for this UI), and refresh the order list when another user changes it.
7. **Offline/sync:** the top-bar sync pill and database card imply a local copy of the catalog. If your app is online-only, hide the pill or make it show connection state.
8. **People:** the assignee pickers suggest people whose roles match the item type (song → song, prayer → prayer, scripture → reader, supper → table, giving → give, sermon → preacher, welcome → welcome) first, then everyone else. Use your existing member directory and role data.
9. **Permissions:** the mockup has none. Decide who can edit versus view a service, and who can publish or export.
10. **Localization/format:** dates use "Sunday, Oct 4, 2026" style long dates and "Oct 4" short dates.

## 12. Mockup shortcuts not to copy

- Sample data and the hard-coded "today" (Sep 28 2026), the fixed current user, and the `s1…s4` ids.
- Procedurally generated sheet music and text slides (real slides come from the slide database).
- Whole-pane HTML re-rendering on every change and global mutable state. Use a proper component/state model.
- Song `title` duplicated onto the item; `verses` as array indexes (see §6).
- "Move up/down" doesn't change the section when crossing a section boundary. Decide the intended behavior (recommended: the item joins its new neighbour's section).
- **Duplicate** copies the `helpers` list by reference. Deep-copy it.
- Stubbed actions: Team & roles, Song requests, Sync, Copy slides, Request slides, Attach PowerPoint, all Export and Share items.
- "Remove" without undo.
- The `< 1180 px` preview hiding.

## 13. Acceptance scenarios

1. **Open slot flow.** Given a service with an empty invitation slot, when I click it, then the library opens with the purpose banner, the query is empty, results are only hymns tagged Invitation or Commitment sorted longest-since-sung first, and the search box has focus.
2. **Fill a slot.** Given that state, when I select a result and click *Use as invitation song*, then the slot shows the hymn with key, start note and hymnal number, the banner disappears, the sidebar pill drops one "open", and the plan check no longer lists that slot.
3. **Lyric search.** When I type `blood`, then hymns with "blood" in the lyrics appear, the term is highlighted, and lyric matches show the matching line under the title.
4. **Hymnal number.** `SFP 236` returns the hymn whose SFP entry is number 236 as the first result (production behavior per §7.1); `236` alone matches that number in any hymnal.
5. **Filters combine.** Selecting topic chips *Communion* and *Cross*, key `G`, and *Public domain only* returns only hymns satisfying all four.
6. **Insert after selection.** Given a selected row, when I add a hymn, then it appears directly after that row in the same section, becomes the selection, and the next add follows it.
7. **Drag from library.** Dragging a result onto the boundary between two rows inserts it there; dragging onto an open slot fills the slot.
8. **Reorder.** Dragging a row into another section changes its section header grouping.
9. **Recently sung.** Adding a hymn sung 9 days ago shows a heads-up toast, the row subtitle shows "sung 9 days ago", and the plan check lists it.
10. **Transpose.** Setting +2 on a hymn in D shows key E and an updated start note in the row and editor; the printed slides are unchanged; ▶ plays the shifted pitch.
11. **Slides to include.** Unchecking "Refrain" on a hymn removes that slide from the deck, and the tab count drops by one.
12. **Deck.** The deck lists a title slide, hymn slides in order, and text slides for other items, grouped by section; clicking one opens the presenter on it, and arrow keys navigate.
13. **Pitch playback.** ▶ plays a tone at the frequencies in §7.3 within 0.1 Hz.
14. **Keyboard.** `⌘K` focuses search from anywhere; ↓/↑/Enter operate on results; F5 opens the presenter; Esc closes menus and the presenter.
15. **Empty and error states.** A query with no matches shows the empty state with *Reset filters*; a service with no items shows only the Add button; a hymn with no slide pack shows "No slides yet" and *Request slides*.

## 14. Open questions for the implementing team

1. Where do hymn slide images come from (pre-rendered per section, or generated from notation data), and at what sizes?
2. Do *planned* future services count toward "sung recently"?
3. Should the pitch-jump check use transposed keys?
4. Is the section list fixed, or editable per service or template?
5. Who may edit, publish and export?
6. Can two planners edit the same service simultaneously?
7. Should removing an item be undoable? (Recommended: yes.)
8. Does the catalog include minor-key hymns, and how is their start note stored?
