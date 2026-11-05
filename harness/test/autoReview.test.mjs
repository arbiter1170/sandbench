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
  for (const command of ["git status", "git status --porcelain", "git log -n 5 --oneline", "git diff HEAD", "git branch", "git branch -a", "git tag -l", "git remote -v"]) {
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
  assert.equal(auto("NPM TEST", ["npm test"]), true);
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
