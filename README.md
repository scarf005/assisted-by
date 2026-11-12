# @scarf/assisted-by

Adds Linux kernel style AI attribution to commits, pull requests, and issues that Claude Code, Codex, Pi, and OpenCode create.

## What it does

The hooks find these commands in the bash calls of the agent:

- `git commit`
- `git rebase --continue`
- `gh pr create`
- `gh issue create`

For each command, the hook adds the attribution. The model does not write the attribution.

- Commits get trailers through the `--trailer` option of Git:
  - `Assisted-by: AGENT:MODEL [TOOL ...]`
  - `Co-authored-by: ...` when the model has a known bot identity
- Pull request bodies get `<sub>PR opened by MODEL THINKING on HARNESS</sub>`.
- Issue bodies get `<sub>Issue opened by MODEL THINKING on HARNESS</sub>`.

The hook also does these steps:

- It refuses `git commit` without a message source, because a GUI editor stops the agent. Message sources are `-m`, `-F`, `-C`, `-c`, `--fixup`, `--squash`, `--amend`, and `--no-edit`.
- It runs commits and `git rebase --continue` with `GIT_EDITOR=:`, so no editor opens.
- It does not add a trailer two times on `--amend`. It uses `trailer.ifexists=addIfDifferent` for this.

The `TOOL` list does not include basic tools. The hook reads the bash commands and adds only these analysis tools:

- `coccinelle` / `spatch`
- `sparse`
- `smatch`
- `clang-tidy`

Where each harness uses the hook:

- Pi: `bash` tool calls, and `!` user bash commands
- OpenCode: bash and shell tool calls
- Codex: Bash tool calls, through a plugin hook
- Claude Code: Bash tool calls, through a plugin hook

## Install for Pi

Install from the npm registry of JSR:

```bash
npm config set @jsr:registry https://npm.jsr.io
pi install npm:@jsr/scarf__assisted-by
```

Install from the current directory:

```bash
pi install .
```

Optional environment variables:

- `PI_ASSISTED_BY_AGENT`: the agent name in `Assisted-by:`. The default is `pi`.
- `PI_ASSISTED_BY_EXTRA_TOOLS`: more tool labels to add, separated by spaces or commas.

## Install for Codex

This repository is a Codex plugin. Add the repository as a local marketplace, then install the plugin:

```bash
codex plugin marketplace add /absolute/path/to/assisted-by
codex plugin add assisted-by@assisted-by-local
```

Start a new Codex conversation. Open `/hooks` and trust the `assisted-by` plugin hook. Codex asks for this review each time you install or change a hook that is not managed.

The hook changes the supported Bash commands and records the active model. You can also use the wrapper script directly, for example to find a problem:

```bash
source /absolute/path/to/assisted-by/bin/codex-bash-hook.sh && git commit -m "subject"
```

Keep `&&` after `source`. If the attribution setup fails, the commit must not run.

The model name comes from `CODEX_ASSISTED_BY_MODEL`, then from `CODEX_MODEL`. If both are empty, the hook records `codex` as the model. The agent label is always `codex` by default.

Optional environment variables:

- `CODEX_ASSISTED_BY_AGENT`: the agent name in `Assisted-by:`. The default is `codex`.
- `CODEX_ASSISTED_BY_EXTRA_TOOLS`: more tool labels to add, separated by spaces or commas.

## Install for Claude Code

This repository is a Claude Code plugin. Add the repository as a local marketplace, then install the plugin:

```bash
claude plugin marketplace add /absolute/path/to/assisted-by
claude plugin install assisted-by@assisted-by-local
```

In the Claude Code settings, set `attribution.commit` to an empty string. If you do not, Claude Code adds its own trailer and the commit gets two.

The `PreToolUse` hook reads the model from the last assistant turn in the session transcript. If it cannot find the model, it records `claude`. The default agent label is `claude-code`.

Optional environment variables:

- `CLAUDE_ASSISTED_BY_MODEL`: the model name.
- `CLAUDE_ASSISTED_BY_AGENT`: the agent name in `Assisted-by:`. The default is `claude-code`.
- `CLAUDE_ASSISTED_BY_EXTRA_TOOLS`: more tool labels to add, separated by spaces or commas.

### How the Claude Code hook changes commands

Claude Code worktree isolation refuses commands that run `source` or `git -c`. Thus the hook works differently from the other harnesses:

1. For `git commit` and `git rebase --continue`, the hook adds `--trailer` options to the command.
2. It does not use `trailer.ifexists=addIfDifferent`. It reads the message that Git will commit and removes each `--trailer` that the message already has.
3. It reads the message from `-m`, `-F <file>`, quoted heredocs, `-C <ref>`, or `HEAD` for `--amend`.
4. It reads files and `HEAD` only when the commit is the first command in the Bash call.
5. If it cannot read the message, it adds both trailers.

For `gh` calls, and for git calls that it cannot change, the hook uses `bin/claude-bash-hook.sh`. If you use this script directly, keep `&&` after `source`.

## Install for OpenCode

In your OpenCode config directory, add the JSR package with the JSR npm helper:

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

- `OPENCODE_ASSISTED_BY_AGENT`: the agent name in `Assisted-by:`. The default is `opencode`.
- `OPENCODE_ASSISTED_BY_EXTRA_TOOLS`: more tool labels to add, separated by spaces or commas.

## CLI

Run from JSR:

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

The source and the package metadata are for Deno and JSR only. `deno.json` declares the package entrypoints, which are TypeScript files.

```bash
deno task fmt
deno task check
deno task lint
deno task test
deno task publish:dry-run
```

Write docs in Simplified Technical English. See `AGENTS.md` for the rules.

## Release

Push a semver tag. GitHub Actions then publishes the package to JSR:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow uses GitHub Actions OIDC. Link the JSR package to this GitHub repository first. The workflow validates the package, does a dry run, and then publishes with the version from the tag.

## Limits

- It changes only commits that `git commit` or `git rebase --continue` makes. It does not change commits from other commands.
- It changes a pull request body only after `gh pr create` is successful.
- It changes an issue body only after `gh issue create` is successful and prints the URL of the new issue.
- The JSR npm package is `@jsr/scarf__assisted-by`. There is no `@scarf/assisted-by` package on npmjs.
- Pi loads `./extensions` by convention.
