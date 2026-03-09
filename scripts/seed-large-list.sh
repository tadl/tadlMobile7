#!/usr/bin/env bash
set -euo pipefail

# Seed a list to a target size using Aspen SearchAPI + ListAPI.
# Default behavior:
# - reads creds from ./.creds (username=..., password=...)
# - creates/uses list title "large list"
# - fills list to 500 items
#
# Example:
#   scripts/seed-large-list.sh
#   scripts/seed-large-list.sh --title "large list 2" --target 750
#   scripts/seed-large-list.sh --creds ./.creds --term the --term a --term history

API_BASE_DEFAULT="https://aspen.tools.tadl.org/API"
API_PARAM_DEFAULT="tadl-prod"
DEFAULT_TITLE="large list"
DEFAULT_TARGET=500
DEFAULT_PAGE_SIZE=1000
DEFAULT_PAGES_PER_TERM=1

title="$DEFAULT_TITLE"
description="automation seeded list"
target="$DEFAULT_TARGET"
creds_file="./.creds"
api_base="$API_BASE_DEFAULT"
api_param="$API_PARAM_DEFAULT"
page_size="$DEFAULT_PAGE_SIZE"
pages_per_term="$DEFAULT_PAGES_PER_TERM"
terms=("the" "a")

usage() {
  cat <<'EOF'
Usage: scripts/seed-large-list.sh [options]

Options:
  --title <name>            List title (default: "large list")
  --description <text>      List description (default: "automation seeded list")
  --target <n>              Desired final item count (default: 500)
  --creds <path>            Creds file path (default: ./.creds)
  --api-base <url>          API base URL (default: https://aspen.tools.tadl.org/API)
  --api <name>              Aspen API selector (default: tadl-prod)
  --page-size <n>           Search pageSize (default: 1000)
  --pages-per-term <n>      Pages to fetch per search term (default: 1)
  --term <query>            Add a search term (repeatable)
  --help                    Show this help
EOF
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

while (($#)); do
  case "$1" in
    --title) title="${2:-}"; shift 2 ;;
    --description) description="${2:-}"; shift 2 ;;
    --target) target="${2:-}"; shift 2 ;;
    --creds) creds_file="${2:-}"; shift 2 ;;
    --api-base) api_base="${2:-}"; shift 2 ;;
    --api) api_param="${2:-}"; shift 2 ;;
    --page-size) page_size="${2:-}"; shift 2 ;;
    --pages-per-term) pages_per_term="${2:-}"; shift 2 ;;
    --term) terms+=("${2:-}"); shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

require_cmd curl
require_cmd jq

if [[ ! -f "$creds_file" ]]; then
  echo "Creds file not found: $creds_file" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$creds_file"

if [[ -z "${username:-}" || -z "${password:-}" ]]; then
  echo "Creds file must define: username=... and password=..." >&2
  exit 1
fi

if ! [[ "$target" =~ ^[0-9]+$ ]]; then
  echo "--target must be a positive integer" >&2
  exit 1
fi

if ! [[ "$page_size" =~ ^[0-9]+$ && "$pages_per_term" =~ ^[0-9]+$ ]]; then
  echo "--page-size and --pages-per-term must be positive integers" >&2
  exit 1
fi

api_post_form() {
  local url="$1"
  shift
  curl -L -sS -X POST "$url" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data "username=${username}" \
    --data "password=${password}" \
    "$@"
}

urlenc() {
  jq -rn --arg v "$1" '$v|@uri'
}

echo "Resolving list: ${title}"
user_lists_json="$(api_post_form "${api_base}/ListAPI?method=getUserLists&api=${api_param}")"
list_id="$(printf '%s' "$user_lists_json" | jq -r --arg t "$title" '.result.lists[]? | select((.title // "") == $t) | .id' | head -n1)"

