@echo off
setlocal
cd /d "%~dp0"

set /p "COMMIT_MSG=Enter commit message: "
if not defined COMMIT_MSG (
    echo Commit message cannot be empty. Nothing was pushed.
    pause
    exit /b 1
)

git add -A || goto :error
git commit -m "%COMMIT_MSG%" || goto :error
git push || goto :error

echo.
echo Changes pushed successfully.
pause
exit /b 0

:error
echo.
echo Git operation failed. Check the output above.
pause
exit /b 1
