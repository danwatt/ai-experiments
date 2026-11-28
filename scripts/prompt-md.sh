#!/usr/bin/env bash
# Write <demo-dir>/prompt.md from Claude Code, Cursor and/or Codex (ChatGPT app)
# session transcript(s): model(s), effort level(s), token usage/cost via
# tokscale, then the conversation (user prompts + assistant replies) with
# screenshots saved to <demo-dir>/prompt-assets/ (as WebP, at most 1600px wide,
# when ImageMagick is installed). Thinking and tool calls are
# omitted. Cursor transcripts carry no model/effort/usage/images, so those come
# from tokscale when it knows the session.
#
# Usage: scripts/prompt-md.sh [--no-screenshots] [--append] <demo-dir> [session-id ...]
# Each id is looked up in ~/.claude/projects, ~/.cursor/projects and
# ~/.codex/sessions. With no id, uses the newest transcript of any tool whose
# cwd is this repo.
#
# --append keeps an existing prompt.md and its screenshots as they are and adds
# each session to the end, inside <!-- prompt-md:session --> markers, with its
# screenshots saved as prompt-assets/<first 8 of id>-NNN.webp. Running it again
# for the same session replaces only that session's block (and its screenshots).
# The header's model, effort, session and cost lines are recomputed from the
# original header (kept in a <!-- prompt-md:base --> comment) plus every block.
# Sessions listed in the original header are skipped. Without a prompt.md,
# --append writes a new one as usual.
set -euo pipefail

screenshots=1; append=0
while [ $# -gt 0 ]; do
  case $1 in
    --no-screenshots) screenshots=0; shift;;
    --append) append=1; shift;;
    *) break;;
  esac
done

demo_dir=${1:?usage: $0 [--no-screenshots] [--append] <demo-dir> [session-id ...]}
shift
mode=full
[ "$append" = 1 ] && [ -f "$demo_dir/prompt.md" ] && mode=append
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

if [ "$mode" = full ]; then
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
fi

fmt() { jq -r "$1" <<<"$usage"; }

# One JSON event per line, in transcript order:
#   {role: "user"|"claude", text}  or  {role, image: {media_type, data}}
claude_events() {
  jq -c '
    select(.isSidechain | not)
    | "Background (from the session that started this one)" as $brief
    | if .type == "user" and (.isMeta | not) and .origin == null
         and (.message.content | type) == "string" and (.message.content | contains($brief)) then
        # A session started by another session: its brief, minus any reminder text in front of it.
        .message.content as $c | {role: "user", text: $c[($c | index($brief)):]}
      elif .type == "user" and .origin.kind == "human" and (.isMeta | not) then
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
out="$demo_dir/prompt.md"

# Events on stdin -> markdown on stdout. Screenshots are saved as
# <prefix>NNN.<ext> (NNN counts from 1 per call); their alt text keeps counting
# from <screenshots already in prompt.md>.
render_events() { # <file prefix> <screenshots before>
  local prefix=$1 n=$2 k=0 last="" ev role ext file
  while IFS= read -r ev; do
    role=$(jq -r .role <<<"$ev")
    if [ "$role" != "$last" ]; then
      echo
      if [ "$role" = user ]; then echo "## You"; else echo "## Claude"; fi
      last=$role
    fi
    if jq -e 'has("image")' <<<"$ev" >/dev/null; then
      [ "$screenshots" = 1 ] || continue
      n=$((n + 1)); k=$((k + 1))
      ext=$(jq -r '.image.media_type | sub("^image/"; "") | sub("jpeg"; "jpg")' <<<"$ev")
      file=$(printf '%s%03d.%s' "$prefix" "$k" "$ext")
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
}

if [ "$mode" = full ]; then
  rm -rf "$assets"
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
    events | render_events "" 0
  } > "$out"
  echo "wrote $out"
  exit 0
fi

