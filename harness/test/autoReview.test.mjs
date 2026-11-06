import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeRule, readOnlyCommand, reviewCommand, reviewPermission } from "../autoReview.mjs";

const DEFAULTS = ["Get-ChildItem", "Get-Date", "Get-Process", "Get-Location", "dir", "ls", "pwd"];
const auto = (command, rules = DEFAULTS) => reviewCommand(command, rules).auto;

test("the default rules still cover the harmless commands they were meant for", () => {
  for (const command of [
    "Get-Date",
    "get-date -Format yyyy-MM-dd",
    "Get-ChildItem -Recurse -Filter package.json",
    "Get-ChildItem src/components",
    "Get-Process",
    "Get-Location",
    "dir src",
    "ls src",
    "pwd",
  ]) {
    assert.equal(auto(command), true, command);
  }
});

test("a command-name rule does not cover subcommands that change things", () => {
  const rules = ["git", "npm", "Remove-Item", "node", "docker"];
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
  for (const command of ["Get-Content notes.txt", "Get-Content -Path notes.txt"]) {
    assert.equal(auto(command, rules), true, command);
  }
});

test("under a shorter rule, an argument that is not positively validated asks", () => {
  const rules = ["git", "cat", "ls", "dir", "head", "tail", "wc", "echo", "type", "pwd", "whoami", "hostname", "Get-ChildItem", "Get-Content", "Get-Item", "Get-Date", "Get-Location", "Get-PSDrive", "Test-Path", "Resolve-Path", "Select-String"];
  for (const command of [
    // Absolute paths, parent directories and drive-qualified paths leave the working folder.
    "cat /home/me/notes.txt",
    "cat C:/Users/me/notes.txt",
    "cat ../notes.txt",
    "cat src/../../notes.txt",
    "Get-ChildItem C:/Users/me/Documents",
    "ls /",
    // Abbreviated or attached parameters.
    "Get-Content -Pa notes.txt",
    "Get-Content -Path:notes.txt",
    "Get-ChildItem -Rec",
    "Select-String -Patt x -Path notes.txt",
    "Get-Date -Date 2020",
    "Get-Location -Stack",
    "Get-PSDrive -Name x",
    "Test-Path -PathType Leaf x",
    // Flags no one has reviewed.
    "cat -",
    "ls --color=always",
    "tail -f notes.txt",
    "head -c 5 notes.txt",
    "wc --files0-from=notes.txt",
    "echo -e x",
    "pwd -P",
    "whoami /all",
    "type -a ls",
    // git options and shapes outside the list.
    "git log --unknown-option",
    "git log -S needle",
    "git log --max-count=x",
    "git status --unknown",
    "git diff HEAD src/App.tsx",
    "git diff a b",
    "git diff --unknown HEAD",
    "git grep -e .. x",
    "git shortlog HEAD",
    "git blame -L 1 notes.txt",
    "git describe --match x",
    "git ls-files --others",
    "git rev-parse --parseopt",
    "git show HEAD HEAD",
    "git show ../x",
    "git show HEAD:../x",
    "git show HEAD:/abs",
    "git show HEAD:a:b",
    "git show :notes.txt",
    // Windows device names are not files.
    "cat CON",
    "cat nul",
    "Get-Content PRN.txt",
    "type src/aux",
    "tail COM1",
    "wc lpt9.log",
    "git branch --contains x",
    "git tag --sort=x",
  ]) {
    assert.equal(auto(command, rules), false, command);
  }
  // An exact rule is the user's own word for word choice, and is still taken literally.
  assert.equal(auto("git log --unknown-option", ["git log --unknown-option"]), true);
  assert.equal(auto("cat /home/me/notes.txt", ["cat /home/me/notes.txt"]), true);
  // Flags keep their case outside PowerShell, whose parameters ignore it.
  assert.equal(auto("ls -LA", ["ls"]), false);
  assert.equal(auto("get-childitem -RECURSE", ["Get-ChildItem"]), true);
});

