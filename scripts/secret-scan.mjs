#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const maxBytes = 1_500_000;
const skippedExtensions = new Set([
  ".docx",
  ".gz",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".tar",
  ".webp",
  ".zip",
]);

const patterns = [
  {
    name: "private key",
    regex: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/i,
  },
  {
    name: "Google API key",
    regex: /AIza[0-9A-Za-z_-]{20,}/,
  },
  {
    name: "OpenAI-style API key",
    regex: /sk-[A-Za-z0-9_-]{20,}/,
  },
  {
    name: "OAuth access token",
    regex: /(?:ya29\.|1\/\/)[0-9A-Za-z._-]{20,}/,
  },
  {
    name: "JSON client_secret value",
    regex: /"client_secret"\s*:\s*"(?!<|change-me|your-|placeholder|example|secret-here|$)[^"\n]{16,}"/i,
  },
  {
    name: "environment secret value",
    regex: /^[^\S\r\n]*[A-Z0-9_]*(?:CLIENT|API|APP|PORTAL|CALLHISTORY|GOOGLE|NFON)?_?SECRET[^\S\r\n]*=[^\S\r\n]*(?!\r?$|<|change-me|your-|placeholder|example|secret-here)[^\s#]{12,}/im,
  },
  {
    name: "environment token value",
    regex: /^[^\S\r\n]*[A-Z0-9_]*(?:ACCESS|REFRESH|ID)_TOKEN[^\S\r\n]*=[^\S\r\n]*(?!\r?$|<|change-me|your-|placeholder|example)[^\s#]{12,}/im,
  },
];

function gitFiles() {
  const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "buffer",
  });
  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort();
}

function shouldScan(file) {
  const ext = path.extname(file).toLowerCase();
  if (skippedExtensions.has(ext)) return false;
  const fullPath = path.join(root, file);
  if (!existsSync(fullPath)) return false;
  const stats = statSync(fullPath);
  return stats.isFile() && stats.size <= maxBytes;
}

const findings = [];

for (const file of gitFiles()) {
  if (!shouldScan(file)) continue;
  const body = readFileSync(path.join(root, file), "utf8");
  for (const pattern of patterns) {
    const match = body.match(pattern.regex);
    if (match) {
      const before = body.slice(0, match.index);
      const line = before.split("\n").length;
      findings.push({ file, line, name: pattern.name });
    }
  }
}

if (findings.length) {
  console.error("Potential secrets found in commit-visible files:");
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} (${finding.name})`);
  }
  process.exit(1);
}

console.log("No obvious secrets found in commit-visible files.");
