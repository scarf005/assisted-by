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
  local opts char

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --)
        return 1
        ;;
      --amend|--no-edit|--fixup|--squash|--message|--file|--reuse-message|--reedit-message)
        return 0
        ;;
      --fixup=*|--squash=*|--message=*|--file=*|--reuse-message=*|--reedit-message=*)
        return 0
        ;;
      --author|--date|--cleanup|--template|--trailer|--pathspec-from-file)
        [ "$#" -gt 1 ] && shift
        ;;
      --*)
        ;;
      -?*)
        # Short options may be bundled (-qm, -am). Scan left to right: the first
        # option that takes a value consumes the rest of the bundle.
        opts="${1#-}"
        while [ -n "$opts" ]; do
          char="${opts%"${opts#?}"}"
          opts="${opts#?}"
          case "$char" in
            m|F|C|c)
              return 0
              ;;
            t)
              [ -z "$opts" ] && [ "$#" -gt 1 ] && shift
              break
              ;;
            u|S)
              break
              ;;
          esac
        done
        ;;
    esac
    shift
  done

  return 1
}

# Print the model of one Assisted-by trailer value: "AGENT:MODEL [TOOL ...]" gives "model".
_pi_assisted_by_model() {
  local value="${1#*:}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%%[[:space:]]*}"
  value="${value##*:}"
  printf '%s' "$value" | tr '[:upper:]' '[:lower:]'
}

# Print the message that the commit will use. It reads `globals` of the calling `git` function.
# Read it from -m, -F, -C, -c, or HEAD for --amend.
# Print nothing when the source is not simple. Then the caller adds the trailer.
_pi_assisted_by_commit_message() {
  local message="" ref="" amend=0 has_text=0

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --)
        break
        ;;
      --amend)
        amend=1
        ;;
      -m|--message)
        [ "$#" -gt 1 ] || return 0
        message="${message}${2}"$'\n\n'
        has_text=1
        shift
        ;;
      --message=*)
        message="${message}${1#--message=}"$'\n\n'
        has_text=1
        ;;
      -F|--file)
        [ "$#" -gt 1 ] && [ "$2" != "-" ] || return 0
        message="${message}$(cat -- "$2" 2>/dev/null)"$'\n\n'
        has_text=1
        shift
        ;;
      --file=*)
        message="${message}$(cat -- "${1#--file=}" 2>/dev/null)"$'\n\n'
        has_text=1
        ;;
      -C|-c|--reuse-message|--reedit-message)
        [ "$#" -gt 1 ] || return 0
        ref="$2"
        shift
        ;;
      --reuse-message=*|--reedit-message=*)
        ref="${1#*=}"
        ;;
    esac
    shift
  done

  if [ -n "$ref" ]; then
    command git "${globals[@]}" log -1 --format=%B "$ref" 2>/dev/null
  elif [ "$has_text" = 1 ]; then
    printf '%s' "$message"
  elif [ "$amend" = 1 ]; then
    command git "${globals[@]}" log -1 --format=%B HEAD 2>/dev/null
  fi
}

# Succeed when the message already has an Assisted-by trailer for the same model as $1.
_pi_assisted_by_message_has_model() {
  local wanted line

  wanted="$(_pi_assisted_by_model "$1")"
  [ -n "$wanted" ] || return 1

  while IFS= read -r line; do
    case "$line" in
      [Aa]ssisted-by:*)
        [ "$(_pi_assisted_by_model "$line")" = "$wanted" ] && return 0
        ;;
    esac
  done <<<"$(_pi_assisted_by_commit_message "${@:2}")"

  return 1
}

git() {
  local globals=()

  # Keep global options (-C dir, -c k=v, --git-dir dir, ...) in front of the wrapped subcommand.
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -C|-c|--git-dir|--work-tree|--namespace|--exec-path|--config-env)
        [ "$#" -gt 1 ] || break
        globals+=("$1" "$2")
        shift 2
        ;;
      -p|-P|--*)
        globals+=("$1")
        shift
        ;;
      *)
        break
        ;;
    esac
  done

  if [ "$#" -gt 0 ] && [ "$1" = "commit" ]; then
    shift

    if ! _pi_assisted_by_has_git_commit_message_source "$@"; then
      printf '%s\n' "assisted-by: refusing git commit without a message source; use -m, -F, -C, -c, --fixup, --squash, --amend, or --no-edit explicitly." >&2
      return 1
    fi

    # The trailer step of Git compares whole values. Skip the trailer when the model is already there.
    local trailers=()
    _pi_assisted_by_message_has_model "$PI_ASSISTED_BY_TRAILER" "$@" ||
      trailers+=(--trailer "$PI_ASSISTED_BY_TRAILER")
    [ -z "${PI_CO_AUTHORED_BY_TRAILER:-}" ] ||
      trailers+=(--trailer "$PI_CO_AUTHORED_BY_TRAILER")

    GIT_EDITOR=: command git "${globals[@]}" -c trailer.ifexists=addIfDifferent -c trailer.ifmissing=add commit \
      "${trailers[@]}" \
      "$@"
    return $?
  fi

  if _pi_assisted_by_is_git_rebase_continue "$@"; then
    GIT_EDITOR=: command git "${globals[@]}" "$@"
    return $?
  fi

  command git "${globals[@]}" "$@"
}

# zsh has no `export -f` and prints the function bodies instead.
if [ -n "${BASH_VERSION:-}" ]; then
  export -f _pi_assisted_by_is_git_rebase_continue
  export -f _pi_assisted_by_has_git_commit_message_source
  export -f _pi_assisted_by_model
  export -f _pi_assisted_by_commit_message
  export -f _pi_assisted_by_message_has_model
  export -f git
fi
