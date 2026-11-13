The top navigation strip, rendered from a single `ITEMS` array in `nav.js` into every page.

Ten links, each an emoji plus a label, laid out as `.button` elements in a `.toolbar-group`. The current page carries `.active`. There is no second level and no breadcrumb: GeoTagger is ten peer screens over one library.

## When to use

Once per page, as the first child of the toolbar. Adding a page means adding one `ITEMS` entry in `nav.js` and setting `data-active` on the new page's `<div id="app-nav">` — the nav is data-driven, so never hand-write the markup in a page.

## What the consumer provides

`<div class="toolbar-group" id="app-nav" data-active="<key>"></div>` and a `<script src="nav.js">`. The keys are `home`, `search`, `geocode`, `quick-geocode`, `map`, `timesync`, `people`, `representatives`, `contexts`, `settings`.

## Don't

- Don't reorder the items per page; the order is muscle memory.
- Don't drop the emoji — at 12px it is the fastest target in the row — and don't use it without the word beside it.
- Don't mark more than one item active.
