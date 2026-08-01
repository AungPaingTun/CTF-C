import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CATEGORIES = new Set(["web", "pwn", "reverse", "surprise"]);
const REQUIRED_FIELDS = [
  "Category",
  "Target authorization",
  "Target",
  "Remote status",
  "Authorized remote actions",
  "User approval record",
  "Local Docker Compose",
  "Time budget",
];

export function isValidChallengeSlug(slug) {
  return SLUG_PATTERN.test(slug);
}

export function parseStage2Declaration(declaration) {
  const metadata = {};
  for (const label of REQUIRED_FIELDS) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = declaration.match(new RegExp(`^-[ \\t]*\\*\\*${escapedLabel}:\\*\\*[ \\t]*\`([^\`]+)\``, "m"));
    metadata[label] = match?.[1] ?? "";
  }
  return {
    category: metadata.Category,
    authorization_state: metadata["Target authorization"],
    target_state: metadata.Target,
    remote_status: metadata["Remote status"],
    authorized_remote_actions: metadata["Authorized remote actions"],
    user_approval_record: metadata["User approval record"],
    local_docker_compose: metadata["Local Docker Compose"],
    time_budget: metadata["Time budget"],
  };
}

export function validateStage2Declaration(metadata) {
  const errors = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (value === "") errors.push(`missing:${key}`);
  }
  if (metadata.category && !CATEGORIES.has(metadata.category)) errors.push("invalid:category");
  if (metadata.authorization_state !== "local-only") errors.push("invalid:authorization_state");
  if (metadata.target_state !== "local-source-only") errors.push("invalid:target_state");
  if (metadata.remote_status !== "local-only") errors.push("invalid:remote_status");
  if (metadata.authorized_remote_actions !== "none") errors.push("invalid:authorized_remote_actions");
  if (metadata.user_approval_record !== "not approved") errors.push("invalid:user_approval_record");
  if (metadata.local_docker_compose === "" || metadata.local_docker_compose === undefined) {
    errors.push("missing:local_docker_compose");
  }
  if (metadata.time_budget !== "15 minutes" && metadata.time_budget !== "30 minutes") {
    errors.push("invalid:time_budget");
  }
  return errors;
}

function isInside(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return pathFromParent !== "" && !pathFromParent.startsWith("..") && !isAbsolute(pathFromParent);
}

function resolveChallengeDirectory(challengeSlug) {
  const challengesRoot = resolve(process.cwd(), "challenges");
  const challengeDir = resolve(challengesRoot, challengeSlug);
  if (!existsSync(challengeDir) || lstatSync(challengeDir).isSymbolicLink() || !lstatSync(challengeDir).isDirectory()) {
    throw new Error("Challenge directory not found");
  }
  const resolvedRoot = realpathSync(challengesRoot);
  const resolvedChallengeDir = realpathSync(challengeDir);
  if (!isInside(resolvedRoot, resolvedChallengeDir)) throw new Error("Challenge directory not found");
  return resolvedChallengeDir;
}

export function readStage2Declaration(challengeSlug) {
  if (!isValidChallengeSlug(challengeSlug)) throw new Error("Invalid challenge slug");
  const challengeDir = resolveChallengeDirectory(challengeSlug);
  const declarationPath = join(challengeDir, "challenge.md");
  if (!existsSync(declarationPath) || lstatSync(declarationPath).isSymbolicLink()) {
    throw new Error("Challenge declaration not found");
  }
  const metadata = parseStage2Declaration(readFileSync(declarationPath, "utf8"));
  const errors = validateStage2Declaration(metadata);
  if (errors.length > 0) throw new Error(`Invalid Stage 2 declaration: ${errors.join(", ")}`);
  return { challenge_slug: challengeSlug, ...metadata };
}

export function beginInvestigation(challengeSlug) {
  const declaration = readStage2Declaration(challengeSlug);
  return {
    challenge_slug: declaration.challenge_slug,
    state: "ready",
    phase: "source_audit",
    category: declaration.category,
    next_action: "delegate_one_read_only_auditor",
    remote_actions: "blocked",
    side_effects: "none",
  };
}

function textResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], details: value };
}

const stage2Status = defineTool({
  name: "stage2_status",
  label: "Stage 2 Status",
  description: "Read and validate local CTF-C challenge declaration metadata.",
  parameters: Type.Object({ challenge_slug: Type.String({ description: "Safe challenge directory slug" }) }),
  async execute(_toolCallId, params) {
    const declaration = readStage2Declaration(params.challenge_slug);
    return textResult({
      challenge_slug: declaration.challenge_slug,
      category: declaration.category,
      authorization_state: declaration.authorization_state,
      remote_actions_state: declaration.authorized_remote_actions,
      time_budget: declaration.time_budget,
    });
  },
});

const beginInvestigationTool = defineTool({
  name: "begin_investigation",
  label: "Begin Investigation",
  description: "Validate a local Stage 2 declaration and return a no-side-effect investigation skeleton.",
  parameters: Type.Object({ challenge_slug: Type.String({ description: "Safe challenge directory slug" }) }),
  async execute(_toolCallId, params) {
    return textResult(beginInvestigation(params.challenge_slug));
  },
});

export default function (pi) {
  pi.registerTool(stage2Status);
  pi.registerTool(beginInvestigationTool);
}
