# ai-experiments

Each demo is a standalone directory. Games live under `games/`; other demos are top-level.

`index.html` at the repo root is the hand-maintained landing page: add a card there for every new demo (with a `prompt.html` link when it has a `prompt.md`). The Pages build (`.github/workflows/pages.yml`) copies the repo and renders `prompt.md`/`README.md` to `.html` via `scripts/render-md.sh`.

## When finishing a demo: write `prompt.md`

When work on a demo is done (user says it's done, or before committing a finished demo), generate `prompt.md` inside that demo's directory:

```bash
scripts/prompt-md.sh <demo-dir>
```

- Defaults to the most recent session transcript for this repo (the current session). If the demo spanned several sessions, pass every session id: `scripts/prompt-md.sh <demo-dir> <id1> <id2>`. The current session id is the scratchpad directory's last path component.
- It records model(s), effort level(s), token usage + cost from `tokscale` (`npx -y tokscale`), then the conversation: user prompts verbatim and Claude's text replies (thinking and tool calls omitted).
- Screenshots (browser tool captures and pasted images) are saved to `<demo-dir>/prompt-assets/` and linked inline. Commit that folder with `prompt.md`. Pass `--no-screenshots` before the dir to skip them.
- Run it as the last step, after the final user prompt, so the transcript is complete. Re-run (overwrite) if more prompts follow.
- Check the output: drop prompts that belong to unrelated work in the same session, and say so if cost shows "unavailable".
