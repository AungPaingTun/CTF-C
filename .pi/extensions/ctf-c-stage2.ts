import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidChallengeSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

function readDeclarationValue(declaration: string, label: string): string {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = declaration.match(new RegExp(`^-[ \\t]*\\*\\*${escapedLabel}:\\*\\*[ \\t]*\`([^\`]+)\``, "m"));
  return match?.[1] ?? "";
}

export interface Stage2Status {
  challenge_slug: string;
  category: string;
  authorization_state: string;
  remote_actions_state: string;
  time_budget: string;
}

function isInside(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent !== "" && !pathFromParent.startsWith("..") && !isAbsolute(pathFromParent);
}

function resolveChallengeDirectory(challengeSlug: string): string {
  const challengesRoot = resolve(process.cwd(), "challenges");
  const challengeDir = resolve(challengesRoot, challengeSlug);

  if (!existsSync(challengeDir) || lstatSync(challengeDir).isSymbolicLink()) {
    throw new Error("Challenge directory not found");
  }
  if (!lstatSync(challengeDir).isDirectory()) {
    throw new Error("Challenge directory not found");
  }

  const resolvedRoot = realpathSync(challengesRoot);
  const resolvedChallengeDir = realpathSync(challengeDir);
  if (!isInside(resolvedRoot, resolvedChallengeDir)) {
    throw new Error("Challenge directory not found");
  }

  return resolvedChallengeDir;
}

export function readStage2Status(challengeSlug: string): Stage2Status {
  if (!isValidChallengeSlug(challengeSlug)) {
    throw new Error("Invalid challenge slug");
  }

  const challengeDir = resolveChallengeDirectory(challengeSlug);

  const declarationPath = join(challengeDir, "challenge.md");
  if (!existsSync(declarationPath) || lstatSync(declarationPath).isSymbolicLink()) {
    throw new Error("Challenge declaration not found");
  }

  const declaration = readFileSync(declarationPath, "utf8");
  return {
    challenge_slug: challengeSlug,
    category: readDeclarationValue(declaration, "Category"),
    authorization_state: readDeclarationValue(declaration, "Target authorization"),
    remote_actions_state: readDeclarationValue(declaration, "Authorized remote actions"),
    time_budget: readDeclarationValue(declaration, "Time budget"),
  };
}

const stage2Status = defineTool({
  name: "stage2_status",
  label: "Stage 2 Status",
  description: "Read local CTF-C challenge declaration metadata without side effects.",
  parameters: Type.Object({
    challenge_slug: Type.String({ description: "Safe challenge directory slug" }),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    const result = readStage2Status(params.challenge_slug);

    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      details: result,
    };
  },
});

export default function (pi: ExtensionAPI) {
  pi.registerTool(stage2Status);
}
