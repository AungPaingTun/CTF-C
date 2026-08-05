import { copyFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, delimiter, extname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

const MAX_FILES = 128;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const ARCHIVES = new Set([".tar", ".tgz", ".zip"]);
const TAR_GZ = ".tar.gz";

const inside = (parent, candidate) => {
  const path = relative(parent, candidate);
  return path !== "" && !path.startsWith("..") && !path.startsWith("/");
};

function safeRoots(roots) {
  return roots.map((root) => {
    const resolved = resolve(root);
    if (!existsSync(resolved) || !lstatSync(resolved).isDirectory()) throw new Error(`Permitted input root is unavailable: ${root}`);
    return realPathWithoutSymlink(resolved, resolved);
  });
}

function realPathWithoutSymlink(root, target) {
  const path = relative(root, target);
  if (path.startsWith("..") || path.startsWith("/")) throw new Error("Input path escapes permitted root");
  let current = root;
  for (const part of path ? path.split("/") : []) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error("Input symlink is not allowed");
  }
  return resolve(target);
}

function permittedRoots(roots) {
  if (roots) return safeRoots(roots);
  const configured = process.env.CTFC_COMPETITION_INPUT_ROOTS?.split(delimiter).filter(Boolean);
  return safeRoots(configured ?? [join(homedir(), "Downloads")]);
}

export function extractCompetitionInputPaths(text) {
  const paths = new Set();
  for (const match of String(text).matchAll(/(?:^|[\s([{:}=])(?:"(\/(?!\/)[^<>"'\r\n]*)"|'(\/(?!\/)[^<>"'\r\n]*)'|`(\/(?!\/)[^<>"'\r\n]*)`|(\/(?!\/)[^\s<>"'`]+))/g)) {
    const candidate = match[1] ?? match[2] ?? match[3] ?? match[4].replace(/[.,;:!?)}\]]+$/g, "");
    if (candidate.startsWith("/") && !candidate.startsWith("//")) paths.add(candidate);
  }
  return [...paths];
}

function archiveKind(path) {
  const lower = path.toLowerCase();
  if (lower.endsWith(TAR_GZ)) return "tar.gz";
  const extension = extname(lower);
  return ARCHIVES.has(extension) ? extension.slice(1) : null;
}

function safeArchiveEntry(entry) {
  if (!entry || entry.startsWith("/") || entry.startsWith("\\") || entry.includes("\\") || entry.split("/").includes("..")) throw new Error(`Unsafe archive entry: ${entry}`);
  return entry;
}

function command(commandName, args, maxBuffer = 2 * 1024 * 1024) {
  const result = spawnSync(commandName, args, { encoding: "utf8", maxBuffer });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `${commandName} failed`);
  return result.stdout;
}

function archiveEntries(archive, kind) {
  const listing = kind === "zip" ? command("/usr/bin/unzip", ["-Z1", archive]) : command("/usr/bin/tar", ["-tf", archive]);
  const entries = listing.split(/\r?\n/).filter(Boolean).map(safeArchiveEntry);
  if (entries.length > MAX_FILES) throw new Error("Archive file limit exceeded");
  if (kind === "zip") {
    const details = command("/usr/bin/zipinfo", ["-l", archive]);
    if (/\bsymbolic link\b|\bhard link\b/i.test(details) || details.split(/\r?\n/).some((line) => line.trimStart().startsWith("l"))) throw new Error("Archive links are not allowed");
  } else {
    const details = command("/usr/bin/tar", ["-tvf", archive]);
    if (details.split(/\r?\n/).some((line) => /^[lh]/.test(line))) throw new Error("Archive links are not allowed");
  }
  return entries;
}

function measureTree(root) {
  const files = [];
  const walk = (directory) => {
    for (const name of readdirSync(directory)) {
      const target = join(directory, name);
      const stat = lstatSync(target);
      if (stat.isSymbolicLink()) throw new Error("Extracted symlink is not allowed");
      if (stat.isDirectory()) walk(target);
      else if (stat.isFile()) files.push({ path: target, size: stat.size, inode: `${stat.dev}:${stat.ino}` });
      else throw new Error("Unsupported extracted file type");
    }
  };
  walk(root);
  if (files.length > MAX_FILES) throw new Error("Archive file limit exceeded");
  if (files.some((file) => file.size > MAX_FILE_BYTES)) throw new Error("Archive file size limit exceeded");
  if (files.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_BYTES) throw new Error("Archive total size limit exceeded");
  if (new Set(files.map((file) => file.inode)).size !== files.length) throw new Error("Extracted hard link is not allowed");
  return files;
}

function extractArchive(archive, destination, kind) {
  archiveEntries(archive, kind);
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  try {
    if (kind === "zip") command("/usr/bin/unzip", ["-q", archive, "-d", destination]);
    else command("/usr/bin/tar", [kind === "tar.gz" || kind === "tgz" ? "-xzf" : "-xf", archive, "-C", destination]);
    measureTree(destination);
  } catch (error) {
    rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}

function uniqueName(directory, name) {
  const extension = extname(name);
  const stem = extension ? name.slice(0, -extension.length) : name;
  let candidate = name;
  let index = 2;
  while (existsSync(join(directory, candidate))) candidate = `${stem}-${index++}${extension}`;
  return candidate;
}

function copyInput(input, sourceRoot, index) {
  const name = uniqueName(sourceRoot, basename(input));
  const destination = join(sourceRoot, name);
  copyFileSync(input, destination);
  chmodSync(destination, 0o600);
  const kind = archiveKind(input);
  if (!kind) return { name, kind: "file", source_index: index };
  const extractedName = uniqueName(sourceRoot, name.replace(/\.tar\.gz$|\.tgz$|\.tar$|\.zip$/i, ""));
  const extracted = join(sourceRoot, extractedName);
  try {
    extractArchive(destination, extracted, kind);
  } catch (error) {
    rmSync(destination, { force: true });
    throw error;
  }
  return { name, kind, extracted: extractedName, source_index: index };
}

export function ingestCompetitionInputs(recordPath, text, { roots } = {}) {
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  const candidates = extractCompetitionInputPaths(text);
  if (!candidates.length) return { accepted: [], rejected: [] };
  const rootsToCheck = permittedRoots(roots);
  const sourceRoot = join(record.paths.work, "source");
  mkdirSync(sourceRoot, { recursive: true, mode: 0o700 });
  chmodSync(sourceRoot, 0o700);
  const accepted = [];
  const rejected = [];
  for (const [index, candidate] of candidates.entries()) {
    try {
      if (!existsSync(candidate)) throw new Error("file does not exist");
      if (lstatSync(candidate).isSymbolicLink()) throw new Error("symbolic links are not allowed");
      if (!lstatSync(candidate).isFile()) throw new Error("path is not a regular file");
      const lexical = resolve(candidate);
      const root = rootsToCheck.find((permittedRoot) => inside(permittedRoot, lexical));
      if (!root) throw new Error("path is outside permitted input roots");
      const resolved = realPathWithoutSymlink(root, lexical);
      accepted.push(copyInput(resolved, sourceRoot, index));
    } catch (error) {
      rejected.push({ path: candidate, reason: error instanceof Error ? error.message : "input rejected" });
    }
  }
  const manifest = { accepted, rejected };
  const manifestPath = join(sourceRoot, "supplied-inputs.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  chmodSync(manifestPath, 0o600);
  const temporary = `${recordPath}.tmp-${randomUUID()}`;
  writeFileSync(temporary, `${JSON.stringify({ ...record, source_root: sourceRoot }, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, recordPath);
  return manifest;
}