test("path spellings that normalize to something else ask", () => {
  for (const command of [
    // Found by review: each printed a fake token or key.
    "cat .git/./config",
    "cat .git//config",
    "tail .git/hooks/../config",
    "Get-Content .git./config",
    "cat .git/HEAD",
    "Get-Content .env/.",
    "Get-Content .env/x/..",
    "Select-String -Pattern x -Path .env/.",
    "Get-Content a.key.",
    "cat server.pem...",
    "Get-Content server.pem/x/..",
    // Other non-canonical spellings of a path.
    "cat ./notes.txt",
    "cat src/./notes.txt",
    "cat src//notes.txt",
    "ls src/",
    "cat notes.txt.",
    "cat /dev/fd/../environ",
    "ls /dev/fd/../../",
  ]) {
    assert.equal(auto(command, ["cat", "tail", "ls", "Get-Content", "Select-String"]), false, command);
  }
  assert.equal(auto("cat /dev/fd/../environ", ["cat /dev/fd/../environ"]), false, "not even as an exact rule");
  assert.equal(auto("ls .", ["ls"]), true);
  assert.equal(auto("cat .gitignore", ["cat"]), true);
});

test("git forms that print file contents ask, because a tracked secret has no recognizable name", () => {
  for (const command of [
    "git grep -n FAKE",
    "git grep needle",
    "git grep -e needle",
    "git log -p -1",
    "git log --patch",
    "git show",
    "git show HEAD",
    "git show 336709932309ea097397544f1377e5b6164c58f7",
    "git show --stat 336709932309ea097397544f1377e5b6164c58f7",
    "git show --oneline HEAD",
    "git diff",
    "git diff HEAD",
    "git diff --cached",
    "git diff notes.txt",
    "git diff notes.txt pgpass.conf",
    "git diff --stat a b",
    "git diff --name-only a b",
    "git blame notes.txt",
    "git blame --contents=notes.txt a.txt",
    "git ls-files -s",
  ]) {
    assert.equal(auto(command, ["git"]), false, command);
  }
});

test("a rule for git, or for part of a git command, covers no git command but itself", () => {
  // A repository's own config can make any git command run a program, and a folder with plain
  // HEAD, config, objects/ and refs/ is a repository: nothing in the command text shows it.
  const commands = [
    "git status",
    "git status --short",
    "git log",
    "git log --oneline",
    "git log -n 5 --stat",
    "git log HEAD..main",
    "git diff --stat HEAD",
    "git diff --name-only HEAD",
    "git show --stat HEAD",
    "git show HEAD:src/App.tsx",
    "git branch",
    "git branch -a",
    "git branch --show-current",
    "git tag -l",
    "git remote",
    "git rev-parse --show-toplevel",
    "git ls-files src",
    "git describe --tags",
  ];
  for (const command of commands) {
    assert.equal(auto(command, ["git"]), false, command);
    assert.equal(auto(command, [command.split(" ").slice(0, 2).join(" ")]) && command.split(" ").length > 2, false, `subcommand rule: ${command}`);
    assert.equal(auto(command, [command]), true, `exact: ${command}`);
  }
  assert.equal(auto("git log --oneline", ["git log"]), false);
});

test("a pattern search asks in every form, because its results reveal what a file holds", () => {
  // Issuing only these, a review script recovered a whole tracked secret, one guess at a time.
  for (const command of ["git grep -l FAKEabc", "git grep -l -e FAKEabc", "git grep -c -e FAKEabc 7cacd33", "git grep -c FAKE blobtag", "git grep --count x", "git grep --files-with-matches x", "git grep -l -i x src"]) {
    assert.equal(auto(command, ["git"]), false, command);
  }
});

test("slash forms of dir ask: no shell here is cmd.exe, so they are root-level paths", () => {
  for (const command of ["dir /s", "dir /b", "dir /w", "dir /b src"]) assert.equal(auto(command), false, command);
});

