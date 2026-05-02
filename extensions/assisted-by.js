// @ts-check

import { fileURLToPath } from "node:url"

import {
  createLocalBashOperations,
  isToolCallEventType,
} from "@mariozechner/pi-coding-agent"

import {
  buildTrailers,
  createHookBootstrap,
  detectSpecializedTools,
  hasGitCommitInvocation,
  normalizeTools,
} from "../lib/assisted-by.js"

/**
 * @typedef {import("@mariozechner/pi-coding-agent").ExtensionAPI} ExtensionAPI
 * @typedef {import("@mariozechner/pi-coding-agent").ExtensionContext} ExtensionContext
 * @typedef {{ command: string, detectedTools: Set<string> }} CollectToolsOptions
 * @typedef {{ command: string, ctx: ExtensionContext, detectedTools: Set<string> }} BuildWrappedCommandOptions
 */

const hookPath = fileURLToPath(
  new URL("../bin/git-commit-hook.sh", import.meta.url),
)

const agentName = process.env.PI_ASSISTED_BY_AGENT?.trim() || "pi"
const extraTools = normalizeTools({
  tools: process.env.PI_ASSISTED_BY_EXTRA_TOOLS?.split(/[\s,]+/) ?? [],
})

/** @type {(options: CollectToolsOptions) => void} */
const collectTools = ({ command, detectedTools }) => {
  for (const tool of detectSpecializedTools({ command })) {
    detectedTools.add(tool)
  }
}

/** @type {(options: BuildWrappedCommandOptions) => string} */
const buildWrappedCommand = ({ command, ctx, detectedTools }) => {
  if (!hasGitCommitInvocation({ command })) return ""
  if (!ctx.model?.id) return ""

  const trailers = buildTrailers({
    agent: agentName,
    model: ctx.model.id,
    tools: [...detectedTools, ...extraTools],
  })

  if (!trailers.assistedBy) return ""

  return `${createHookBootstrap({ hookPath, ...trailers })}\n${command}`
}

/** @type {(pi: ExtensionAPI) => void} */
const assistedByExtension = (pi) => {
  /** @type {Set<string>} */
  const detectedTools = new Set(extraTools)

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return

    collectTools({ command: event.input.command, detectedTools })
    const wrapped = buildWrappedCommand({
      command: event.input.command,
      ctx,
      detectedTools,
    })
    if (wrapped) event.input.command = wrapped
  })

  pi.on("user_bash", (event, ctx) => {
    collectTools({ command: event.command, detectedTools })

    const wrapped = buildWrappedCommand({
      command: event.command,
      ctx,
      detectedTools,
    })
    if (!wrapped) return

    const local = createLocalBashOperations()
    return {
      operations: {
        exec: (_command, cwd, options) => local.exec(wrapped, cwd, options),
      },
    }
  })
}

export default assistedByExtension
