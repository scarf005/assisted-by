#!/usr/bin/env -S deno run --allow-read --allow-env

import { readFileSync } from "node:fs"
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
  normalizeTools,
  resolveTranscriptModel,
} from "../src/core/assisted-by.ts"

type HookInput = {
  tool_name?: unknown
  tool_input?: { command?: unknown }
  transcript_path?: unknown
}
type BuildWrappedCommandOptions = { command: string; model: string }

const commitHookPath = fileURLToPath(
  new URL("../bin/git-commit-hook.sh", import.meta.url),
)
const prCreateHookPath = fileURLToPath(
  new URL("../bin/gh-pr-create-hook.sh", import.meta.url),
)

const agentName = process.env.CLAUDE_ASSISTED_BY_AGENT?.trim() || "claude-code"
const extraTools = normalizeTools({
  tools: process.env.CLAUDE_ASSISTED_BY_EXTRA_TOOLS?.split(/[\s,]+/) ?? [],
})

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

/** @type {(options: BuildWrappedCommandOptions) => string} */
const buildWrappedCommand = (
  { command, model }: BuildWrappedCommandOptions,
): string => {
  if (!model) return ""

  const bootstraps: string[] = []

  if (
    hasGitCommitInvocation({ command }) ||
    hasGitRebaseContinueInvocation({ command })
  ) {
    const trailers = buildTrailers({
      agent: agentName,
      model,
      tools: [...detectSpecializedTools({ command }), ...extraTools],
    })

    const bootstrap = createHookBootstrap({
      hookPath: commitHookPath,
      ...trailers,
    })
    if (bootstrap) bootstraps.push(bootstrap)
  }

  const thinking = process.env.CLAUDE_EFFORT?.trim() ?? ""

  if (hasGhPrCreateInvocation({ command })) {
    const bootstrap = createGhPrCreateHookBootstrap({
      hookPath: prCreateHookPath,
      trailer: buildPrTrailer({ model, thinking, harness: agentName }),
    })
    if (bootstrap) bootstraps.push(bootstrap)
  }

  if (hasGhIssueCreateInvocation({ command })) {
    const bootstrap = createGhIssueCreateHookBootstrap({
      hookPath: prCreateHookPath,
      trailer: buildIssueTrailer({ model, thinking, harness: agentName }),
    })
    if (bootstrap) bootstraps.push(bootstrap)
  }

  if (bootstraps.length === 0) return ""

  return `${bootstraps.join("\n")}\n${command}`
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
