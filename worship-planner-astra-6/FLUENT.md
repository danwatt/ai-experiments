# Gather — Fluent desktop concept

Open `fluent.html` for the new iteration. `index.html`, `styles.css`, and `app.js` remain the original design. The Fluent page has its own CSS, JavaScript, and localStorage key (`gather-fluent-prototype-v1`), so editing one concept does not change the other's saved services.

## Design direction

This is a browser mockup informed by Uno / WinUI Fluent conventions, not an Uno implementation or a pixel-exact platform control reproduction.

- System typography (Segoe UI where installed), neutral surfaces, blue accent, restrained 4px control corners, and visible focus states.
- A title bar, collapsible navigation pane, service command bar, and status bar.
- A window-sized workspace with independently scrolling service and hymn lists, plus a persistent preview pane.
- Compact selectable rows with accent indicators, instead of separate cards.
- A hymn inspector with sheet music / metadata tabs, slide thumbnails, saved state, and an add-to-service action.
- Narrow layouts adapt to tabs. Desktop window controls are left to the eventual native host; the browser mockup offers a working full-screen action.

## Suggested native control mapping

| Mockup element | Uno / WinUI starting point |
| --- | --- |
| App navigation | NavigationView |
| Service actions | CommandBar with AppBarButton |
| Service and hymn lists | ListView and selected item bindings |
| Search | AutoSuggestBox |
| Theme/key filters | ComboBox |
| Slide-ready filter | ToggleButton |
| Preview/details tabs | TabView or a two-choice selector |
| Editors and confirmations | ContentDialog |
| Pane layout | Grid with ScrollViewer regions |

These are implementation suggestions to confirm against the team's Uno version and target platforms. Background translucency is simulated with gradients; native Mica / Acrylic behavior is not implemented here.

## Reference

- [Uno: Fluent-styled controls](https://platform.uno/docs/articles/external/uno.themes/doc/fluent-getting-started.html)
- [Microsoft: NavigationView](https://learn.microsoft.com/en-us/windows/apps/design/controls/navigationview)
- [Microsoft: Desktop app structure](https://learn.microsoft.com/en-us/windows/apps/develop/ui/windows-app-sdk-app-structure)

## Prototype scope

The sample hymn catalog, service editing, reordering, presentation preview, outline download, and local persistence are retained. Sheet music and slide assets remain illustrative. No actual PowerPoint files, backend, .NET project, or native integrations are included. The Fluent page has no build step, dependencies, or external font requests.