# ---- --append: keep prompt.md, (re)write one marked block per session ----
# strip: read the header (or the base comment an earlier append left), drop the
#   blocks of the sessions being written (and their screenshots), list which
#   sessions to write, print how many screenshots the kept text links.
# merge: append the new blocks, number the session dividers, rebuild the header.
merge_py=$(cat <<'PY'
import glob, json, os, re, sys

BLOCK = re.compile(r"\n*<!-- prompt-md:session (\{.*?\}) -->\n(.*?)<!-- /prompt-md:session -->\n?", re.S)
DIVIDER = re.compile(r"\A\s*---\n\n\*Session [^\n]*\*\n")
HEADER = re.compile(r"\A# Prompts\n\n((?:- \*\*[^\n]*\n)+)")
BASE = re.compile(r"<!-- prompt-md:base (\{.*?\}) -->\n")
TOKENS = ("input", "output", "cacheRead", "cacheWrite")

def parse_header(lines):
    d = {"models": [], "efforts": [], "sessions": [], "usage": None}
    for line in lines.splitlines():
        m = re.match(r"- \*\*(.+?):\*\* (.*)", line)
        if not m:
            continue
        key, val = m.groups()
        if key in ("Model", "Effort"):
            d["models" if key == "Model" else "efforts"] = [] if val == "unknown" else val.split(", ")
        elif key == "Session(s)":
            d["sessions"] = val.split()
        elif key == "Tokens":
            d["usage"] = dict(zip(TOKENS, map(int, re.findall(r"\d+", val))))
        elif key.startswith("Cost (tokscale") and d["usage"] is not None:
            d["usage"]["cost"] = float(re.sub(r"[^\d.]", "", val))
    return d

def split(path):
    text = open(path).read()
    m = HEADER.match(text)
    if not m:
        sys.exit(f"{path} has no '# Prompts' header to append under")
    body = text[m.end():]
    b = BASE.match(body.lstrip("\n"))
    if b:
        return json.loads(b.group(1)), body.lstrip("\n")[b.end():]
    return parse_header(m.group(1)), body

cmd, out, tmp = sys.argv[1:4]
if cmd == "strip":
    base, body = split(out)
    todo = []
    for sid in sys.argv[4:]:
        if sid in base["sessions"]:
            print(f"session {sid} is part of the original prompt.md; left as is", file=sys.stderr)
        elif sid not in todo:
            todo.append(sid)
    def drop(m):
        sid = json.loads(m.group(1))["id"]
        if sid not in todo:
            return m.group(0)
        for f in glob.glob(os.path.join(os.path.dirname(out), "prompt-assets", sid[:8] + "-*")):
            os.remove(f)
        return ""
    body = BLOCK.sub(drop, body)
    json.dump(base, open(f"{tmp}/base.json", "w"))
    open(f"{tmp}/body.md", "w").write(body)
    open(f"{tmp}/todo", "w").write("".join(s + "\n" for s in todo))
    print(len(re.findall(r"!\[screenshot ", body)))
else:
    base = json.load(open(f"{tmp}/base.json"))
    body = open(f"{tmp}/body.md").read().rstrip("\n") + "\n"
    for sid in open(f"{tmp}/todo").read().split():
        meta = open(f"{tmp}/meta-{sid}.json").read().strip()
        content = open(f"{tmp}/block-{sid}.md").read().strip("\n")
        body += f"\n<!-- prompt-md:session {meta} -->\n{content}\n<!-- /prompt-md:session -->\n"
    metas = []
    def divide(m):
        meta = json.loads(m.group(1))
        metas.append(meta)
        bits = [f"Session {len(base['sessions']) + len(metas)}", meta.get("date"), ", ".join(meta["models"])]
        if meta["efforts"]:
            bits.append("effort " + ", ".join(meta["efforts"]))
        inner = DIVIDER.sub("", m.group(2), count=1).strip("\n")
        return (f"\n\n<!-- prompt-md:session {json.dumps(meta)} -->\n\n---\n\n*"
                + " · ".join(b for b in bits if b) + f"*\n\n{inner}\n\n<!-- /prompt-md:session -->\n")
    body = BLOCK.sub(divide, body)
    models = sorted(set(base["models"]).union(*(m["models"] for m in metas)))
    efforts = sorted(set(base["efforts"]).union(*(m["efforts"] for m in metas)))
    usages = [base["usage"]] + [m["usage"] for m in metas]
    have = [u for u in usages if u]
    lines = ["# Prompts", "",
             f"- **Model:** {', '.join(models) or 'unknown'}",
             f"- **Effort:** {', '.join(efforts) or 'unknown'}",
             f"- **Session(s):** {' '.join(base['sessions'] + [m['id'] for m in metas])}"]
    if have:
        t = {k: sum(u[k] for u in have) for k in TOKENS + ("cost",)}
        missing = len(usages) - len(have)
        note = f" (no data for {missing} session{'s' if missing > 1 else ''})" if missing else ""
        lines.append(f"- **Tokens:** input {t['input']}, output {t['output']}, cache read {t['cacheRead']}, cache write {t['cacheWrite']}{note}")
        lines.append(f"- **Cost (tokscale estimate):** ${t['cost']:.2f}{note}")
    else:
        lines.append("- **Cost:** unavailable (tokscale failed)")
    open(out, "w").write("\n".join(lines) + f"\n\n<!-- prompt-md:base {json.dumps(base)} -->\n" + body)
PY
)

n=$(python3 -c "$merge_py" strip "$out" "$tmp" "${sessions[@]}")
if [ ! -s "$tmp/todo" ]; then echo "nothing to append to $out"; exit 0; fi
while IFS= read -r id; do
  for i in "${!sessions[@]}"; do [ "${sessions[$i]}" = "$id" ] && break; done
  src=${sources[$i]}; path=${transcripts[$i]}
  case $src in
    claude) me=$(jq -s '{models: ([.[] | select(.type == "assistant" and .message.model != "<synthetic>") | .message.model] | unique),
                         efforts: ([.[] | select(.type == "assistant") | .effort // empty] | unique)}' "$path");;
    codex) me=$(jq -s '{models: ([.[] | select(.type == "turn_context") | .payload.model // empty] | unique),
                        efforts: ([.[] | select(.type == "turn_context") | .payload.effort // empty] | unique)}' "$path");;
    *) me='{"models": [], "efforts": []}';;
  esac
  u=$(tokscale_usage "$src" "$id")
  # first timestamp in the transcript, as a local date
  day=$(jq -rn 'first(inputs | .timestamp? // empty | strings)
                | sub("\\.[0-9]+"; "") | fromdateiso8601 | localtime | strftime("%Y-%m-%d")' "$path" 2>/dev/null || true)
  [ -n "$day" ] || day=$(date -r "$path" +%F)
  jq -n --arg id "$id" --arg day "$day" --arg src "$src" --argjson me "$me" --argjson u "$u" '
    {id: $id, date: $day,
     models: ($me.models + (if $src == "cursor" then ($u.models // []) else [] end) | unique),
     efforts: $me.efforts,
     usage: (if ($u.found // 0) > 0 then ($u | {input, output, cacheRead, cacheWrite, cost}) else null end)}
  ' -c > "$tmp/meta-$id.json"
  "${src}_events" "$path" | render_events "${id:0:8}-" "$n" > "$tmp/block-$id.md"
  n=$((n + $(grep -c '^!\[screenshot ' "$tmp/block-$id.md" || true)))
done < "$tmp/todo"
python3 -c "$merge_py" merge "$out" "$tmp"
echo "appended $(wc -l < "$tmp/todo" | tr -d ' ') session(s) to $out"
