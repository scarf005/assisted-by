# @scarf/pi-assisted-by

Pi package that mechanically appends kernel-style AI attribution trailers when Pi triggers `git commit`.

## What it does

- intercepts Pi `bash` tool calls that invoke `git commit`
- wraps Pi `!git commit` user bash commands the same way
- appends trailers with Git's built-in `--trailer` support
- de-duplicates trailers on `--amend` via `trailer.ifexists=doNothing`
- emits kernel-style attribution:
  - `Assisted-by: pi:MODEL [TOOL ...]`
  - `Co-authored-by: ...` when the model maps to a known bot identity

Basic tools are not listed. Specialized tools are collected mechanically from bash commands for:

- `coccinelle` / `spatch`
- `sparse`
- `smatch`
- `clang-tidy`

## Install

```bash
pi install /home/scarf/repo/etc/assisted-by
```

Or from the current directory:

```bash
pi install .
```

## Configuration

Optional environment variables:

- `PI_ASSISTED_BY_AGENT`: override the agent name in `Assisted-by:`. Default: `pi`
- `PI_ASSISTED_BY_EXTRA_TOOLS`: extra space- or comma-separated specialized tool labels to append

## Notes

- this intercepts `git commit` mechanically; the model does not format or decide the trailers
- it does not rewrite commits created by commands other than `git commit`
- it ships a small CLI compatible with the reference script shape:

```bash
assisted-by <model-name> <agent-name> [tool ...]
```