test("a program that would read standard input with no file asks, because it stalls the turn", () => {
  for (const command of ["cat", "cat -n", "head", "head -n 1", "tail", "tail -1", "wc", "wc -l", "Select-String -Pattern x"]) {
    assert.equal(auto(command, [command.split(" ")[0]]), false, command);
    // Not even under a rule for exactly that command.
    assert.deepEqual(reviewCommand(command, [command]), { auto: false, why: "would read standard input" }, command);
  }
  // With a file they read the file.
  for (const command of ["cat notes.txt", "head -n 1 notes.txt", "tail -1 notes.txt", "wc -l notes.txt", "Select-String -Pattern x -Path notes.txt"]) {
    assert.equal(auto(command, [command]), true, command);
  }
});

test("forms that fail in PowerShell ask instead of skipping the card and then erroring", () => {
  // `ls` and `cat` are Get-ChildItem and Get-Content there, and `type` describes a command in sh.
  for (const [rule, command] of [
    ["ls", "ls -la src"],
    ["ls", "ls -l"],
    ["ls", "ls -lah src"],
    ["ls", "ls -1"],
    ["cat", "cat -n notes.txt"],
    ["type", "type notes.txt"],
  ]) {
    assert.equal(reviewCommand(command, [rule]).auto, false, command);
  }
  // A rule for exactly that command is still taken literally.
  assert.equal(auto("ls -la src", ["ls -la src"]), true);
  assert.equal(auto("type notes.txt", ["type notes.txt"]), true);
});

test("a rule that names a file covers more flags for it, not more files", () => {
  for (const [rule, command] of [
    ["cat notes.txt", "cat notes.txt other.txt"],
    ["cat notes.txt", "cat other.txt notes.txt"],
    ["Get-ChildItem src", "Get-ChildItem src lib"],
    ["head -n 5 notes.txt", "head -n 5 notes.txt other.txt"],
    ["Get-Content notes.txt", "Get-Content notes.txt other.txt"],
  ]) {
    assert.equal(auto(command, [rule]), false, `${rule} -> ${command}`);
  }
  for (const [rule, command] of [
    ["Get-ChildItem src", "Get-ChildItem src -Recurse"],
    ["Get-Content notes.txt", "Get-Content notes.txt -TotalCount 5"],
    ["head notes.txt", "head notes.txt -n 5"],
    ["head -n", "head -n 5 notes.txt"],
    ["Get-ChildItem -Path", "Get-ChildItem -Path src -File"],
    ["cat", "cat notes.txt other.txt"],
  ]) {
    assert.equal(auto(command, [rule]), true, `${rule} -> ${command}`);
  }
});

test("a rule for one program covers no other program", () => {
  for (const command of ["rm x", "curl x", "cat notes.txt", "git-log x"]) assert.equal(auto(command, ["git"]), false, command);
  assert.equal(auto("git status", [["git"]]), false, "a non-string rule");
});

test("git show asks in every form under a rule for git", () => {
  for (const command of ["git show --output=out.txt HEAD:a", "git show -p HEAD:a", "git show --stat HEAD:a", "git show HEAD:a HEAD:b"]) {
    assert.equal(auto(command, ["git"]), false, command);
  }
});

test("a value after a flag has the same shape limits as a positional", () => {
  for (const command of ["Get-Content -Path D:notes.txt", "Get-Content -Path a.txt:stream", "Get-ChildItem -Path D:", "Test-Path -Path D:x", "Get-Item -Path D:x", "Resolve-Path -Path D:x", "Select-String -Pattern x -Path D:x", "Get-Process -Name -Module", "Get-Content -Path -Raw", "Get-ChildItem -Filter *", "head -n x notes.txt"]) {
    assert.equal(auto(command, [command.split(" ")[0]]), false, command);
  }
});

