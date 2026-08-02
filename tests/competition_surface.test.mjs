import { writeFileSync } from "node:fs";
import { competitionTools } from "../.pi/extensions/ctf-c-stage2-core.mjs";

export default function (pi) {
  pi.on("session_start", () => {
    const output = process.env.CTFC_SURFACE_OUTPUT;
    if (!output) throw new Error("surface output path is missing");
    writeFileSync(output, `tools=${competitionTools.map((tool) => tool.name).join(",")}\n`, { flag: "a" });
  });
}
