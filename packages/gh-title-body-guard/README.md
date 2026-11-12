# @scarf/gh-title-body-guard

A Pi extension. It blocks low-level GitHub API calls that can overwrite the title or body of a pull request or issue. Use `gh pr edit` or `gh issue edit` for these changes.

## What it blocks

- `gh api ... PATCH ... /issues/N` with a title or body payload, or with `--input`
- `gh api ... PATCH ... /pulls/N` with a title or body payload, or with `--input`
- `gh api graphql` mutations that use `updatePullRequest` or `updateIssue` with `title` or `body`

## What it allows

- `gh pr create --title ... --body-file ...`
- `gh issue create --title ... --body-file ...`
- `gh pr edit ... --title ... --body-file ...`
- `gh issue edit ... --title ... --body-file ...`
- edits that change only metadata, for example labels and assignees

Before you edit the title or body of a pull request or issue, read the current title and body. Make your change on that current text.

## Install for Pi

From this package directory:

```bash
pi install .
```

From the repository root:

```bash
pi install ./packages/gh-title-body-guard
```

After you install it, reload Pi.

## Development

```bash
deno task fmt
deno task check
deno task lint
deno task test
```
