The Franklin-style handheld: case, black bezel and green glass around fixed lines of text. Hand-written from `demo-reader.html` (`.device`, `.lcd-frame`, `.lcd`, `.lcd .glow`).

**When to use it.** To show what the device itself would display — a verse as the hardware renders it, a menu, a search prompt. It is a frame around content, not a text renderer: the original paints its glyphs on a `<canvas>` with the curved LCD font from `lcd-font.js`, and this component sets ordinary mono text on the glass instead. Say so wherever the distinction matters.

**What it gives you.** A case in a `case-face` to `case` gradient with a `case-edge` border, `radius-device`, `shadow-device` and `space-9` of padding, capped at 860px; a `lcd-bezel` frame at `radius-xl` with `shadow-lcd-frame`; and the glass in `lcd` at `radius-md` with `shadow-lcd-glass` and a highlight overlay. Lines are `lcd-ink` on `lcd` at 8.3:1.

**What you supply.** `lines` — strings, or `{ text, dim }` for an unlit or printed row. `dim` is `lcd-dim`, 2.1:1 on the glass by design: use it for a segment that is off or a legend printed on the bezel, never for text a reader needs. Lines do not wrap (`white-space: pre`); break them yourself to the character width you are emulating, and set `width` in `ch` to match. `label` prints a caption on the case below the glass.

The case and glass colours are the same in both themes — a physical object does not change colour when the page does.

Props: `lines`, `width`, `label`, `className`.
