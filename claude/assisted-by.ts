#!/usr/bin/env -S deno run --allow-read --allow-env --allow-run=gh

import { readFileSync } from "node:fs"
import process from "node:process"

import {
  buildIssueTrailer,
  buildPrTrailer,
  buildTrailers,
  detectSpecializedTools,
  extractGithubUrls,
  hasGhIssueCreateInvocation,
  hasGhPrCreateInvocation,
  normalizeTools,
  resolveTranscriptModel,
  rewriteGitCommitInvocations,
} from "../src/core/assisted-by.ts"

type HookInput = {
  hook_event_name?: unknown
  tool_name?: unknown
  tool_input?: { command?: unknown }
  tool_response?: unknown
  transcript_path?: unknown
}
type BuildWrappedCommandOptions = { command: string; model: string }
type AppendBodyTrailerOptions = {
  kind: "pr" | "issue"
  url: string
  trailer: string
}

const agentName = process.env.CLAUDE_ASSISTED_BY_AGENT?.trim() || "claude-code"
const extraTools = normalizeTools({
  tools: process.env.CLAUDE_ASSISTED_BY_EXTRA_TOOLS?.split(/[\s,]+/) ?? [],
})
const ghBin = process.env.CLAUDE_ASSISTED_BY_GH?.trim() || "gh"

/**
 * Read a transcript without failing the tool call on unreadable paths.
 *
 * @type {(path: string) => string}
 */
const readTranscript = (path: string): string => {
  if (!path) return ""

  try {
    return readFileSync(path, "utf8")
  } catch {
    return ""
  }
}

/**
 * Resolve the acting model id, preferring an explicit override.
 *
 * @type {(transcriptPath: unknown) => string}
 */
const resolveModel = (transcriptPath: unknown): string => {
  const override = process.env.CLAUDE_ASSISTED_BY_MODEL?.trim()
  if (override) return override

  return resolveTranscriptModel({
    transcript: readTranscript(`${transcriptPath ?? ""}`),
  })
}

/**
 * Add commit trailers as literal git arguments.
 *
 * The command is not wrapped in a sourced shell function: Claude Code worktree
 * isolation refuses commands that run `. <script>` because it cannot verify
 * them. `git rebase --continue` is left alone because Claude Code already runs
 * Bash with `GIT_EDITOR=true`.
 *
 * @type {(options: BuildWrappedCommandOptions) => string}
 */
const buildWrappedCommand = (
  { command, model }: BuildWrappedCommandOptions,
): string => {
  if (!model) return ""

  const trailers = buildTrailers({
    agent: agentName,
    model,
    tools: [...detectSpecializedTools({ command }), ...extraTools],
  })
  const wrapped = rewriteGitCommitInvocations({ command, ...trailers })

  return wrapped === command ? "" : wrapped
}

/** @type {(args: string[], stdin?: string) => Promise<string | undefined>} */
const runGh = async (
  args: string[],
  stdin?: string,
): Promise<string | undefined> => {
  try {
    const child = new Deno.Command(ghBin, {
      args,
      stdin: stdin === undefined ? "null" : "piped",
      stdout: "piped",
      stderr: "null",
    }).spawn()

    if (stdin !== undefined) {
      const writer = child.stdin.getWriter()
      await writer.write(new TextEncoder().encode(stdin))
      await writer.close()
    }

    const { success, stdout } = await child.output()
    return success ? new TextDecoder().decode(stdout) : undefined
  } catch {
    return undefined
  }
}

/**
 * Append the attribution line to a created PR or issue body once.
 *
 * @type {(options: AppendBodyTrailerOptions) => Promise<void>}
 */
const appendBodyTrailer = async (
  { kind, url, trailer }: AppendBodyTrailerOptions,
): Promise<void> => {
  const body = await runGh([
    kind,
    "view",
    url,
    "--json",
    "body",
    "--jq",
    '.body // ""',
  ])
  if (body === undefined) return

  const current = body.replace(/\n+$/, "")
  if (current.includes(trailer)) return

  const next = current ? `${current}\n\n${trailer}\n` : `${trailer}\n`
  await runGh([kind, "edit", url, "--body-file", "-"], next)
}

/** @type {(response: unknown) => string} */
const responseText = (response: unknown): string => {
  if (typeof response === "string") return response
  if (response && typeof response === "object") {
    const { stdout } = response as { stdout?: unknown }
    if (typeof stdout === "string") return stdout
  }
  return ""
}

/**
 * After a successful `gh pr create` / `gh issue create`, edit the body.
 *
 * Done after the tool call instead of by rewriting the command, so the command
 * the harness verifies stays exactly what the model wrote.
 *
 * @type {(input: HookInput) => Promise<void>}
 */
const handlePostToolUse = async (input: HookInput): Promise<void> => {
  const command = `${input.tool_input?.command ?? ""}`
  const isPr = hasGhPrCreateInvocation({ command })
  const isIssue = hasGhIssueCreateInvocation({ command })
  if (!isPr && !isIssue) return
  if (/(^|\s)(--dry-run|-w|--web)(\s|$)/.test(command)) return

  const model = resolveModel(input.transcript_path)
  if (!model) return

  const output = responseText(input.tool_response)
  const thinking = process.env.CLAUDE_EFFORT?.trim() ?? ""

  if (isPr) {
    const trailer = buildPrTrailer({ model, thinking, harness: agentName })
    for (const url of extractGithubUrls({ output, kind: "pull" })) {
      await appendBodyTrailer({ kind: "pr", url, trailer })
    }
  }

  if (isIssue) {
    const trailer = buildIssueTrailer({ model, thinking, harness: agentName })
    for (const url of extractGithubUrls({ output, kind: "issues" })) {
      await appendBodyTrailer({ kind: "issue", url, trailer })
    }
  }
}

const raw = await new Response(Deno.stdin.readable).text()

/** An unparseable payload must never block the tool call. */
let input: HookInput = {}
try {
  input = JSON.parse(raw) as HookInput
} catch {
  process.exit(0)
}

if (`${input.tool_name ?? ""}` !== "Bash") process.exit(0)

if (`${input.hook_event_name ?? ""}` === "PostToolUse") {
  await handlePostToolUse(input)
  process.exit(0)
}

const command = `${input.tool_input?.command ?? ""}`
const wrapped = buildWrappedCommand({
  command,
  model: resolveModel(input.transcript_path),
})

if (!wrapped) process.exit(0)

/**
 * `permissionDecision` is deliberately omitted: this hook only rewrites the
 * command, and must not grant permission the user has not given.
 */
console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    updatedInput: { ...input.tool_input, command: wrapped },
  },
}))
