#!/usr/bin/env bash
# Write <demo-dir>/prompt.md from Claude Code session transcript(s):
# model(s), effort level(s), token usage/cost via tokscale, then the
# conversation (user prompts + Claude's replies) with screenshots saved to
# <demo-dir>/prompt-assets/. Thinking and tool calls are omitted.
#
# Usage: scripts/prompt-md.sh [--no-screenshots] <demo-dir> [session-id ...]
# With no session id, uses the most recently modified transcript for this repo.
set -euo pipefail

screenshots=1
if [ "${1:-}" = "--no-screenshots" ]; then screenshots=0; shift; fi

demo_dir=${1:?usage: $0 [--no-screenshots] <demo-dir> [session-id ...]}
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

models=$(jq -r 'select(.type == "assistant" and .message.model != "<synthetic>") | .message.model' "${transcripts[@]}" | sort -u | paste -sd, - | sed 's/,/, /g')
efforts=$(jq -r 'select(.type == "assistant") | .effort // empty' "${transcripts[@]}" | sort -u | paste -sd, - | sed 's/,/, /g')

usage=$(npx -y tokscale models -c claude --json --group-by session,model --no-spinner 2>/dev/null \
  | jq --argjson ids "$(printf '%s\n' "${sessions[@]}" | jq -R . | jq -s .)" '
      [.entries[] | select(.sessionId as $s | $ids | index($s))]
      | {input: (map(.input) | add // 0), output: (map(.output) | add // 0),
         cacheRead: (map(.cacheRead) | add // 0), cacheWrite: (map(.cacheWrite) | add // 0),
         cost: (map(.cost) | add // 0)}' || echo '{}')

fmt() { jq -r "$1" <<<"$usage"; }

# One JSON event per line, in transcript order:
#   {role: "user"|"claude", text}  or  {role, image: {media_type, data}}
events() {
  jq -c '
    select(.isSidechain | not)
    | if .type == "user" and .origin.kind == "human" and (.isMeta | not) then
        .message.content
        | if type == "string" then {role: "user", text: .}
          else .[] | if .type == "text" then {role: "user", text: .text}
                     elif .type == "image" then {role: "user", image: .source}
                     else empty end
          end
      elif .type == "user" and (.message.content | type) == "array" then
        .message.content[] | select(.type == "tool_result")
        | .. | objects | select(.type == "image" and .source.type == "base64")
        | {role: "claude", image: .source}
      elif .type == "assistant" then
        .message.content[] | select(.type == "text" and (.text | test("\\S")))
        | {role: "claude", text: .text}
      else empty end
  ' "${transcripts[@]}"
}

assets="$demo_dir/prompt-assets"
rm -rf "$assets"
out="$demo_dir/prompt.md"
n=0
last=""

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

  events | while IFS= read -r ev; do
    role=$(jq -r .role <<<"$ev")
    if [ "$role" != "$last" ]; then
      echo
      if [ "$role" = user ]; then echo "## You"; else echo "## Claude"; fi
      last=$role
    fi
    if jq -e 'has("image")' <<<"$ev" >/dev/null; then
      [ "$screenshots" = 1 ] || continue
      n=$((n + 1))
      ext=$(jq -r '.image.media_type | sub("^image/"; "") | sub("jpeg"; "jpg")' <<<"$ev")
      file=$(printf '%03d.%s' "$n" "$ext")
      mkdir -p "$assets"
      jq -r .image.data <<<"$ev" | base64 -d > "$assets/$file"
      echo
      echo "![screenshot $n](prompt-assets/$file)"
    else
      echo
      jq -r .text <<<"$ev"
    fi
  done
} > "$out"

echo "wrote $out"
