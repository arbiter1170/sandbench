import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeRule, reviewCommand, reviewPermission } from "../autoReview.mjs";

const DEFAULTS = ["Get-ChildItem", "Get-Date", "Get-Process", "Get-Location", "dir", "ls", "pwd"];
const auto = (command, rules = DEFAULTS) => reviewCommand(command, rules).auto;

test("the default rules still cover the harmless commands they were meant for", () => {
  for (const command of [
    "Get-Date",
    "get-date -Format yyyy-MM-dd",
    "Get-ChildItem -Recurse -Filter package.json",
    "Get-ChildItem C:\\Users\\me\\Documents",
    "Get-Process",
    "Get-Location",
    "dir /s",
    "ls -la src",
    "pwd",
  ]) {
    assert.equal(auto(command), true, command);
  }
});

test("a command-name rule does not cover subcommands that change things", () => {
  const rules = ["git", "npm", "Remove-Item", "node", "docker"];
  for (const command of ["git status", "git status --porcelain", "git log -n 5 --oneline", "git diff HEAD", "git branch", "git branch -a", "git tag -l", "git remote"]) {
    assert.equal(auto(command, rules), true, command);
  }
  for (const command of [
    "git push",
    "git push origin main",
    "git push --force origin main",
    "git commit -m wip",
    "git reset --hard HEAD",
    "git clean -fdx",
    "git checkout -- .",
    "git stash",
    "git branch -D main",
    "git branch new-branch",
    "git tag v1",
    "git remote add x https://example.test/x.git",
    "git config core.pager less",
    "npm install",
    "npm test",
    "node script.js",
    "docker run image",
    "Remove-Item -Recurse build",
  ]) {
    assert.equal(auto(command, rules), false, command);
  }
});

test("git options that run programs, write files or switch repositories always ask", () => {
  const rules = ["git"];
  for (const command of [
    "git -c core.pager=calc log",
    "git -C ../other status",
    "git --git-dir=/tmp/x status",
    "git --exec-path=/tmp log",
    "git diff --output=/tmp/out",
    "git diff --ext-diff",
    "git log --textconv",
    "git grep -Oevil x",
    "git grep --open-files-in-pager=evil x",
    "git log --exec=evil",
    "git log --upload-pack=evil",
  ]) {
    assert.equal(auto(command, rules), false, command);
  }
});

test("git expands abbreviated options and clustered flags, so those spellings of a risky option ask too", () => {
  // `--open` and `-iO` ran a program on real git 2.52 under only a `git` rule. The rest are
  // spellings of the same risky options; `--text` is harmless but errs on the side of a card.
  for (const command of [
    "git grep --open=evil x",
    "git grep --open-files=evil x",
    "git grep --op=evil x",
    "git grep -iOevil x",
    "git grep -nOevil x",
    "git grep -ivOevil x",
    "git log -p --outpu=out",
    "git show HEAD --outp=out",
    "git diff HEAD --ext-dif",
    "git diff HEAD --text",
  ]) {
    assert.equal(auto(command, ["git"]), false, command);
  }
  // Ordinary read-only options that only look close must keep working.
  for (const command of ["git log --oneline", "git log -n 5 --stat", "git grep -in needle", "git diff --name-only HEAD", "git show --stat HEAD", "git log --format=short"]) {
    assert.equal(auto(command, ["git"]), true, command);
  }
});

test("a sensitive path still asks when it is attached to a parameter name or a revision", () => {
  const rules = ["Get-Content", "Test-Path", "git", "cat", "wc"];
  for (const command of [
    "Get-Content -Path:.env",
    "Get-Content -LiteralPath:.ssh/id_rsa",
    "Test-Path -Path:\\\\host\\share",
    "git show HEAD:.env",
    "git show HEAD:deploy/.env",
    "wc --files0-from=.env",
  ]) {
    assert.equal(auto(command, rules), false, command);
  }
  for (const command of ["Get-Content -Path:notes.txt", "git show HEAD:src/App.tsx", "Get-Content C:\\Users\\me\\notes.txt"]) {
    assert.equal(auto(command, rules), true, command);
  }
});

test("the credential stores of the tools this app drives ask", () => {
  for (const command of ["cat .sandbench/config", "cat C:\\Users\\me\\.sandbench\\workspace.json", "cat .claude/.credentials.json", "cat .config/gh/hosts.yml", "cat id_rsa", "cat .ssh./id_rsa"]) {
    assert.equal(auto(command, ["cat"]), false, command);
  }
});

test("a backslash asks outside PowerShell cmdlets, because a POSIX shell removes it after the review", () => {
  // Each of the first eight ran a program, wrote a file or read a fake secret under bash and sh.
  for (const command of [
    "cat .e\\nv",
    "cat secrets.js\\on",
    "cat /pr\\oc/self/environ",
    "cat .s\\sh/id_r\\sa",
    "git grep \\-O./evil x",
    "git grep --open\\=./evil x",
    "git log \\--output=out",
    "git log --outp\\ut=out",
    "dir src\\sub",
    "cat C:\\Users\\me\\notes.txt",
  ]) {
    assert.equal(auto(command, ["git", "cat", "dir"]), false, command);
  }
  assert.equal(auto("Get-Content C:\\Users\\me\\notes.txt", ["Get-Content"]), true);
});

