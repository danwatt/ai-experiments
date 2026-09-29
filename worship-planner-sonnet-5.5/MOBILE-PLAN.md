# Mobile app plan: read-only worship plan viewer

Implementation plan for adding a read-only "plan view" to an existing mobile app.
Self-contained: it doesn't depend on the mockup code. The mockup (`mobile.html`, `js/mobile.js`) is only a visual reference.

## 1. Scope

**Build**

1. **Plan view**: one service's order of worship, top to bottom.
2. **Detail sheet**: tap a song for time signature, starting note, an audible pitch and other metadata.
3. Access through a **public, unguessable, read-only link**.

**Explicitly out of scope** (present in the mockup, drop them)

| Mockup feature | Status |
|---|---|
| "Last sung" / usage history / freshness warnings | Removed |
| Durations, start times, time budget, Live timer, drift | Removed. Services aren't timed, so timing isn't part of the product |
| Song-leader-per-song, "Me" tab, accept/decline, notification toggles | Removed |
| Hymn search, filters, topic chips, add-to-service | Removed (read-only) |
| Edit mode, reorder, plan check, service switcher, FAB | Removed |
| Sheet-music slides | Never on mobile |

Result: a single-screen list plus a bottom-sheet detail. No tabs, no writes, no accounts.

> **Assumption to confirm:** "who is assigned" means a plain display name per item (prayer, scripture reader, sermon, communion, and so on).
> It's optional and display-only, with no confirmation workflow. Songs don't need an assignee.

## 2. User experience

### 2.1 Plan view

Header:
- Service title (e.g. "Sunday Morning Worship")
- Date
- Small "Updated 2:14 PM" line, and offline indicator if showing cached data

