export type CommandOptions = { command?: unknown }
export type ProtectedGhTitleBodyMutation = {
  kind: "api"
  reason: string
}

const GH_MUTABLE_API_FIELD_PATTERN =
  /(?:--(?:title|body|body-file)(?:=|\s)|(?:-[fF]|--(?:field|raw-field))\s+(?:title|body)=|(?:-[fF](?:title|body)=))/
const GH_API_CALL_PATTERN =
  /(^|[\n;&|()\s])gh(?:\s+[^\n;&|()]+)*\s+api\b([^\n;&|()]*)/gm

/**
 * Detect low-level gh API commands that can overwrite an existing PR/issue title or body.
 *
 * @type {(options?: CommandOptions) => ProtectedGhTitleBodyMutation | undefined}
 */
export const detectProtectedGhTitleBodyMutation = (
  { command }: CommandOptions = {},
): ProtectedGhTitleBodyMutation | undefined => {
  const source = `${command ?? ""}`

  if (
    /(^|[\n;&|()\s])gh(?:\s+[^\n;&|()]+)*\s+api\s+graphql\b/m.test(source) &&
    /\bupdate(?:PullRequest|Issue)\b/.test(source) &&
    /\b(?:title|body)\b/.test(source)
  ) {
    return {
      kind: "api",
      reason:
        "gh api graphql PR/issue title/body mutation is blocked; read current title/body first, then use gh pr/issue edit with reviewed --title/--body-file inputs",
    }
  }

  for (const match of source.matchAll(GH_API_CALL_PATTERN)) {
    const args = match[2] ?? ""
    const mutatesIssueOrPr = /(?:\/issues\/\d+|\/pulls\/\d+)/.test(args)
    const patchMethod = /(?:\s-X\s*PATCH|\s--method\s+PATCH|\s--method=PATCH)/i
      .test(args)
    const mutablePayload = GH_MUTABLE_API_FIELD_PATTERN.test(args) ||
      /(?:--input\s|--input=)/.test(args)
    if (mutatesIssueOrPr && patchMethod && mutablePayload) {
      return {
        kind: "api",
        reason:
          "gh api PATCH that can overwrite PR/issue title/body is blocked; read current title/body first, then use gh pr/issue edit with reviewed --title/--body-file inputs",
      }
    }
  }

  return undefined
}
