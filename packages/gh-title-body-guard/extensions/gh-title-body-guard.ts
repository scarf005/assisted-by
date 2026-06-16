import { detectProtectedGhTitleBodyMutation } from "../src/core.ts"

type ToolCallEvent = { input?: { command?: unknown } }
type UserBashEvent = { command?: unknown }
type ExtensionContext = Record<string, never>
type ToolBlock = { block: true; reason: string }
type UserBashBlock = {
  result: {
    output: string
    exitCode: 1
    cancelled: false
    truncated: false
  }
}
type PiApi = {
  on(
    name: "tool_call",
    handler: (
      event: ToolCallEvent,
      ctx: ExtensionContext,
    ) => void | ToolBlock | Promise<void | ToolBlock>,
  ): void
  on(
    name: "user_bash",
    handler: (
      event: UserBashEvent,
      ctx: ExtensionContext,
    ) => void | UserBashBlock | Promise<void | UserBashBlock>,
  ): void
}

/** @type {(reason: string) => string} */
const formatBlockedReason = (reason: string): string =>
  `gh-title-body-guard: ${reason}`

/** @type {(pi: PiApi) => void} */
const ghTitleBodyGuardExtension = (pi: PiApi): void => {
  pi.on("tool_call", (event: ToolCallEvent) => {
    if (typeof event.input?.command !== "string") return

    const protectedMutation = detectProtectedGhTitleBodyMutation({
      command: event.input.command,
    })
    if (!protectedMutation) return

    return {
      block: true,
      reason: formatBlockedReason(protectedMutation.reason),
    }
  })

  pi.on("user_bash", (event: UserBashEvent) => {
    const protectedMutation = detectProtectedGhTitleBodyMutation({
      command: event.command,
    })
    if (!protectedMutation) return

    return {
      result: {
        output: formatBlockedReason(protectedMutation.reason),
        exitCode: 1,
        cancelled: false,
        truncated: false,
      },
    }
  })
}

export default ghTitleBodyGuardExtension
