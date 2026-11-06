import {
  buildTrailers,
  hasGhIssueCreateInvocation,
  hasGhPrCreateInvocation,
  hasGitCommitMessageSource,
  quoteForShell,
  type Trailers,
} from "../src/core/assisted-by.ts"
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
  agent?: string
  tools?: string[]
  pluginRoot?: string
  readTranscript?: (path: string) => string
}
export type ClaudePreToolUseOutput = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse"
    permissionDecision: "allow" | "deny"
    permissionDecisionReason?: string
    updatedInput?: Record<string, unknown> & { command: string }
  }
}
type InlineResult = { command: string } | { denied: string } | undefined

const missingMessageSource =
  "assisted-by: refusing git commit without a message source; use -m, -F, -C, -c, --fixup, --squash, --amend, or --no-edit explicitly."
const gitGlobals = String
  .raw`(?:\s+(?:-[Cc]\s+[^\s;&|()]+|--(?:git-dir|work-tree|namespace|exec-path|config-env)\s+[^\s;&|()]+|--[^\s;&|()]+|-[pP]))*`
const commandStart = String.raw`(^|[\n;&|(])(\s*)`
const anyStart = String.raw`(^|[\n;&|()\s])()`
const commitAt = (start: string) =>
  new RegExp(`${start}git(${gitGlobals})\\s+commit(?=\\s|$)`, "gm")
const rebaseContinueAt = (start: string) =>
  new RegExp(
    `${start}git(\\s+rebase(?:\\s+[^\\s;&|()]+)*\\s+--continue)(?=\\s|$)`,
    "gm",
  )
type Words = { words: string[]; dynamic: boolean }

