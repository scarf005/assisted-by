#!/usr/bin/env bash

_claude_assisted_by_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
_claude_assisted_by_model="${CLAUDE_ASSISTED_BY_MODEL:-claude}"
_claude_assisted_by_agent="${CLAUDE_ASSISTED_BY_AGENT:-claude-code}"
_claude_assisted_by_tools="${CLAUDE_ASSISTED_BY_EXTRA_TOOLS:-}"

_claude_assisted_by_trailers="$(
  deno run --quiet --allow-read "$_claude_assisted_by_root/bin/assisted-by.ts" \
    "$_claude_assisted_by_model" "$_claude_assisted_by_agent" \
    ${_claude_assisted_by_tools//,/ } 2>/dev/null
)" || _claude_assisted_by_trailers=""

if [ -z "$_claude_assisted_by_trailers" ]; then
  printf '%s\n' "assisted-by: unable to build Claude Code attribution; install Deno or set up the package first." >&2
  return 1 2>/dev/null || exit 1
fi

export PI_ASSISTED_BY_TRAILER="$(printf '%s\n' "$_claude_assisted_by_trailers" | sed -n '1p')"
export PI_CO_AUTHORED_BY_TRAILER="$(printf '%s\n' "$_claude_assisted_by_trailers" | sed -n '2p')"
export PI_PR_OPENED_BY_TRAILER="<sub>PR opened by $_claude_assisted_by_model on $_claude_assisted_by_agent</sub>"
export PI_ISSUE_OPENED_BY_TRAILER="<sub>Issue opened by $_claude_assisted_by_model on $_claude_assisted_by_agent</sub>"

# Reuse the tested command wrappers used by the Pi and OpenCode integrations.
source "$_claude_assisted_by_root/bin/git-commit-hook.sh"
source "$_claude_assisted_by_root/bin/gh-pr-create-hook.sh"

unset _claude_assisted_by_root
unset _claude_assisted_by_model
unset _claude_assisted_by_agent
unset _claude_assisted_by_tools
unset _claude_assisted_by_trailers
