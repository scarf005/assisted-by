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

From JSR's npm compatibility registry:

```bash
npm config set @jsr:registry https://npm.jsr.io
pi install npm:@jsr/scarf__pi-assisted-by
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
deno run -A npm:jsr add @scarf/pi-assisted-by --npm
```

Then add the server export to `opencode.jsonc`:

```jsonc
{
  "plugin": ["@scarf/pi-assisted-by/server"]
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
deno run jsr:@scarf/pi-assisted-by/cli <model-name> <agent-name> [tool ...]
```

Example:

```bash
deno run jsr:@scarf/pi-assisted-by/cli gpt-5.4 opencode sparse
```

Install as a Deno executable:

```bash
deno install --global --name assisted-by jsr:@scarf/pi-assisted-by/cli
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

- this intercepts `git commit` mechanically; the model does not format or decide the trailers
- it does not rewrite commits created by commands other than `git commit`
- JSR's npm compatibility package is `@jsr/scarf__pi-assisted-by`, not an npmjs `@scarf/pi-assisted-by` publish
- Pi loads `./extensions` by convention
