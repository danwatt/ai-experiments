#!/usr/bin/env bash
# Write <demo-dir>/prompt.md from Claude Code, Cursor and/or Codex (ChatGPT app)
# session transcript(s): model(s), effort level(s), token usage/cost via
# tokscale, then the conversation (user prompts + assistant replies) with
# screenshots saved to <demo-dir>/prompt-assets/ (as WebP, at most 1600px wide,
# when ImageMagick is installed). Thinking and tool calls are
# omitted. Cursor transcripts carry no model/effort/usage/images, so those come
# from tokscale when it knows the session.
#
# Usage: scripts/prompt-md.sh [--no-screenshots] <demo-dir> [session-id ...]
# Each id is looked up in ~/.claude/projects, ~/.cursor/projects and
# ~/.codex/sessions. With no id, uses the newest transcript of any tool whose
# cwd is this repo.
set -euo pipefail

screenshots=1
if [ "${1:-}" = "--no-screenshots" ]; then screenshots=0; shift; fi

demo_dir=${1:?usage: $0 [--no-screenshots] <demo-dir> [session-id ...]}
shift
repo_root=$(cd "$(dirname "$0")/.." && pwd)
slug=$(printf '%s' "$repo_root" | sed 's|[/.]|-|g')
claude_dir="$HOME/.claude/projects/$slug"
cursor_dir="$HOME/.cursor/projects/${slug#-}/agent-transcripts"
codex_dir="$HOME/.codex/sessions"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

# Decompress a codex rollout (.jsonl or .jsonl.zst) to stdout.
codex_cat() { case $1 in *.zst) zstd -dc "$1";; *) cat "$1";; esac; }
codex_cwd() { codex_cat "$1" 2>/dev/null | head -1 | jq -r '.payload.cwd // empty'; }
# Re-encode a PNG/JPEG screenshot as WebP (quality 75, at most 1600px wide) to
# keep the Pages upload small. Prints the file name to link; keeps the original
# when ImageMagick is missing or the WebP isn't smaller.
to_webp() {
  local src=$1 dst=${1%.*}.webp
  case $src in *.png|*.jpg|*.jpeg) ;; *) basename "$src"; return;; esac
  if command -v magick >/dev/null &&
     magick "$src" -resize '1600x>' -quality 75 "$dst" 2>/dev/null &&
     [ "$(wc -c <"$dst")" -lt "$(wc -c <"$src")" ]; then
    rm "$src"; basename "$dst"
  else
    rm -f "$dst"; basename "$src"
  fi
}
codex_id() { basename "$1" | sed -E 's/\.jsonl(\.zst)?$//; s/^rollout-[0-9T-]{19}-//'; }

# Echo "<claude|cursor|codex> <path> <session-id>" for an id (uuid, or filename for codex).
locate() {
  local f
  if [ -f "$claude_dir/$1.jsonl" ]; then echo "claude $claude_dir/$1.jsonl $1"
  elif [ -f "$cursor_dir/$1/$1.jsonl" ]; then echo "cursor $cursor_dir/$1/$1.jsonl $1"
  elif f=$(find "$codex_dir" -name "*$1*.jsonl*" 2>/dev/null | head -1) && [ -n "$f" ]; then echo "codex $f $(codex_id "$f")"
  else echo "no transcript for session $1" >&2; return 1; fi
}

# Newest transcript for this repo across tools -> "<source> <path> <id>" via locate.
latest_session() {
  local best="" f cands
  # shellcheck disable=SC2012
  cands=$(ls -t "$claude_dir"/*.jsonl "$cursor_dir"/*/*.jsonl 2>/dev/null | head -1)
  # codex rollouts live in dated dirs for every project: scan newest few for our cwd
  for f in $(find "$codex_dir" -name 'rollout-*.jsonl*' 2>/dev/null | xargs ls -t 2>/dev/null | head -40); do
    [ "$(codex_cwd "$f")" = "$repo_root" ] && { cands="$cands"$'\n'"$f"; break; }
  done
  best=$(printf '%s\n' "$cands" | sed '/^$/d' | xargs ls -t | head -1)
  [ -n "$best" ] || { echo "no transcripts found" >&2; return 1; }
  case $best in *"/.codex/"*) codex_id "$best";; *) basename "$best" .jsonl;; esac
}

