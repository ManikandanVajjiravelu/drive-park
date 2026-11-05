// Repository guard for Usop. Plain Node ESM, no dependencies; run from the repo root:
//   node scripts/check-repo.mjs
// It looks only at tracked files (`git ls-files`), prints one line per problem as
// "RULE file:line", never prints the matched secret text, and exits 1 if anything is wrong.
// The rules and the why behind them are in docs/WORKFLOW.md.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const JOURNAL = "drizzle/migrations/meta/_journal.json";

// Rule A: files that must never be tracked.
const FORBIDDEN_BASENAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  ".env",
  ".env.local",
  ".env.production",
  "repo-tree.txt",
]);
const FORBIDDEN_BASENAME_SUFFIXES = [".pem", ".key"];
const FORBIDDEN_ROOT_SCRIPT = /^(?:seed|fix|inspect|check)-.*\.mjs$/;

// Rule B: secrets. Only real key material counts, so the platform files that compare against
// the bare prefixes ("sb_secret_", "rzp_live_", "sk_live_") stay clean.
const SECRET_SKIP_BASENAMES = new Set(["bun.lock", ".env.example"]);
const POSTGRES_URL = /postgres(?:ql)?:\/\/[^\s:@/]+:([^\s@/]+)@/;
const POSTGRES_PLACEHOLDERS = new Set(["YOUR_PASSWORD", "[YOUR-PASSWORD]", "password"]);
const SECRET_PATTERNS = [
  /Demo123/,
  /eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{10,}/,
  /(?:sb_secret_|rzp_live_|sk_live_)[A-Za-z0-9_-]{10,}/,
];

// Rule C: text files that must never contain a zero byte.
const NUL_BYTE_EXTENSIONS = new Set([
  ".gitignore",
  ".gitattributes",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".json",
  ".md",
  ".sql",
  ".yml",
  ".yaml",
  ".css",
  ".html",
  ".toml",
]);

// Rule D: every migration file needs a matching journal entry, and the numbering must be sane.
const MIGRATION_FILE = /^(\d{4})_[^/]+\.sql$/;

function git(args) {
  return execFileSync("git", args, { maxBuffer: 256 * 1024 * 1024 }).toString("utf8");
}

function basename(file) {
  return file.slice(file.lastIndexOf("/") + 1);
}

function extension(file) {
  const name = basename(file).toLowerCase();
  return name.includes(".") ? `.${name.split(".").pop()}` : name;
}

function looksBinary(buffer) {
  return buffer.subarray(0, 8192).indexOf(0) !== -1;
}

function lineAt(buffer, offset) {
  let line = 1;
  for (let i = 0; i < offset; i += 1) {
    if (buffer[i] === 0x0a) line += 1;
  }
  return line;
}

// Rule A: lockfiles, env files and keys anywhere; one-off helper scripts at the repo root.
function checkForbiddenFiles(tracked) {
  const findings = [];
  for (const file of tracked) {
    const name = basename(file).toLowerCase();
    const isRootLevel = !file.includes("/");
    const forbidden =
      FORBIDDEN_BASENAMES.has(name) ||
      FORBIDDEN_BASENAME_SUFFIXES.some((suffix) => name.endsWith(suffix)) ||
      (isRootLevel && FORBIDDEN_ROOT_SCRIPT.test(name));
    if (forbidden) findings.push({ rule: "FORBIDDEN FILE", file, line: 1 });
  }
  return findings;
}

function hasSecret(line) {
  const postgres = line.match(POSTGRES_URL);
  if (postgres && !POSTGRES_PLACEHOLDERS.has(postgres[1])) return true;
  return SECRET_PATTERNS.some((pattern) => pattern.test(line));
}

// Rule B: secrets in tracked text files (the matched text itself is never printed).
function checkSecrets(tracked) {
  const findings = [];
  for (const file of tracked) {
    const name = basename(file).toLowerCase();
    if (SECRET_SKIP_BASENAMES.has(name) || name.endsWith(".md") || file.startsWith("docs/")) {
      continue;
    }

    let buffer;
    try {
      buffer = readFileSync(file);
    } catch {
      continue;
    }
    if (looksBinary(buffer)) continue;

    buffer
      .toString("utf8")
      .split("\n")
      .forEach((text, index) => {
        if (hasSecret(text)) findings.push({ rule: "SECRET", file, line: index + 1 });
      });
  }
  return findings;
}

