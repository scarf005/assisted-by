# Project Rule

- format with `deno fmt --no-semicolons --prose-wrap=never`
- use TypeScript types directly; do not add JSDoc type annotations to TypeScript files

## Documentation

Write `README.md`, docs, and code comments in Simplified Technical English (ASD-STE100).

- Write one instruction or one fact in each sentence.
- Keep procedural sentences to 20 words or fewer. Keep descriptive sentences to 25 words or fewer.
- Use the active voice. Write instructions in the imperative ("Run `deno task test`.").
- Use one word for one meaning. Use the same term for the same thing in all files (for example, always "hook", not "hook" in one place and "interceptor" in another).
- Use technical words only in their real technical meaning: "recursive", "idempotent", "trailer", "heredoc", "hook", and "regex" are correct.
- Do not use words as made-up metaphors: "load-bearing", "surface" (as a verb), "lean into", "first-class", "battle-tested", "seamless", "robust", "powerful", "leverage", "under the hood", "out of the box".
- Do not add filler: "simply", "just", "basically", "note that", "it is worth mentioning".
- Do not use the em-dash (`—`). Use a period, a colon, or parentheses.
- Do not describe the tool with adjectives. Describe what it does and what it does not do.