test("an exact rule still cannot name a sensitive location or leave the alphabet", () => {
  for (const command of ["Get-Content env:SECRET", "Get-Content Environment::X", "cat /proc/self/environ", "cat /etc/shadow", "ls //192.0.2.1/share", "git-credential-store get", "src/run.sh", "cat.exe x", "Get-ChildItem a,b", "ls ~"]) {
    assert.equal(auto(command, [command]), false, command);
  }
});

test("programs and git subcommands outside the table ask under a rule for them", () => {
  for (const command of ["rm notes.txt", "curl example", "Invoke-WebRequest example", "wc --libxo=encoder=x notes.txt", "more notes.txt", "Set-Content notes.txt"]) {
    assert.equal(auto(command, [command.split(" ")[0]]), false, command);
  }
  for (const sub of ["fetch", "clone", "pull", "archive", "bundle", "difftool", "ls-remote", "submodule", "apply", "am", "shortlog", "config", "help"]) {
    assert.equal(auto(`git ${sub} x`, ["git"]), false, sub);
  }
});

test("every credential name asks, even as an exact rule or attached to something", () => {
  for (const path of ["secrets.json", "aws-credentials.txt", ".aws/x", "id_dsa", "id_ecdsa", "a.pfx", "a.keystore", ".env-prod", ".env_local", "_netrc", "pgpass.conf", ".bash_history", "ConsoleHost_history.txt", "AppData/Roaming/gcloud/x"]) {
    assert.equal(auto(`cat ${path}`, ["cat"]), false, path);
    assert.equal(auto(`cat ${path}`, [`cat ${path}`]), false, `exact: ${path}`);
  }
  for (const command of ["ls *", "cat a?", "echo $HOME", "cat .e\\nv"]) {
    assert.equal(auto(command, [command]), false, `exact, outside the alphabet: ${command}`);
  }
  for (const command of ["git show HEAD:.env", "git show HEAD:.ssh/x", "wc --files0-from=.env", "wc --files0-from=.ssh/x", "Get-Content -Path:.env", "Get-Content -Path:.ssh/x", "git grep -f.ssh/x y"]) {
    assert.equal(auto(command, [command]), false, `exact: ${command}`);
  }
});

test("a read-only command in the validated form auto-runs under a shorter rule", () => {
  for (const [rule, command] of [
    ["pwd", "pwd"],
    ["whoami", "whoami"],
    ["hostname", "hostname"],
    ["Get-Location", "Get-Location"],
    ["Get-Date", "Get-Date"],
    ["cat", "cat notes.txt"],
    ["ls", "ls src"],
    ["dir", "dir src"],
    ["head", "head -n 5 notes.txt"],
    ["tail", "tail -20 notes.txt"],
    ["wc", "wc -l notes.txt"],
    ["echo", "echo hello there"],
    ["Get-Content", "Get-Content notes.txt -TotalCount 5"],
    ["Get-ChildItem", "Get-ChildItem -Path src -File -Depth 2"],
    ["Select-String", "Select-String -Pattern needle -Path notes.txt"],
    ["Test-Path", "Test-Path notes.txt"],
    ["Resolve-Path", "Resolve-Path notes.txt"],
    ["Get-Item", "Get-Item notes.txt"],
    ["Get-PSDrive", "Get-PSDrive"],
  ]) {
    assert.equal(auto(command, [rule]), true, command);
  }
});

test("the credential stores of the tools this app drives ask", () => {
  for (const command of ["cat .sandbench/config", "cat C:\\Users\\me\\.sandbench\\workspace.json", "cat .claude/.credentials.json", "cat .config/gh/hosts.yml", "cat id_rsa", "cat .ssh./id_rsa"]) {
    assert.equal(auto(command, ["cat"]), false, command);
  }
});

