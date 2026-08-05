import { spawnSync } from "node:child_process";

const [provider = "", model = ""] = process.argv.slice(2);
if (!provider && !model) process.exit(0);
if (!provider || !model) {
  process.stderr.write("Provider preflight failed: provider and model must be supplied together.\n");
  process.exit(78);
}

const pattern = model.includes("/") ? model : `${provider}/${model}`;
const result = spawnSync("pi", ["--offline", "--list-models", pattern], { encoding: "utf8" });
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
if (result.error || result.status !== 0 || /No models matching/i.test(output)) {
  const detail = output.replace(/[\r\n]+/g, " ").slice(0, 512) || result.error?.message || "provider/model is unavailable";
  process.stderr.write(`Provider preflight failed for ${pattern}: ${detail}\n`);
  process.exit(78);
}
process.exit(0);
