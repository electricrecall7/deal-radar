# Deal Radar: search for deals with your Claude plan (through Claude Code), show what changed, and
# upload the new list to the app only when you say so. Double-click "Search deals.cmd" to run it, or:
#   powershell -ExecutionPolicy Bypass -File scripts\search-and-upload.ps1
# Kept to plain ASCII: Windows PowerShell 5.1 misreads other characters in scripts saved without a BOM.

# Native commands report failure through $LASTEXITCODE, checked after each one. 'Stop' would also turn
# harmless stderr output (git progress, npm warnings) into errors in Windows PowerShell 5.1.
$ErrorActionPreference = 'Continue'
Set-Location (Split-Path -Parent $PSScriptRoot)

$DataFiles = @('data/deals.json', 'data/last-run.json')
$Discard = 'git checkout -- data/deals.json data/last-run.json'

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Stop-With($text) {
  Say $text 'Red'
  exit 1
}
function Need($command, $help) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { Stop-With "Can't find '$command'. $help" }
}
# Keys pressed during the long search would otherwise answer the next question on their own.
# DEAL_RADAR_ANSWERS (comma-separated) answers the questions instead, for automated tests.
$script:Answers = New-Object System.Collections.Queue
if ($env:DEAL_RADAR_ANSWERS) { foreach ($a in ($env:DEAL_RADAR_ANSWERS -split ',')) { $script:Answers.Enqueue($a) } }
function Ask($question) {
  if ($script:Answers.Count -gt 0) {
    $a = $script:Answers.Dequeue()
    Say "$question`: $a"
    return $a
  }
  try { $Host.UI.RawUI.FlushInputBuffer() } catch { }
  return Read-Host $question
}

Need 'git' 'Install Git for Windows from https://git-scm.com/download/win and run this again.'
Need 'node' 'Install Node.js 22 or newer (LTS) from https://nodejs.org and run this again.'
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 22) {
  Stop-With "Deal Radar needs Node.js 22 or newer (you have $(node --version)). Install the LTS from https://nodejs.org."
}

# The native Claude Code installer puts claude.exe in %USERPROFILE%\.local\bin, which often isn't on PATH.
if (-not (Get-Command 'claude' -ErrorAction SilentlyContinue)) {
  $bin = Join-Path $env:USERPROFILE '.local\bin'
  if (Test-Path (Join-Path $bin 'claude.exe')) {
    $env:Path = "$bin;$env:Path"
  } else {
    Stop-With ("Claude Code isn't installed. Install it in PowerShell with:  irm https://claude.ai/install.ps1 | iex`n" +
      "Then run 'claude' once, sign in with your Claude account, and run this again.")
  }
}

# Checked now rather than after a 2-hour search.
git var GIT_COMMITTER_IDENT *> $null
if ($LASTEXITCODE -ne 0) {
  Stop-With ("Git doesn't know your name and email yet, so it couldn't save the results. Run these once:`n" +
    "  git config --global user.name ""Your Name""`n  git config --global user.email ""you@example.com""")
}
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  Stop-With 'Some changes are already staged in this folder. Commit or unstage them first, so they are not uploaded with the deals.'
}

Say ''
Say 'Deal Radar search' 'Cyan'
Say '-----------------' 'Cyan'

git diff --quiet -- $DataFiles
$kept = ($LASTEXITCODE -ne 0)
if ($kept) {
  Say 'You have results from an earlier search that were not uploaded yet.' 'Yellow'
} else {
  # Start from the list the app has now, so an upload never undoes an earlier one.
  Say 'Getting the latest deal list...'
  git pull --ff-only --quiet
  if ($LASTEXITCODE -ne 0) { Stop-With "Couldn't update from GitHub; see the message above." }
}

# Reinstall packages whenever package-lock.json changes (or a first install was interrupted).
$lockHash = (Get-FileHash 'package-lock.json').Hash
$stamp = 'node_modules\.deal-radar-lock'
if (-not (Test-Path $stamp) -or ((Get-Content $stamp -Raw).Trim() -ne $lockHash)) {
  Say 'Installing packages...'
  npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Stop-With 'npm ci failed; see the messages above.' }
  Set-Content $stamp $lockHash -Encoding ascii
}

