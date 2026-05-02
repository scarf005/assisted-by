#!/usr/bin/env node
// src/cli/assisted-by.ts
import process from "node:process"

// src/core/assisted-by.ts
var trimValue = (value) =>
  `${value ?? ""}`.trim().replace(/^(["'])(.*)\1$/, "$2")
var titleFamily = (family) =>
  `${family.slice(0, 1).toUpperCase()}${family.slice(1)}`
var normalizeTools = ({ tools: tools2 = [] } = {}) => {
  const seen = /* @__PURE__ */ new Set()
  const normalized = []
  for (const tool of tools2) {
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
var buildTrailers = ({ agent = "pi", model, tools: tools2 = [] } = {}) => {
  const agentValue = trimValue(agent)
  const modelValue = trimValue(model)
  if (!agentValue || !modelValue) {
    return {
      assistedBy: "",
      coAuthoredBy: "",
    }
  }
  const normalizedTools = normalizeTools({
    tools: tools2,
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

// src/cli/assisted-by.ts
var [, , modelArg = "", agentArg = "", ...tools] = process.argv
if (!modelArg || !agentArg) {
  console.error("usage: assisted-by <model-name> <agent-name> [tool ...]")
  process.exit(1)
}
var trailers = buildTrailers({
  model: modelArg,
  agent: agentArg,
  tools,
})
console.log(trailers.assistedBy)
if (trailers.coAuthoredBy) console.log(trailers.coAuthoredBy)
