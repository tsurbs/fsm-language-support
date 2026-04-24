// Bundles the extension and language server with esbuild.
// Run via `npm run build` (production) or `npm run watch` (incremental).
const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const baseOptions = {
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

const builds = [
  {
    ...baseOptions,
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
    // `vscode` is provided by the host at runtime and must not be bundled.
    external: ["vscode"],
  },
  {
    ...baseOptions,
    entryPoints: ["src/server.ts"],
    outfile: "dist/server.js",
    // The server is a separate Node process spawned by the client; nothing host-provided.
    external: [],
  },
];

async function run() {
  if (watch) {
    const ctxs = await Promise.all(builds.map((b) => esbuild.context(b)));
    await Promise.all(ctxs.map((c) => c.watch()));
    console.log("[esbuild] watching...");
    return;
  }
  await Promise.all(builds.map((b) => esbuild.build(b)));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
