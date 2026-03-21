import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const entryPoints = [
  { in: "src/feed.js", out: "feed" },
  { in: "src/content.js", out: "content" },
  { in: "src/popup.js", out: "popup" },
  { in: "src/background.js", out: "background" },
];

const buildOptions = {
  entryPoints: entryPoints.map((e) => ({ in: e.in, out: e.out })),
  bundle: true,
  format: "iife",
  target: "chrome110",
  outdir: ".",
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await esbuild.build(buildOptions);
}