test("git commands that read outside the tracked tree or print remote credentials ask", () => {
  for (const command of [
    "git grep --no-index -e .",
    "git grep --no-i -e .",
    "git grep --untracked --no-exclude-standard -e x",
    "git grep --untracked -e x",
    "git diff --no-index empty home",
    "git diff a ../outside",
    "git diff a /etc/hosts",
    "git diff a C:/Users/me",
    "git log -- ../outside",
    "git grep -f /tmp/patterns x",
    "git grep -f.env x",
    "git grep -if.env x",
    "git grep -f.ssh/x y",
    "git grep -if.ssh/x y",
    "git grep -f/tmp/patterns x",
    "git grep -if../patterns x",
    "git remote -v",
    "git remote --verbose",
    "git log --help",
    "git log --show-signature",
  ]) {
    assert.equal(auto(command, ["git"]), false, command);
  }
  for (const command of ["git remote", "git log HEAD..main", "git diff HEAD src/App.tsx", "git status", "git branch --show-current", "git rev-parse --show-toplevel"]) {
    assert.equal(auto(command, ["git"]), true, command);
  }
});

test("PowerShell provider paths and remote parameters ask, under the default rules too", () => {
  const rules = [...DEFAULTS, "Get-Content", "Get-Item", "Test-Path"];
  for (const command of [
    "Get-ChildItem Environment::",
    "Get-Content Environment::SB_FAKE",
    "Get-Item Microsoft.PowerShell.Core\\Environment::SB_FAKE",
    "Test-Path Microsoft.PowerShell.Core\\Registry::HKEY_CURRENT_USER\\Console",
    "Test-Path Microsoft.PowerShell.Security\\Certificate::CurrentUser",
    "Test-Path FileSystem::/\\192.0.2.1\\x",
    "Get-ChildItem /\\192.0.2.1\\x",
    "Get-Process -ComputerName 192.0.2.1",
    "Get-Process -cn 192.0.2.1",
    "Get-Process -Module",
  ]) {
    assert.equal(auto(command, rules), false, command);
  }
  for (const command of ["Get-Process", "Get-Process node", "Get-Process -Name node", "Get-Process -Id 42"]) {
    assert.equal(auto(command, rules), true, command);
  }
});

test("each credential location asks, including the stores of every driver", () => {
  for (const path of [
    ".grok/auth.json",
    ".codex/auth.json",
    ".claude/settings.json",
    ".claude.json",
    ".git/config",
    ".gitconfig",
    ".pgpass",
    ".pypirc",
    ".vault-token",
    ".envrc",
    "prod.env",
    "server.pem",
    "server.key",
    "cert.p12",
    ".config/git/credentials",
    ".config/gcloud/application_default_credentials.json",
    ".config/configstore/firebase-tools.json",
    "/etc/shadow",
    ".npmrc",
    ".netrc",
    ".gnupg/key",
    ".docker/config.json",
    ".kube/config",
    ".azure/token",
    "id_ed25519",
  ]) {
    assert.equal(auto(`cat ${path}`, ["cat"]), false, path);
  }
  for (const drive of ["function:", "alias:", "hkcu:", "HKEY_USERS:", "wsman:", "registry:"]) {
    assert.equal(auto(`Get-ChildItem ${drive}`, ["Get-ChildItem"]), false, drive);
  }
  assert.equal(auto("cat docs/keys-and-tokens.md", ["cat"]), true);
});

test("a read-only program with a side effect in its arguments asks", () => {
  assert.equal(auto("hostname", ["hostname"]), true);
  assert.equal(auto("hostname evil", ["hostname"]), false);
});

test("arguments match case-sensitively, because -d and -D are different commands", () => {
  assert.equal(auto("git branch -D feature", ["git branch -d feature"]), false);
  assert.equal(auto("git branch -d feature", ["git branch -d feature"]), true);
  assert.equal(auto("git checkout -B main", ["git checkout -b main"]), false);
  assert.equal(auto("NPM test", ["npm test"]), true, "the program name may differ in case");
  assert.equal(auto("git status", ["GIT"]), true);
});

test("codex and grok requests always ask, because their requests can be file changes or other tools", () => {
  for (const [command, tool, rule] of [
    ["edit src/a.ts", "codex", "edit src/a.ts"],
    ["shell", "codex", "shell"],
    ["git status", "codex", "git"],
    ["Write notes.txt", "grok", "Write notes.txt"],
    ["ls", "grok", "ls"],
  ]) {
    assert.equal(reviewPermission({ command, tool }, [rule]).auto, false, `${tool}: ${command}`);
  }
});

test("git branch, tag and remote only auto-run when they only list", () => {
  for (const command of ["git branch -l -D main", "git branch -a new", "git tag -n3 new", "git remote add x http:/a", "git remote show origin", "--status", "git --version"]) {
    assert.equal(auto(command, ["git", "--status"]), false, command);
  }
});

