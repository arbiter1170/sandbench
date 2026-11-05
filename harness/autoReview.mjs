// Auto-review: which commands may run without an approval card. The page (planner turns) and
// the harness (driver turns) both import this file so the two paths cannot drift. It has no
// dependencies because the runner image ships `harness/` without the root node_modules.
//
// A rule is a command prefix the user saved under Studio > Auto-review. The default is to ask:
// a command skips the card only when it is positively validated. All of these must hold:
//   1. It is one simple command, using only letters, digits, spaces and `_ - . / : = +`. These
//      mean the same thing in PowerShell, bash and sh. Anything else always asks, including a
//      backslash, which is a path separator in PowerShell but an escape in a POSIX shell. The
//      page does not know which shell will run the command.
//   2. Its first word is a plain program name, not a path or `name.exe`.
//   3. No word names a location on the sensitive list.
//   4. A rule matches it word for word, either the whole command or a leading part of it. Only
//      the program name ignores case: `-d` and `-D` are different commands.
//   5. A rule that matches only a leading part counts only when the whole command fits that
//      program's entry below, flag by flag and argument by argument. A flag or an argument
//      shape that is not listed asks, so abbreviations and new options ask too. Paths must be
//      relative and canonical. git is not listed: a repository's own config or attributes can
//      make any git command run a program (core.fsmonitor, diff.external, a textconv driver),
//      and a folder with plain `HEAD`, `config`, `objects/` and `refs/` is a repository, so
//      nothing in the command text can show it is safe. A git command only skips the card under
//      a rule for exactly that command.
//
// What this does not establish, so this is a narrowing gate and not a sandbox:
//   - The program name is resolved by the shell: an entry earlier on PATH, or a PowerShell
//     profile, alias or function, runs instead.
//   - The sensitive list is best-effort. Under a `cat` rule, a secret in a file it does not
//     name is read, and a symlink inside the folder can lead outside it.
//   - An exact rule is taken literally apart from checks 1 to 3: it can use absolute paths, run
//     project code (`npm test` runs what `package.json` says at that moment), or run a git
//     command, with the repository-config risk above.
//   - It sees only what reaches it: a driver CLI's own read tools produce no request.

const SAFE = /^[A-Za-z0-9 _\-./:=+]+$/;
const PROGRAM = /^[A-Za-z][A-Za-z0-9_-]*$/;

// PowerShell provider paths, /proc and /etc, network shares and the usual credential files.
const SENSITIVE = [
  /^(-[A-Za-z]+:)?(env|variable|function|alias|cert|hklm|hkcu|hkey_[a-z_]+|wsman|registry):/i,
  /::/,
  /(^|[\\/])(proc|etc)([\\/]|$)/i,
  /^[\\/]dev([\\/]|$)/i,
  /^[\\/]{2}/,
  /secrets\.json|harness-token|credential|[._]npmrc|[._]netrc|pgpass|\.pypirc|\.vault-token|\.gitconfig|\.claude\.json|\.envrc|_history|id_(rsa|dsa|ecdsa|ed25519)|\.(pem|key|p12|pfx|keystore)$|(^|[\\/])appdata([\\/]|$)|(^|[\\/])\.(git|ssh|aws|gnupg|docker|kube|azure|sandbench|claude|grok|codex|config)\.*([\\/]|$)|\.env([-_.]|$)/i,
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

// Argument shapes.
const isNumber = (arg) => /^\d+$/.test(arg);
const isPlain = (arg) => /^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/.test(arg);
const isDate = (arg) => /^[A-Za-z0-9_][A-Za-z0-9_.:+-]*$/.test(arg);
// A canonical relative path, so the text can be checked as written. No empty, `.` or `..`
// segment, and no trailing dot, which Windows removes: `.env/.`, `a.key.` and `.git/./config`
// all open something the sensitive list would have named. No Windows device such as `CON`.
const isRelative = (arg) => {
  if (arg === ".") return true;
  if (!/^[A-Za-z0-9_.][A-Za-z0-9_./-]*$/.test(arg)) return false;
  return arg.split("/").every((part) => part && !part.endsWith(".") && !/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part));
};

