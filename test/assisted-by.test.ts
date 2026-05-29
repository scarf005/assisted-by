import { spawnSync } from "node:child_process"
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  buildIssueTrailer,
  buildPrTrailer,
  buildTrailers,
  createGhIssueCreateHookBootstrap,
  createGhPrCreateHookBootstrap,
  createHookBootstrap,
  detectSpecializedTools,
  hasGhIssueCreateInvocation,
  hasGhPrCreateInvocation,
  hasGitCommitInvocation,
  resolveCoAuthor,
} from "../src/core/assisted-by.ts"

const repoPrefix = join(tmpdir(), "assisted-by-")
const hookPath = fileURLToPath(
  new URL("../bin/git-commit-hook.sh", import.meta.url),
)
const prCreateHookPath = fileURLToPath(
  new URL("../bin/gh-pr-create-hook.sh", import.meta.url),
)

/** @type {(actual: unknown, expected: unknown) => void} */
const assertEquals = (actual: unknown, expected: unknown): void => {
  if (!Object.is(actual, expected)) {
    throw new Error(
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    )
  }
}

/** @type {(actual: unknown, expected: unknown) => void} */
const assertDeepEquals = (actual: unknown, expected: unknown): void => {
  const actualJson = JSON.stringify(actual)
  const expectedJson = JSON.stringify(expected)
  if (actualJson !== expectedJson) {
    throw new Error(`expected ${expectedJson}, got ${actualJson}`)
  }
}

/** @type {(actual: string, pattern: RegExp) => void} */
const assertMatch = (actual: string, pattern: RegExp): void => {
  if (!pattern.test(actual)) {
    throw new Error(`expected ${actual} to match ${pattern}`)
  }
}

/** @type {(actual: unknown, expected: unknown) => void} */
const assertNotEquals = (actual: unknown, expected: unknown): void => {
  if (Object.is(actual, expected)) {
    throw new Error(`expected values to differ: ${JSON.stringify(actual)}`)
  }
}

