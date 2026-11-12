import {
  buildTrailers,
  hasGhIssueCreateInvocation,
  hasGhPrCreateInvocation,
  hasGitCommitMessageSource,
  quoteForShell,
  type Trailers,
} from "../src/core/assisted-by.ts"
import { isRecord, needsAttribution } from "./codex-pre-tool-use.ts"
import { resolve } from "node:path"

export type ClaudePreToolUseInput = {
  hook_event_name?: unknown
  tool_input?: unknown
  tool_name?: unknown
  transcript_path?: unknown
  cwd?: unknown
}
export type ClaudePreToolUseOptions = {
  input?: ClaudePreToolUseInput
  modelOverride?: string
  agent?: string
  tools?: string[]
  pluginRoot?: string
  readTranscript?: (path: string) => string
  readFile?: (path: string) => string | undefined
  runGit?: (args: string[], cwd: string) => string | undefined
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

type MessageContext = {
  cwd: string
  readFile: (path: string) => string | undefined
  runGit: (args: string[], cwd: string) => string | undefined
}
type CommitArgs = {
  messages: string[]
  file?: string
  ref?: string
  amend: boolean
  fixup: boolean
}

export const readFileOrUndefined = (path: string): string | undefined => {
  try {
    return Deno.readTextFileSync(path)
  } catch {
    return undefined
  }
}

export const runGitOutput = (
  args: string[],
  cwd: string,
): string | undefined => {
  try {
    const { success, stdout } = new Deno.Command("git", {
      args,
      cwd,
      stdin: "null",
      stdout: "piped",
      stderr: "null",
    }).outputSync()
    return success ? new TextDecoder().decode(stdout) : undefined
  } catch {
    return undefined
  }
}

const shortValueOptions: Record<string, keyof CommitArgs> = {
  m: "messages",
  F: "file",
  C: "ref",
  c: "ref",
}
const longValueOptions: Record<string, keyof CommitArgs> = {
  "--message": "messages",
  "--file": "file",
  "--reuse-message": "ref",
  "--reedit-message": "ref",
}

// Collect the options that decide the commit message, mirroring hasGitCommitMessageSource.
const parseCommitArgs = (words: string[]): CommitArgs => {
  const parsed: CommitArgs = { messages: [], amend: false, fixup: false }
  const set = (key: keyof CommitArgs, value: string | undefined) => {
    if (value === undefined) return
    if (key === "messages") parsed.messages = [...parsed.messages, value]
    else if (key === "file" || key === "ref") parsed[key] = value
  }
  for (let index = 0; index < words.length; index++) {
    const arg = words[index]
    if (arg === "--") break
    if (arg === "--amend") parsed.amend = true
    else if (/^--(?:fixup|squash)(?:=|$)/.test(arg)) {
      parsed.fixup = true
      if (!arg.includes("=")) index++
    } else if (arg in longValueOptions) {
      set(longValueOptions[arg], words[++index])
    } else if (/^--[^=]+=/.test(arg)) {
      const [name] = arg.split("=", 1)
      if (name in longValueOptions) {
        set(longValueOptions[name], arg.slice(name.length + 1))
      }
    } else if (
      /^--(?:author|date|cleanup|template|trailer|pathspec-from-file)$/.test(
        arg,
      )
    ) index++
    else if (!arg.startsWith("--") && /^-./.test(arg)) {
      // Short options may be bundled (-qm, -am); the first option that takes a value consumes the rest.
      const opts = arg.slice(1)
      for (const [position, char] of [...opts].entries()) {
        const key = shortValueOptions[char]
        if (key) {
          set(key, opts.slice(position + 1) || words[++index])
          break
        }
        if (char === "t" && position === opts.length - 1) index++
        if ("tuS".includes(char)) break
      }
    }
  }
  return parsed
}

const quotedHeredoc = String.raw`<<-?\s*(['"])([\w.-]+)\1`

// `-m "$(cat <<'EOF' ... EOF)"` is the only expansion whose text is known before the shell runs.
const literalMessage = (value: string): string | undefined => {
  if (!/[$`]/.test(value)) return value
  const heredoc = new RegExp(
    String.raw`^\$\(cat ${quotedHeredoc}\n([\s\S]*?)\n\2\n?\)$`,
  ).exec(value)
  return heredoc?.[3]
}

// Body of a quoted heredoc fed to `-F -` on the commit's own line.
const stdinHeredoc = (rest: string): string | undefined =>
  new RegExp(String.raw`^[^\n]*?${quotedHeredoc}[^\n]*\n([\s\S]*?)\n\2(?:\n|$)`)
    .exec(rest)?.[3]

// Resolve the message git will commit when it is knowable before the command runs.
const readCommitMessage = (
  { words, globals, rest, isFirstCommand, cwd, readFile, runGit }:
    & MessageContext
    & {
      words: string[]
      globals: string[]
      rest: string
      isFirstCommand: boolean
    },
): string | undefined => {
  const args = parseCommitArgs(words)
  if (args.fixup) return undefined
  if (args.messages.length > 0) {
    const messages = args.messages.map(literalMessage)
    return messages.every((message) => message !== undefined)
      ? messages.join("\n\n")
      : undefined
  }
  if (args.file === "-") return stdinHeredoc(rest)

  // Files, refs, and HEAD may be changed by earlier commands in the same Bash call.
  if (!isFirstCommand || !cwd) return undefined
  const dirOption = globals.flatMap((word, index) =>
    globals[index - 1] === "-C" ? [word] : []
  )
  const otherGlobals = globals.filter((word, index) =>
    word !== "-C" && globals[index - 1] !== "-C"
  )
  if ([...dirOption, ...otherGlobals].some((word) => /[$`]/.test(word))) {
    return undefined
  }
  const dir = resolve(cwd, ...dirOption)
  if (args.file !== undefined) {
    return /[$`]/.test(args.file)
      ? undefined
      : readFile(resolve(dir, args.file))
  }
  const ref = args.ref ?? (args.amend ? "HEAD" : undefined)
  if (ref === undefined || /[$`]/.test(ref)) return undefined
  return runGit([...otherGlobals, "log", "-1", "--format=%B", ref], dir)
}

