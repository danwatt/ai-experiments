The page switcher shared by all six demos. Hand-written from `nav.js`, which injects the same markup and CSS at the top of `.wrap` on every page.

**When to use it.** One per page, first thing inside the page wrapper, for switching between sibling views. It is a navigation bar, not a tab widget: in the original each tab is a link to another document.

**What it gives you.** Tabs on a shared `rule` hairline, each with a pixel-face label in `dmg-3` and a mono note in `ink-soft`. Hover lifts a tab onto `panel` and brightens its label to `dmg-4`. The current tab sits on `panel`, takes `shadow-tab-current` (a 2px `hot` rule along its top) and turns its label `hot`. Focus draws a 2px `hot` outline, offset 2px.

**What you supply.** `items` (label, optional one-line note, href) and `current` — matched on `href` first, then `label`. Pass `onSelect` to switch views in place instead of navigating; without it the tabs behave as links and the current one swallows its own click. The original hides the notes below 620px; this component does not, so keep the notes to three or four words.

Props: `items`, `current`, `onSelect`, `label`, `className`.
