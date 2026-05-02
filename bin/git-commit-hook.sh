git() {
  if [ "$#" -gt 0 ] && [ "$1" = "commit" ]; then
    shift

    if [ -n "${PI_CO_AUTHORED_BY_TRAILER:-}" ]; then
      command git -c trailer.ifexists=addIfDifferent -c trailer.ifmissing=add commit \
        --trailer "$PI_ASSISTED_BY_TRAILER" \
        --trailer "$PI_CO_AUTHORED_BY_TRAILER" \
        "$@"
      return $?
    fi

    command git -c trailer.ifexists=addIfDifferent -c trailer.ifmissing=add commit \
      --trailer "$PI_ASSISTED_BY_TRAILER" \
      "$@"
    return $?
  fi

  command git "$@"
}

export -f git
