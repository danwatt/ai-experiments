# ai-experiments

Each top-level directory is a standalone demo.

## When finishing a demo: write `prompt.md`

When work on a demo is done (user says it's done, or before committing a finished demo), generate `prompt.md` inside that demo's directory:

```bash
scripts/prompt-md.sh <demo-dir>
```

- Defaults to the most recent session transcript for this repo (the current session). If the demo spanned several sessions, pass every session id: `scripts/prompt-md.sh <demo-dir> <id1> <id2>`. The current session id is the scratchpad directory's last path component.
- It records the user's prompts verbatim, model(s), effort level(s), and token usage + cost from `tokscale` (`npx -y tokscale`).
- Run it as the last step, after the final user prompt, so the transcript is complete. Re-run (overwrite) if more prompts follow.
- Check the output: drop prompts that belong to unrelated work in the same session, and say so if cost shows "unavailable".