/**
 * One program's validated form.
 *   flags: bare flags. values: flags that take the next word.
 *   counts: allows `-5`. positional: the shape of other words. max: how many of them.
 *   anyCase: PowerShell parameters ignore case; other programs' flags do not.
 */
function form({ flags = [], values = {}, counts = false, positional = null, min = 0, max = Infinity, anyCase = false }) {
  const key = (name) => (anyCase ? name.toLowerCase() : name);
  const flagSet = new Set(flags.map(key));
  const valueMap = new Map(Object.entries(values).map(([name, check]) => [key(name), check]));
  return (args) => {
    let used = 0;
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (flagSet.has(key(arg))) continue;
      if (valueMap.has(key(arg))) {
        index += 1;
        if (index >= args.length || !valueMap.get(key(arg))(args[index])) return false;
        continue;
      }
      if (arg.startsWith("-")) {
        if (counts && /^-\d+$/.test(arg)) continue;
        return false;
      }
      if (!positional || !positional(arg)) return false;
      used += 1;
      if (used > max) return false;
    }
    return used >= min;
  };
}

const paths = { positional: isRelative };
// With no file these read standard input, which nothing closes, so the turn would stall.
const files = { positional: isRelative, min: 1 };

const PROGRAMS = new Map(
  Object.entries({
    "get-childitem": form({ flags: ["-Recurse", "-File", "-Directory", "-Name"], values: { "-Path": isRelative, "-Filter": isPlain, "-Depth": isNumber }, ...paths, anyCase: true }),
    "get-date": form({ values: { "-Format": isDate }, anyCase: true }),
    "get-process": form({ values: { "-Name": isPlain, "-Id": isNumber }, positional: isPlain, anyCase: true }),
    "get-location": form({}),
    "get-content": form({ values: { "-Path": isRelative, "-TotalCount": isNumber, "-Tail": isNumber }, ...paths, anyCase: true }),
    "get-item": form({ values: { "-Path": isRelative }, ...paths, anyCase: true }),
    "get-psdrive": form({}),
    "test-path": form({ values: { "-Path": isRelative }, ...paths, anyCase: true }),
    "resolve-path": form({ values: { "-Path": isRelative }, ...paths, anyCase: true }),
    "select-string": (args) => args.some((arg) => arg.toLowerCase() === "-path") && form({ values: { "-Pattern": isPlain, "-Path": isRelative }, anyCase: true })(args),
    dir: form(paths),
    ls: form({ flags: ["-l", "-a", "-A", "-h", "-R", "-1", "-la", "-al", "-lh", "-lah", "-alh"], ...paths }),
    pwd: form({}),
    whoami: form({}),
    hostname: form({}),
    cat: form({ flags: ["-n"], ...files }),
    type: form(files),
    head: form({ values: { "-n": isNumber }, counts: true, ...files }),
    tail: form({ values: { "-n": isNumber }, counts: true, ...files }),
    wc: form({ flags: ["-l", "-w", "-c"], ...files }),
    echo: form({ positional: isPlain }),
  }),
);

/** True when the whole command fits a validated read-only form (rule 5 above). */
export function readOnlyCommand(words) {
  const [head, ...args] = words;
  const name = String(head ?? "").toLowerCase();
  const check = PROGRAMS.get(name);
  return Boolean(check) && check(args);
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
  const program = parts[0].toLowerCase();
  let prefix = false;
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (typeof rule !== "string") continue;
    const ruleWords = words(rule);
    if (!ruleWords.length || ruleWords.length > parts.length) continue;
    if (ruleWords[0].toLowerCase() !== program) continue;
    if (!ruleWords.every((part, index) => index === 0 || part === parts[index])) continue;
    // The bare name of a listed program is a shorter rule's job: bare `cat` would stall reading
    // standard input, so a `cat` rule does not make it exact.
    const bareListed = parts.length === 1 && PROGRAMS.has(program);
    if (ruleWords.length === parts.length && !bareListed) return { auto: true, why: "matches a rule exactly", rule };
    prefix = true;
  }
  if (!prefix) return { auto: false, why: "no rule matches" };
  if (readOnlyCommand(parts)) return { auto: true, why: "validated read-only command under a rule" };
  return { auto: false, why: "a rule matches only part of a command that is not validated as read-only" };
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
