#!/usr/bin/env bash

_codex_assisted_by_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
_codex_assisted_by_model="${CODEX_ASSISTED_BY_MODEL:-${CODEX_MODEL:-codex}}"
_codex_assisted_by_agent="${CODEX_ASSISTED_BY_AGENT:-codex}"
_codex_assisted_by_tools="${CODEX_ASSISTED_BY_EXTRA_TOOLS:-}"

_codex_assisted_by_trailers="$(
  deno run --quiet --allow-read "$_codex_assisted_by_root/bin/assisted-by.ts" \
    "$_codex_assisted_by_model" "$_codex_assisted_by_agent" \
    ${_codex_assisted_by_tools//,/ } 2>/dev/null
)" || _codex_assisted_by_trailers=""

if [ -z "$_codex_assisted_by_trailers" ]; then
  printf '%s\n' "assisted-by: unable to build Codex attribution; install Deno or set up the package first." >&2
  return 1 2>/dev/null || exit 1
fi

export PI_ASSISTED_BY_TRAILER="$(printf '%s\n' "$_codex_assisted_by_trailers" | sed -n '1p')"
export PI_CO_AUTHORED_BY_TRAILER="$(printf '%s\n' "$_codex_assisted_by_trailers" | sed -n '2p')"
export PI_PR_OPENED_BY_TRAILER="<sub>PR opened by $_codex_assisted_by_model on $_codex_assisted_by_agent</sub>"
export PI_ISSUE_OPENED_BY_TRAILER="<sub>Issue opened by $_codex_assisted_by_model on $_codex_assisted_by_agent</sub>"

# Reuse the tested command wrappers used by the Pi and OpenCode integrations.
source "$_codex_assisted_by_root/bin/git-commit-hook.sh"
source "$_codex_assisted_by_root/bin/gh-pr-create-hook.sh"

unset _codex_assisted_by_root
unset _codex_assisted_by_model
unset _codex_assisted_by_agent
unset _codex_assisted_by_tools
unset _codex_assisted_by_trailers
