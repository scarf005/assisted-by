# @scarf/assisted-by

Mechanical kernel-style AI attribution trailers for Pi, OpenCode, and Claude Code `git commit`, `git rebase --continue`, `gh pr create`, and `gh issue create` calls.

## What it does

- intercepts Pi `bash` tool calls that invoke `git commit`, `git rebase --continue`, `gh pr create`, or `gh issue create`
- wraps Pi `!git commit`, `!git rebase --continue`, `!gh pr create`, and `!gh issue create` user bash commands the same way
- wraps OpenCode bash/shell tool calls that invoke `git commit`, `git rebase --continue`, `gh pr create`, or `gh issue create`
- wraps Claude Code `Bash` tool calls the same way, through a `PreToolUse` hook
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

## Install for Claude Code

Claude Code loads hooks from settings, so point a `PreToolUse` hook at the entrypoint:

```jsonc
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "deno run --allow-read --allow-env jsr:@scarf/assisted-by/claude",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

For local development, swap the `command` for `deno run --allow-read --allow-env ./claude/assisted-by.ts`.

The hook emits `updatedInput` **without** a `permissionDecision`, so it rewrites the command but never grants permission on your behalf; the normal permission flow still applies to the rewritten command.

Optional environment variables:

- `CLAUDE_ASSISTED_BY_AGENT`: override the agent name in `Assisted-by:`. Default: `claude-code`
- `CLAUDE_ASSISTED_BY_EXTRA_TOOLS`: extra space- or comma-separated specialized tool labels to append
- `CLAUDE_ASSISTED_BY_MODEL`: override model detection instead of reading the transcript

Claude Code differs from Pi and OpenCode in two ways worth knowing:

- it does not hand the model to hooks, so the model is read from the last assistant entry of the session transcript; when the transcript is unreadable the hook stays silent rather than guessing
- each hook run is a fresh process with no session memory, so specialized tools are detected from the current command only, not accumulated across the session as the long-lived Pi and OpenCode plugins do

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
- the Claude Code hook reads the transcript only to resolve the model id; it writes nothing back
- it does not rewrite commits created by commands other than `git commit`
- it updates PR bodies only after successful `gh pr create` calls
- it updates issue bodies only after successful `gh issue create` calls that print the created issue URL
- JSR's npm compatibility package is `@jsr/scarf__assisted-by`, not an npmjs `@scarf/assisted-by` publish
- Pi loads `./extensions` by convention
