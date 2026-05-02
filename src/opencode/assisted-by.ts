import { fileURLToPath } from "node:url"
import process from "node:process"

import {
  buildTrailers,
  createHookBootstrap,
  detectSpecializedTools,
  hasGitCommitInvocation,
  normalizeTools,
} from "../core/assisted-by.ts"

type PluginInput = Record<string, unknown>
type PluginOptions = Record<string, unknown>
type Model = { id?: unknown; modelID?: unknown; providerID?: unknown }
type ChatParamsInput = { sessionID: string; model?: Model }
type ChatMessageInput = { sessionID: string; model?: Model }
type ToolBeforeInput = { tool: string; sessionID: string }
type ToolBeforeOutput = {
  args: { command?: unknown } & Record<string, unknown>
}
type HookResult = void | Promise<void>
type Hooks = {
  "chat.params"?: (
    input: ChatParamsInput,
    output: Record<string, unknown>,
  ) => HookResult
  "chat.message"?: (
    input: ChatMessageInput,
    output: Record<string, unknown>,
  ) => HookResult
  "tool.execute.before"?: (
    input: ToolBeforeInput,
    output: ToolBeforeOutput,
  ) => HookResult
}

type BuildWrappedCommandOptions = {
  command: string
  model: string
  detectedTools: Set<string>
}

const hookPath = fileURLToPath(
  new URL("../bin/git-commit-hook.sh", import.meta.url),
)

const agentName = process.env.OPENCODE_ASSISTED_BY_AGENT?.trim() || "opencode"
const extraTools = normalizeTools({
  tools: process.env.OPENCODE_ASSISTED_BY_EXTRA_TOOLS?.split(/[\s,]+/) ?? [],
})

/** @type {(model?: Model) => string} */
const modelId = (model?: Model): string => {
  const id = `${model?.id ?? ""}`.trim()
  if (id) return id

  return `${model?.modelID ?? ""}`.trim()
}

/** @type {(tool: string) => boolean} */
const isShellTool = (tool: string): boolean =>
  tool === "bash" || tool === "shell"

/** @type {(command: string, detectedTools: Set<string>) => void} */
const collectTools = (command: string, detectedTools: Set<string>): void => {
  for (const tool of detectSpecializedTools({ command })) {
    detectedTools.add(tool)
  }
}

/** @type {(options: BuildWrappedCommandOptions) => string} */
const buildWrappedCommand = (
  { command, model, detectedTools }: BuildWrappedCommandOptions,
): string => {
  if (!hasGitCommitInvocation({ command })) return ""
  if (!model) return ""

  const trailers = buildTrailers({
    agent: agentName,
    model,
    tools: [...detectedTools, ...extraTools],
  })

  if (!trailers.assistedBy) return ""

  return `${createHookBootstrap({ hookPath, ...trailers })}\n${command}`
}

const assistedByOpenCodePlugin = (
  _input: PluginInput,
  _options?: PluginOptions,
): Hooks => {
  const detectedTools = new Set(extraTools)
  const modelBySession = new Map<string, string>()

  return {
    "chat.params"(input: ChatParamsInput) {
      const model = modelId(input.model)
      if (model) modelBySession.set(input.sessionID, model)
    },

    "chat.message"(input: ChatMessageInput) {
      const model = modelId(input.model)
      if (model) modelBySession.set(input.sessionID, model)
    },

    "tool.execute.before"(
      input: ToolBeforeInput,
      output: ToolBeforeOutput,
    ) {
      if (!isShellTool(input.tool)) return

      const command = `${output.args.command ?? ""}`
      collectTools(command, detectedTools)

      const wrapped = buildWrappedCommand({
        command,
        model: modelBySession.get(input.sessionID) ?? "",
        detectedTools,
      })
      if (wrapped) output.args.command = wrapped
    },
  }
}

export default assistedByOpenCodePlugin
