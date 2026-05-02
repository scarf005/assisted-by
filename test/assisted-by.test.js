// @ts-check

import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import {
  buildTrailers,
  createHookBootstrap,
  detectSpecializedTools,
  hasGitCommitInvocation,
} from "../lib/assisted-by.js"

const repoPrefix = join(tmpdir(), "pi-assisted-by-")
const hookPath = fileURLToPath(
  new URL("../bin/git-commit-hook.sh", import.meta.url),
)

/** @type {(options: { command: string, cwd: string }) => string} */
const run = ({ command, cwd }) => {
  const result = spawnSync("bash", ["-lc", command], { cwd, encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(
      result.stderr || result.stdout || `command failed: ${command}`,
    )
  }
  return result.stdout.trimEnd()
}

test("buildTrailers follows kernel assisted-by format and adds mapped co-author", () => {
  const trailers = buildTrailers({
    agent: "pi",
    model: "claude-sonnet-4-5",
    tools: ["sparse", "smatch"],
  })
  assert.equal(
    trailers.assistedBy,
    "Assisted-by: pi:claude-sonnet-4-5 sparse smatch",
  )
  assert.equal(
    trailers.coAuthoredBy,
    "Co-authored-by: Claude Sonnet 4.5 <noreply@anthropic.com>",
  )
})

test("detectSpecializedTools only records supported analysis tools", () => {
  assert.deepEqual(
    detectSpecializedTools({
      command: "make C=2 && sparse foo.c && git status",
    }),
    ["sparse"],
  )
  assert.deepEqual(
    detectSpecializedTools({
      command: "spatch --sp-file foo.cocci && clang-tidy a.cc",
    }),
    ["coccinelle", "clang-tidy"],
  )
})

test("hasGitCommitInvocation matches git commit and skips other git commands", () => {
  assert.equal(hasGitCommitInvocation({ command: "git commit -m test" }), true)
  assert.equal(hasGitCommitInvocation({ command: "git status" }), false)
})

test("hook bootstrap appends trailers, preserves distinct co-authors, and avoids duplicates on amend", () => {
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
    assert.notEqual(assistedByIndex, -1)
    assert.notEqual(botCoAuthorIndex, -1)
    assert.match(
      committed,
      /Co-authored-by: Claude Sonnet 4\.5 <noreply@anthropic\.com>/,
    )
    assert.equal((committed.match(/^Co-authored-by:/gm) ?? []).length, 2)
    assert.equal(botCoAuthorIndex, assistedByIndex + 1)

    writeFileSync(join(repo, "a.txt"), "one\ntwo\nthree\n")
    run({ command: "git add a.txt", cwd: repo })
    run({ command: `${bootstrap}\ngit commit --amend --no-edit`, cwd: repo })

    const amended = run({ command: "git log -1 --pretty=%B", cwd: repo })
    assert.equal((amended.match(/Assisted-by:/g) ?? []).length, 1)
    assert.equal((amended.match(/Co-authored-by:/g) ?? []).length, 2)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})
