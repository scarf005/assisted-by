_pi_assisted_by_is_git_rebase_continue() {
  [ "$#" -gt 0 ] && [ "$1" = "rebase" ] || return 1
  shift

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --continue)
        return 0
        ;;
    esac
    shift
  done

  return 1
}

_pi_assisted_by_has_git_commit_message_source() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --amend|--no-edit|--fixup|--squash|--message|--file|--reuse-message|--reedit-message)
        return 0
        ;;
      --fixup=*|--squash=*|--message=*|--file=*|--reuse-message=*|--reedit-message=*)
        return 0
        ;;
      -m|-F|-C|-c)
        return 0
        ;;
      -m*|-F*|-C*|-c*)
        return 0
        ;;
      --)
        return 1
        ;;
    esac
    shift
  done

  return 1
}

git() {
  if [ "$#" -gt 0 ] && [ "$1" = "commit" ]; then
    shift

    if ! _pi_assisted_by_has_git_commit_message_source "$@"; then
      printf '%s\n' "assisted-by: refusing git commit without a message source; use -m, -F, -C, -c, --fixup, --squash, --amend, or --no-edit explicitly." >&2
      return 1
    fi

    if [ -n "${PI_CO_AUTHORED_BY_TRAILER:-}" ]; then
      GIT_EDITOR=: command git -c trailer.ifexists=addIfDifferent -c trailer.ifmissing=add commit \
        --trailer "$PI_ASSISTED_BY_TRAILER" \
        --trailer "$PI_CO_AUTHORED_BY_TRAILER" \
        "$@"
      return $?
    fi

    GIT_EDITOR=: command git -c trailer.ifexists=addIfDifferent -c trailer.ifmissing=add commit \
      --trailer "$PI_ASSISTED_BY_TRAILER" \
      "$@"
    return $?
  fi

  if _pi_assisted_by_is_git_rebase_continue "$@"; then
    GIT_EDITOR=: command git "$@"
    return $?
  fi

  command git "$@"
}

export -f _pi_assisted_by_is_git_rebase_continue
export -f _pi_assisted_by_has_git_commit_message_source
export -f git
