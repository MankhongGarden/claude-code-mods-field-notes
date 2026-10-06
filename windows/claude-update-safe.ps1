param([switch]$StageOnly, [switch]$Force, [string]$Version)

$ErrorActionPreference = 'Stop'
$root  = Join-Path "$(npm root -g)".Trim() '@anthropic-ai'
$live  = "$root\claude-code"
$exe   = "$live\bin\claude.exe"
$work  = Join-Path $env:LOCALAPPDATA 'claude-update-safe'
New-Item -ItemType Directory -Force $work | Out-Null
$log   = Join-Path $work 'claude-update.log'
$stage = Join-Path $work 'stage'

function Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m" | Add-Content -Encoding utf8 $log }

$mtx = New-Object System.Threading.Mutex($false, 'Global\claude-update-safe')
if (-not $mtx.WaitOne(0)) { exit }
try {
  Get-ChildItem "$live\bin" -Filter 'claude.exe.old-*' -ErrorAction SilentlyContinue | ForEach-Object {
    try { Remove-Item $_.FullName -Force -ErrorAction Stop; Log "cleanup $($_.Name)" } catch {}
  }
  Get-ChildItem $root -Directory -Filter '.claude-code-*' -Force -ErrorAction SilentlyContinue | ForEach-Object {
    try { Remove-Item $_.FullName -Recurse -Force -ErrorAction Stop; Log "cleanup $($_.Name)" } catch {}
  }

  $cur = (Get-Content "$live\package.json" -Raw | ConvertFrom-Json).version
  $new = if ($Version) { $Version } else { "$(npm view @anthropic-ai/claude-code version 2>$null)".Trim() }
  if (-not $new) { Log 'check failed: no version from npm'; exit }
  if (-not $Version -and [version]$new -le [version]$cur) { Write-Output "Claude Code $cur is the latest version"; exit }

  Log "staging $new (current $cur)"
  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
  New-Item -ItemType Directory $stage | Out-Null
  npm install --prefix $stage --no-audit --no-fund --loglevel=error "@anthropic-ai/claude-code@$new" *> $null
  $sp   = "$stage\node_modules\@anthropic-ai\claude-code"
  $sexe = @("$stage\node_modules\@anthropic-ai\claude-code-win32-x64\claude.exe", "$sp\node_modules\@anthropic-ai\claude-code-win32-x64\claude.exe", "$sp\bin\claude.exe") |
    Where-Object { (Test-Path $_) -and (Get-Item $_).Length -ge 10MB } | Select-Object -First 1
  if (-not $sexe) { $sexe = "$sp\bin\claude.exe" }
  if (-not (Test-Path $sexe) -or (Get-Item $sexe).Length -lt 10MB) { throw "staged binary missing or stub" }
  $sv = "$(& $sexe --version 2>$null)"
  if ($sv -notmatch [regex]::Escape($new)) { throw "staged binary reports '$sv', expected $new" }
  Log "staged ok: $sv"
  if ($StageOnly) { exit }

  $ts  = Get-Date -Format 'yyyyMMddHHmmss'
  $old = "claude.exe.old-$ts"
  if (Test-Path $exe) { Rename-Item $exe $old }
  try { Move-Item $sexe $exe } catch { Rename-Item "$live\bin\$old" 'claude.exe'; throw }
  foreach ($f in 'package.json', 'install.cjs', 'cli-wrapper.cjs', 'sdk-tools.d.ts', 'README.md', 'LICENSE.md') {
    if (Test-Path "$sp\$f") { Copy-Item "$sp\$f" "$live\$f" -Force }
  }
  $plat = 'node_modules\@anthropic-ai\claude-code-win32-x64\package.json'
  if ((Test-Path "$sp\$plat") -and (Test-Path (Split-Path "$live\$plat"))) { Copy-Item "$sp\$plat" "$live\$plat" -Force }

  $lv = "$(& $exe --version 2>$null)"
  Log "updated $cur -> $new ($lv)"
  Write-Output "Updated Claude Code $cur -> $new (new sessions use it; open ones keep $cur until closed)"
}
catch { Log "ERROR $($_.Exception.Message)"; Write-Output "Update failed: $($_.Exception.Message) (see $log)" }
finally {
  if (Test-Path $stage) { try { Remove-Item $stage -Recurse -Force -ErrorAction Stop } catch {} }
  $mtx.ReleaseMutex()
}
