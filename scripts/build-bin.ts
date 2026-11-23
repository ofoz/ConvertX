/**
 * Compiles the server into a single executable.
 *
 * The CLI equivalent embeds a quoted `--define` argument
 * (`--define 'process.env.NODE_ENV="production"'`) which Windows cannot pass
 * through cmd.exe, so the build is invoked with an argument array instead:
 * no shell means no quoting differences between platforms.
 */
const arguments_ = [
  "build",
  "./src/index.tsx",
  "--compile",
  "--minify",
  "--sourcemap",
  "--bytecode",
  "--format=esm",
  "--define",
  'process.env.NODE_ENV="production"',
  "--outfile",
  "./dist/convertx",
];

const result = Bun.spawnSync([process.execPath, ...arguments_], {
  stdio: ["inherit", "inherit", "inherit"],
  cwd: import.meta.dir + "/..",
});

if (result.exitCode !== 0) {
  console.error(`build:bin failed with exit code ${result.exitCode ?? "unknown"}`);
}

process.exit(result.exitCode ?? 1);
