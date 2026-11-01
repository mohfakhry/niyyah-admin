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
git commit -m "%COMMIT_MSG%"

echo.
echo Syncing with remote before pushing...
git pull --rebase origin main || goto :rebase_error

git push origin main || goto :error

echo.
echo Changes pushed successfully to niyyah-admin.
pause
exit /b 0

:rebase_error
echo.
echo Rebase encountered a conflict. Resolve conflicts in your editor, then run:
echo   git add -A
echo   git rebase --continue
echo   git push origin main
pause
exit /b 1

:error
echo.
echo Git operation failed. Check the output above.
pause
exit /b 1