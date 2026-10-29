@echo off
rem SIR Math OCR helper - keep this window open while importing PDFs.
cd /d "%~dp0"
title SIR Math OCR helper
call .venv\Scripts\activate.bat || (echo Run install.bat first & pause & exit /b 1)
python server.py %*
pause
