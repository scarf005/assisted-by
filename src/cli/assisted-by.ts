#!/usr/bin/env node

import process from "node:process"

import { buildTrailers } from "../core/assisted-by.ts"

const [, , modelArg = "", agentArg = "", ...tools] = process.argv

if (!modelArg || !agentArg) {
  console.error("usage: assisted-by <model-name> <agent-name> [tool ...]")
  process.exit(1)
}

const trailers = buildTrailers({ model: modelArg, agent: agentArg, tools })
console.log(trailers.assistedBy)
if (trailers.coAuthoredBy) console.log(trailers.coAuthoredBy)
