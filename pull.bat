@echo off
setlocal
cd /d "%~dp0"

echo Pulling latest changes from niyyah-admin...
git pull origin main || goto :error

echo.
echo Repository updated successfully.
pause
exit /b 0

:error
echo.
echo Git pull failed. You may have local merge conflicts or uncommitted changes.
pause
exit /b 1