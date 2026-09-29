import { quoteForShell } from "../src/core/assisted-by.ts"
import { isRecord, needsAttribution } from "./codex-pre-tool-use.ts"

export type ClaudePreToolUseInput = {
  hook_event_name?: unknown
  tool_input?: unknown
  tool_name?: unknown
  transcript_path?: unknown
}
export type ClaudePreToolUseOptions = {
  input?: ClaudePreToolUseInput
  modelOverride?: string
  pluginRoot?: string
  readTranscript?: (path: string) => string
}
export type ClaudePreToolUseOutput = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse"
    permissionDecision: "allow"
    updatedInput: Record<string, unknown> & { command: string }
  }
}

// Claude Code hook input carries no model, so read it from the latest assistant turn of the transcript.
export const findTranscriptModel = (transcript: string): string => {
  for (const line of transcript.split("\n").reverse()) {
    try {
      const model = JSON.parse(line)?.message?.model
      if (typeof model === "string" && !model.startsWith("<")) return model
    } catch {
      // Skip partial or non-JSON transcript lines.
    }
  }
  return ""
}

const readTranscriptModel = (
  { path, readTranscript }: {
    path: unknown
    readTranscript: (path: string) => string
  },
): string => {
  if (typeof path !== "string" || !path) return ""
  try {
    return findTranscriptModel(readTranscript(path))
  } catch {
    return ""
  }
}

// Build a Claude Code PreToolUse response that sources the installed attribution wrapper.
export const buildClaudePreToolUseOutput = (
  {
    input = {},
    modelOverride = "",
    pluginRoot = "",
    readTranscript = () => "",
  }: ClaudePreToolUseOptions = {},
): ClaudePreToolUseOutput | undefined => {
  if (
    input.hook_event_name !== "PreToolUse" || input.tool_name !== "Bash" ||
    !isRecord(input.tool_input) || !pluginRoot
  ) return undefined

  const command = input.tool_input.command
  if (
    typeof command !== "string" || !needsAttribution(command) ||
    command.includes("claude-bash-hook.sh")
  ) return undefined

  const model = modelOverride ||
    readTranscriptModel({ path: input.transcript_path, readTranscript }) ||
    "claude"
  const hookPath = `${pluginRoot}/bin/claude-bash-hook.sh`
  const updatedCommand = `CLAUDE_ASSISTED_BY_MODEL=${
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
    const output = buildClaudePreToolUseOutput({
      input,
      modelOverride: Deno.env.get("CLAUDE_ASSISTED_BY_MODEL") ?? "",
      pluginRoot: Deno.env.get("CLAUDE_PLUGIN_ROOT") ?? "",
      readTranscript: (path) => Deno.readTextFileSync(path),
    })
    if (output) console.log(JSON.stringify(output))
  } catch {
    // Invalid hook input must not interfere with the original Claude Code command.
  }
}
