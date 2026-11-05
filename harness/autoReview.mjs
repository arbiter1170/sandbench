// Auto-review: which commands may run without an approval card. The page (planner turns) and
// the harness (driver turns) both import this file so the two paths cannot drift. It has no
// dependencies because the runner image ships `harness/` without the root node_modules.
//
// A rule is a command prefix the user saved under Studio > Auto-review. A command skips the
// card only when all of these hold:
//   1. It is one simple command: only letters, digits, spaces and `_ - . / \ : = +`. Anything
//      else (pipes, chaining, redirects, quotes, `$` or `%` expansion, globs, `~`, braces,
//      PowerShell `@` splatting, `,` arrays, `#` comments, newlines) always asks. A backslash
//      only passes for a PowerShell cmdlet, where it is a literal path separator; a POSIX
//      shell removes it after this review, so `cat .e\nv` would read `.env`.
//   2. Its first word is a plain program name, not a path or `name.exe`.
//   3. A rule matches it word for word, either the whole command or a leading part of it. Only
//      the program name ignores case: `-d` and `-D` are different commands.
//   4. A rule that matches only a leading part counts only when the full command is on the
//      read-only list below. So `git` covers `git status` but never `git push`, and `npm`
//      covers nothing but the bare word `npm`; save `npm test` to allow exactly that.
// This is a heuristic gate in front of the approval card, not a sandbox. The sensitive list and
// the risky options are best-effort lists, so a read-only command can still reach something
// they miss. A read-only git command also still runs whatever the repository's own config
// (hooks such as core.fsmonitor, an external diff tool) tells git to run.

const SAFE = /^[A-Za-z0-9 _\-./\\:=+]+$/;
const PROGRAM = /^[A-Za-z][A-Za-z0-9_-]*$/;
const CMDLET = /^[A-Za-z]+-[A-Za-z]+$/;
// PowerShell provider paths other than plain file paths, /proc, UNC shares and the usual
// credential files can leak secrets to the model even through a read-only command.
const SENSITIVE = [
  /^(-[A-Za-z]+:)?(env|variable|function|alias|cert|hklm|hkcu|hkey_[a-z_]+|wsman|registry):/i,
  /::/,
  /(^|[\\/])(proc|etc)([\\/]|$)/i,
  /^[\\/]{2}/,
  /secrets\.json|harness-token|credential|\.npmrc|\.netrc|\.pgpass|\.pypirc|\.vault-token|\.gitconfig|\.claude\.json|\.envrc|id_(rsa|dsa|ecdsa|ed25519)|\.(pem|key|p12|pfx|keystore)$|(^|[\\/])\.git[\\/]config|(^|[\\/])\.(ssh|aws|gnupg|docker|kube|azure|sandbench|claude|grok|codex|config)\.*([\\/]|$)|\.env(\.|$)/i,
];

// A path can be attached to a parameter name, a revision or a short flag (`-Path:.env`,
// `HEAD:.env`, `--files0-from=.env`, `-f.env`), so a word is also read from after every `:` and
// `=`, and a short-flag word from each of its letters.
function wordForms(word) {
  const forms = [word];
  for (let index = 0; index < word.length; index += 1) {
    if (word[index] === ":" || word[index] === "=") forms.push(word.slice(index + 1));
  }
  if (/^-[^-]/.test(word)) for (let index = 1; index < word.length; index += 1) forms.push(word.slice(index));
  return forms;
}

function touchesSensitive(word) {
  return wordForms(word).some((form) => SENSITIVE.some((pattern) => pattern.test(form)));
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

// Options that make an otherwise read-only git command write a file, run a program, reach the
// network or read past the tracked tree. Git also accepts any unambiguous prefix of a long
// option (`--open=prog`) and short flags run together (`-iOprog`), so those spellings count too.
// A harmless option that is a prefix of a risky one (`--text`) asks as well; that errs on the
// side of a card.
const GIT_RISKY_LONG = [
  "--output",
  "--ext-diff",
  "--textconv",
  "--exec",
  "--upload-pack",
  "--receive-pack",
  "--open-files-in-pager",
  "--no-index",
  "--untracked",
  "--no-exclude-standard",
  "--help",
  "--show-signature",
];
// `git diff` silently compares files directly when a path is outside the repository.
const OUTSIDE_REPO = /^([\\/]|[A-Za-z]:[\\/])|(^|[\\/])\.\.([\\/]|$)/;

function gitRisky(arg) {
  if (wordForms(arg).some((form) => OUTSIDE_REPO.test(form))) return true;
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
  // `git remote -v` prints any token stored in a remote's URL.
  if (sub === "remote") return rest.length === 0;
  return false;
}

// Read-only programs whose arguments can change what they do.
function argsAreReadOnly(name, args) {
  if (name === "hostname") return args.length === 0;
  // `-ComputerName` (and its abbreviations and alias) reaches another machine.
  if (name === "get-process") return args.every((arg) => !arg.startsWith("-") || /^-(name|id)$/i.test(arg));
  return true;
}

/** True when the whole command is a known read-only form (rule 4 above). */
export function readOnlyCommand(words) {
  const [head, ...args] = words;
  const name = String(head ?? "").toLowerCase();
  if (name === "git") return gitReadOnly(args);
  return READ_ONLY.has(name) && argsAreReadOnly(name, args);
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
  if (text.includes("\\") && !CMDLET.test(parts[0])) return { auto: false, why: "a backslash outside a PowerShell cmdlet" };
  if (parts.some(touchesSensitive)) return { auto: false, why: "touches a sensitive location" };
  const program = parts[0].toLowerCase();
  let prefix = false;
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (typeof rule !== "string") continue;
    const ruleWords = words(rule);
    if (!ruleWords.length || ruleWords.length > parts.length) continue;
    if (ruleWords[0].toLowerCase() !== program) continue;
    if (!ruleWords.every((part, index) => index === 0 || part === parts[index])) continue;
    if (ruleWords.length === parts.length) return { auto: true, why: "matches a rule exactly", rule };
    prefix = true;
  }
  if (!prefix) return { auto: false, why: "no rule matches" };
  if (readOnlyCommand(parts)) return { auto: true, why: "read-only command under a rule" };
  return { auto: false, why: "a rule matches only part of a command that can change things" };
}

// Shell tools whose permission requests carry a shell command line. Every other tool (Claude
// Code's Write, Edit, WebFetch, MCP tools, ...) is described as "<Tool> <target>" and always
// gets a card, whatever the rules say. The codex and grok drivers label every request with
// their own name, including file changes and other tools, so they always get a card too.
const SHELL_TOOLS = new Set(["bash", "powershell"]);

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
