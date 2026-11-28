# ai-experiments

Each demo is a standalone directory, grouped by its landing-page section (the `s` key in `demos.js`):

| Section | Directory |
| --- | --- |
| Hex 2048 variants | `games/hex2048/` |
| Games & toys | `games/` |
| Educational tools | `edu/` |
| Explainers | `explainers/` |
| Worship planner mockups | `worship/` |
| 2026 Midterms | `midterms/` |
| Texas schools | `schools/` |
| Data & analysis | `data/` |
| Tools | `tools/` |
| Design systems | `design/` |
| Video & vision | `vision/` |

Demos sit two levels below the root (three for hex 2048), so links back to the landing page are `../../` and Bluebonnet is `../../design/bluebonnet-design-system/`. A new section gets a new top-level directory.

`index.html` at the repo root is the landing page; its cards come from the hand-maintained list in `demos.js`. Add an entry there for every new demo (with a `["prompt", "<dir>/prompt.html"]` link when it has a `prompt.md`, and `model`/`effort` when known). New sections go in `SECTIONS` in the same file. The Pages build (`.github/workflows/pages.yml`) copies the repo and renders `prompt.md`/`README.md` to `.html` via `scripts/render-md.sh`.

## When finishing a demo: write `prompt.md`

When work on a demo is done (user says it's done, or before committing a finished demo), generate `prompt.md` inside that demo's directory:

```bash
scripts/prompt-md.sh <demo-dir>
```

- Works with Claude Code, Cursor and Codex/ChatGPT-app sessions (ids are looked up in `~/.claude/projects`, `~/.cursor/projects`, `~/.codex/sessions`; Cursor model/tokens/cost come from tokscale and it has no effort or screenshots). Defaults to the most recent transcript of any tool for this repo (the current session). Ids may mix tools. If the demo spanned several sessions, pass every session id: `scripts/prompt-md.sh <demo-dir> <id1> <id2>`. The current session id is the scratchpad directory's last path component.
- It records model(s), effort level(s), token usage + cost from `tokscale` (`npx -y tokscale`), then the conversation: user prompts verbatim and Claude's text replies (thinking and tool calls omitted).
- Screenshots (browser tool captures and pasted images) are saved to `<demo-dir>/prompt-assets/` and linked inline. Commit that folder with `prompt.md`. Pass `--no-screenshots` before the dir to skip them.
- Run it as the last step, after the final user prompt, so the transcript is complete. Re-run (overwrite) if more prompts follow.
- **A later session on a demo that already has a committed `prompt.md`:** don't regenerate it. Run `scripts/prompt-md.sh --append <demo-dir> [session-id]` (no id = current session). It keeps the existing text and screenshots byte-for-byte, adds the session at the end inside `<!-- prompt-md:session -->` markers under a "Session N · date · model · effort" divider, saves its screenshots as `prompt-assets/<first 8 of id>-NNN.webp`, and recomputes the header totals (the original header is kept in a `<!-- prompt-md:base -->` comment). Re-running `--append` for the same session replaces only that session's block, so redo any hand pruning of it afterwards.
- Check the output: drop prompts that belong to unrelated work in the same session, and say so if cost shows "unavailable".

## Environment

- Install nothing on the host. Builds, toolchains and backends run in Docker (`docker compose`; a Makefile wrapper is fine). Python deps go in the image.
- Demos are static HTML/CSS/JS with no build step unless the prompt says otherwise. A demo that needs a backend gets a demo mode with bundled data, or screenshots only, so it still works on GitHub Pages.

## New demo setup

- Use the directory the user names. If none is named, use `<name>-<model>-<effort>` (e.g. `games/td-opus-5.5-high`), inside its section's directory (table above).
- If the prompt says "don't reference other code", or the directory is one of a set of model-comparison runs (same prompt, model suffix), don't read other demos, the landing page or Bluebonnet for style. Isolation is the experiment.
- When the user asks "what could we…", "ideas first", "show me a design first" or "grill me", answer with a numbered list (the user replies "1-4" or "6 and 11") and build nothing until they pick.

## Look and feel

- Texas and civic data demos use Bluebonnet (`design/bluebonnet-design-system/`) unless isolation applies. New charts use TanStack Charts with the Bluebonnet chart tokens.
- Avoid the generic generated-site look: no marketing hero or tagline, no buzzwords, no default sage/green palette. Put the main chart or interaction first.
- Maps always get a simple base layer (roads, cities).
- Check phone widths. Kid apps target a phone and an iPad mini; keep controls (keypads) fixed in place across states.

## Data demos

- Use public, official sources. Link numbers back to their source where possible (table cells, tooltips), and list sources on the page.
- Fetching and extraction are scripts committed with the demo, re-runnable without an LLM. Leave notes or a README on how to refresh the data.
- Raw downloads (PDFs, shapefiles, big CSVs) are gitignored. Commit only the processed results the page loads, and check this before committing.

## Privacy

- No identifying info in committed assets: blur signs, house numbers, faces and anything in photos that isn't the subject. Don't commit exact home coordinates; default to a public landmark (e.g. Founders' Plaza).

## Git

- Commit only the demo being worked on: stage its paths explicitly, never `git add -A`. Other demos often have uncommitted work the user isn't ready to commit.
- Work on master unless the user asks for a branch. "Commit" means commit only; push only when the user says "push".
- Message style: `Add <Title>: <tagline>` for a new demo, `<Demo>: <change>` for an update.

## Wrap-up checklist

"Wrap up", "finish up" or "done" means, in order:
1. `scripts/prompt-md.sh` (or `--append`);
2. a landing-page screenshot at `screenshots/{games,projects}/<dir>.webp`;
3. a `demos.js` entry (model, effort, prompt link);
4. a commit, if the user asked for one.
