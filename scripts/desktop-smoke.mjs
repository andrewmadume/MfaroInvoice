import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  profile = await mkdtemp(path.resolve("work/desktop-smoke-")),
  report = path.join(profile, "report.json");
const executable = process.argv[2] || require("electron");
const args = process.argv[2] ? ["--smoke-test"] : [".", "--smoke-test"];
await new Promise((resolve, reject) => {
  const child = spawn(executable, args, {
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      MFARO_SMOKE_PROFILE: profile,
      MFARO_SMOKE_REPORT: report,
    },
  });
  const timeout = setTimeout(() => {
    child.kill();
    reject(new Error("Desktop launch timed out"));
  }, 30000);
  child.on("error", (e) => {
    clearTimeout(timeout);
    reject(e);
  });
  child.on("exit", () => {
    clearTimeout(timeout);
    resolve();
  });
});
const result = JSON.parse(await readFile(report, "utf8"));
if (
  !result.workspace ||
  !result.storage ||
  result.node !== "undefined" ||
  result.process !== "undefined" ||
  result.pdfBytes < 100
)
  throw new Error("Desktop smoke checks failed");
console.log(result);
