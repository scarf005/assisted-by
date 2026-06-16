# @scarf/gh-title-body-guard

Pi extension that blocks low-level GitHub API paths that can overwrite existing PR/issue titles or bodies without the normal `gh pr/issue edit` workflow.

## What it blocks

- `gh api ... PATCH ... /issues/N` with title/body payload or `--input`
- `gh api ... PATCH ... /pulls/N` with title/body payload or `--input`
- `gh api graphql` mutations using `updatePullRequest` or `updateIssue` with `title` or `body`

## What it allows

- `gh pr create --title ... --body-file ...`
- `gh issue create --title ... --body-file ...`
- `gh pr edit ... --title ... --body-file ...`
- `gh issue edit ... --title ... --body-file ...`
- metadata-only edits such as labels and assignees

Before editing an existing PR/issue title or body, read the current title/body and patch from that current content.

## Install for Pi

From this package directory:

```bash
pi install .
```

From the repository root:

```bash
pi install ./packages/gh-title-body-guard
```

Reload Pi after installing.

## Development

```bash
deno task fmt
deno task check
deno task lint
deno task test
```