// Marks the characters the shell reads as command text: outside quotes, escapes, and heredoc bodies.
const commandText = (command: string): boolean[] => {
  const code: boolean[] = []
  const heredocs: { end: string; tabs: boolean }[] = []
  let quote = ""
  for (let index = 0; index < command.length; index++) {
    const char = command[index]
    if (quote) {
      code.push(false)
      if (quote === '"' && char === "\\") {
        code.push(false)
        index++
      } else if (char === quote) quote = ""
      continue
    }
    if (char === "\\") {
      code.push(false, false)
      index++
      continue
    }
    if (char === "'" || char === '"') {
      code.push(false)
      quote = char
      continue
    }
    const heredoc = command[index - 1] === "<"
      ? null
      : /^<<(?!<)(-?)\s*(['"]?)([\w.-]+)\2/.exec(command.slice(index))
    if (heredoc) {
      heredocs.push({ end: heredoc[3], tabs: heredoc[1] === "-" })
      code.push(...heredoc[0].split("").map(() => true))
      index += heredoc[0].length - 1
      continue
    }
    code.push(true)
    if (char !== "\n") continue
    for (const { end, tabs } of heredocs.splice(0)) {
      while (index + 1 < command.length) {
        const lineEnd = command.indexOf("\n", index + 1)
        const stop = lineEnd === -1 ? command.length : lineEnd
        const line = command.slice(index + 1, stop)
        code.push(
          ...command.slice(index + 1, stop + 1).split("").map(() => false),
        )
        index = stop
        if ((tabs ? line.replace(/^\t+/, "") : line) === end) break
      }
    }
  }
  return code
}

const gitIndex = (match: RegExpMatchArray) =>
  (match.index ?? 0) + match[1].length + match[2].length
const commandMatches = (pattern: RegExp, command: string, code: boolean[]) =>
  [...command.matchAll(pattern)].filter((match) => code[gitIndex(match)])

// Split the words of one simple command; dynamic when a word holds an expansion.
const simpleCommandWords = (text: string): Words | undefined => {
  const words: string[] = []
  let word: string | undefined
  let quote = ""
  let dynamic = false
  let redirectTarget = false
  const finishWord = () => {
    if (word !== undefined && !redirectTarget) words.push(word)
    else if (word !== undefined) redirectTarget = false
    word = undefined
  }
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quote) {
      if (char === quote) quote = ""
      else if (quote === '"' && char === "\\") {
        word = (word ?? "") + (text[++index] ?? "")
      } else {
        if (quote === '"' && /[$`]/.test(char)) dynamic = true
        word = (word ?? "") + char
      }
    } else if (char === "'" || char === '"') {
      quote = char
      word ??= ""
    } else if (char === "\\") {
      if (text[index + 1] === "\n") finishWord()
      else word = (word ?? "") + (text[index + 1] ?? "")
      index++
    } else if (char === "<" || char === ">") {
      // Drop a file descriptor prefix (2>&1) and the redirection target.
      if (word !== undefined && /^\d+$/.test(word)) word = undefined
      finishWord()
      while (/[<>&-]/.test(text[index + 1] ?? "")) index++
      redirectTarget = true
    } else if (char === "$" && text[index + 1] === "(") return undefined
    else if (/[\n;&|()]/.test(char)) break
    else if (/\s/.test(char)) finishWord()
    else {
      if (char === "$" || char === "`") dynamic = true
      word = (word ?? "") + char
    }
  }
  if (quote) return undefined
  finishWord()
  return { words, dynamic }
}

// Rewrite git commit and rebase --continue in place, so the command stays a plain git call.
const inlineGitAttribution = (
  command: string,
  { assistedBy, coAuthoredBy }: Trailers,
): InlineResult => {
  const code = commandText(command)
  const commits = commandMatches(commitAt(commandStart), command, code)
  const rebases = commandMatches(rebaseContinueAt(commandStart), command, code)
  if (
    hasGhPrCreateInvocation({ command }) ||
    hasGhIssueCreateInvocation({ command }) ||
    commandMatches(commitAt(anyStart), command, code).length !==
      commits.length ||
    commandMatches(rebaseContinueAt(anyStart), command, code).length !==
      rebases.length
  ) return undefined

  const args = commits.map((match) =>
    simpleCommandWords(command.slice((match.index ?? 0) + match[0].length))
  )
  const missing = args.filter((parsed) =>
    parsed && !hasGitCommitMessageSource(parsed.words)
  )
  if (
    args.some((parsed) => parsed === undefined) ||
    missing.some((parsed) => parsed?.dynamic)
  ) return undefined
  if (missing.length > 0) return { denied: missingMessageSource }

  const trailers = [assistedBy, coAuthoredBy]
    .filter(Boolean)
    .map((trailer) => ` --trailer ${quoteForShell(trailer)}`)
    .join("")
  // Rewrite from the end so earlier match offsets stay valid.
  const edits = [
    ...commits.map((match) => ({
      match,
      text: (globals: string) =>
        `GIT_EDITOR=: git${globals} -c trailer.ifexists=addIfDifferent -c trailer.ifmissing=add commit${trailers}`,
    })),
    ...rebases.map((match) => ({
      match,
      text: (rest: string) => `GIT_EDITOR=: git${rest}`,
    })),
  ].toSorted((a, b) => gitIndex(b.match) - gitIndex(a.match))
  return {
    command: edits.reduce(
      (text, { match, text: replacement }) =>
        text.slice(0, gitIndex(match)) + replacement(match[3]) +
        text.slice((match.index ?? 0) + match[0].length),
      command,
    ),
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
    agent = "claude-code",
    tools = [],
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
  const inline = inlineGitAttribution(
    command,
    buildTrailers({ agent, model, tools }),
  )
  if (inline && "denied" in inline) {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: inline.denied,
      },
    }
  }
  // Claude Code worktree isolation refuses `source`, so only commands that cannot be rewritten inline use the wrapper.
  const hookPath = `${pluginRoot}/bin/claude-bash-hook.sh`
  const updatedCommand = inline?.command ??
    `CLAUDE_ASSISTED_BY_MODEL=${quoteForShell(model)} source ${
      quoteForShell(hookPath)
    } && ${command}`

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
      agent: Deno.env.get("CLAUDE_ASSISTED_BY_AGENT") || "claude-code",
      tools: (Deno.env.get("CLAUDE_ASSISTED_BY_EXTRA_TOOLS") ?? "").split(
        /[\s,]+/,
      ),
      pluginRoot: Deno.env.get("CLAUDE_PLUGIN_ROOT") ?? "",
      readTranscript: (path) => Deno.readTextFileSync(path),
    })
    if (output) console.log(JSON.stringify(output))
  } catch {
    // Invalid hook input must not interfere with the original Claude Code command.
  }
}
