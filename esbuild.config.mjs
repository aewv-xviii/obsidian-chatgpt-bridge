import esbuild from "esbuild";

const isProduction = process.argv.includes("production");

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*"],
  format: "cjs",
  platform: "node",
  target: "es2020",
  sourcemap: isProduction ? false : "inline",
  outfile: "main.js",
  logLevel: "info",
  treeShaking: true
});

if (isProduction) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
  console.log("Watching for changes...");
}
