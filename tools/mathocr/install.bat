@echo off
rem SIR Math OCR helper - one-time installation (needs internet once).
cd /d "%~dp0"
where py >nul 2>nul && (set PY=py -3) || (set PY=python)
%PY% -m venv .venv || goto :fail
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip || goto :fail
python -m pip install -r requirements.txt || goto :fail
python get_model.py %* || goto :fail
python selftest.py || goto :fail
echo.
echo Installed. Start the helper with start_helper.bat
pause
exit /b 0
:fail
echo.
echo Installation FAILED - see the messages above.
pause
exit /b 1
