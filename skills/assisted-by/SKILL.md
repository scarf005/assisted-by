---
name: assisted-by
description: Add mechanical Assisted-by and Co-authored-by attribution to Codex git commits, rebase continuations, pull requests, and issues. Use when the user asks for attribution, assisted-by trailers, or when this plugin is installed and a Codex-owned change is being committed or published.
---

# Assisted-by attribution

Use the repository's existing assisted-by integration for Codex-owned git and GitHub work. Codex does not expose a stable Bash environment injection point to this plugin, so source the local wrapper explicitly for commands that must carry attribution.

## Commit and rebase commands

Resolve `<plugin-root>` by going two directories up from this `SKILL.md` file. The installed plugin may nest the skill under a version folder; use the directory that actually contains this skill as the anchor, then source the wrapper from `<plugin-root>/bin/`:

```bash
source <plugin-root>/bin/codex-bash-hook.sh && git commit -m "subject"
```

The wrapper uses `CODEX_ASSISTED_BY_MODEL`, then `CODEX_MODEL`, and records `codex` only when neither model identifier is available. Set `CODEX_ASSISTED_BY_MODEL` before the command when the exact model identifier is available:

```bash
export CODEX_ASSISTED_BY_MODEL=gpt-6-astra
```

Use the same wrapper for `git rebase --continue`. Do not add a second copy of either trailer manually; Git's `addIfDifferent` setting makes repeated attribution idempotent.

## GitHub creation commands

Use the wrapper for PR and issue creation so the body receives the matching opened-by line:

```bash
source <plugin-root>/bin/codex-bash-hook.sh && gh pr create --fill
source <plugin-root>/bin/codex-bash-hook.sh && gh issue create --title "Bug" --body "Details"
```

The wrapper preserves the command's output and exit status. It does not edit `--dry-run` or `--web` operations.

## Configuration

- `CODEX_ASSISTED_BY_AGENT` changes the `Assisted-by` agent label; it defaults to `codex`.
- `CODEX_ASSISTED_BY_MODEL` supplies the model identifier; `CODEX_MODEL` is a secondary fallback, then `codex` when Codex does not expose one.
- `CODEX_ASSISTED_BY_EXTRA_TOOLS` adds space- or comma-separated specialized tool labels.

Do not label Codex work as `pi`. Existing Pi and OpenCode integrations keep their own agent labels.
