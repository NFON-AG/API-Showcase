#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from 'node:url';

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
  { name: 'Google OAuth client secret', regex: /GOCSPX-[A-Za-z0-9_-]{16,}/ },
  {
    name: "JSON client_secret value",
    regex: /"client_secret"\s*:\s*"(?!<|change-me|your-|placeholder|example|secret-here|$)[^"\n]{16,}"/i,
  },
  { name: 'Basic authorization', regex: /\bBasic\s+(?!<|placeholder|example)[A-Za-z0-9+/]{12,}={0,2}/i },
  { name: 'URL credentials', regex: /https?:\/\/(?!<)[^\s/:@"']+:(?!<)[^\s/@"']{8,}@/i },
  { name: 'URL access token', regex: /[?&](?:access_token|refresh_token|api_key|client_secret)=(?!<|%3C|placeholder|example)[A-Za-z0-9._~%+/-]{12,}/i },
  { name: 'local user path', regex: /\/(?:Users|home)\/(?!<|user\b|username\b|runner\b|node\b)[A-Za-z][A-Za-z0-9._-]*\// },
  { name: 'JWT', regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  { name: 'Bearer token', regex: /\bBearer\s+(?!<|placeholder|example)[A-Za-z0-9._~+/-]{16,}=*/i },
];

export function scanText(body, file = '') {
  const found = [];
  for (const pattern of patterns) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags.replace('g', '') + 'g');
    for (const match of body.matchAll(regex)) {
      if (pattern.name === 'Basic authorization') {
        const value = match[0].trim().split(/\s+/).pop();
        if (!Buffer.from(value, 'base64').toString('utf8').includes(':')) continue;
      }
      found.push({ file, line: body.slice(0, match.index).split('\n').length, name: pattern.name });
    }
  }
  const placeholder = value => /^(?:<[^>]+>|change-me|your-[\w-]+|placeholder(?:[-_][\w-]+)?|example(?:[-_][\w-]+)?|secret-here)$/i.test(value) || value === 'demo-csrf-token';
  const add = (index, name) => found.push({ file, line: body.slice(0,index).split('\n').length, name });
  const rawValue = (text, shellAssignment = false) => {
    const raw = text.trim();
    const quote = raw[0];
    if (quote === '"' || quote === "'") {
      let end = 1;
      while (end < raw.length && raw[end] !== quote) {
        if (raw[end] === '\\' && !(shellAssignment && quote === "'")) end++;
        end++;
      }
      // Shell words can concatenate quoted and unquoted parts without a separator.
      // A placeholder in just the first part must not exempt the entire value.
      if (shellAssignment && end < raw.length - 1 && !/^[\s;&|]/.test(raw.slice(end + 1))) return raw;
      return end < raw.length ? raw.slice(1,end) : '';
    }
    return raw.split(/\s+#/)[0].trim();
  };
  const credentialKind = key => {
    const normalized = key.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
    if (/(?:PASSWORD|PASSWD|PASS)$/.test(normalized)) return 'password';
    if (/TOKEN$/.test(normalized)) return 'token';
    return /(?:SECRET(?:_ACCESS)?_KEY|PRIVATE_KEY|SECRET|API_?KEY)$/.test(normalized) ? 'secret' : '';
  };
  const shellFile = /\.(?:sh|bash|zsh|command)$/i.test(file);
  const commandExpansionEnd = (value, start = 0) => {
    let depth = 1, quote = '';
    for (let index = start + 2; index < value.length; index++) {
      const char = value[index];
      if (char === '\\' && quote !== "'") { index++; continue; }
      if (quote === "'" || quote === '`') {
        if (char === quote) quote = '';
        continue;
      }
      if (char === '$' && value[index + 1] === '(') {
        index = commandExpansionEnd(value, index);
        if (index < 0) return -1;
        continue;
      }
      if (quote) { if (char === quote) quote = ''; continue; }
      if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
      if (char === '(') depth++;
      if (char === ')' && --depth === 0) return index;
    }
    return -1;
  };
  const shellExpansion = raw => {
    if (!shellFile || raw.trim().startsWith("'")) return false;
    // Only a complete expansion is exempt: single quotes, escaped dollars and
    // literal prefixes/default values must still be checked as credentials.
    const text = raw.trim();
    const quoted = text.match(/^"([\s\S]*)"\s*(?:#.*)?$/);
    if (text.startsWith('"') && !quoted) return false;
    const value = quoted ? quoted[1] : rawValue(text);
    return /^\$(?:[A-Za-z_]\w*|\{[A-Za-z_]\w*\})$/.test(value)
      || (value.startsWith('$(') && commandExpansionEnd(value) === value.length - 1);
  };
  // Read one shell word, keeping quoted newlines but removing actual line
  // continuations. A physical line is not an assignment/value boundary.
  function shellWord(start) {
    let value = '', quote = '', index = start;
    for (; index < body.length; index++) {
      const char = body[index];
      if (char === '\\' && quote !== "'") {
        const next = body[index + 1];
        if (next === '\n') { index++; continue; }
        if (next === '\r' && body[index + 2] === '\n') { index += 2; continue; }
        value += char;
        if (next !== undefined) value += body[++index];
        continue;
      }
      if (quote !== "'" && char === '$' && body[index + 1] === '(') {
        const end = commandExpansionEnd(body, index);
        if (end >= 0) { value += body.slice(index, end + 1); index = end; continue; }
      }
      if (quote) {
        value += char;
        if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'") { quote = char; value += char; continue; }
      if (/[\s;&|]/.test(char)) break;
      value += char;
    }
    return { value, end: index };
  }
  const assignments = shellFile
    ? /^[^\S\r\n]*(?:export[ \t]+)?([A-Z][A-Z0-9_]*)(?:[ \t]*)=/gim
    : /^[^\S\r\n]*(?:export[ \t]+)?([A-Z][A-Z0-9_]*)(?:[ \t]*)=([^\r\n]*)/gim;
  let match;
  while ((match = assignments.exec(body))) {
    const word = shellFile ? shellWord(assignments.lastIndex) : null;
    if (word) assignments.lastIndex = word.end;
    const raw = word ? word.value : match[2].trim();
    // Unquoted assignments are expressions in source code, but literal values in dotenv.
    if (shellExpansion(raw) || (/\.(?:[cm]?js|[cm]?ts|jsx|tsx)$/i.test(file) && !/^["']/.test(raw))) continue;
    const value = rawValue(raw, shellFile), kind = credentialKind(match[1]);
    if (kind && value.length >= (kind === 'password' ? 8 : 12) && !placeholder(value)) add(match.index, 'environment ' + kind + ' value');
  }
  for (const match of body.matchAll(/(["'])([\w-]+)\1\s*:\s*(["'])((?:\\.|(?!\3)[^\\\r\n])*)\3(?=\s*[,}\r\n]|\s*$)/g)) {
    if (!credentialKind(match[2])) continue;
    if (match[4].length >= 8 && !placeholder(match[4])) add(match.index, 'structured password or token value');
  }
  for (const match of body.matchAll(/^[ \t]*([\w-]+)[ \t]*:[ \t]*([^\r\n]+)/gm)) {
    if (!credentialKind(match[1])) continue;
    const value = rawValue(match[2]);
    if (value.length >= 8 && !placeholder(value) && (/^[A-Za-z0-9_#/+==-]+$/.test(match[2].trim()) || /^(["'])([^"']+)\1\s*(?:#.*)?$/.test(match[2]))) add(match.index, 'YAML password or token value');
  }
  for (const match of body.matchAll(/X-NFON-Service-Token["']?\s*[:=]\s*["']?([A-Za-z0-9_-]{12,})/gi)) {
    if (!placeholder(match[1])) add(match.index, 'service ownership token');
  }
  for (const match of body.matchAll(/\b(\w+)\s*=\s*(["'])([^"'\n]{8,})\2(?=\s*[,;}\r\n]|\s*$)/gi)) {
    if (credentialKind(match[1]) && !shellExpansion(match[2] + match[3] + match[2]) && !placeholder(match[3])) add(match.index, 'assigned credential value');
  }
  for (const match of body.matchAll(/^\s*K[A-Z0-9]{3,}\s+(\S{8,})\s*$/gim)) {
    if (!placeholder(match[1])) add(match.index, 'CTI credential file');
  }
  return found;
}

function gitFiles() {
  const git = process.env.GIT_BIN || 'git';
  let output;
  try { output = execFileSync(git, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "buffer", stdio: ["ignore", "pipe", "pipe"],
  }); } catch { throw new Error("Git could not list files. Set GIT_BIN to an available Git executable."); }
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

function main() {
const findings = [];

for (const file of gitFiles()) {
  if (!shouldScan(file)) continue;
  const body = readFileSync(path.join(root, file), "utf8");
  findings.push(...scanText(body, file));
}

if (findings.length) {
  console.error("Potential secrets found in commit-visible files:");
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} (${finding.name})`);
  }
  process.exit(1);
}

console.log("No obvious secrets found in commit-visible files.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
