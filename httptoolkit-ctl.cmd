@echo off
set "HTK_DESKTOP_RESOURCES=%~dp0"
for %%I in ("%~dp0..") do set "HTK_DESKTOP_EXE=%%~fI\HTTP Toolkit.exe"
"%~dp0httptoolkit-server\bin\httptoolkit-server.cmd" ctl %*