Body:
- Items grouped under section headers (Gathering, The Lord's Supper, Giving, The Word, Response).
  Show the header only if the data has sections.
- Each row is a card-style list row with a type icon tile on the left.

| Item type | Line 1 | Line 2 | Chips (line 3) |
|---|---|---|---|
| Song, hymn chosen | Hymn title (serif) | Assignee, only if present | `Key D` · `Start F♯ (mi)` · `SFP 236`, where the last chip is hidden if there's no hymnal number |
| Song, no hymn yet | "Song: to be announced" (muted) | none | none |
| Prayer, scripture, communion, sermon, giving, announcements, other | Title | Assignee (or nothing) · scripture reference | none |

Behavior:
- Tap a song row to open the detail sheet. Tap a non-song row to open a small sheet (title, assignee, reference, notes), or make it non-tappable if you prefer.
- Pull to refresh. Show a skeleton on first load.
- Support system light/dark, dynamic type and screen readers (row = one accessible element, e.g. "Holy, Holy, Holy. Key of D. Start on F sharp. Songs of Faith and Praise 1").

### 2.2 Song detail sheet

Bottom sheet, dismiss by swipe, X or backdrop.

Top to bottom:
1. **Title**, first line in italics, author/composer credit.
2. **Start pitch card** (the hero element): large note name (`F♯`), "Start on F♯ (mi)", "Key of D · a cappella", and a **round Play button**.
3. **Fact tiles**: Time signature (`4/4`), Meter (`11.12.12.10`) with tune name (`NICAEA`), Tempo (optional).
4. **Hymnal numbers**: every hymnal the hymn appears in (`SFP 1`, `GSC 4`, and so on).
5. **Scripture** refs and **Topics** as tags.
6. Optional, phase 2: verse-1 lyrics for public-domain hymns.

Hide any section whose data is empty.

**Not shown:** last-sung, usage sparkline, slide-count/"locked slides" card, add/swap buttons.

### 2.3 Audible pitch

- Tapping Play produces a **pure sine tone at the start note for about 1.5 s**, with a short attack (about 50 ms) and a smooth release so it doesn't click.
- Tapping again while playing restarts it. Only one tone at a time.
- Audio must play even when the iOS silent switch is on (playback category), and shouldn't duck or interrupt other audio permanently.
- Frequency comes from the precomputed MIDI number: `freq = 440 * 2^((midi - 69) / 12)`.

### 2.4 States

| State | Behavior |
|---|---|
| Loading (no cache) | Skeleton rows |
| Loaded | Plan view |
| Offline with cache | Show cached plan and a "Showing saved copy" note |
| Offline, no cache | "Can't load the plan. Check your connection." plus Retry |
| Bad or revoked link | Generic "This plan isn't available." Don't say whether the link ever existed. |

## 3. Data contract

The desktop app publishes an **immutable snapshot** per service. The mobile app only reads it.
The snapshot is **precomputed**, so the phone does no music theory and no joins. It just renders.

`GET {base}/p/{token}` returns `200` with JSON. Suggested shape:

```json
{
  "schemaVersion": 1,
  "publishedAt": "2026-09-29T19:14:03Z",
  "service": {
    "title": "Sunday Morning Worship",
    "date": "2026-10-04",
    "theme": "Grace",
    "scripture": "Ephesians 2:1–10"
  },
  "items": [
    {
      "id": "i1",
      "type": "welcome",
      "section": "Gathering",
      "title": "Welcome & Announcements",
      "assignee": "Mark Hollis",
      "reference": null,
      "notes": null,
      "hymn": null
    },
    {
      "id": "i2",
      "type": "song",
      "section": "Gathering",
      "title": "Holy, Holy, Holy",
      "assignee": null,
      "reference": null,
      "notes": null,
      "hymn": {
        "title": "Holy, Holy, Holy",
        "firstLine": "Holy, holy, holy! Lord God Almighty!",
        "author": "Reginald Heber, 1826",
        "composer": "John B. Dykes, 1861",
        "tune": "NICAEA",
        "meter": "11.12.12.10",
        "key": "D",
        "timeSignature": "4/4",
        "tempo": "Majestic, ♩ = 76",
        "startNote": { "name": "F♯", "solfege": "mi", "midi": 66 },
        "hymnals": [
          { "code": "SFP", "name": "Songs of Faith & Praise", "number": 1 },
          { "code": "GSC", "name": "Great Songs of the Church", "number": 4 }
        ],
        "announceAs": { "code": "SFP", "number": 1 },
        "scripture": ["Rev 4:8–11", "Isa 6:3"],
        "topics": ["Praise", "Trinity", "Worship"]
      }
    },
    {
      "id": "i9",
      "type": "song",
      "section": "Response",
      "title": "Song",
      "assignee": null,
      "hymn": null
    }
  ]
}
```

Field rules:

- `type` is one of `song | prayer | scripture | supper | give | sermon | welcome | custom`. Unknown types render as `custom`.
- **Everything is optional except** `schemaVersion`, `items[].id/type/title`. The client must tolerate missing or null fields.
- `hymn: null` on a `song` item means "not chosen yet".
- `startNote.midi` is the source of truth for audio. `name` and `solfege` are display strings.
- Plan row hymnal chip: use `announceAs` if present, else the first entry in `hymnals`, else hide the chip.
- Ignore unknown fields (forward compatibility). Bump `schemaVersion` only for breaking changes, and show "Please update the app" if the version is higher than the app supports.
- Not in the payload, by design: last-sung, durations, start times, song-leader assignments, licensing/slide info.

### Where the start note comes from

The mockup stores each hymn's **key** and the **scale degree of its first note** (1 = do, 3 = mi, 5 = sol), then the publisher computes the pitch.
Do this on the publishing side, not in the mobile app.

Algorithm (major keys, as in the mockup):
1. `keySemitone` from the tonic (C = 0, D = 2, E = 4, F = 5, G = 7, A = 9, B = 11, plus 1 for ♯ or minus 1 for ♭).
2. `startSemitone = (keySemitone + majorScale[degree - 1]) mod 12` with `majorScale = [0, 2, 4, 5, 7, 9, 11]`.
3. Note name: letter = the tonic letter advanced by `degree - 1` (e.g. key D, degree 3, letter F), then add ♯/♭ so the semitone matches.
4. `midi = 60 + (startSemitone > 7 ? startSemitone - 12 : startSemitone)`. This keeps the tone in a comfortable singing range, from about G♯3 to G4.

Test vectors (use these to verify whichever side implements it):

| Key | Degree | Note | Solfege | MIDI | Hz |
|---|---|---|---|---|---|
| D | 3 | F♯ | mi | 66 | 369.99 |
| G | 5 | D | sol | 62 | 293.66 |
| F | 3 | A | mi | 57 | 220.00 |
| B♭ | 5 | F | sol | 65 | 349.23 |
| E♭ | 3 | G | mi | 67 | 392.00 |
| A♭ | 5 | E♭ | sol | 63 | 311.13 |
| D♭ | 3 | F | mi | 65 | 349.23 |

> **Gap:** the mockup only handles major keys. If any hymn is in a minor key, or has an unusual first note, store an explicit `startNote` for it in the database instead of deriving it.

## 4. Public link and security

The requirement is a public, read-only link with security through obscurity.

- **Token**: at least 128 bits from a CSPRNG, URL-safe (about 22+ characters base64url). It is not a sequential ID and not derived from the date or service. One token per published service (or one rolling token; see open questions).
- **Read-only by construction**: the endpoint serves `GET` only. No write route exists for the token. The snapshot is static JSON, so a static host or CDN is enough.
- **No listing**: no directory, index or "all plans" endpoint. Unknown tokens get `404` with an identical body and timing to revoked ones.
- **Not indexable**: `X-Robots-Tag: noindex, nofollow`, and `Referrer-Policy: no-referrer` if any web page is involved. Don't put the token in analytics or crash-report breadcrumbs (redact it in logs).
- **Rotate and revoke**: the desktop app can regenerate a token, which instantly invalidates the old link. Old plans can expire automatically (say 14 days after the service date), which is also good hygiene.
- **Minimize what's exposed**: the payload contains only display data. No emails, phone numbers or internal IDs. Names are the only personal data, so decide the format (full name, or first name and last initial) at publish time.
- **Caching**: `Cache-Control: public, max-age=60` plus `ETag`, so refreshes are cheap and CDN-friendly.
- Because anyone with the link can read it, tell the user that in the desktop "Share" UI ("Anyone with this link can view").

## 5. Client implementation plan

### 5.1 Architecture (framework-agnostic)

```
LinkHandler  →  PlanRepository  →  PlanStore (cache)  →  PlanViewModel  →  PlanScreen
                     │                                                        │
                 HTTP GET (ETag)                                      SongDetailSheet ── PitchPlayer
```

- **LinkHandler**: opens the app from a URL (`https://…/p/{token}`), or accepts a pasted link or QR scan on a first-run screen. Stores the token(s).
- **PlanRepository**: fetches with `If-None-Match`, validates and parses JSON tolerantly, maps HTTP `404` to `NotAvailable`.
- **PlanStore**: persists the last good snapshot per token (file or key-value). Serves it instantly on launch, then refreshes.
- **PitchPlayer**: `play(midi)` and `stop()`. Generates a sine tone (Web Audio, `AVAudioEngine`, `AudioTrack` and so on), 1.5 s, with a 50 ms fade-in and a 200 ms fade-out.
- **View models**: pure functions from a snapshot to display rows (chip strings, hidden-when-empty rules). These are easy to unit test.

### 5.2 Display mapping rules (unit-test these)

- Row chips for a song with a hymn: `Key {hymn.key}`, `Start {startNote.name} ({solfege})`, and `{code} {number}` (from `announceAs`, else the first hymnal, else omitted).
- A song with `hymn = null` shows the "to be announced" row and isn't tappable.
- Section header appears when the `section` value changes from the previous item.
- Assignee line hidden when null or empty.
- Detail sheet hides empty groups (no scripture means no Scripture heading).

### 5.3 Phasing

| Phase | Deliverable | Notes |
|---|---|---|
| **0. Contract** | Agree the JSON schema (section 3) and the desktop "Publish" output. Add the test vectors. | Blocks everything else |
| **1. Plan view** | Fetch → parse → list. Skeleton, error and offline states. | Can develop against a static sample JSON |
| **2. Detail sheet** | Sheet UI with all fields and hide-if-empty rules. | |
| **3. Pitch** | `PitchPlayer` plus the Play button, silent-switch handling, restart behavior. | Test on real devices |
| **4. Link entry** | Deep link / paste / QR; persistence; "forget this plan". | |
| **5. Polish** | Dark mode, dynamic type, accessibility, refresh UX, "Updated at". | |
| **Later** | Multiple plans, verse-1 lyrics for public-domain hymns. | Deliberately deferred |

### 5.4 Testing / acceptance

- Renders the sample snapshot correctly, including an empty song slot and a hymn with no hymnal number.
- Tolerates: missing optional fields, unknown `type`, unknown extra fields, empty `items`.
- `schemaVersion` higher than supported shows the update message instead of crashing.
- Pitch: the seven test-vector rows produce the listed frequencies within 0.1 Hz. Tone starts and stops without clicks, works with the silent switch on, and restarts cleanly on a second tap.
- Airplane mode: cached plan opens; a bad token shows the generic unavailable state.
- VoiceOver/TalkBack read each row as one coherent phrase; the Play button has a clear label ("Play starting pitch F sharp").
- Small phone (320 pt wide) and large text sizes don't clip the chips. Chips wrap.

## 6. Publisher-side changes (desktop app)

A small change set on the desktop app, needed by the mobile app:

1. **Publish** action on a service: builds the snapshot (section 3), including precomputed `startNote`, and uploads it under a new random token.
2. Store `startDegree` per hymn (already in the sample data) and use the algorithm above; support an explicit override.
3. **Share** UI: copy link, QR code, "Regenerate link", "Stop sharing", and the "anyone with the link" notice.
4. Optional: auto re-publish on change vs. an explicit "Publish update" button (recommend explicit, so a half-edited plan doesn't go out).

## 7. Open questions

1. **One link per service, or one rolling link** ("this Sunday")? Rolling is friendlier for a congregation but the token then lives longer.
2. **Assignee display**: full names, or first name plus last initial, in a public link?
3. **Non-song rows**: tappable detail sheet, or plain rows?
4. **Hymnal to show in the row**: always the first hymnal, or the one the planner picked (`announceAs`)? The plan assumes the planner picks.
5. **Minor-key or non-standard hymns**: is an explicit start note in the database acceptable for those?
6. **Expiry**: should old plans disappear automatically after the service date?
7. **Target stack** of the existing app (native iOS/Android, React Native, Flutter, or web view). This only affects section 5.1's audio and storage choices. Everything else is unchanged.