Say ''
Say 'What should I do?'
Say '  1) Deals: re-check the list, find new deals, re-check card benefits (about 1-2 hours)'
Say '  2) Promo codes for the restaurants in data\code-watchlist.json (about 30-60 minutes)'
Say '  3) Both'
Say '  4) Preview only: show what a search would do, no searching'
if ($kept) { Say '  5) Upload the results kept from the last search (no new search)' }
$choice = Ask 'Choose a number'
switch ($choice) {
  '1' { $flags = @('--skip-codes') }
  '2' { $flags = @('--only-codes') }
  '3' { $flags = @() }
  '4' { $flags = @('--dry-run') }
  '5' { if (-not $kept) { Stop-With 'There are no kept results to upload.' } }
  default { Stop-With 'Nothing chosen; stopping.' }
}

if ($choice -ne '5') {
  if ($kept -and $choice -ne '4') {
    Say "Note: this search starts from your kept results. To start fresh instead, close this window and run: $Discard" 'DarkGray'
  }
  # Put the data files back exactly as they were if the search fails, kept results included.
  $backup = Join-Path $env:TEMP "deal-radar-backup-$PID"
  New-Item -ItemType Directory -Force $backup | Out-Null
  Copy-Item $DataFiles $backup

  Say ''
  if ($choice -ne '4') {
    Say 'Searching with your Claude plan. Leave this window open; it can take a while.' 'Yellow'
    Say "Your plan's usage limits apply: if you hit one, the search stops early and keeps what it found." 'DarkGray'
    Say ''
  }
  npx tsx scripts/update-deals.ts --engine=claude-code @flags
  $searchExit = $LASTEXITCODE
  if ($searchExit -ne 0) {
    Copy-Item (Join-Path $backup '*') 'data' -Force
    Remove-Item $backup -Recurse -Force
    Stop-With 'The search failed (see the messages above). The data folder is back the way it was; nothing was uploaded.'
  }
  Remove-Item $backup -Recurse -Force
  if ($choice -eq '4') {
    Say ''
    Say 'Preview finished. Nothing was searched, changed or uploaded.' 'Green'
    exit 0
  }
}

Say ''
Say 'Checking the new list...'
$testOutput = npm test --silent 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) {
  Say $testOutput 'DarkGray'
  Say 'The new list failed the checks above, so it was NOT uploaded.' 'Red'
  Say "To throw the new results away:  $Discard" 'Red'
  exit 1
}

git diff --quiet -- $DataFiles
if ($LASTEXITCODE -eq 0) {
  Say 'Nothing changed. Nothing to upload.' 'Green'
  exit 0
}

Say ''
Say 'Changed files:' 'Cyan'
git --no-pager diff --stat -- $DataFiles
Say 'The summary above lists every deal added, updated or removed (also saved in data\last-run.json).' 'DarkGray'
Say ''
$answer = Ask 'Upload these results to the app now? (y/n)'
if ($answer -notmatch '^(y|yes)$') {
  Say ''
  Say 'Not uploaded. The results stay in the data folder:' 'Yellow'
  Say '  - run this again later and choose "Upload the results kept from the last search", or' 'Yellow'
  Say "  - throw them away with:  $Discard" 'Yellow'
  exit 0
}

# Only upload on top of the exact list this search started from; never merge two versions of deals.json.
git fetch --quiet
if ($LASTEXITCODE -ne 0) { Stop-With "Couldn't reach GitHub; your results are kept. Run this again later and choose to upload." }
$behind = [int](git rev-list --count 'HEAD..@{u}')
if ($behind -gt 0) {
  Stop-With ("The list on GitHub changed after this search started, so these results can't be uploaded safely.`n" +
    "Throw them away with:  $Discard   then search again.")
}
git commit --quiet -m "Deal update $(Get-Date -Format 'yyyy-MM-dd') (local run)" -- $DataFiles
if ($LASTEXITCODE -ne 0) { Stop-With "Couldn't save the results as a commit (see above). Your results are kept in the data folder." }
git push --quiet
if ($LASTEXITCODE -ne 0) {
  git reset --quiet --mixed HEAD~1
  Stop-With 'The upload to GitHub failed (see above). Your results are kept; run this again and choose to upload.'
}

Say ''
Say 'Uploaded. Open Deal Radar and pull down on the Today screen to load the new list.' 'Green'
