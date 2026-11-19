#Requires -Version 7
<#
Pulls this course repo's app code (index.html, assets/, the Pages deploy
workflow) up to date from the published course template repo, without
touching grades/roster/config data. Run this from inside your course
repo's local clone any time a fix ships upstream.
Keep in sync with update-from-template.sh (macOS/Ubuntu) if this logic
changes.

Usage:
  .\update-from-template.ps1 [-SourceOwner ORG] [-SourceRepo NAME] [-Repo OWNER/NAME] [-Dir PATH] [-DryRun] [-Yes]
#>

param(
  [string]$SourceOwner = 'IngSoft-DA1',
  [string]$SourceRepo = 'DAxInClassGrading-course-template',
  [string]$Repo = '',
  [string]$Dir = '',
  [switch]$DryRun,
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'

function Invoke-Checked {
  param([string[]]$Command)
  Write-Host "+ $($Command -join ' ')"
  if ($DryRun) { return }
  & $Command[0] @($Command[1..($Command.Length - 1)])
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed (exit $LASTEXITCODE): $($Command -join ' ')"
  }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Error "git is required but not found."
  exit 1
}

# --- Safety gate: refuse to run anywhere that isn't recognizably a --------
# --- deployed DAxInClassGrading course-repo clone -------------------------
# Always runs for real, -DryRun or not, on any directory that already
# exists on disk - this is what stops the script from being run by mistake
# against the wrong working copy (this dev repo, some unrelated repo, or
# the template repo itself).
function Get-OriginOwnerRepo {
  param([string]$RepoDir)
  $url = (git -C $RepoDir config --get remote.origin.url 2>$null)
  if (-not $url) { return '' }
  $url = $url -replace '^git@github\.com:', ''
  $url = $url -replace '^https://github\.com/', ''
  $url = $url -replace '\.git$', ''
  return $url
}

function Assert-CourseRepo {
  param([string]$RepoDir)
  if (Test-Path -LiteralPath (Join-Path $RepoDir 'package.json') -PathType Leaf) {
    Write-Error "Refusing to run: found package.json at $RepoDir - this looks like the DAxInClassGrading dev repo, not a deployed course repo."
    exit 1
  }
  $indexHtml = Join-Path $RepoDir 'index.html'
  if (-not (Test-Path -LiteralPath $indexHtml -PathType Leaf)) {
    Write-Error "Refusing to run: no index.html at $RepoDir - this doesn't look like a course-repo clone."
    exit 1
  }
  $githubApi = Join-Path $RepoDir 'assets/js/github-api.js'
  if (-not (Test-Path -LiteralPath $githubApi -PathType Leaf) -or -not (Select-String -LiteralPath $githubApi -Pattern 'TEMPLATE_OWNER' -Quiet)) {
    Write-Error "Refusing to run: assets/js/github-api.js is missing or doesn't look like the DAxInClassGrading app at $RepoDir."
    exit 1
  }
  $origin = Get-OriginOwnerRepo -RepoDir $RepoDir
  if ($origin -eq "$SourceOwner/$SourceRepo") {
    Write-Error "Refusing to run: $RepoDir's origin is the template repo itself ($SourceOwner/$SourceRepo) - nothing to sync."
    exit 1
  }
}

# --- Resolve the working directory ----------------------------------------

$workDir = ''
$inRepo = $true
try {
  $workDir = (git rev-parse --show-toplevel 2>$null).Trim()
  if ($LASTEXITCODE -ne 0) { $inRepo = $false }
} catch {
  $inRepo = $false
}

if ($inRepo -and $workDir) {
  Write-Host "Using current repo: $workDir"
  Assert-CourseRepo -RepoDir $workDir
} elseif ($Repo) {
  $workDir = if ($Dir) { $Dir } else { Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName()) }
  Invoke-Checked @('git', 'clone', "https://github.com/$Repo.git", $workDir)
  if (Test-Path -LiteralPath (Join-Path $workDir '.git')) {
    Assert-CourseRepo -RepoDir $workDir
  } else {
    Write-Host "[dry-run] would verify $workDir looks like a course-repo clone before syncing."
  }
} else {
  Write-Error "Not inside a git repository, and no -Repo given. cd into your course repo's local clone, or pass -Repo OWNER/NAME."
  exit 1
}

Write-Host "Looks like a DAxInClassGrading course repo - proceeding."

# --- Fetch the template repo's current app code ---------------------------

$srcDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
try {
  Invoke-Checked @('git', 'clone', '--depth', '1', "https://github.com/$SourceOwner/$SourceRepo.git", $srcDir)

  # --- Sync exactly the app-code paths - never grades/students/config/photos

  Push-Location $workDir
  try {
    $assetsDir = Join-Path $workDir 'assets'
    Write-Host "+ Remove-Item -Recurse -Force assets"
    if (-not $DryRun) { Remove-Item -Recurse -Force -LiteralPath $assetsDir -ErrorAction SilentlyContinue }
    Write-Host "+ Copy-Item -Recurse $srcDir/assets assets"
    if (-not $DryRun) { Copy-Item -Recurse -Path (Join-Path $srcDir 'assets') -Destination $assetsDir }

    Write-Host "+ Copy-Item $srcDir/index.html index.html"
    if (-not $DryRun) { Copy-Item -Path (Join-Path $srcDir 'index.html') -Destination (Join-Path $workDir 'index.html') -Force }

    $workflowsDir = Join-Path $workDir '.github/workflows'
    if (-not $DryRun) { New-Item -ItemType Directory -Force -Path $workflowsDir | Out-Null }
    Write-Host "+ Copy-Item $srcDir/.github/workflows/deploy-pages.yml .github/workflows/deploy-pages.yml"
    if (-not $DryRun) {
      Copy-Item -Path (Join-Path $srcDir '.github/workflows/deploy-pages.yml') -Destination (Join-Path $workflowsDir 'deploy-pages.yml') -Force
    }

    if ($DryRun) {
      Write-Host ""
      Write-Host "[dry-run] would review changes to index.html, assets/, and"
      Write-Host "[dry-run] .github/workflows/deploy-pages.yml, then commit and push."
      return
    }

    Invoke-Checked @('git', 'add', 'index.html', 'assets', '.github/workflows/deploy-pages.yml')

    git diff --cached --quiet -- index.html assets .github/workflows/deploy-pages.yml
    if ($LASTEXITCODE -eq 0) {
      Write-Host "Already up to date - nothing to sync."
      return
    }

    Write-Host ""
    Write-Host "Changes to commit:"
    git diff --cached --stat -- index.html assets .github/workflows/deploy-pages.yml

    if (-not $Yes) {
      Write-Host ""
      $reply = Read-Host "Commit and push these changes? [y/N]"
      if ($reply -notmatch '^[yY]') {
        Write-Host "Aborted (changes staged locally but not committed)."
        exit 1
      }
    }

    Invoke-Checked @('git', 'commit', '-m', 'Sync app code from course template')
    Invoke-Checked @('git', 'push')
  } finally {
    Pop-Location
  }
} finally {
  if (Test-Path -LiteralPath $srcDir) { Remove-Item -Recurse -Force -LiteralPath $srcDir -ErrorAction SilentlyContinue }
}
