// Auto-review: which commands may run without an approval card. The page (planner turns) and
// the harness (driver turns) both import this file so the two paths cannot drift. It has no
// dependencies because the runner image ships `harness/` without the root node_modules.
//
// A rule is a command prefix the user saved under Studio > Auto-review. A command skips the
// card only when all of these hold:
//   1. It is one simple command: only letters, digits, spaces and `_ - . / \ : = +`. Anything
//      else (pipes, chaining, redirects, quotes, `$` or `%` expansion, globs, `~`, braces,
//      PowerShell `@` splatting, `,` arrays, `#` comments, newlines) always asks.
//   2. Its first word is a plain program name, not a path or `name.exe`.
//   3. A rule matches it word for word (case-insensitive), either the whole command or a
//      leading part of it.
//   4. A rule that matches only a leading part counts only when the full command is on the
//      read-only list below. So `git` covers `git status` but never `git push`, and `npm`
//      covers nothing but the bare word `npm`; save `npm test` to allow exactly that.
// This is a heuristic gate in front of the approval card, not a sandbox: a read-only git
// command still runs whatever the repository's own config (hooks such as core.fsmonitor, an
// external diff tool) tells git to run.

const SAFE = /^[A-Za-z0-9 _\-./\\:=+]+$/;
const PROGRAM = /^[A-Za-z][A-Za-z0-9_-]*$/;
// PowerShell provider drives other than the file system, /proc, UNC shares and the usual
// credential files can leak secrets to the model even through a read-only command.
const SENSITIVE = [
  /^(-[A-Za-z]+:)?(env|variable|function|alias|cert|hklm|hkcu|hkey_[a-z_]+|wsman|registry):/i,
  /(^|[\\/])proc([\\/]|$)/i,
  /^(\\\\|\/\/)/,
  /secrets\.json|harness-token|\.git-credentials|\.credentials\.json|\.npmrc|\.netrc|id_(rsa|dsa|ecdsa|ed25519)|(^|[\\/])\.(ssh|aws|gnupg|docker|kube|azure|sandbench)\.*([\\/]|$)|(^|[\\/])\.config[\\/]gh([\\/]|$)|(^|[\\/])\.env(\.|$)/i,
];

// A path can be attached to a parameter name or a revision (`-Path:.env`, `HEAD:.env`,
// `--files0-from=.env`), so each word is also checked from after every `:` and `=`.
function touchesSensitive(word) {
  const forms = [word];
  for (let index = 0; index < word.length; index += 1) {
    if (word[index] === ":" || word[index] === "=") forms.push(word.slice(index + 1));
  }
  return forms.some((form) => SENSITIVE.some((pattern) => pattern.test(form)));
}

const READ_ONLY = new Set(
  [
    "Get-ChildItem",
    "Get-Date",
    "Get-Process",
    "Get-Location",
    "Get-Content",
    "Get-Item",
    "Get-PSDrive",
    "Test-Path",
    "Resolve-Path",
    "Select-String",
    "dir",
    "ls",
    "pwd",
    "whoami",
    "hostname",
    "cat",
    "type",
    "head",
    "tail",
    "wc",
    "echo",
  ].map((name) => name.toLowerCase()),
);

// Options that make an otherwise read-only git command write a file, run a program or reach
// the network. Git also accepts any unambiguous prefix of a long option (`--open=prog`) and
// short flags run together (`-iOprog`), so those spellings count too. A harmless option that
// is a prefix of a risky one (`--text`) asks as well; that errs on the side of a card.
const GIT_RISKY_LONG = ["--output", "--ext-diff", "--textconv", "--exec", "--upload-pack", "--receive-pack", "--open-files-in-pager"];

function gitRisky(arg) {
  if (!arg.startsWith("--")) return /^-[A-Za-z0-9]*O/.test(arg);
  const name = arg.split("=")[0];
  return name !== "--" && GIT_RISKY_LONG.some((risky) => risky.startsWith(name) || name.startsWith(risky));
}

