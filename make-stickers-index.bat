@echo off
rem Double-click this file after you add/remove sticker images in the stickers folder.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0make-stickers-index.ps1"
echo.
pause
