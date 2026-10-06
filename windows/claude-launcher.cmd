@echo off
REM Launch Claude Code behind the Matrix intro.
REM Put this file, matrix-intro.exe and claude-update-safe.ps1 in one folder on PATH.
REM matrix-intro.exe starts the hidden updater, then rains until Claude bumps
REM numStartups in .claude.json (just before its first screen), 20 s cap.
REM CLAUDE_MATRIX_INTRO=0 turns the intro off. Needs DISABLE_AUTOUPDATER=1 in settings.json
REM if you want the safe updater to own updates.

set "CC_INTRO_MARK=%TEMP%\claude-intro-%RANDOM%%RANDOM%.flag"
start "" /b "%~dp0matrix-intro.exe" %*

REM claude is npm's claude.cmd: without "call", nothing after this line runs.
call claude %*
set "CC_RC=%ERRORLEVEL%"
if exist "%CC_INTRO_MARK%" (
  del "%CC_INTRO_MARK%" >nul 2>&1
  cls
)
exit /b %CC_RC%
