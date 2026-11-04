import { spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import process from "node:process"
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
  hasGitRebaseContinueInvocation,
  resolveCoAuthor,
  resolveTranscriptModel,
  rewriteGitCommitInvocations,
} from "../src/core/assisted-by.ts"

const repoPrefix = join(tmpdir(), "assisted-by-")
const hookPath = fileURLToPath(
  new URL("../bin/git-commit-hook.sh", import.meta.url),
)
const prCreateHookPath = fileURLToPath(
  new URL("../bin/gh-pr-create-hook.sh", import.meta.url),
)
const claudeHookPath = fileURLToPath(
  new URL("../claude/assisted-by.ts", import.meta.url),
)

/** @type {(entries: Record<string, unknown>[]) => string} */
const transcriptOf = (entries: Record<string, unknown>[]): string =>
  `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`

/**
 * Drive the Claude Code hook the way the harness does: JSON on stdin.
 *
 * @type {(options: { input: unknown; env?: Record<string, string> }) => string}
 */
const runClaudeHook = (
  { input, env = {} }: { input: unknown; env?: Record<string, string> },
): string => {
  const result = spawnSync("deno", [
    "run",
    "--allow-read",
    "--allow-env",
    "--allow-run",
    claudeHookPath,
  ], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, ...env },
  })

  if (result.status !== 0) {
    throw new Error(result.stderr || `claude hook exited ${result.status}`)
  }

  return result.stdout
}

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

