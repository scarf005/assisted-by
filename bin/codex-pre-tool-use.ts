import {
  hasGhIssueCreateInvocation,
  hasGhPrCreateInvocation,
  hasGitCommitInvocation,
  hasGitRebaseContinueInvocation,
  quoteForShell,
} from "../src/core/assisted-by.ts"

export type CodexPreToolUseInput = {
  hook_event_name?: unknown
  model?: unknown
  tool_input?: unknown
  tool_name?: unknown
}
export type CodexPreToolUseOptions = {
  input?: CodexPreToolUseInput
  modelOverride?: string
  pluginRoot?: string
}
export type CodexPreToolUseOutput = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse"
    permissionDecision: "allow"
    updatedInput: Record<string, unknown> & { command: string }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const needsAttribution = (command: string): boolean =>
  hasGitCommitInvocation({ command }) ||
  hasGitRebaseContinueInvocation({ command }) ||
  hasGhPrCreateInvocation({ command }) ||
  hasGhIssueCreateInvocation({ command })

// Build a Codex PreToolUse response that sources the installed attribution wrapper.
export const buildCodexPreToolUseOutput = (
  { input = {}, modelOverride = "", pluginRoot = "" }: CodexPreToolUseOptions =
    {},
): CodexPreToolUseOutput | undefined => {
  if (
    input.hook_event_name !== "PreToolUse" || input.tool_name !== "Bash" ||
    !isRecord(input.tool_input) || !pluginRoot
  ) return undefined

  const command = input.tool_input.command
  if (
    typeof command !== "string" || !needsAttribution(command) ||
    command.includes("codex-bash-hook.sh")
  ) return undefined

  const model = modelOverride ||
    (typeof input.model === "string" ? input.model : "") || "codex"
  const hookPath = `${pluginRoot}/bin/codex-bash-hook.sh`
  const updatedCommand = `CODEX_ASSISTED_BY_MODEL=${
    quoteForShell(model)
  } source ${quoteForShell(hookPath)} && ${command}`

  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: { ...input.tool_input, command: updatedCommand },
    },
  }
}

if (import.meta.main) {
  try {
    const input = JSON.parse(await new Response(Deno.stdin.readable).text())
    const output = buildCodexPreToolUseOutput({
      input,
      modelOverride: Deno.env.get("CODEX_ASSISTED_BY_MODEL") ?? "",
      pluginRoot: Deno.env.get("PLUGIN_ROOT") ?? "",
    })
    if (output) console.log(JSON.stringify(output))
  } catch {
    // Invalid hook input must not interfere with the original Codex command.
  }
}