// Rule C: a zero byte in a text file means it was written as binary or corrupted.
function checkNulBytes(tracked) {
  const findings = [];
  for (const file of tracked) {
    if (!NUL_BYTE_EXTENSIONS.has(extension(file))) continue;

    let buffer;
    try {
      buffer = readFileSync(file);
    } catch {
      continue;
    }
    const offset = buffer.indexOf(0);
    if (offset !== -1) findings.push({ rule: "NUL BYTE", file, line: lineAt(buffer, offset) });
  }
  return findings;
}

// Rule D: migrations and their journal must agree, in both directions.
function checkMigrations(tracked) {
  const findings = [];
  const files = tracked
    .filter((file) => file.startsWith("drizzle/migrations/") && MIGRATION_FILE.test(basename(file)))
    .sort();

  let journalText = "";
  let entries = [];
  try {
    journalText = readFileSync(JOURNAL, "utf8");
    const journal = JSON.parse(journalText);
    entries = Array.isArray(journal.entries) ? journal.entries : [];
  } catch {
    if (files.length > 0) findings.push({ rule: "MIGRATIONS", file: JOURNAL, line: 1 });
    return findings;
  }

  const journalLines = journalText.split("\n");
  const lineOfTag = (tag) => {
    const index = journalLines.findIndex((text) => text.includes(`"${tag}"`));
    return index === -1 ? 1 : index + 1;
  };

  const seenTags = new Set();
  const seenIdx = new Set();
  let previousWhen = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    const tag = String(entry.tag ?? "");
    const line = lineOfTag(tag);
    const number = MIGRATION_FILE.test(`${tag}.sql`) ? Number(tag.slice(0, 4)) : null;

    if (!tracked.includes(`drizzle/migrations/${tag}.sql`)) {
      findings.push({ rule: "MIGRATIONS", file: JOURNAL, line });
    }
    if (seenTags.has(tag) || seenIdx.has(entry.idx)) {
      findings.push({ rule: "MIGRATIONS", file: JOURNAL, line });
    }
    seenTags.add(tag);
    seenIdx.add(entry.idx);
    if (number === null || entry.idx !== number) {
      findings.push({ rule: "MIGRATIONS", file: JOURNAL, line });
    }

    const when = Number(entry.when);
    if (!(when > previousWhen)) findings.push({ rule: "MIGRATIONS", file: JOURNAL, line });
    previousWhen = when;
  }

  const numbers = [];
  const seenNumbers = new Set();
  for (const file of files) {
    const number = Number(basename(file).slice(0, 4));
    numbers.push(number);
    if (seenNumbers.has(number)) findings.push({ rule: "MIGRATIONS", file, line: 1 });
    seenNumbers.add(number);
    if (!seenTags.has(basename(file).slice(0, -4))) {
      findings.push({ rule: "MIGRATIONS", file, line: 1 });
    }
  }

  const unique = [...new Set(numbers)].sort((a, b) => a - b);
  unique.forEach((number, index) => {
    if (number === index) return;
    const file = files.find((candidate) => Number(basename(candidate).slice(0, 4)) === number);
    findings.push({ rule: "MIGRATIONS", file: file ?? JOURNAL, line: 1 });
  });

  return findings;
}

// Rule E: the index must hold LF, not CRLF or a mix of both.
function checkLineEndings(eolOutput) {
  const findings = [];
  for (const record of eolOutput.split("\0")) {
    const tab = record.indexOf("\t");
    if (tab === -1) continue;
    const meta = record.slice(0, tab);
    const file = record.slice(tab + 1);
    const indexToken = meta.split(" ").find((token) => token.startsWith("i/"));
    if (!indexToken) continue;
    const eol = indexToken.slice(2);
    if (eol === "crlf" || eol === "mixed") findings.push({ rule: "LINE ENDINGS", file, line: 1 });
  }
  return findings;
}

function main() {
  let tracked;
  let eolOutput;
  try {
    tracked = git(["ls-files", "-z"])
      .split("\0")
      .filter((file) => file !== "");
    eolOutput = git(["ls-files", "-z", "--eol"]);
  } catch (error) {
    console.error("repo checks failed: could not list tracked files.");
    console.error("Run `node scripts/check-repo.mjs` from the repo root, with git installed.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  const findings = [
    ...checkForbiddenFiles(tracked),
    ...checkSecrets(tracked),
    ...checkNulBytes(tracked),
    ...checkMigrations(tracked),
    ...checkLineEndings(eolOutput),
  ];

  const reported = new Set();
  for (const finding of findings) {
    const line = `${finding.rule} ${finding.file}:${finding.line}`;
    if (reported.has(line)) continue;
    reported.add(line);
    console.log(line);
  }

  if (reported.size > 0) {
    console.error(`${reported.size} problem${reported.size === 1 ? "" : "s"} found.`);
    process.exitCode = 1;
    return;
  }

  console.log("repo checks passed");
}

main();
