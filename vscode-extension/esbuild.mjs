import * as esbuild from "esbuild";

await Promise.all([
  esbuild.build({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    external: ["vscode"],
    format: "cjs",
    minify: false,
    outfile: "dist/extension.js",
    platform: "node",
    sourcemap: true,
    target: "node20"
  }),
  esbuild.build({
    entryPoints: ["src/renderer.ts"],
    bundle: true,
    format: "esm",
    minify: true,
    outfile: "dist/renderer.js",
    platform: "browser",
    sourcemap: true,
    target: "es2022"
  })
]);