test("compounds, redirects, substitution and expansion always ask, on POSIX and Windows shells", () => {
  const rules = [...DEFAULTS, "git", "echo", "cat"];
  for (const command of [
    "Get-Date; Remove-Item -Recurse C:\\",
    "Get-Date && del x",
    "Get-Date || del x",
    "Get-Date & calc",
    "Get-Date | Out-File x",
    "ls > out.txt",
    "ls >> out.txt",
    "cat < secret",
    "echo `whoami`",
    "echo $(whoami)",
    "echo $HOME",
    "echo $env:USERNAME",
    "echo %USERPROFILE%",
    "echo ${x}",
    "Get-ChildItem @args",
    "Get-ChildItem (Remove-Item x)",
    "Get-ChildItem {Remove-Item x}",
    "Get-ChildItem a,b",
    "echo 'quoted'",
    'echo "quoted"',
    "ls *",
    "ls ~",
    "ls ?",
    "ls [a]",
    "Get-Date # comment",
    "git log HEAD~1",
    "git log HEAD^",
    "pwd\nrm -rf /",
    "pwd\r\ndel x",
    "pwd\tx",
    "Get-Date \u2013Format x",
    "ls \u00a0-la",
  ]) {
    assert.equal(auto(command, rules), false, JSON.stringify(command));
  }
});

test("the program must be a plain name: paths, .exe and look-alikes ask", () => {
  for (const command of ["./ls", "C:\\tools\\ls", "/bin/ls", "ls.exe", "pwd.cmd", "..\\pwd", "-ls"]) {
    assert.equal(auto(command, ["ls", "pwd"]), false, command);
  }
});

test("read-only commands that would expose secrets or other machines ask", () => {
  const rules = ["Get-ChildItem", "Get-Content", "Get-Item", "cat", "ls", "type"];
  for (const command of [
    "Get-ChildItem env:",
    "Get-Item env:ANTHROPIC_API_KEY",
    "Get-Content -Path:env:XAI_API_KEY",
    "Get-ChildItem Variable:",
    "Get-ChildItem HKLM:\\Software",
    "Get-ChildItem Cert:\\CurrentUser",
    "cat /proc/self/environ",
    "Get-ChildItem \\\\server\\share",
    "ls //server/share",
    "Get-Content C:\\Users\\me\\.sandbench\\secrets.json",
    "cat .harness-token",
    "type C:\\Users\\me\\.git-credentials",
    "cat .env",
    "cat .env.local",
    "ls .ssh",
    "Get-Content C:\\Users\\me\\.aws\\credentials",
  ]) {
    assert.equal(auto(command, rules), false, command);
  }
  assert.equal(auto("Get-Content README.md", rules), true);
  assert.equal(auto("cat docs/environment.md", rules), true);
});

test("an exact rule allows exactly that command and nothing longer", () => {
  assert.equal(auto("npm test", ["npm test"]), true);
  assert.equal(auto("NPM TEST", ["npm test"]), false);
  assert.equal(auto("npm test -- --watch", ["npm test"]), false);
  assert.equal(auto("npm", ["npm"]), true);
  assert.equal(auto("npm install", ["npm"]), false);
  assert.equal(auto("git push", ["git push"]), true, "an explicit exact rule is taken literally");
  assert.equal(auto("git push --force", ["git push"]), false);
  assert.equal(auto("npm test; rm -rf /", ["npm test"]), false);
});

test("no rules, non-string rules and empty commands never auto-run", () => {
  assert.equal(auto("pwd", []), false);
  assert.equal(auto("pwd", [null, 3, {}, ""]), false);
  assert.equal(auto("", DEFAULTS), false);
  assert.equal(auto("   ", DEFAULTS), false);
  assert.equal(reviewCommand("pwd", undefined).auto, false);
});

test("non-shell tool requests from a driver always ask, even when the rule names the tool", () => {
  for (const tool of ["Write", "Edit", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch", "mcp__fs__write"]) {
    assert.equal(reviewPermission({ command: `${tool} notes.txt`, tool }, [tool, `${tool} notes.txt`]).auto, false, tool);
  }
  assert.equal(reviewPermission({ command: "git status", tool: "Bash" }, ["git"]).auto, true);
  assert.equal(reviewPermission({ command: "Get-Date", tool: "PowerShell" }, ["Get-Date"]).auto, true);
  assert.equal(reviewPermission({ command: "git push", tool: "Bash" }, ["git"]).auto, false);
  assert.equal(reviewPermission({ command: "git status" }, ["git"]).auto, true, "the http and anthropic drivers send no tool");
  assert.equal(reviewPermission({ command: "edit src/a.ts", tool: "codex" }, ["edit"]).auto, false);
});

test("rules typed in Studio keep every word so they can be specific", () => {
  assert.equal(normalizeRule("  npm   test "), "npm test");
  assert.equal(normalizeRule("Get-Content"), "Get-Content");
  assert.equal(normalizeRule("git status; rm -rf /"), "");
  assert.equal(normalizeRule("./script"), "");
  assert.equal(normalizeRule(""), "");
});
