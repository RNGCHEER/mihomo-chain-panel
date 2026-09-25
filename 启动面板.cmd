@echo off
setlocal
cd /d "%~dp0"
if not exist "%~dp0runtime\node\node.exe" (
  echo Bundled Node runtime is missing: "%~dp0runtime\node\node.exe"
  pause
  exit /b 1
)
set "PATH=%~dp0runtime\node;%~dp0runtime\python;%~dp0runtime\curl;%PATH%"
"%~dp0runtime\node\node.exe" "%~dp0launch.cjs"
if errorlevel 1 (
  echo Launch failed. See the message above.
  pause
  exit /b 1
)
endlocal
