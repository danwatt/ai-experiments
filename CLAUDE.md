# ai-experiments

Each demo is a standalone directory. Games live under `games/`; other demos are top-level.

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
- Check the output: drop prompts that belong to unrelated work in the same session, and say so if cost shows "unavailable".
