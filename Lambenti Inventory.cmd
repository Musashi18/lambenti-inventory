@echo off
setlocal
cd /d "%USERPROFILE%\Desktop\lambenti-inventory"

echo Lambenti Inventory
echo ==================
echo Project: %CD%
echo.
echo Starting the PostgreSQL database with Docker Compose...
docker compose up -d db
if errorlevel 1 (
  echo.
  echo Docker did not start the database. Make sure Docker Desktop is running, then run this file again.
  pause
  exit /b 1
)

echo.
echo Applying database migrations...
call npx prisma migrate deploy
if errorlevel 1 (
  echo.
  echo Migration failed. Check the error above.
  pause
  exit /b 1
)

echo.
echo Stopping any previous Lambenti server on port 5173 before rebuilding...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr "127.0.0.1:5173" ^| findstr "LISTENING"') do (
  taskkill /PID %%P /F >nul 2>nul
)

echo.
echo Building the app so the dashboard CSS/chunks are served from one clean production build...
if exist .next rmdir /s /q .next
call npm run build
if errorlevel 1 (
  echo.
  echo Build failed. Check the error above.
  pause
  exit /b 1
)

echo.
echo Opening app at http://127.0.0.1:5173 ...
start "" "http://127.0.0.1:5173"

echo.
echo Starting Next.js production server. Keep this window open while using the app.
call npm run start:local

pause