/** @type {(options: { command: string; cwd: string }) => string} */
const run = ({ command, cwd }: { command: string; cwd: string }): string => {
  const result = spawnSync("bash", ["-lc", command], { cwd, encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(
      result.stderr || result.stdout || `command failed: ${command}`,
    )
  }
  return result.stdout.trimEnd()
}

Deno.test("buildTrailers follows kernel assisted-by format and adds mapped co-author", () => {
  const trailers = buildTrailers({
    agent: "pi",
    model: "claude-sonnet-4-5",
    tools: ["sparse", "smatch"],
  })
  assertEquals(
    trailers.assistedBy,
    "Assisted-by: pi:claude-sonnet-4-5 sparse smatch",
  )
  assertEquals(
    trailers.coAuthoredBy,
    "Co-authored-by: Claude Sonnet 4.5 <noreply@anthropic.com>",
  )
})

Deno.test("resolveCoAuthor handles provider-prefixed model ids", () => {
  assertEquals(
    resolveCoAuthor({ model: "anthropic/claude-sonnet-4-5" }),
    "Claude Sonnet 4.5 <noreply@anthropic.com>",
  )
  assertEquals(
    resolveCoAuthor({ model: "openai/gpt-5.4" }),
    "chatgpt-codex-connector[bot] <199175422+chatgpt-codex-connector[bot]@users.noreply.github.com>",
  )
})

Deno.test("detectSpecializedTools only records supported analysis tools", () => {
  assertDeepEquals(
    detectSpecializedTools({
      command: "make C=2 && sparse foo.c && git status",
    }),
    ["sparse"],
  )
  assertDeepEquals(
    detectSpecializedTools({
      command: "spatch --sp-file foo.cocci && clang-tidy a.cc",
    }),
    ["coccinelle", "clang-tidy"],
  )
})

Deno.test("hasGitCommitInvocation matches git commit and skips other git commands", () => {
  assertEquals(hasGitCommitInvocation({ command: "git commit -m test" }), true)
  assertEquals(hasGitCommitInvocation({ command: "git status" }), false)
})

Deno.test("GitHub body trailer helpers handle gh create invocations", () => {
  assertEquals(
    hasGhPrCreateInvocation({ command: "git status && gh pr create --fill" }),
    true,
  )
  assertEquals(
    hasGhPrCreateInvocation({ command: "gh -R owner/repo pr new" }),
    true,
  )
  assertEquals(hasGhPrCreateInvocation({ command: "gh pr view" }), false)
  assertEquals(
    hasGhIssueCreateInvocation({ command: "gh -R owner/repo issue create" }),
    true,
  )
  assertEquals(
    hasGhIssueCreateInvocation({ command: "gh issue view 1" }),
    false,
  )
  assertEquals(
    buildPrTrailer({
      model: "claude-sonnet-4-5",
      thinking: "high",
      harness: "pi",
    }),
    "<sub>PR opened by claude-sonnet-4-5 high on pi</sub>",
  )
  assertEquals(
    buildIssueTrailer({
      model: "claude-sonnet-4-5",
      thinking: "high",
      harness: "pi",
    }),
    "<sub>Issue opened by claude-sonnet-4-5 high on pi</sub>",
  )
  assertEquals(
    createGhPrCreateHookBootstrap({
      hookPath: "/tmp/gh-pr-create-hook.sh",
      trailer: "<sub>PR opened by model high on pi</sub>",
    }),
    "export PI_PR_OPENED_BY_TRAILER='<sub>PR opened by model high on pi</sub>'\n. '/tmp/gh-pr-create-hook.sh'",
  )
  assertEquals(
    createGhIssueCreateHookBootstrap({
      hookPath: "/tmp/gh-pr-create-hook.sh",
      trailer: "<sub>Issue opened by model high on pi</sub>",
    }),
    "export PI_ISSUE_OPENED_BY_TRAILER='<sub>Issue opened by model high on pi</sub>'\n. '/tmp/gh-pr-create-hook.sh'",
  )
})

Deno.test("gh pr create hook appends PR trailer without changing visible output", () => {
  const repo = mkdtempSync(repoPrefix)
  const bodyPath = join(repo, "body.txt")
  const fakeGhPath = join(repo, "gh")

  try {
    writeFileSync(
      fakeGhPath,
      `#!/usr/bin/env bash
if [ "$1" = "pr" ] && [ "$2" = "create" ]; then
  echo "https://github.com/owner/repo/pull/1"
  exit 0
fi

if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
  echo "https://github.com/owner/repo/pull/1"
  exit 0
fi

if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  for arg in "$@"; do
    if [ "$arg" = "url" ]; then
      echo "https://github.com/owner/repo/pull/1"
      exit 0
    fi
    if [ "$arg" = "body" ]; then
      echo "Existing body"
      exit 0
    fi
  done
fi

if [ "$1" = "pr" ] && [ "$2" = "edit" ]; then
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "--body-file" ]; then
      cp "$2" "$ASSISTED_BY_BODY_PATH"
      echo "suppressed edit output"
      exit 0
    fi
    shift
  done
fi

exit 1
`,
    )
    chmodSync(fakeGhPath, 0o755)

    const bootstrap = createGhPrCreateHookBootstrap({
      hookPath: prCreateHookPath,
      trailer: "<sub>PR opened by claude-sonnet-4-5 high on pi</sub>",
    })

    const output = run({
      command:
        `export PATH='${repo}':$PATH\nexport ASSISTED_BY_BODY_PATH='${bodyPath}'\n${bootstrap}\ntrue && gh pr create --title test`,
      cwd: repo,
    })

    assertEquals(output, "https://github.com/owner/repo/pull/1")
    assertEquals(
      readFileSync(bodyPath, "utf8"),
      "Existing body\n\n<sub>PR opened by claude-sonnet-4-5 high on pi</sub>\n",
    )
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

Deno.test("gh issue create hook appends issue trailer without changing visible output", () => {
  const repo = mkdtempSync(repoPrefix)
  const bodyPath = join(repo, "issue-body.txt")
  const fakeGhPath = join(repo, "gh")

  try {
    writeFileSync(
      fakeGhPath,
      `#!/usr/bin/env bash
if [ "$1" = "issue" ] && [ "$2" = "create" ]; then
  echo "https://github.com/owner/repo/issues/2"
  exit 0
fi

if [ "$1" = "issue" ] && [ "$2" = "view" ]; then
  for arg in "$@"; do
    if [ "$arg" = "body" ]; then
      echo "Existing issue body"
      exit 0
    fi
  done
fi

if [ "$1" = "issue" ] && [ "$2" = "edit" ]; then
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "--body-file" ]; then
      cp "$2" "$ASSISTED_BY_BODY_PATH"
      echo "suppressed issue edit output"
      exit 0
    fi
    shift
  done
fi

exit 1
`,
    )
    chmodSync(fakeGhPath, 0o755)

    const bootstrap = createGhIssueCreateHookBootstrap({
      hookPath: prCreateHookPath,
      trailer: "<sub>Issue opened by claude-sonnet-4-5 high on pi</sub>",
    })

    const output = run({
      command:
        `export PATH='${repo}':$PATH\nexport ASSISTED_BY_BODY_PATH='${bodyPath}'\n${bootstrap}\ngh issue create --title bug`,
      cwd: repo,
    })

    assertEquals(output, "https://github.com/owner/repo/issues/2")
    assertEquals(
      readFileSync(bodyPath, "utf8"),
      "Existing issue body\n\n<sub>Issue opened by claude-sonnet-4-5 high on pi</sub>\n",
    )
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

Deno.test("hook bootstrap appends trailers, preserves distinct co-authors, and avoids duplicates on amend", () => {
  const repo = mkdtempSync(repoPrefix)

  try {
    run({ command: "git init -q", cwd: repo })
    run({
      command:
        "git config user.name test && git config user.email test@example.com",
      cwd: repo,
    })

    writeFileSync(join(repo, "a.txt"), "one\n")
    run({ command: "git add a.txt && git commit -q -m init", cwd: repo })

    writeFileSync(join(repo, "a.txt"), "one\ntwo\n")
    run({ command: "git add a.txt", cwd: repo })

    const bootstrap = createHookBootstrap({
      hookPath,
      assistedBy: "Assisted-by: pi:gpt-5.4 sparse",
      coAuthoredBy:
        "Co-authored-by: chatgpt-codex-connector[bot] <199175422+chatgpt-codex-connector[bot]@users.noreply.github.com>",
    })

    run({
      command:
        `${bootstrap}\ngit commit -m update -m "Co-authored-by: Claude Sonnet 4.5 <noreply@anthropic.com>"`,
      cwd: repo,
    })
    const committed = run({ command: "git log -1 --pretty=%B", cwd: repo })
    const committedLines = committed.split("\n")
    const assistedByIndex = committedLines.indexOf(
      "Assisted-by: pi:gpt-5.4 sparse",
    )
    const botCoAuthorIndex = committedLines.indexOf(
      "Co-authored-by: chatgpt-codex-connector[bot] <199175422+chatgpt-codex-connector[bot]@users.noreply.github.com>",
    )
    assertNotEquals(assistedByIndex, -1)
    assertNotEquals(botCoAuthorIndex, -1)
    assertMatch(
      committed,
      /Co-authored-by: Claude Sonnet 4\.5 <noreply@anthropic\.com>/,
    )
    assertEquals((committed.match(/^Co-authored-by:/gm) ?? []).length, 2)
    assertEquals(botCoAuthorIndex, assistedByIndex + 1)

    writeFileSync(join(repo, "a.txt"), "one\ntwo\nthree\n")
    run({ command: "git add a.txt", cwd: repo })
    run({ command: `${bootstrap}\ngit commit --amend --no-edit`, cwd: repo })

    const amended = run({ command: "git log -1 --pretty=%B", cwd: repo })
    assertEquals((amended.match(/Assisted-by:/g) ?? []).length, 1)
    assertEquals((amended.match(/Co-authored-by:/g) ?? []).length, 2)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})