Deno.test("hasGitRebaseContinueInvocation matches only rebase continue", () => {
  assertEquals(
    hasGitRebaseContinueInvocation({ command: "git rebase --continue" }),
    true,
  )
  assertEquals(
    hasGitRebaseContinueInvocation({ command: "git rebase --abort" }),
    false,
  )
  assertEquals(
    hasGitRebaseContinueInvocation({ command: "git status" }),
    false,
  )
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

Deno.test("git commit hook disables editor for message-less commit", () => {
  const repo = mkdtempSync(repoPrefix)
  const markerPath = join(repo, "editor-ran")

  try {
    run({ command: "git init -q", cwd: repo })
    run({
      command:
        "git config user.name test && git config user.email test@example.com",
      cwd: repo,
    })

    writeFileSync(join(repo, "a.txt"), "one\n")
    run({ command: "git add a.txt", cwd: repo })

    const bootstrap = createHookBootstrap({
      hookPath,
      assistedBy: "Assisted-by: pi:gpt-5.4",
    })
    const result = spawnSync(
      "bash",
      [
        "-lc",
        `${bootstrap}\nGIT_EDITOR='sh -c "echo opened > ${markerPath}"' git commit`,
      ],
      { cwd: repo, encoding: "utf8" },
    )

    assertNotEquals(result.status, 0)
    assertEquals(
      result.stderr.includes("assisted-by: refusing git commit"),
      true,
    )
    assertEquals(result.stdout.includes("opened"), false)
    assertEquals(result.stderr.includes("opened"), false)
    assertEquals(existsSync(markerPath), false)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

Deno.test("git hook disables editor for rebase continue", () => {
  const repo = mkdtempSync(repoPrefix)
  const fakeGitPath = join(repo, "git")

  try {
    writeFileSync(
      fakeGitPath,
      `#!/usr/bin/env bash
printf '%s\\n' "\${GIT_EDITOR:-}"
`,
    )
    chmodSync(fakeGitPath, 0o755)

    const bootstrap = createHookBootstrap({
      hookPath,
      assistedBy: "Assisted-by: pi:gpt-5.4",
    })

    const output = run({
      command:
        `${bootstrap}\nPATH='${repo}':$PATH GIT_EDITOR=code git rebase --continue`,
      cwd: repo,
    })

    assertEquals(output, ":")
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

Deno.test("resolveTranscriptModel reads the acting model from the last assistant entry", () => {
  const transcript = transcriptOf([
    { type: "user", message: { role: "user", content: "hi" } },
    {
      type: "assistant",
      message: { role: "assistant", model: "claude-sonnet-4-5" },
    },
    {
      type: "assistant",
      message: { role: "assistant", model: "claude-opus-4-8" },
    },
  ])

  assertEquals(resolveTranscriptModel({ transcript }), "claude-opus-4-8")
  assertEquals(resolveTranscriptModel({ transcript: "" }), "")
  assertEquals(resolveTranscriptModel(), "")
})

Deno.test("resolveTranscriptModel survives truncated and malformed transcript lines", () => {
  const transcript = [
    JSON.stringify({
      type: "assistant",
      message: { model: "claude-opus-4-8" },
    }),
    "",
    '{"type":"assistant","message":{"model":"claude-op',
  ].join("\n")

  assertEquals(resolveTranscriptModel({ transcript }), "claude-opus-4-8")
})

Deno.test("claude hook rewrites git commit with trailers and grants no permission", () => {
  const dir = mkdtempSync(repoPrefix)
  try {
    const transcriptPath = join(dir, "transcript.jsonl")
    writeFileSync(
      transcriptPath,
      transcriptOf([
        { type: "assistant", message: { model: "claude-opus-4-8" } },
      ]),
    )

    const stdout = runClaudeHook({
      input: {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: 'git commit -m "feat: x"', timeout: 5000 },
        transcript_path: transcriptPath,
      },
    })

    const parsed = JSON.parse(stdout)
    const { hookSpecificOutput } = parsed
    assertEquals(hookSpecificOutput.hookEventName, "PreToolUse")
    assertEquals("permissionDecision" in hookSpecificOutput, false)
    assertEquals(hookSpecificOutput.updatedInput.timeout, 5000)

    const command = hookSpecificOutput.updatedInput.command as string
    assertMatch(command, /Assisted-by: claude-code:claude-opus-4-8/)
    assertMatch(
      command,
      /Co-authored-by: Claude Opus 4\.8 <noreply@anthropic\.com>/,
    )
    assertEquals(command.includes(". '"), false)
    assertEquals(command.includes("git-commit-hook.sh"), false)
    assertEquals(
      command.includes("--trailer 'Assisted-by: claude-code:claude-opus-4-8'"),
      true,
    )
    assertEquals(
      command.includes(
        "--trailer 'Co-authored-by: Claude Opus 4.8 <noreply@anthropic.com>'",
      ),
      true,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

Deno.test("claude hook ignores non-Bash tools, unrelated commands, and unusable input", () => {
  const dir = mkdtempSync(repoPrefix)
  try {
    const transcriptPath = join(dir, "transcript.jsonl")
    writeFileSync(
      transcriptPath,
      transcriptOf([
        { type: "assistant", message: { model: "claude-opus-4-8" } },
      ]),
    )

    const base = {
      hook_event_name: "PreToolUse",
      transcript_path: transcriptPath,
    }

    assertEquals(
      runClaudeHook({
        input: {
          ...base,
          tool_name: "Edit",
          tool_input: { command: "git commit -m x" },
        },
      }),
      "",
    )
    assertEquals(
      runClaudeHook({
        input: {
          ...base,
          tool_name: "Bash",
          tool_input: { command: "git status" },
        },
      }),
      "",
    )
    assertEquals(
      runClaudeHook({
        input: {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command: "git commit -m x" },
          transcript_path: join(dir, "missing.jsonl"),
        },
      }),
      "",
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

const claudeModelEnv = {
  CLAUDE_ASSISTED_BY_MODEL: "claude-opus-4-8",
  CLAUDE_ASSISTED_BY_AGENT: "claude-code-web",
  CLAUDE_EFFORT: "high",
}
const prTrailerLine =
  "<sub>PR opened by claude-opus-4-8 high on claude-code-web</sub>"

/**
 * Fake gh: logs args, prints $FAKE_GH_BODY for `view`, saves stdin for `edit`.
 *
 * @type {(dir: string) => { ghPath: string; logPath: string; stdinPath: string }}
 */
const writeFakeGh = (
  dir: string,
): { ghPath: string; logPath: string; stdinPath: string } => {
  const ghPath = join(dir, "gh")
  const logPath = join(dir, "gh.log")
  const stdinPath = join(dir, "gh.stdin")
  writeFileSync(
    ghPath,
    `#!/usr/bin/env bash
echo "$*" >> '${logPath}'
if [ "$2" = "view" ]; then
  printf '%s\\n' "$FAKE_GH_BODY"
elif [ "$2" = "edit" ]; then
  cat > '${stdinPath}'
fi
`,
  )
  chmodSync(ghPath, 0o755)
  return { ghPath, logPath, stdinPath }
}

/** @type {(options: { command: string; stdout: string }) => unknown} */
const postToolUseInput = (
  { command, stdout }: { command: string; stdout: string },
): unknown => ({
  hook_event_name: "PostToolUse",
  tool_name: "Bash",
  tool_input: { command },
  tool_response: { stdout },
})

Deno.test("claude hook PostToolUse appends the PR trailer once through gh edit", () => {
  const dir = mkdtempSync(repoPrefix)
  try {
    const { ghPath, logPath, stdinPath } = writeFakeGh(dir)
    const url = "https://github.com/o/r/pull/3"
    const input = postToolUseInput({
      command: "gh pr create --fill",
      stdout: `${url}\n`,
    })
    const env = {
      ...claudeModelEnv,
      CLAUDE_ASSISTED_BY_GH: ghPath,
      FAKE_GH_BODY: "Existing body",
    }

    assertEquals(runClaudeHook({ input, env }), "")
    assertMatch(
      readFileSync(logPath, "utf8"),
      new RegExp(`pr edit ${url} --body-file -`),
    )
    const body = readFileSync(stdinPath, "utf8")
    assertEquals(body.startsWith("Existing body\n\n"), true)
    assertEquals(body.endsWith(`${prTrailerLine}\n`), true)

    rmSync(logPath)
    runClaudeHook({
      input,
      env: { ...env, FAKE_GH_BODY: `Existing body\n\n${prTrailerLine}` },
    })
    assertEquals(readFileSync(logPath, "utf8").includes(" edit "), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

Deno.test("claude hook PostToolUse edits the issue body after gh issue create", () => {
  const dir = mkdtempSync(repoPrefix)
  try {
    const { ghPath, logPath, stdinPath } = writeFakeGh(dir)
    runClaudeHook({
      input: postToolUseInput({
        command: "gh issue create --title t",
        stdout: "https://github.com/o/r/issues/7\n",
      }),
      env: { ...claudeModelEnv, CLAUDE_ASSISTED_BY_GH: ghPath },
    })

    assertMatch(
      readFileSync(logPath, "utf8"),
      /issue edit https:\/\/github\.com\/o\/r\/issues\/7 --body-file -/,
    )
    assertEquals(
      readFileSync(stdinPath, "utf8").includes(
        "<sub>Issue opened by claude-opus-4-8 high on claude-code-web</sub>",
      ),
      true,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

Deno.test("claude hook does not rewrite gh pr create before the call", () => {
  assertEquals(
    runClaudeHook({
      input: {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "gh pr create --fill" },
      },
      env: claudeModelEnv,
    }),
    "",
  )
})

Deno.test("claude hook PostToolUse skips gh pr create --dry-run", () => {
  const dir = mkdtempSync(repoPrefix)
  try {
    const { ghPath, logPath } = writeFakeGh(dir)
    runClaudeHook({
      input: postToolUseInput({
        command: "gh pr create --dry-run",
        stdout: "https://github.com/o/r/pull/3\n",
      }),
      env: { ...claudeModelEnv, CLAUDE_ASSISTED_BY_GH: ghPath },
    })
    assertEquals(existsSync(logPath), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

Deno.test("claude hook rewrite adds real trailers once and survives amend", () => {
  const repo = mkdtempSync(repoPrefix)
  try {
    run({ command: "git init -q", cwd: repo })
    run({
      command:
        "git config user.name test && git config user.email test@example.com",
      cwd: repo,
    })

    /** @type {(command: string) => string} */
    const rewrite = (command: string): string =>
      JSON.parse(runClaudeHook({
        input: {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command },
        },
        env: { CLAUDE_ASSISTED_BY_MODEL: "claude-opus-4-8" },
      })).hookSpecificOutput.updatedInput.command

    run({
      command: rewrite(`git -C "${repo}" commit --allow-empty -m "feat: x"`),
      cwd: tmpdir(),
    })
    const assisted = "Assisted-by: claude-code:claude-opus-4-8"
    const coAuthor = "Co-authored-by: Claude Opus 4.8 <noreply@anthropic.com>"
    const first = run({
      command: "git log -1 --format='%(trailers)'",
      cwd: repo,
    })
    assertEquals(first.includes(assisted), true)
    assertEquals(first.includes(coAuthor), true)

    run({
      command: rewrite(
        `git -C "${repo}" commit --amend --no-edit --allow-empty`,
      ),
      cwd: tmpdir(),
    })
    const amended = run({
      command: "git log -1 --format='%(trailers)'",
      cwd: repo,
    })
    assertEquals(amended.split(assisted).length - 1, 1)
    assertEquals(amended.split(coAuthor).length - 1, 1)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

Deno.test("rewriteGitCommitInvocations rewrites only git commit invocations", () => {
  const trailers = {
    assistedBy: "Assisted-by: a:b",
    coAuthoredBy: "Co-authored-by: C <c@x>",
  }
  const flags = "-c trailer.ifexists=addIfDifferent -c trailer.ifmissing=add"
  const suffix =
    " --trailer 'Assisted-by: a:b' --trailer 'Co-authored-by: C <c@x>'"

  assertEquals(
    rewriteGitCommitInvocations({
      command: "cd x && git commit -m y",
      ...trailers,
    }),
    `cd x && git ${flags} commit${suffix} -m y`,
  )
  assertEquals(
    rewriteGitCommitInvocations({
      command: "git -c user.name=x commit -m y; git log -1",
      ...trailers,
    }),
    `git ${flags} -c user.name=x commit${suffix} -m y; git log -1`,
  )
  assertEquals(
    rewriteGitCommitInvocations({
      command: 'git -C "/tmp/a b" commit -m y',
      ...trailers,
    }),
    `git ${flags} -C "/tmp/a b" commit${suffix} -m y`,
  )
  for (const command of ["git status", "git log -1", "echo git commit"]) {
    assertEquals(rewriteGitCommitInvocations({ command, ...trailers }), command)
  }
  assertEquals(
    rewriteGitCommitInvocations({ command: "git commit -m y", assistedBy: "" }),
    "git commit -m y",
  )
})
