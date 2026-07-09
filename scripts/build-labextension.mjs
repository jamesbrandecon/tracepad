import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const python = process.env.PYTHON || "python";
const fallback = execFileSync(
  python,
  ["-c", "import sys; from pathlib import Path; print(Path(sys.prefix) / 'share' / 'jupyter' / 'lab' / 'static')"],
  { encoding: "utf8" }
).trim();
const corePath = process.env.JUPYTERLAB_CORE_PATH || fallback;
const builder = require.resolve("@jupyterlab/builder/lib/build-labextension.js");

execFileSync(process.execPath, [builder, "--core-path", corePath, "."], {
  stdio: "inherit"
});

const stylePath = "tracepad/labextension/static/style.js";
if (existsSync(stylePath)) {
  writeFileSync(stylePath, `${readFileSync(stylePath, "utf8").trimEnd()}\n`);
}