const GIT_ANY_ARGS = new Set(["status", "log", "diff", "show", "rev-parse", "ls-files", "describe", "blame", "shortlog", "grep"]);
const GIT_BRANCH_FLAGS = new Set(["-a", "--all", "-r", "--remotes", "-v", "-vv", "--verbose", "-l", "--list", "--show-current", "--merged", "--no-merged", "--contains", "--no-contains", "--no-color"]);
const GIT_TAG_FLAGS = new Set(["-l", "--list", "--merged", "--no-merged", "--contains", "--no-contains", "--points-at"]);

function listOnly(args, flags) {
  const listing = args.includes("-l") || args.includes("--list");
  return args.every((arg) => {
    if (!arg.startsWith("-")) return listing;
    const name = arg.split("=")[0];
    return flags.has(name) || /^--sort=/.test(arg) || /^-n\d*$/.test(arg) || /^--format=/.test(arg);
  });
}

function gitReadOnly(args) {
  const [sub, ...rest] = args;
  // Options before the subcommand (-c, -C, --git-dir, --exec-path, ...) change what runs.
  if (!sub || sub.startsWith("-")) return false;
  if (rest.some(gitRisky)) return false;
  if (GIT_ANY_ARGS.has(sub)) return true;
  if (sub === "branch") return listOnly(rest, GIT_BRANCH_FLAGS);
  if (sub === "tag") return listOnly(rest, GIT_TAG_FLAGS);
  if (sub === "remote") return rest.every((arg) => arg === "-v" || arg === "--verbose");
  return false;
}

/** True when the whole command is a known read-only form (rule 4 above). */
export function readOnlyCommand(words) {
  const [head, ...args] = words;
  const name = String(head ?? "").toLowerCase();
  if (name === "git") return gitReadOnly(args);
  return READ_ONLY.has(name);
}

function words(text) {
  return String(text ?? "").trim().split(/ +/).filter(Boolean);
}

/**
 * Decide whether `command` may run without a card under `rules`.
 * Returns `{ auto, why, rule? }`; `why` is a short reason for tests and logs.
 */
export function reviewCommand(command, rules) {
  const text = String(command ?? "").trim();
  if (!text) return { auto: false, why: "empty" };
  if (!SAFE.test(text)) return { auto: false, why: "not a single simple command" };
  const parts = words(text);
  if (!PROGRAM.test(parts[0])) return { auto: false, why: "program is a path or file name" };
  if (parts.some(touchesSensitive)) return { auto: false, why: "touches a sensitive location" };
  const lower = parts.map((part) => part.toLowerCase());
  let prefix = false;
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (typeof rule !== "string") continue;
    const ruleWords = words(rule).map((part) => part.toLowerCase());
    if (!ruleWords.length || ruleWords.length > lower.length) continue;
    if (!ruleWords.every((part, index) => part === lower[index])) continue;
    if (ruleWords.length === lower.length) return { auto: true, why: "matches a rule exactly", rule };
    prefix = true;
  }
  if (!prefix) return { auto: false, why: "no rule matches" };
  if (readOnlyCommand(parts)) return { auto: true, why: "read-only command under a rule" };
  return { auto: false, why: "a rule matches only part of a command that can change things" };
}

// Shell tools whose permission requests carry a shell command line. Every other tool (Claude
// Code's Write, Edit, WebFetch, MCP tools, ...) is described as "<Tool> <target>" and always
// gets a card, whatever the rules say.
const SHELL_TOOLS = new Set(["bash", "powershell", "codex", "grok"]);

/** The harness gate for one driver permission request. */
export function reviewPermission({ command, tool }, rules) {
  if (tool !== undefined && tool !== null && tool !== "" && !SHELL_TOOLS.has(String(tool).toLowerCase())) {
    return { auto: false, why: `${tool} is not a shell command` };
  }
  return reviewCommand(command, rules);
}

/** Normalize a rule typed in Studio > Auto-review: collapse spaces; empty when unusable. */
export function normalizeRule(text) {
  const parts = words(text);
  if (!parts.length || !SAFE.test(parts.join(" ")) || !PROGRAM.test(parts[0])) return "";
  return parts.join(" ");
}