sessions=("$@")
[ ${#sessions[@]} -gt 0 ] || sessions=("$(latest_session)")

sources=(); transcripts=(); ids=()
for s in "${sessions[@]}"; do
  read -r src path id <<<"$(locate "$s")"
  if [ "$src" = codex ]; then
    out="$tmp/$id.jsonl"; codex_cat "$path" > "$out"; path=$out
  fi
  sources+=("$src"); transcripts+=("$path"); ids+=("$id")
done
sessions=("${ids[@]}")

files_for() { # source
  local i
  for i in "${!sources[@]}"; do [ "${sources[$i]}" = "$1" ] && echo "${transcripts[$i]}"; done
}
ids_for() {
  local i
  for i in "${!sources[@]}"; do [ "${sources[$i]}" = "$1" ] && echo "${sessions[$i]}"; done
}

models=""; efforts=""
claude_files=(); while IFS= read -r l; do [ -n "$l" ] && claude_files+=("$l"); done < <(files_for claude)
codex_files=(); while IFS= read -r l; do [ -n "$l" ] && codex_files+=("$l"); done < <(files_for codex)
if [ ${#claude_files[@]} -gt 0 ]; then
  models+=$(jq -r 'select(.type == "assistant" and .message.model != "<synthetic>") | .message.model' "${claude_files[@]}" | sort -u)$'\n'
  efforts+=$(jq -r 'select(.type == "assistant") | .effort // empty' "${claude_files[@]}" | sort -u)$'\n'
fi
if [ ${#codex_files[@]} -gt 0 ]; then
  models+=$(jq -r 'select(.type == "turn_context") | .payload.model // empty' "${codex_files[@]}" | sort -u)$'\n'
  efforts+=$(jq -r 'select(.type == "turn_context") | .payload.effort // empty' "${codex_files[@]}" | sort -u)$'\n'
fi

# tokscale usage for one client and its session ids (codex ids match by suffix).
tokscale_usage() {
  local client=$1; shift
  [ $# -gt 0 ] || { echo '{}'; return; }
  npx -y tokscale models -c "$client" --json --group-by session,model --no-spinner 2>/dev/null \
    | jq --argjson ids "$(printf '%s\n' "$@" | jq -R . | jq -s .)" '
        [.entries[] | .sessionId as $s | select($ids | any(. as $i | $s == $i or ($s | endswith($i))))]
        | {models: (map(.model) | unique),
           input: (map(.input) | add // 0), output: (map(.output) | add // 0),
           cacheRead: (map(.cacheRead) | add // 0), cacheWrite: (map(.cacheWrite) | add // 0),
           cost: (map(.cost) | add // 0), found: length}' || echo '{}'
}

usages=()
for client in claude cursor codex; do
  ids_arr=(); while IFS= read -r l; do [ -n "$l" ] && ids_arr+=("$l"); done < <(ids_for "$client")
  [ ${#ids_arr[@]} -gt 0 ] || continue
  u=$(tokscale_usage "$client" "${ids_arr[@]}")
  usages+=("$u")
  # Cursor models come only from tokscale.
  [ "$client" = cursor ] && models+=$(jq -r '.models // [] | .[]' <<<"$u")$'\n'
done
models=$(printf '%s' "$models" | sed '/^$/d' | sort -u | paste -sd, - | sed 's/,/, /g')
efforts=$(printf '%s' "$efforts" | sed '/^$/d' | sort -u | paste -sd, - | sed 's/,/, /g')

# Sum usage objects (only those where tokscale found sessions).
usage=$(printf '%s\n' '{}' "${usages[@]}" | jq -s '
  map(select((.found // 0) > 0)) as $u
  | if ($u | length) == 0 then {}
    else {input: ($u | map(.input) | add), output: ($u | map(.output) | add),
          cacheRead: ($u | map(.cacheRead) | add), cacheWrite: ($u | map(.cacheWrite) | add),
          cost: ($u | map(.cost) | add)} end')

fmt() { jq -r "$1" <<<"$usage"; }

# One JSON event per line, in transcript order:
#   {role: "user"|"claude", text}  or  {role, image: {media_type, data}}
claude_events() {
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
  ' "$1"
}

# Cursor: user text sits in <user_query> tags after a <timestamp> line; the
# harness's auto "Briefly inform the user..." follow-ups and [REDACTED]
# reasoning placeholders are dropped. No images or sidechains in the format.
cursor_events() {
  jq -c --slurp '
    .[] | .role as $r | (.message.content // [])[] | select(.type == "text")
    | (if $r == "user"
        then (.text | capture("<user_query>\\s*(?<q>[\\s\\S]*?)\\s*</user_query>").q? // empty)
        else (.text | gsub("\\[REDACTED\\]"; "") | sub("^\\s+"; "") | sub("\\s+$"; "")) end) as $x
    | select($x | test("\\S"))
    | select($x | startswith("Briefly inform the user about the task result") | not)
    | {role: (if $r == "user" then "user" else "claude" end), text: $x}
  ' "$1"
}

# Codex: response_item messages. Injected context blocks (AGENTS.md,
# <environment_context>, plugin lists, ...) are dropped; images are data: URLs.
codex_events() {
  jq -c '
    select(.type == "response_item" and .payload.type == "message"
           and (.payload.role == "user" or .payload.role == "assistant"))
    | .payload.role as $r | .payload.content[]
    | if .type == "input_text" then
        select(.text | test("^\\s*(<|# AGENTS.md)") | not) | {role: "user", text: .text}
      elif .type == "output_text" then select(.text | test("\\S")) | {role: "claude", text: .text}
      elif .type == "input_image" and (.image_url | startswith("data:")) then
        (.image_url | capture("^data:(?<media_type>[^;]+);base64,(?<data>.*)$")) as $i
        | {role: "user", image: $i}
      else empty end
  ' "$1"
}

events() {
  local i
  for i in "${!sessions[@]}"; do
    "${sources[$i]}_events" "${transcripts[$i]}"
  done
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
      file=$(to_webp "$assets/$file")
      echo
      echo "![screenshot $n](prompt-assets/$file)"
    else
      echo
      jq -r .text <<<"$ev"
    fi
  done
} > "$out"

echo "wrote $out"
