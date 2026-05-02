# @scarf/pi-assisted-by

Mechanical kernel-style AI attribution trailers for Pi and OpenCode `git commit` calls.

## What it does

- intercepts Pi `bash` tool calls that invoke `git commit`
- wraps Pi `!git commit` user bash commands the same way
- wraps OpenCode bash/shell tool calls that invoke `git commit`
- appends trailers with Git's built-in `--trailer` support
- de-duplicates trailers on `--amend` via `trailer.ifexists=addIfDifferent`
- emits kernel-style attribution:
  - `Assisted-by: AGENT:MODEL [TOOL ...]`
  - `Co-authored-by: ...` when the model maps to a known bot identity

Basic tools are not listed. Specialized tools are collected mechanically from bash commands for:

- `coccinelle` / `spatch`
- `sparse`
- `smatch`
- `clang-tidy`

## Install for Pi

From npm:

```bash
pi install npm:@scarf/pi-assisted-by
```

From the current directory:

```bash
pi install .
```

Optional environment variables:

- `PI_ASSISTED_BY_AGENT`: override the agent name in `Assisted-by:`. Default: `pi`
- `PI_ASSISTED_BY_EXTRA_TOOLS`: extra space- or comma-separated specialized tool labels to append

## Install for OpenCode

Add the npm package to `opencode.jsonc`:

```jsonc
{
  "plugin": ["@scarf/pi-assisted-by"]
}
```

For local development:

```jsonc
{
  "plugin": ["./opencode/assisted-by.js"]
}
```

Optional environment variables:

- `OPENCODE_ASSISTED_BY_AGENT`: override the agent name in `Assisted-by:`. Default: `opencode`
- `OPENCODE_ASSISTED_BY_EXTRA_TOOLS`: extra space- or comma-separated specialized tool labels to append

## CLI

```bash
assisted-by <model-name> <agent-name> [tool ...]
```

Example:

```bash
assisted-by gpt-5.4 opencode sparse
```

## Development

Source lives in `src/` and generated package entrypoints are emitted to `bin/`, `extensions/`, `lib/`, and `opencode/`.

```bash
deno task fmt
deno task check
deno task lint
deno task test
deno task build
```

## Notes

- this intercepts `git commit` mechanically; the model does not format or decide the trailers
- it does not rewrite commits created by commands other than `git commit`
- npm package export `./server` is the OpenCode plugin entrypoint
- Pi loads `./extensions` through the `pi` manifest
