# Selah desktop: Uno Platform / Fluent mapping

`index.html` in this folder is the desktop mockup restyled to look like a **Fluent (WinUI) app**, which is what Uno Platform renders by default.
It's HTML, so it only *imitates* Fluent. This document says which real control, style and theme resource each piece should become in XAML.

References: [Uno Fluent-styled controls](https://platform.uno/docs/articles/external/uno.themes/doc/fluent-getting-started.html) ·
[NavigationView](https://platform.uno/docs/articles/implemented/windows-ui-xaml-controls-navigationview.html) ·
[CommandBar](https://platform.uno/docs/articles/controls/CommandBar.html) ·
[Uno XAML Controls Gallery](https://github.com/unoplatform/Uno.Xaml-Controls-Gallery) (use it to see the real controls next to this mockup).

> **Verify against your Uno version.** Uno's Fluent docs describe enabling the styles by adding `XamlControlsResources` to `App.xaml`.
> Control availability (`SelectorBar`, `InfoBadge`, `TitleBar`) and exact resource keys vary by Uno / WinUI version, so check each one in the Gallery before committing to it.
> Items I'm less sure of are marked **(verify)**.

## 1. Theme tokens

The mockup's CSS variables are named after WinUI theme resources. Each maps to `{ThemeResource <Name>Brush}` (colors) or the same-named `CornerRadius` resource.

| CSS variable (`css/fluent.css`) | XAML resource | Used for |
|---|---|---|
| `--SolidBackgroundFillColorBase` | `SolidBackgroundFillColorBaseBrush` | Window background (Mica stand-in) |
| `--LayerFillColorDefault` | `LayerFillColorDefaultBrush` | Content area behind cards |
| `--CardBackgroundFillColorDefault` / `Secondary` | `CardBackgroundFillColorDefaultBrush` / `…SecondaryBrush` | Cards (order list, workspace) |
| `--CardStrokeColorDefault` | `CardStrokeColorDefaultBrush` | Card borders |
| `--ControlFillColorDefault` / `Secondary` / `Tertiary` | `ControlFillColor…Brush` | Button / ComboBox rest, hover, pressed |
| `--SubtleFillColorSecondary` / `Tertiary` | `SubtleFillColor…Brush` | List item hover / selected, nav item hover |
| `--ControlStrongStrokeColorDefault` | `ControlStrongStrokeColorDefaultBrush` | TextBox / CheckBox / ToggleSwitch outlines |
| `--DividerStrokeColorDefault` | `DividerStrokeColorDefaultBrush` | Separators |
| `--TextFillColorPrimary` / `Secondary` / `Tertiary` | `TextFillColor…Brush` | Text hierarchy |
| `--AccentFillColorDefault` (+ `Secondary`, `Tertiary`) | `AccentFillColor…Brush` | Accent button, selection pill, checked toggles |
| `--AccentTextFillColorPrimary` | `AccentTextFillColorPrimaryBrush` | Key letter and start pitch numeral |
| `--TextOnAccentFillColorPrimary` | `TextOnAccentFillColorPrimaryBrush` | Text on accent buttons |
| `--SystemFillColorSuccess` / `Caution` / `Critical` / `Attention` (+ `…Background`) | `SystemFillColor…Brush` | InfoBar severities, badges, "sung recently" |
| `--SmokeFillColorDefault` | `SmokeFillColorDefaultBrush` | ContentDialog overlay |
| `--ControlCornerRadius` (4px) / `--OverlayCornerRadius` (8px) | `ControlCornerRadius` / `OverlayCornerRadius` | Controls / cards, flyouts, dialogs |

Light and dark come from the theme dictionaries, so set `RequestedTheme` (or follow the system) instead of hand-coding colors. The mockup's toggle in the command bar demonstrates both.
The accent is the system accent; the mockup uses Windows blue (`#0078D4` family). Don't hard-code it.

**Do not hard-code hex values in XAML.** If a color isn't in the table, find its theme resource. Only the slide artwork (white slide, dark notation) is fixed color.

## 2. Typography

The mockup uses only the Fluent type ramp.

| Mockup text | Style |
|---|---|
| Page title ("Sunday Morning Worship"), 28/36 semibold | `TitleTextBlockStyle` |
| Dialog title, hymn title in preview and editor, 20/28 semibold | `SubtitleTextBlockStyle` |
| Card headings, 16 | `BodyStrongTextBlockStyle` (or `SubtitleTextBlockStyle`, designer's call) |
| Row titles (14 semibold) | `BodyStrongTextBlockStyle` |
| Body / form labels (14) | `BodyTextBlockStyle` |
| Row subtitles, metadata, hints (12) | `CaptionTextBlockStyle` with `TextFillColorSecondaryBrush` |

**Font decision needed.** Windows uses Segoe UI Variable. On macOS/Linux the fallback is the platform font, so either accept that or bundle one font and set `ContentControlThemeFontFamily` **(verify)**.
The earlier (non-Fluent) mockup used a serif for hymn titles. The Fluent version deliberately doesn't.

## 3. Shell and layout

```
Window (Mica / SolidBackgroundFillColorBase)
├─ TitleBar ── icon · "Selah" · AutoSuggestBox (hymn search) · caption buttons
└─ NavigationView (PaneDisplayMode=Left, OpenPaneLength≈264, IsSettingsVisible=true)
   ├─ Pane: services (NavigationViewItem + InfoBadge), headers, "New service", footer: Team, Settings
   └─ Content
      ├─ Header row: TextBox (title) + metadata + CommandBar
      └─ Grid (24px margins, 12px gap): Card[Order ListView + Plan-check Expander] | Card[SelectorBar + pane]
```

- **Window / title bar:** extend content into the title bar and put the search `AutoSuggestBox` there, as Windows 11 apps do. Uno's title-bar behavior differs on macOS/Linux **(verify)**. The mockup's fake caption buttons are platform chrome, so don't build them.
- **NavigationView:** auto-collapses (`Compact`/`Minimal`) at narrow widths. The mockup has a hamburger that toggles 264 ↔ 48px, which is the built-in behavior.
- **Content area:** the mockup rounds the top-left corner (8px) over the base, which is the standard Windows 11 NavigationView look.
- Page margins 24px, card gap 12px, card padding 12–16px.

## 4. Control-by-control mapping

| Mockup element | Control | Notes |
|---|---|---|
| Service list in the pane | `NavigationViewItem` under `NavigationViewItemHeader`s ("Upcoming", "Recent") | Open-slot count is an **`InfoBadge`** (Caution style) in the item's `InfoBadge` property. Selected indicator is built in. |
| "New service" | `NavigationViewItem` (or a `Button` in the pane footer) | |
| Team & roles, Settings | `FooterMenuItems` / the built-in Settings item | Stubs in the mockup |
| Command bar (Add, Share, Export) | `CommandBar` with `AppBarButton`s, `DefaultLabelPosition="Right"` | Add / Share / Export each open a **`MenuFlyout`** |
| Present (F5) | `Button` with `AccentButtonStyle` in the command bar (`AppBarElementContainer`) **(verify)** | `KeyboardAccelerator` F5 |
| Theme toggle | `AppBarToggleButton` or `AppBarButton` | Sets `RequestedTheme` |
| Service title | `TextBox` (borderless style until hover/focus) | |
| Hymn search (title bar) | **`AutoSuggestBox`** with `QueryIcon="Find"` | `TextChanged` → filter; ⌘/Ctrl+K `KeyboardAccelerator` focuses it. Up/Down/Enter in the mockup = move/add, so wire `KeyDown`. |
| Order of service | **`ListView`** with grouped `CollectionViewSource` (sections as group headers) | `CanReorderItems`, `CanDragItems`, `AllowDrop`. Item template: grip glyph, 32px icon tile, two `TextBlock`s, overflow `Button` with `MenuFlyout`. Selected pill is the ListViewItem indicator. |
| Row overflow (⋯) | `Button` (subtle) + `MenuFlyout` | Items: Edit, Duplicate, Move up/down, Replace hymn, **Remove** (destructive) |
| Remove confirmation | **`ContentDialog`** | Primary = `AccentButtonStyle` "Remove", Close = "Cancel" |
| Plan check | `Expander` at the bottom of the order card | Header has an `InfoBadge` count. Content is a list of severity icon + text; clicking selects the item. |
| Tabs (Hymn library / Selected item / Slide deck) | **`SelectorBar`** **(verify)**; fall back to `Pivot` or `TabView` | |
| Insert-position and "picking the invitation song" banners | **`InfoBar`** (Informational, Warning) | `ActionButton` = "Show all hymns" / "Add to end instead" |
| Topic chips | `ToggleButton`s in a horizontal `ScrollViewer` + `ItemsRepeater` | Single-select-toggle behavior per chip, multi-select overall |
| Filters | `Expander` (or `DropDownButton` + `Flyout`) | Contains `ComboBox` ×4 and `ToggleSwitch` ×2. Header badge shows the active filter count. |
| Sort | `ComboBox` | |
| List / grid toggle | `RadioButtons` (or two `ToggleButton`s) | |
| Search results | `ListView` (list) / `GridView` (grid), `ItemTemplate` with 16:9 `Image` thumb | Drag source for adding to the order. Hover-revealed **Add** `Button`. |
| Slide preview | `Image` (slide art) in a bordered `Border`, prev/next `Button`s overlaid | |
| Slide picker (1 2 Refrain) | `RadioButtons` (horizontal) or `ListView` of `ToggleButton`s | |
| Start pitch card | `Border` (accent-tinted) + big `TextBlock` + `Button` (`AccentButtonStyle`, `Volume` glyph) | Plays a tone; see §6 |
| Facts (time signature, tempo, meter…) | `Grid` of caption + body `TextBlock`s | |
| Hymnal / scripture / topic tags | `ItemsRepeater` + `Border` tags; scripture and topics are `Button`s | |
| Congregation history sparkline | Custom drawn (`Canvas` / `ItemsRepeater` of `Rectangle`s) | 52 weekly ticks |
| Slides to include | `CheckBox`es (one per verse/refrain) | |
| Transpose | `Slider` (`Minimum=-3`, `Maximum=3`, `TickFrequency=1`, `SnapsTo=Ticks`) | |
| Assignee / hymnal pickers | `ComboBox` (with grouped suggestions) | |
| Notes | multi-line `TextBox` | |
| Toasts (Added, Removed, Exported…) | transient `InfoBar` in an overlay panel | Success / Warning / Informational |
| Slide deck | `GridView` | Click = start presenting at that slide |
| Presenter | Full-screen page or window, `Image` slides, Left/Right/Esc | |
| Right-click / ⋯ menus | `MenuFlyout` with `MenuFlyoutItem`s + icons + `KeyboardAcceleratorTextOverride` | |

## 5. Design choices made for Fluent (differences from the earlier mockup)

- Colored per-type tiles became neutral 32px icon tiles. Only **songs** get the accent tint, so the list stays calm.
- Pill "chips" for metadata became plain caption text separated by thin dividers, plus a bold accent key letter.
- Status pills for open slots became **`InfoBadge`**s; banners became **`InfoBar`**s; the "sung recently" note is Caution-colored text.
- Filters live in an `Expander` with `ToggleSwitch`es, rather than pills and checkboxes.
- Destructive actions go through a `ContentDialog`, matching Windows conventions.
- Selection everywhere uses the Fluent 3px accent pill on the left edge.
- Focus rectangles use the high-contrast double stroke (`FocusStrokeColorOuter`/`Inner`). Keep the default `FocusVisual` styles.
- Hymn and page titles use the Fluent type ramp and no serif face. The slide artwork keeps its serif because it's content.

## 6. Uno-specific things to decide or check

1. **Fluent styles:** confirm `XamlControlsResources` (or your Uno version's equivalent) is merged in `App.xaml`, per the Uno doc above.
2. **Mica** isn't available on every Uno head. `SolidBackgroundFillColorBase` is the safe fallback the mockup uses. Use `MicaBackdrop` only where supported **(verify)**.
3. **Fonts and icons off Windows:** Segoe UI Variable and Segoe Fluent Icons are Windows fonts. For macOS/Linux, plan to bundle an icon font (Uno publishes a Fluent icons font package **(verify)**) or use `PathIcon`/SVG. The mockup draws icons as inline SVG.
4. **Drag and drop** (reorder inside `ListView`, drag hymn from results into the order) works differently per Uno head. Prototype early and keep the **Add** button and menu as the reliable path.
5. **Slide images:** real slides come from the slide database as images. The mockup generates SVG procedurally, which is only a stand-in. If you use SVG, check `SvgImageSource` support on your targets.
6. **Audio pitch:** generate a short sine tone (about 1.5 s, quick fade in/out) from the MIDI number: `freq = 440 · 2^((midi − 69)/12)`. Uno has no built-in synth, so use the platform audio API or a small library, or ship 12 pre-rendered tones.
7. **Title bar** search box and caption buttons behave differently on macOS and Linux. Decide whether search lives in the title bar or at the top of the library pane on those platforms.
8. **Accessibility:** set `AutomationProperties.Name` on icon-only buttons (Add, kebab, Play), and keep tab order: title bar → nav → command bar → order → workspace. The mockup adds `role`/`aria-*` as the web equivalents.

## 7. Icon mapping (mockup → Segoe Fluent / `Symbol`)

| Mockup glyph | Symbol / FontIcon |
|---|---|
| Add (+) | `Symbol.Add` |
| Search | `Symbol.Find` |
| Share | `Symbol.Share` |
| Export / download | `Symbol.Download` |
| Delete | `Symbol.Delete` |
| Copy | `Symbol.Copy` |
| Up / Down | `Symbol.Up` / `Symbol.Down` |
| Close | `Symbol.Cancel` |
| More (⋯) | `Symbol.More` |
| Calendar | `Symbol.Calendar` |
| People / Team | `Symbol.People` |
| Settings | built-in Settings item (`Symbol.Setting`) |
| Play / volume | `Symbol.Volume` (tone) / `Symbol.Play` |
| Present | `Symbol.SlideShow` **(verify)** |
| Song / prayer / scripture / communion / giving / sermon | `FontIcon` glyphs from Segoe Fluent Icons, chosen with the WinUI Gallery icon browser (no matching `Symbol` for most) |

## 8. Suggested build order

1. Shell: `NavigationView`, title bar with `AutoSuggestBox`, command bar, theme switching.
2. Order `ListView` with grouped sections, selection, overflow `MenuFlyout`, `ContentDialog`.
3. Library: search + results `ListView`, filters `Expander`, preview pane.
4. Item editor and the start-pitch card and player.
5. Slide deck `GridView` and presenter.
6. Drag and drop, InfoBar toasts, plan check, then the polish items in §6.