// git compares trailer keys case-insensitively and values after trimming.
const splitTrailer = (line: string) => {
  const separator = line.indexOf(":")
  return separator < 1 ? undefined : {
    key: line.slice(0, separator).trim().toLowerCase(),
    value: line.slice(separator + 1).trim(),
  }
}

const hasTrailer = (message: string, trailer: string): boolean => {
  const wanted = splitTrailer(trailer)
  const block = message.trim().split(/\n[ \t]*\n/).at(-1) ?? ""
  return block.split("\n").some((line) => {
    const found = splitTrailer(line)
    return found?.key === wanted?.key && found?.value === wanted?.value
  })
}

// Rewrite git commit and rebase --continue in place, so the command stays a plain git call.
const inlineGitAttribution = (
  command: string,
  { assistedBy, coAuthoredBy }: Trailers,
  context: MessageContext,
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

  // Worktree isolation refuses `git -c`, so drop trailers the message already has instead of setting trailer.ifexists.
  const trailersFor = (match: RegExpMatchArray, words: string[]) => {
    const message = readCommitMessage({
      words,
      globals: simpleCommandWords(match[3])?.words ?? [],
      rest: command.slice((match.index ?? 0) + match[0].length),
      isFirstCommand: command.slice(0, gitIndex(match)).trim() === "",
      ...context,
    })
    return [assistedBy, coAuthoredBy]
      .filter((trailer) =>
        trailer && !(message !== undefined && hasTrailer(message, trailer))
      )
      .map((trailer) => ` --trailer ${quoteForShell(trailer)}`)
      .join("")
  }
  // Rewrite from the end so earlier match offsets stay valid.
  const edits = [
    ...commits.map((match, index) => {
      const trailers = trailersFor(match, args[index]?.words ?? [])
      return {
        match,
        text: (globals: string) =>
          `GIT_EDITOR=: git${globals} commit${trailers}`,
      }
    }),
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
    readFile = () => undefined,
    runGit = () => undefined,
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
    {
      cwd: typeof input.cwd === "string" ? input.cwd : "",
      readFile,
      runGit,
    },
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
      readFile: readFileOrUndefined,
      runGit: runGitOutput,
    })
    if (output) console.log(JSON.stringify(output))
  } catch {
    // Invalid hook input must not interfere with the original Claude Code command.
  }
}
