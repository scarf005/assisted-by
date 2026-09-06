# @scarf/assisted-by

Mechanical kernel-style AI attribution trailers for Codex, Pi, and OpenCode `git commit`, `git rebase --continue`, `gh pr create`, and `gh issue create` calls.

## What it does

- intercepts Pi `bash` tool calls that invoke `git commit`, `git rebase --continue`, `gh pr create`, or `gh issue create`
- wraps Pi `!git commit`, `!git rebase --continue`, `!gh pr create`, and `!gh issue create` user bash commands the same way
- wraps OpenCode bash/shell tool calls that invoke `git commit`, `git rebase --continue`, `gh pr create`, or `gh issue create`
- ships a Codex plugin skill and a sourceable Bash wrapper for the same workflows
- appends commit trailers with Git's built-in `--trailer` support
- prevents AI-blocking GUI editors by rejecting `git commit` without a message source and running intercepted commits/rebase-continues with `GIT_EDITOR=:`
- appends PR body attribution: `<sub>PR opened by MODEL THINKING on HARNESS</sub>`
- appends issue body attribution: `<sub>Issue opened by MODEL THINKING on HARNESS</sub>`
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

From JSR's npm compatibility registry:

```bash
npm config set @jsr:registry https://npm.jsr.io
pi install npm:@jsr/scarf__assisted-by
```

From the current directory:

```bash
pi install .
```

Optional environment variables:

- `PI_ASSISTED_BY_AGENT`: override the agent name in `Assisted-by:`. Default: `pi`
- `PI_ASSISTED_BY_EXTRA_TOOLS`: extra space- or comma-separated specialized tool labels to append

## Install for Codex

This repository is also a Codex plugin. Add the repository as a local marketplace and install it:

```bash
codex plugin marketplace add /absolute/path/to/assisted-by
codex plugin add assisted-by@assisted-by-local
```

After restarting Codex, the `assisted-by` skill is available in chat. The installed plugin also provides a wrapper for explicit attribution from a Codex Bash command:

```bash
source /absolute/path/to/assisted-by/bin/codex-bash-hook.sh && git commit -m "subject"
```

The Codex wrapper uses `CODEX_ASSISTED_BY_MODEL`, then `CODEX_MODEL`, and records `codex` only when neither model identifier is available. It always uses `codex` as the default agent label, so Codex work is not mislabeled as Pi work. `CODEX_ASSISTED_BY_AGENT` and `CODEX_ASSISTED_BY_EXTRA_TOOLS` provide the matching overrides. Keep `source` chained with `&&`: if attribution setup fails, the commit command must not run.

## Install for OpenCode

Add the JSR package through the JSR npm helper in your OpenCode config directory:

```bash
deno run -A npm:jsr add @scarf/assisted-by --npm
```

Then add the server export to `opencode.jsonc`:

```jsonc
{
  "plugin": ["@scarf/assisted-by/server"]
}
```

For local development:

```jsonc
{
  "plugin": ["./opencode/assisted-by.ts"]
}
```

Optional environment variables:

- `OPENCODE_ASSISTED_BY_AGENT`: override the agent name in `Assisted-by:`. Default: `opencode`
- `OPENCODE_ASSISTED_BY_EXTRA_TOOLS`: extra space- or comma-separated specialized tool labels to append

## CLI

Run directly from JSR:

```bash
deno run jsr:@scarf/assisted-by/cli <model-name> <agent-name> [tool ...]
```

Example:

```bash
deno run jsr:@scarf/assisted-by/cli gpt-5.4 opencode sparse
```

Install as a Deno executable:

```bash
deno install --global --name assisted-by jsr:@scarf/assisted-by/cli
```

## Development

Source and package metadata are Deno/JSR-only. Package entrypoints are TypeScript files declared in `deno.json`.

```bash
deno task fmt
deno task check
deno task lint
deno task test
deno task publish:dry-run
```

## Release

Push a semver tag to publish to JSR through GitHub Actions:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow uses GitHub Actions OIDC, so link the JSR package to this GitHub repository first. It validates, dry-runs, then publishes with the version from the tag.

## Notes

- this intercepts `git commit`, `git rebase --continue`, `gh pr create`, and `gh issue create` mechanically; the model does not format or decide the trailers
- it does not rewrite commits created by commands other than `git commit`
- it updates PR bodies only after successful `gh pr create` calls
- it updates issue bodies only after successful `gh issue create` calls that print the created issue URL
- JSR's npm compatibility package is `@jsr/scarf__assisted-by`, not an npmjs `@scarf/assisted-by` publish
- Pi loads `./extensions` by convention
