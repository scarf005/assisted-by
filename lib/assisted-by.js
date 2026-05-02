// @ts-check

/**
 * @typedef {{ name: string, patterns: RegExp[] }} SpecializedToolRule
 * @typedef {{ tools?: Iterable<unknown> }} ToolsOptions
 * @typedef {{ model?: unknown }} ModelOptions
 * @typedef {{ agent?: unknown, model?: unknown, tools?: Iterable<unknown> }} BuildTrailersOptions
 * @typedef {{ assistedBy: string, coAuthoredBy: string }} Trailers
 * @typedef {{ command?: unknown }} CommandOptions
 * @typedef {{ hookPath?: string, assistedBy?: string, coAuthoredBy?: string }} HookBootstrapOptions
 */

/** @type {SpecializedToolRule[]} */
const KNOWN_SPECIALIZED_TOOLS = [
  { name: "coccinelle", patterns: [/\bcoccinelle\b/i, /\bspatch\b/i] },
  { name: "sparse", patterns: [/\bsparse\b/i] },
  { name: "smatch", patterns: [/\bsmatch\b/i] },
  { name: "clang-tidy", patterns: [/\bclang-tidy\b/i] },
]

/** @type {(value: unknown) => string} */
const trimValue = (value) =>
  `${value ?? ""}`.trim().replace(/^(["'])(.*)\1$/, "$2")

/** @type {(family: string) => string} */
const titleFamily = (family) =>
  `${family.slice(0, 1).toUpperCase()}${family.slice(1)}`

/**
 * Quote a value as one POSIX shell single-quoted token.
 *
 * @type {(value: unknown) => string}
 */
export const quoteForShell = (value) =>
  `'${`${value ?? ""}`.replace(/'/g, `'"'"'`)}'`

/**
 * Normalize tool labels while preserving first-seen order.
 *
 * @type {(options?: ToolsOptions) => string[]}
 */
export const normalizeTools = ({ tools = [] } = {}) => {
  /** @type {Set<string>} */
  const seen = new Set()
  /** @type {string[]} */
  const normalized = []

  for (const tool of tools) {
    const value = trimValue(tool)
    if (!value) continue
    if (seen.has(value)) continue
    seen.add(value)
    normalized.push(value)
  }

  return normalized
}

/**
 * Resolve a known co-author identity for a model id.
 *
 * @type {(options?: ModelOptions) => string}
 */
export const resolveCoAuthor = ({ model } = {}) => {
  const modelRaw = trimValue(model)
  const normalized = modelRaw.toLowerCase()

  if (!normalized) return ""
  if (/^(gpt-|o[0-9].*|codex|chatgpt|openai\/)/.test(normalized)) {
    return "chatgpt-codex-connector[bot] <199175422+chatgpt-codex-connector[bot]@users.noreply.github.com>"
  }
  if (/^(gemini|google\/gemini)/.test(normalized)) {
    return "gemini-code-assist[bot] <176961590+gemini-code-assist[bot]@users.noreply.github.com>"
  }

  const dottedClaude = normalized.match(
    /^claude-([0-9]+\.?[0-9]*)-(opus|sonnet|haiku)$/,
  )
  if (dottedClaude) {
    const [, version, family] = dottedClaude
    return `Claude ${titleFamily(family)} ${version} <noreply@anthropic.com>`
  }

  const splitClaude = normalized.match(
    /^claude-(opus|sonnet|haiku)-([0-9]+)-([0-9]+)$/,
  )
  if (splitClaude) {
    const [, family, major, minor] = splitClaude
    return `Claude ${
      titleFamily(family)
    } ${major}.${minor} <noreply@anthropic.com>`
  }

  const familyClaude = normalized.match(/^claude-(opus|sonnet|haiku)$/)
  if (familyClaude) {
    const [, family] = familyClaude
    return `Claude ${titleFamily(family)} <noreply@anthropic.com>`
  }

  return ""
}

/**
 * Build git trailers for a model-assisted commit.
 *
 * @type {(options?: BuildTrailersOptions) => Trailers}
 */
export const buildTrailers = ({ agent = "pi", model, tools = [] } = {}) => {
  const agentValue = trimValue(agent)
  const modelValue = trimValue(model)
  if (!agentValue || !modelValue) {
    return { assistedBy: "", coAuthoredBy: "" }
  }

  const normalizedTools = normalizeTools({ tools })
  const assistedBy = `Assisted-by: ${agentValue}:${modelValue}${
    normalizedTools.length > 0 ? ` ${normalizedTools.join(" ")}` : ""
  }`
  const coAuthor = resolveCoAuthor({ model: modelValue })

  return {
    assistedBy,
    coAuthoredBy: coAuthor ? `Co-authored-by: ${coAuthor}` : "",
  }
}

/**
 * Detect supported specialized analysis tools mentioned in a command.
 *
 * @type {(options?: CommandOptions) => string[]}
 */
export const detectSpecializedTools = ({ command } = {}) => {
  const source = `${command ?? ""}`
  /** @type {string[]} */
  const detected = []

  for (const candidate of KNOWN_SPECIALIZED_TOOLS) {
    if (candidate.patterns.some((pattern) => pattern.test(source))) {
      detected.push(candidate.name)
    }
  }

  return detected
}

/** @type {(options?: CommandOptions) => boolean} */
export const hasGitCommitInvocation = ({ command } = {}) =>
  /(^|[\n;&|()\s])git\s+commit(\s|$)/m.test(`${command ?? ""}`)

/**
 * Create shell code that installs the git commit wrapper for one command.
 *
 * @type {(options?: HookBootstrapOptions) => string}
 */
export const createHookBootstrap = (
  { hookPath = "", assistedBy = "", coAuthoredBy = "" } = {},
) => {
  if (!hookPath || !assistedBy) return ""

  const lines = [
    `export PI_ASSISTED_BY_TRAILER=${quoteForShell(assistedBy)}`,
    `export PI_CO_AUTHORED_BY_TRAILER=${quoteForShell(coAuthoredBy)}`,
    `. ${quoteForShell(hookPath)}`,
  ]

  return `${lines.join("\n")}`
}
