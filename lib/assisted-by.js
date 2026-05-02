const KNOWN_SPECIALIZED_TOOLS = [
  { name: "coccinelle", patterns: [/\bcoccinelle\b/i, /\bspatch\b/i] },
  { name: "sparse", patterns: [/\bsparse\b/i] },
  { name: "smatch", patterns: [/\bsmatch\b/i] },
  { name: "clang-tidy", patterns: [/\bclang-tidy\b/i] },
]

const trimValue = (value) =>
  `${value ?? ""}`.trim().replace(/^(["'])(.*)\1$/, "$2")

export const quoteForShell = (value) =>
  `'${`${value ?? ""}`.replace(/'/g, `'"'"'`)}'`

export const normalizeTools = ({ tools = [] } = {}) => {
  const seen = new Set()
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
    const familyTitle = family[0].toUpperCase() + family.slice(1)
    return `Claude ${familyTitle} ${version} <noreply@anthropic.com>`
  }

  const splitClaude = normalized.match(
    /^claude-(opus|sonnet|haiku)-([0-9]+)-([0-9]+)$/,
  )
  if (splitClaude) {
    const [, family, major, minor] = splitClaude
    const familyTitle = family[0].toUpperCase() + family.slice(1)
    return `Claude ${familyTitle} ${major}.${minor} <noreply@anthropic.com>`
  }

  const familyClaude = normalized.match(/^claude-(opus|sonnet|haiku)$/)
  if (familyClaude) {
    const [, family] = familyClaude
    const familyTitle = family[0].toUpperCase() + family.slice(1)
    return `Claude ${familyTitle} <noreply@anthropic.com>`
  }

  return ""
}

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

export const detectSpecializedTools = ({ command } = {}) => {
  const source = `${command ?? ""}`
  const detected = []

  for (const candidate of KNOWN_SPECIALIZED_TOOLS) {
    if (candidate.patterns.some((pattern) => pattern.test(source))) {
      detected.push(candidate.name)
    }
  }

  return detected
}

export const hasGitCommitInvocation = ({ command } = {}) =>
  /(^|[\n;&|()\s])git\s+commit(\s|$)/m.test(`${command ?? ""}`)

export const createHookBootstrap = (
  { hookPath, assistedBy, coAuthoredBy } = {},
) => {
  if (!hookPath || !assistedBy) return ""

  const lines = [
    `export PI_ASSISTED_BY_TRAILER=${quoteForShell(assistedBy)}`,
    `export PI_CO_AUTHORED_BY_TRAILER=${quoteForShell(coAuthoredBy)}`,
    `. ${quoteForShell(hookPath)}`,
  ]

  return `${lines.join("\n")}`
}
