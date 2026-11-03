#!/usr/bin/env bash
# Write <demo-dir>/prompt.md from a Claude Code session transcript:
# user prompts, model(s), effort level(s), and token usage/cost via tokscale.
#
# Usage: scripts/prompt-md.sh <demo-dir> [session-id ...]
# With no session id, uses the most recently modified transcript for this repo.
set -euo pipefail

demo_dir=${1:?usage: $0 <demo-dir> [session-id ...]}
shift
repo_root=$(cd "$(dirname "$0")/.." && pwd)
project_dir="$HOME/.claude/projects/$(printf '%s' "$repo_root" | sed 's|[/.]|-|g')"

sessions=("$@")
if [ ${#sessions[@]} -eq 0 ]; then
  latest=$(ls -t "$project_dir"/*.jsonl | head -1)
  sessions=("$(basename "$latest" .jsonl)")
fi

transcripts=()
for s in "${sessions[@]}"; do transcripts+=("$project_dir/$s.jsonl"); done

# Human-typed prompts only (skips tool results, hook/meta injections).
prompts=$(jq -r '
  select(.type == "user" and .origin.kind == "human" and (.isMeta | not))
  | .message.content
  | if type == "string" then . else map(select(.type == "text") | .text) | join("\n") end
  | "### Prompt\n\n" + . + "\n"
' "${transcripts[@]}")

models=$(jq -r 'select(.type == "assistant" and .message.model != "<synthetic>") | .message.model' "${transcripts[@]}" | sort -u | paste -sd, - | sed 's/,/, /g')
efforts=$(jq -r 'select(.type == "assistant") | .effort // empty' "${transcripts[@]}" | sort -u | paste -sd, - | sed 's/,/, /g')

usage=$(npx -y tokscale models -c claude --json --group-by session,model --no-spinner 2>/dev/null \
  | jq --argjson ids "$(printf '%s\n' "${sessions[@]}" | jq -R . | jq -s .)" '
      [.entries[] | select(.sessionId as $s | $ids | index($s))]
      | {input: (map(.input) | add // 0), output: (map(.output) | add // 0),
         cacheRead: (map(.cacheRead) | add // 0), cacheWrite: (map(.cacheWrite) | add // 0),
         cost: (map(.cost) | add // 0)}' || echo '{}')

fmt() { jq -r "$1" <<<"$usage"; }

{
  echo "# Prompts"
  echo
  echo "- **Model:** ${models:-unknown}"
  echo "- **Effort:** ${efforts:-unknown}"
  echo "- **Session(s):** ${sessions[*]}"
  if [ "$(fmt '.cost // empty')" != "" ]; then
    echo "- **Tokens:** input $(fmt .input), output $(fmt .output), cache read $(fmt .cacheRead), cache write $(fmt .cacheWrite)"
    echo "- **Cost (tokscale estimate):** \$$(fmt '.cost * 100 | round / 100')"
  else
    echo "- **Cost:** unavailable (tokscale failed)"
  fi
  echo
  echo "$prompts"
} > "$demo_dir/prompt.md"

echo "wrote $demo_dir/prompt.md"
