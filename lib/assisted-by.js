// src/core/assisted-by.ts
var KNOWN_SPECIALIZED_TOOLS = [
  {
    name: "coccinelle",
    patterns: [
      /\bcoccinelle\b/i,
      /\bspatch\b/i,
    ],
  },
  {
    name: "sparse",
    patterns: [
      /\bsparse\b/i,
    ],
  },
  {
    name: "smatch",
    patterns: [
      /\bsmatch\b/i,
    ],
  },
  {
    name: "clang-tidy",
    patterns: [
      /\bclang-tidy\b/i,
    ],
  },
]
var trimValue = (value) =>
  `${value ?? ""}`.trim().replace(/^(["'])(.*)\1$/, "$2")
var titleFamily = (family) =>
  `${family.slice(0, 1).toUpperCase()}${family.slice(1)}`
var quoteForShell = (value) => `'${`${value ?? ""}`.replace(/'/g, `'"'"'`)}'`
var normalizeTools = ({ tools = [] } = {}) => {
  const seen = /* @__PURE__ */ new Set()
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
var modelName = (model) => model.split("/").at(-1) ?? model
var resolveCoAuthor = ({ model } = {}) => {
  const modelRaw = trimValue(model)
  const normalized = modelRaw.toLowerCase()
  const name = modelName(normalized)
  if (!normalized) return ""
  if (/^(gpt-|o[0-9].*|codex|chatgpt|openai\/)/.test(normalized)) {
    return "chatgpt-codex-connector[bot] <199175422+chatgpt-codex-connector[bot]@users.noreply.github.com>"
  }
  if (
    /^(gemini|google\/gemini)/.test(normalized) || name.startsWith("gemini")
  ) {
    return "gemini-code-assist[bot] <176961590+gemini-code-assist[bot]@users.noreply.github.com>"
  }
  const dottedClaude = name.match(
    /^claude-([0-9]+\.?[0-9]*)-(opus|sonnet|haiku)$/,
  )
  if (dottedClaude) {
    const [, version, family] = dottedClaude
    return `Claude ${titleFamily(family)} ${version} <noreply@anthropic.com>`
  }
  const splitClaude = name.match(
    /^claude-(opus|sonnet|haiku)-([0-9]+)-([0-9]+)$/,
  )
  if (splitClaude) {
    const [, family, major, minor] = splitClaude
    return `Claude ${
      titleFamily(family)
    } ${major}.${minor} <noreply@anthropic.com>`
  }
  const familyClaude = name.match(/^claude-(opus|sonnet|haiku)$/)
  if (familyClaude) {
    const [, family] = familyClaude
    return `Claude ${titleFamily(family)} <noreply@anthropic.com>`
  }
  return ""
}
var buildTrailers = ({ agent = "pi", model, tools = [] } = {}) => {
  const agentValue = trimValue(agent)
  const modelValue = trimValue(model)
  if (!agentValue || !modelValue) {
    return {
      assistedBy: "",
      coAuthoredBy: "",
    }
  }
  const normalizedTools = normalizeTools({
    tools,
  })
  const assistedBy = `Assisted-by: ${agentValue}:${modelValue}${
    normalizedTools.length > 0 ? ` ${normalizedTools.join(" ")}` : ""
  }`
  const coAuthor = resolveCoAuthor({
    model: modelValue,
  })
  return {
    assistedBy,
    coAuthoredBy: coAuthor ? `Co-authored-by: ${coAuthor}` : "",
  }
}
var detectSpecializedTools = ({ command } = {}) => {
  const source = `${command ?? ""}`
  const detected = []
  for (const candidate of KNOWN_SPECIALIZED_TOOLS) {
    if (candidate.patterns.some((pattern) => pattern.test(source))) {
      detected.push(candidate.name)
    }
  }
  return detected
}
var hasGitCommitInvocation = ({ command } = {}) =>
  /(^|[\n;&|()\s])git\s+commit(\s|$)/m.test(`${command ?? ""}`)
var createHookBootstrap = (
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
export {
  buildTrailers,
  createHookBootstrap,
  detectSpecializedTools,
  hasGitCommitInvocation,
  normalizeTools,
  quoteForShell,
  resolveCoAuthor,
}
