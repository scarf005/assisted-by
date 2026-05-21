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

gh() {
  if ! _pi_assisted_by_is_gh_pr_create "$@"; then
    command gh "$@"
    return $?
  fi

  command gh "$@"
  local status=$?
  if [ "$status" -ne 0 ]; then
    return "$status"
  fi

  _pi_assisted_by_append_pr_trailer "$@"
  return "$status"
}

export -f _pi_assisted_by_is_gh_pr_create
export -f _pi_assisted_by_append_pr_trailer
export -f gh
