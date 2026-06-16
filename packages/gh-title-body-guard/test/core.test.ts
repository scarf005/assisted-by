import { detectProtectedGhTitleBodyMutation } from "../src/core.ts"

/** @type {(actual: unknown, expected: unknown) => void} */
const assertEquals = (actual: unknown, expected: unknown): void => {
  if (!Object.is(actual, expected)) {
    throw new Error(
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    )
  }
}

Deno.test("blocks gh api title/body mutation paths", () => {
  assertEquals(
    detectProtectedGhTitleBodyMutation({
      command: "gh api repos/owner/repo/issues/9514 -X PATCH -f body=@body.md",
    })?.kind,
    "api",
  )
  assertEquals(
    detectProtectedGhTitleBodyMutation({
      command:
        "gh api repos/owner/repo/pulls/9514 --method PATCH --input /tmp/payload.json",
    })?.kind,
    "api",
  )
  assertEquals(
    detectProtectedGhTitleBodyMutation({
      command:
        'gh api graphql -f query=\'mutation { updatePullRequest(input:{pullRequestId:"x", title:"new"}) { pullRequest { id } } }\'',
    })?.kind,
    "api",
  )
  assertEquals(
    detectProtectedGhTitleBodyMutation({
      command:
        'gh api graphql -f query=\'mutation { updateIssue(input:{id:"x", body:"new"}) { issue { id } } }\'',
    })?.kind,
    "api",
  )
})

Deno.test("allows gh pr and issue edit title/body flags", () => {
  assertEquals(
    detectProtectedGhTitleBodyMutation({
      command: "gh pr edit 9514 --body-file /tmp/body.md",
    }),
    undefined,
  )
  assertEquals(
    detectProtectedGhTitleBodyMutation({
      command: "gh pr edit 9514 --title 'new title'",
    }),
    undefined,
  )
  assertEquals(
    detectProtectedGhTitleBodyMutation({
      command: "gh issue edit 9513 --body 'new body'",
    }),
    undefined,
  )
  assertEquals(
    detectProtectedGhTitleBodyMutation({
      command: "gh issue edit 9513 --title='new title'",
    }),
    undefined,
  )
})

Deno.test("allows creates and non-title/body metadata edits", () => {
  assertEquals(
    detectProtectedGhTitleBodyMutation({
      command: "gh pr create --title 'new pr' --body-file /tmp/body.md",
    }),
    undefined,
  )
  assertEquals(
    detectProtectedGhTitleBodyMutation({
      command: "gh issue create --title 'new issue' --body-file /tmp/body.md",
    }),
    undefined,
  )
  assertEquals(
    detectProtectedGhTitleBodyMutation({
      command: "gh pr edit 9514 --add-label ready",
    }),
    undefined,
  )
  assertEquals(
    detectProtectedGhTitleBodyMutation({
      command: "gh issue edit 9513 --add-assignee scarf005",
    }),
    undefined,
  )
})
