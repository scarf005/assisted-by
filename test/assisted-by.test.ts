import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  buildTrailers,
  createHookBootstrap,
  detectSpecializedTools,
  hasGitCommitInvocation,
  resolveCoAuthor,
} from "../src/core/assisted-by.ts"

const repoPrefix = join(tmpdir(), "assisted-by-")
const hookPath = fileURLToPath(
  new URL("../bin/git-commit-hook.sh", import.meta.url),
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
