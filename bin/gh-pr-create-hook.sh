_pi_assisted_by_is_gh_pr_create() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -R|--repo)
        shift 2
        ;;
      --repo=*)
        shift
        ;;
      pr)
        [ "${2:-}" = "create" ] || [ "${2:-}" = "new" ]
        return $?
        ;;
      --)
        return 1
        ;;
      -*)
        shift
        ;;
      *)
        return 1
        ;;
    esac
  done

  return 1
}

_pi_assisted_by_is_gh_issue_create() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -R|--repo)
        shift 2
        ;;
      --repo=*)
        shift
        ;;
      issue)
        [ "${2:-}" = "create" ]
        return $?
        ;;
      --)
        return 1
        ;;
      -*)
        shift
        ;;
      *)
        return 1
        ;;
    esac
  done

  return 1
}

_pi_assisted_by_extract_issue_url() {
  grep -Eo 'https://github\.com/[^[:space:]]+/issues/[0-9]+' | tail -n 1
}

_pi_assisted_by_append_pr_trailer() {
  local head=""
  local dry_run=0
  local web=0
  local repo_args=()

  while [ "$#" -gt 0 ]; do
    case "$1" in
      -R|--repo)
        if [ "$#" -gt 1 ]; then
          repo_args+=("$1" "$2")
          shift 2
        else
          shift
        fi
        ;;
      --repo=*)
        repo_args+=("$1")
        shift
        ;;
      -H|--head)
        if [ "$#" -gt 1 ]; then
          head="$2"
          shift 2
        else
          shift
        fi
        ;;
      --head=*)
        head="${1#--head=}"
        shift
        ;;
      --dry-run)
        dry_run=1
        shift
        ;;
      -w|--web)
        web=1
        shift
        ;;
      *)
        shift
        ;;
    esac
  done

  if [ "$dry_run" -ne 0 ] || [ "$web" -ne 0 ]; then
    return 0
  fi

  if [ -z "${PI_PR_OPENED_BY_TRAILER:-}" ]; then
    return 0
  fi

  local url=""
  if [ -n "$head" ]; then
    local head_branch="${head##*:}"
    url="$(command gh pr list "${repo_args[@]}" --head "$head_branch" --state open --limit 1 --json url --jq '.[0].url // ""' 2>/dev/null)"
  fi

  if [ -z "$url" ]; then
    url="$(command gh pr view "${repo_args[@]}" --json url --jq '.url // ""' 2>/dev/null)"
  fi

  if [ -z "$url" ]; then
    return 0
  fi

  local body=""
  body="$(command gh pr view "$url" "${repo_args[@]}" --json body --jq '.body // ""' 2>/dev/null)" || return 0

  if printf '%s\n' "$body" | grep -F -- "$PI_PR_OPENED_BY_TRAILER" >/dev/null; then
    return 0
  fi

  local body_file=""
  body_file="$(mktemp)" || return 0

  if [ -n "$body" ]; then
    printf '%s\n\n%s\n' "$body" "$PI_PR_OPENED_BY_TRAILER" >"$body_file"
  else
    printf '%s\n' "$PI_PR_OPENED_BY_TRAILER" >"$body_file"
  fi

  command gh pr edit "$url" "${repo_args[@]}" --body-file "$body_file" >/dev/null 2>&1 || true
  rm -f "$body_file"
}

_pi_assisted_by_append_issue_trailer() {
  local url="${1:-}"
  shift || true

  local dry_run=0
  local web=0
  local repo_args=()

  while [ "$#" -gt 0 ]; do
    case "$1" in
      -R|--repo)
        if [ "$#" -gt 1 ]; then
          repo_args+=("$1" "$2")
          shift 2
        else
          shift
        fi
        ;;
      --repo=*)
        repo_args+=("$1")
        shift
        ;;
      --dry-run)
        dry_run=1
        shift
        ;;
      -w|--web)
        web=1
        shift
        ;;
      *)
        shift
        ;;
    esac
  done

  if [ "$dry_run" -ne 0 ] || [ "$web" -ne 0 ]; then
    return 0
  fi

  if [ -z "${PI_ISSUE_OPENED_BY_TRAILER:-}" ] || [ -z "$url" ]; then
    return 0
  fi

  local body=""
  body="$(command gh issue view "$url" "${repo_args[@]}" --json body --jq '.body // ""' 2>/dev/null)" || return 0

  if printf '%s\n' "$body" | grep -F -- "$PI_ISSUE_OPENED_BY_TRAILER" >/dev/null; then
    return 0
  fi

  local body_file=""
  body_file="$(mktemp)" || return 0

  if [ -n "$body" ]; then
    printf '%s\n\n%s\n' "$body" "$PI_ISSUE_OPENED_BY_TRAILER" >"$body_file"
  else
    printf '%s\n' "$PI_ISSUE_OPENED_BY_TRAILER" >"$body_file"
  fi

  command gh issue edit "$url" "${repo_args[@]}" --body-file "$body_file" >/dev/null 2>&1 || true
  rm -f "$body_file"
}

gh() {
  if _pi_assisted_by_is_gh_pr_create "$@"; then
    command gh "$@"
    local status=$?
    if [ "$status" -ne 0 ]; then
      return "$status"
    fi

    _pi_assisted_by_append_pr_trailer "$@"
    return "$status"
  fi

  if _pi_assisted_by_is_gh_issue_create "$@"; then
    local output_file=""
    output_file="$(mktemp)" || {
      command gh "$@"
      return $?
    }

    command gh "$@" | tee "$output_file"
    local status=${PIPESTATUS[0]}
    if [ "$status" -eq 0 ]; then
      local url=""
      url="$(_pi_assisted_by_extract_issue_url <"$output_file")"
      _pi_assisted_by_append_issue_trailer "$url" "$@"
    fi

    rm -f "$output_file"
    return "$status"
  fi

  command gh "$@"
}

export -f _pi_assisted_by_is_gh_pr_create
export -f _pi_assisted_by_is_gh_issue_create
export -f _pi_assisted_by_extract_issue_url
export -f _pi_assisted_by_append_pr_trailer
export -f _pi_assisted_by_append_issue_trailer
export -f gh
