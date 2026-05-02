type Bundle = {
  entry: string
  output: string
  executable?: boolean
}

const bundles: Bundle[] = [
  { entry: "src/core/assisted-by.ts", output: "lib/assisted-by.js" },
  {
    entry: "src/cli/assisted-by.ts",
    output: "bin/assisted-by.js",
    executable: true,
  },
  {
    entry: "src/pi/assisted-by.ts",
    output: "extensions/assisted-by.js",
  },
  { entry: "src/opencode/assisted-by.ts", output: "opencode/assisted-by.js" },
]

/** @type {(command: string, args: string[]) => Promise<void>} */
const run = async (command: string, args: string[]): Promise<void> => {
  const result = await new Deno.Command(command, {
    args,
    stdout: "inherit",
    stderr: "inherit",
  }).output()

  if (!result.success) {
    throw new Error(`${command} ${args.join(" ")} failed with ${result.code}`)
  }
}

/** @type {(path: string) => Promise<void>} */
const ensureShebang = async (path: string): Promise<void> => {
  const source = await Deno.readTextFile(path)
  const withoutShebang = source.replace(/^#!.*\n\n?/, "")
  await Deno.writeTextFile(path, `#!/usr/bin/env node\n${withoutShebang}`)
  await Deno.chmod(path, 0o755)
}

for (const bundle of bundles) {
  await run(Deno.execPath(), [
    "bundle",
    "--packages=external",
    "--external",
    "@mariozechner/pi-coding-agent",
    "--no-lock",
    bundle.entry,
    "-o",
    bundle.output,
  ])

  if (bundle.executable) await ensureShebang(bundle.output)
}

await run(Deno.execPath(), [
  "fmt",
  "--no-semicolons",
  "--prose-wrap=never",
  "src",
  "test",
  "scripts",
  "bin/assisted-by.js",
  "extensions/assisted-by.js",
  "lib/assisted-by.js",
  "opencode/assisted-by.js",
])
