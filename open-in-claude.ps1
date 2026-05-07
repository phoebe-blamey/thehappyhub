# open-in-claude.ps1
# Launches Claude Code (desktop) with this project folder as the working directory.
# Designed to be invoked from a Desktop shortcut. Finds the latest installed
# Claude Code version dynamically so the shortcut survives app updates.

$projectPath = $PSScriptRoot
$claudeRoot  = Join-Path $env:APPDATA 'Claude\claude-code'

if (-not (Test-Path $claudeRoot)) {
  Write-Host "Claude desktop doesn't appear to be installed."
  Write-Host "Looked in: $claudeRoot"
  Write-Host "Install Claude desktop, then try again."
  Start-Sleep 8
  exit 1
}

$latestVersion = Get-ChildItem $claudeRoot -Directory |
  Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } |
  Sort-Object { [version]$_.Name } -Descending |
  Select-Object -First 1

if (-not $latestVersion) {
  Write-Host "Couldn't find any Claude Code version folder under $claudeRoot"
  Start-Sleep 8
  exit 1
}

$claudeExe = Join-Path $latestVersion.FullName 'claude.exe'

if (-not (Test-Path $claudeExe)) {
  Write-Host "Found version folder $($latestVersion.Name) but no claude.exe inside it."
  Start-Sleep 8
  exit 1
}

Start-Process -FilePath $claudeExe -WorkingDirectory $projectPath
