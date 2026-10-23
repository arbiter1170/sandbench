# Run after: gh auth login  AND  vercel login
# Also set Firebase VITE_* on Vercel (or pass --env locally for preview).
$ErrorActionPreference = "Stop"
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
Set-Location $PSScriptRoot\..

gh auth status
if (-not (git remote get-url origin 2>$null)) {
  gh repo create sandbench --private --source=. --remote=origin --push
} else {
  git push -u origin deploy/vercel
  git checkout main 2>$null
  git merge deploy/vercel -m "Merge deploy/vercel"
  git push -u origin main
  git checkout deploy/vercel
}

vercel link --yes
vercel --prod --yes

Write-Host "Add Vercel URL to Firebase Auth authorized domains, publish firestore.rules, set VITE_* env, redeploy."