if [[ -z "${list_id:-}" || "$list_id" == "null" ]]; then
  echo "List not found. Creating..."
  create_json="$(api_post_form "${api_base}/ListAPI?method=createList&title=$(urlenc "$title")&description=$(urlenc "$description")&public=0&api=${api_param}")"
  list_id="$(printf '%s' "$create_json" | jq -r '.result.listId // empty')"
fi

if [[ -z "${list_id:-}" ]]; then
  echo "Could not resolve/create list id." >&2
  exit 1
fi

echo "Using list id: ${list_id}"

existing_tmp="$(mktemp)"
cand_tmp="$(mktemp)"
new_tmp="$(mktemp)"
trap 'rm -f "$existing_tmp" "$cand_tmp" "$new_tmp"' EXIT

existing_json="$(api_post_form "${api_base}/ListAPI?method=getListTitles&id=${list_id}&page=1&numTitles=4000&api=${api_param}")"
printf '%s' "$existing_json" | jq -r '.result.titles[]?.id // empty' | sort -u > "$existing_tmp"
existing_count="$(wc -l < "$existing_tmp" | tr -d ' ')"

if (( existing_count >= target )); then
  echo "List already has ${existing_count} items (target: ${target})."
  exit 0
fi

deficit=$((target - existing_count))
echo "Current count: ${existing_count}, need to add: ${deficit}"

> "$cand_tmp"
for term in "${terms[@]}"; do
  [[ -z "$term" ]] && continue
  for ((p=1; p<=pages_per_term; p++)); do
    echo "Collecting candidates: term='${term}', page=${p}"
    resp="$(api_post_form "${api_base}/SearchAPI?method=searchLite&type=catalog&lookfor=$(urlenc "$term")&page=${p}&pageSize=${page_size}&searchIndex=Keyword&source=local&sort=relevance&includeSortList=false&api=${api_param}")" || true
    printf '%s' "$resp" | jq -r '.result.items[]?.key // empty' >> "$cand_tmp" || true
  done
done

sort -u "$cand_tmp" -o "$cand_tmp"
comm -23 "$cand_tmp" "$existing_tmp" | head -n "$deficit" > "$new_tmp"

ids=()
while IFS= read -r line; do
  [[ -n "$line" ]] && ids+=("$line")
done < "$new_tmp"

if [[ "${#ids[@]}" -eq 0 ]]; then
  echo "No new candidate IDs to add." >&2
  exit 1
fi

batch_size=50
added_reported=0

for ((i=0; i<${#ids[@]}; i+=batch_size)); do
  batch=("${ids[@]:i:batch_size}")
  echo "Adding batch $((i / batch_size + 1)) / $((( ${#ids[@]} + batch_size - 1 ) / batch_size))"

  curl_cmd=(
    curl -L -sS -X POST
    "${api_base}/ListAPI?method=addTitlesToList&listId=${list_id}&source=GroupedWork&api=${api_param}"
    -H "Content-Type: application/x-www-form-urlencoded"
    --data "username=${username}"
    --data "password=${password}"
  )

  for rid in "${batch[@]}"; do
    curl_cmd+=(--data-urlencode "recordIds[]=${rid}")
  done

  add_json="$("${curl_cmd[@]}")"
  ok="$(printf '%s' "$add_json" | jq -r '.result.success // false')"
  num_added="$(printf '%s' "$add_json" | jq -r '.result.numAdded // 0')"

  if [[ "$ok" != "true" ]]; then
    echo "Batch failed at offset ${i}" >&2
    printf '%s\n' "$add_json" >&2
    exit 1
  fi

  added_reported=$((added_reported + num_added))
done

final_json="$(api_post_form "${api_base}/ListAPI?method=getListTitles&id=${list_id}&page=1&numTitles=4000&api=${api_param}")"
final_count="$(printf '%s' "$final_json" | jq -r '.result.totalResults // (.result.titles|length) // 0')"

echo "Done."
echo "list_id=${list_id}"
echo "existing_before=${existing_count}"
echo "added_reported=${added_reported}"
echo "final_count=${final_count}"
