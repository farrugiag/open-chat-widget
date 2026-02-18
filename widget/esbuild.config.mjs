import { build, context } from "esbuild";

const watchMode = process.argv.includes("--watch");

const options = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "dist/chat-widget.js",
  format: "iife",
  platform: "browser",
  target: ["es2018"],
  minify: !watchMode,
  sourcemap: watchMode,
  logLevel: "info",
  banner: {
    js: "/* os-chatbot widget */"
  }
};

if (watchMode) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("Watching widget source files...");
} else {
  await build(options);
}
