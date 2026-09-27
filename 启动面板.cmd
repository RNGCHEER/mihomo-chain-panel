@echo off
setlocal
cd /d "%~dp0"
set "NODE_EXE=%~dp0runtime\node\node.exe"
if not exist "%NODE_EXE%" (
  for /f "delims=" %%i in ('where node 2^>nul') do set "NODE_EXE=%%i"
)
if not defined NODE_EXE (
  echo Node.js not found. Please install Node.js or place node.exe in runtime\node\
  pause
  exit /b 1
)
if exist "%~dp0runtime\node\node.exe" set "PATH=%~dp0runtime\node;%PATH%"
if exist "%~dp0runtime\python\python.exe" set "PATH=%~dp0runtime\python;%PATH%"
if exist "%~dp0runtime\curl\curl.exe" set "PATH=%~dp0runtime\curl;%PATH%"
"%NODE_EXE%" "%~dp0launch.cjs"
if errorlevel 1 (
  echo Launch failed. See the message above.
  pause
  exit /b 1
)
endlocal
