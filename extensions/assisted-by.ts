import { fileURLToPath } from "node:url"
import process from "node:process"

import {
  createLocalBashOperations,
  isToolCallEventType,
} from "@mariozechner/pi-coding-agent"

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
} from "../src/core/assisted-by.ts"

type ExtensionContext = { model?: { id?: string } }
type ToolCallEvent = { input: { command: string } }
type UserBashEvent = { command: string }
type PiApi = {
  getThinkingLevel?: () => string
  on(
    name: "tool_call",
    handler: (
      event: ToolCallEvent,
      ctx: ExtensionContext,
    ) => void | Promise<void>,
  ): void
  on(
    name: "user_bash",
    handler: (event: UserBashEvent, ctx: ExtensionContext) => unknown,
  ): void
}
type CollectToolsOptions = { command: string; detectedTools: Set<string> }
type LocalBashOperations = ReturnType<typeof createLocalBashOperations>
type LocalExecOptions = Parameters<LocalBashOperations["exec"]>[2]
type BuildWrappedCommandOptions = {
  command: string
  ctx: ExtensionContext
  detectedTools: Set<string>
  thinking: string
}

const commitHookPath = fileURLToPath(
  new URL("../bin/git-commit-hook.sh", import.meta.url),
)
const prCreateHookPath = fileURLToPath(
  new URL("../bin/gh-pr-create-hook.sh", import.meta.url),
)

const agentName = process.env.PI_ASSISTED_BY_AGENT?.trim() || "pi"
const extraTools = normalizeTools({
  tools: process.env.PI_ASSISTED_BY_EXTRA_TOOLS?.split(/[\s,]+/) ?? [],
})

/** @type {(options: CollectToolsOptions) => void} */
const collectTools = (
  { command, detectedTools }: CollectToolsOptions,
): void => {
  for (const tool of detectSpecializedTools({ command })) {
    detectedTools.add(tool)
  }
}

/** @type {(options: BuildWrappedCommandOptions) => string} */
const buildWrappedCommand = (
  { command, ctx, detectedTools, thinking }: BuildWrappedCommandOptions,
): string => {
  if (!ctx.model?.id) return ""

  const bootstraps: string[] = []

  if (
    hasGitCommitInvocation({ command }) ||
    hasGitRebaseContinueInvocation({ command })
  ) {
    const trailers = buildTrailers({
      agent: agentName,
      model: ctx.model.id,
      tools: [...detectedTools, ...extraTools],
    })

    const bootstrap = createHookBootstrap({
      hookPath: commitHookPath,
      ...trailers,
    })
    if (bootstrap) bootstraps.push(bootstrap)
  }

  if (hasGhPrCreateInvocation({ command })) {
    const trailer = buildPrTrailer({
      model: ctx.model.id,
      thinking,
      harness: agentName,
    })
    const bootstrap = createGhPrCreateHookBootstrap({
      hookPath: prCreateHookPath,
      trailer,
    })
    if (bootstrap) bootstraps.push(bootstrap)
  }

  if (hasGhIssueCreateInvocation({ command })) {
    const trailer = buildIssueTrailer({
      model: ctx.model.id,
      thinking,
      harness: agentName,
    })
    const bootstrap = createGhIssueCreateHookBootstrap({
      hookPath: prCreateHookPath,
      trailer,
    })
    if (bootstrap) bootstraps.push(bootstrap)
  }

  if (bootstraps.length === 0) return ""

  return `${bootstraps.join("\n")}\n${command}`
}

/** @type {(pi: PiApi) => void} */
const assistedByExtension = (pi: PiApi): void => {
  const detectedTools = new Set(extraTools)
  const thinkingLevel = (): string => pi.getThinkingLevel?.() ?? ""

  pi.on("tool_call", (event: ToolCallEvent, ctx: ExtensionContext) => {
    if (!isToolCallEventType("bash", event as never)) return

    collectTools({ command: event.input.command, detectedTools })
    const wrapped = buildWrappedCommand({
      command: event.input.command,
      ctx,
      detectedTools,
      thinking: thinkingLevel(),
    })
    if (wrapped) event.input.command = wrapped
  })

  pi.on("user_bash", (event: UserBashEvent, ctx: ExtensionContext) => {
    collectTools({ command: event.command, detectedTools })

    const wrapped = buildWrappedCommand({
      command: event.command,
      ctx,
      detectedTools,
      thinking: thinkingLevel(),
    })
    if (!wrapped) return

    const local = createLocalBashOperations()
    return {
      operations: {
        exec: (_command: string, cwd: string, options: unknown) =>
          local.exec(wrapped, cwd, options as LocalExecOptions),
      },
    }
  })
}

export default assistedByExtension