test("a backslash always asks: the same text means different things in different shells", () => {
  // Each of the first eight ran a program, wrote a file or read a fake secret under bash and sh.
  for (const command of [
    "Get-Content C:\\Users\\me\\notes.txt",
    "Get-Content src\\notes.txt",
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
    assert.equal(auto(command, ["git", "cat", "dir", "Get-Content"]), false, command);
  }
  assert.equal(auto("Get-Content C:\\notes.txt", ["Get-Content C:\\notes.txt"]), false, "not even as an exact rule");
  assert.equal(normalizeRule("Get-Content C:\\notes.txt"), "", "Studio refuses to save it");
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
  assert.equal(auto("GIT status", ["git status"]), true);
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
  assert.equal(reviewPermission({ command: "git status", tool: "Bash" }, ["git status"]).auto, true);
  assert.equal(reviewPermission({ command: "Get-Date", tool: "PowerShell" }, ["Get-Date"]).auto, true);
  assert.equal(reviewPermission({ command: "git push", tool: "Bash" }, ["git"]).auto, false);
  assert.equal(reviewPermission({ command: "git status" }, ["git status"]).auto, true, "the http and anthropic drivers send no tool");
  assert.equal(reviewPermission({ command: "edit src/a.ts", tool: "codex" }, ["edit"]).auto, false);
});

test("rules typed in Studio keep every word so they can be specific", () => {
  assert.equal(normalizeRule("  npm   test "), "npm test");
  assert.equal(normalizeRule("Get-Content"), "Get-Content");
  assert.equal(normalizeRule("git status; rm -rf /"), "");
  assert.equal(normalizeRule("./script"), "");
  assert.equal(normalizeRule(""), "");
});

// Gaps found by the fourth review: each of these mutations of autoReview.mjs survived before.

test("every character outside the alphabet asks, even under a rule for exactly that command", () => {
  const allowed = new Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 _-./:=+");
  for (let code = 0; code < 128; code += 1) {
    const char = String.fromCharCode(code);
    if (allowed.has(char)) continue;
    const command = `echo a${char}b`;
    assert.equal(reviewCommand(command, [command]).auto, false, `char ${code}`);
    assert.equal(normalizeRule(command), "", `char ${code}`);
  }
  for (const char of ["é", "ä", " ", " ", "；", ";"]) {
    assert.equal(reviewCommand(`echo a${char}b`, [`echo a${char}b`]).auto, false, char);
  }
  for (const char of allowed) {
    if (char === " ") continue;
    assert.equal(reviewCommand(`echo a${char}b`, [`echo a${char}b`]).auto, true, `allowed ${char}`);
  }
});

test("every PowerShell provider drive asks, even under a rule for exactly that command", () => {
  for (const drive of ["env", "Env", "variable", "function", "alias", "cert", "HKLM", "hkcu", "HKEY_LOCAL_MACHINE", "hkey_users", "WSMan", "Registry"]) {
    for (const command of [`Get-ChildItem ${drive}:`, `Get-Content ${drive}:x`, `Get-ChildItem -Path:${drive}:`, `Get-Item -LiteralPath:${drive}:x`, `Test-Path ${drive}:/x`]) {
      assert.equal(reviewCommand(command, [command]).auto, false, command);
    }
  }
  // A drive letter is not a provider drive.
  assert.equal(reviewCommand("Get-ChildItem src", ["Get-ChildItem src"]).auto, true);
});

test("each flag value is checked against its shape", () => {
  for (const [rule, command] of [
    ["Get-ChildItem", "Get-ChildItem -Filter a/b"],
    ["Get-ChildItem", "Get-ChildItem -Filter .hidden"],
    ["Get-ChildItem", "Get-ChildItem -Depth 2a"],
    ["Get-ChildItem", "Get-ChildItem -Depth -1"],
    ["Get-ChildItem", "Get-ChildItem -Path ../x"],
    ["Get-Date", "Get-Date -Format a/b"],
    ["Get-Date", "Get-Date -Format -x"],
    ["Get-Process", "Get-Process -Name a/b"],
    ["Get-Process", "Get-Process -Id x"],
    ["Get-Process", "Get-Process a/b"],
    ["Get-Content", "Get-Content notes.txt -TotalCount x"],
    ["Get-Content", "Get-Content notes.txt -Tail 1.5"],
    ["Get-Content", "Get-Content -Path /x"],
    ["Get-Item", "Get-Item -Path ./x"],
    ["Test-Path", "Test-Path -Path a//b"],
    ["Resolve-Path", "Resolve-Path -Path ../x"],
    ["Select-String", "Select-String -Pattern a/b -Path notes.txt"],
    ["Select-String", "Select-String -Pattern x -Path ../x"],
    ["head", "head -n x notes.txt"],
    ["head", "head -n -1 notes.txt"],
    ["tail", "tail -n 1.5 notes.txt"],
    ["tail", "tail -x notes.txt"],
    ["echo", "echo a/b"],
    ["echo", "echo .x"],
  ]) {
    assert.equal(auto(command, [rule]), false, command);
  }
  for (const [rule, command] of [
    ["Get-ChildItem", "Get-ChildItem -Filter package.json -Depth 2"],
    ["Get-Date", "Get-Date -Format HH:mm"],
    ["Get-Process", "Get-Process -Name node -Id 42"],
    ["Get-Content", "Get-Content notes.txt -Tail 3"],
    ["head", "head -n 3 notes.txt"],
    ["tail", "tail -n 3 notes.txt"],
    ["echo", "echo v1.2+3"],
  ]) {
    assert.equal(auto(command, [rule]), true, command);
  }
});

test("a flag with its value missing asks", () => {
  for (const [rule, command] of [
    ["Get-ChildItem", "Get-ChildItem -Path"],
    ["Get-ChildItem", "Get-ChildItem src -Filter"],
    ["Get-ChildItem", "Get-ChildItem src -Depth"],
    ["Get-Date", "Get-Date -Format"],
    ["Get-Process", "Get-Process -Name"],
    ["Get-Process", "Get-Process -Id"],
    ["Get-Content", "Get-Content notes.txt -TotalCount"],
    ["Get-Content", "Get-Content notes.txt -Tail"],
    ["Get-Item", "Get-Item -Path"],
    ["Test-Path", "Test-Path -Path"],
    ["Resolve-Path", "Resolve-Path -Path"],
    ["Select-String", "Select-String -Path notes.txt -Pattern"],
    ["head", "head notes.txt -n"],
    ["tail", "tail notes.txt -n"],
  ]) {
    assert.equal(auto(command, [rule]), false, command);
  }
});

test("a path argument must be relative and canonical for every program that takes one", () => {
  const programs = ["Get-ChildItem", "Get-Content", "Get-Item", "Test-Path", "Resolve-Path", "dir", "ls", "cat", "head", "tail", "wc"];
  for (const program of programs) {
    for (const bad of ["../x", "..", "x/..", "./x", "a//b", "a/", "/x", "x.", "a/./b", "CON", "nul.txt", "Lpt1", "com3.log", "-x"]) {
      assert.equal(auto(`${program} ${bad}`, [program]), false, `${program} ${bad}`);
    }
    for (const good of ["notes.txt", "src/a.ts", "a-b_c.d", "connect.txt", "nullish.md"]) {
      const command = `${program} ${good}`;
      assert.equal(auto(command, [program]), true, command);
    }
  }
  for (const program of ["Get-ChildItem", "Get-Content", "Get-Item", "Test-Path", "Resolve-Path"]) {
    assert.equal(auto(`${program} -Path ../x`, [program]), false, program);
    assert.equal(auto(`${program} -path notes.txt`, [program]), true, `${program} lower-case -path`);
  }
  assert.equal(auto("Get-ChildItem .", ["Get-ChildItem"]), true);
});

test("the program name must be a plain name, under every kind of rule", () => {
  for (const command of ["./cat notes.txt", "bin/cat notes.txt", "cat.exe notes.txt", "1cat notes.txt", "-cat notes.txt", "C:cat notes.txt"]) {
    assert.equal(reviewCommand(command, [command, "cat"]).auto, false, command);
    assert.equal(normalizeRule(command), "", command);
  }
  assert.equal(normalizeRule("  cat   notes.txt "), "cat notes.txt");
  assert.equal(normalizeRule("Get-ChildItem"), "Get-ChildItem");
  assert.equal(normalizeRule(""), "");
});

test("more credential files ask, under a shorter rule and as an exact rule", () => {
  for (const file of ["repo.git/config", "repo.git", ".envs/prod", ".env2", ".environment", "key.ppk", "store.jks", "terraform.tfstate", "x.tfstate.backup", "prod.tfvars", "vars.tfvars.json", "db.kdbx", "k.p8", "s.gpg", ".s3cfg", ".my.cnf", "my.cnf", ".boto", "a/.htpasswd", ".terraformrc", ".dockercfg", "kubeconfig", ".rclone.conf", ".passwd-s3fs", "KEY.PPK"]) {
    assert.equal(auto(`cat ${file}`, ["cat"]), false, file);
    assert.equal(auto(`cat ${file}`, [`cat ${file}`]), false, `exact ${file}`);
    assert.equal(auto(`Get-Content -Path ${file}`, ["Get-Content"]), false, `Get-Content ${file}`);
  }
  for (const file of ["notes.txt", "src/env.ts", "environment.md", "docs/git.md", "my.git.notes", "envoy.yaml", "docs/keys.md", "boto.md", "tfvars.md", "kubeconfig.md", "src/digit.ts"]) {
    assert.equal(auto(`cat ${file}`, ["cat"]), true, file);
  }
});

test("a path joined with = or : is still checked, even as an exact rule", () => {
  for (const command of ["echo a=.env", "echo x=id_rsa", "echo HEAD:.env", "echo a=b=.ssh/x", "Get-ChildItem -Filter=.env"]) {
    assert.equal(reviewCommand(command, [command]).auto, false, command);
  }
});

test("flags outside PowerShell keep their case, and unlisted flags ask", () => {
  for (const command of ["head -N 5 notes.txt", "wc -L notes.txt", "wc -W notes.txt", "wc --files0-from notes.txt", "Get-ChildItem -Force", "Get-ChildItem -Hidden", "Get-ChildItem -Attributes Hidden", "Get-Content -Raw notes.txt", "Get-Content -Stream x notes.txt"]) {
    assert.equal(auto(command, [command.split(" ")[0]]), false, command);
  }
  for (const command of ["head -5 notes.txt", "tail -5 notes.txt", "get-childitem -recurse", "GET-CONTENT -TOTALCOUNT 2 notes.txt"]) {
    assert.equal(auto(command, [command.split(" ")[0]]), true, command);
  }
});

test("a rule that is not a string is ignored", () => {
  for (const rule of [["cat"], 5, null, undefined, { 0: "cat" }, true]) {
    assert.equal(reviewCommand("cat notes.txt", [rule]).auto, false, JSON.stringify(rule));
  }
  assert.equal(reviewCommand("cat notes.txt", "cat").auto, false);
});

test("readOnlyCommand alone refuses forms that would read standard input", () => {
  for (const words of [["cat"], ["head", "-n", "1"], ["wc", "-l"], ["Select-String", "-Pattern", "x"], ["rm", "x"], [], ["type", "notes.txt"]]) {
    assert.equal(readOnlyCommand(words), false, words.join(" "));
  }
  for (const words of [["cat", "notes.txt"], ["Select-String", "-Pattern", "x", "-Path", "notes.txt"], ["pwd"], ["ls"]]) {
    assert.equal(readOnlyCommand(words), true, words.join(" "));
  }
});
