@echo off
chcp 65001 >nul 2>&1
title E-Social Bot Agent
color 0A

echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║        E-SOCIAL BOT AGENT BAŞLADILIR         ║
echo  ╚══════════════════════════════════════════════╝
echo.

:: ── 1. Node.js yoxlanışı ─────────────────────────────
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    color 0C
    echo  [XETA] Node.js tapilmadi!
    echo  Zehmet olmasa https://nodejs.org saytindan yukleyin.
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo  [OK] Node.js versiya: %NODE_VER%

:: ── 2. İş qovluğu (AppData — admin lazım deyil) ─────
set "WORK_DIR=%LOCALAPPDATA%\ESocialBotAgent"
if not exist "%WORK_DIR%" mkdir "%WORK_DIR%"
echo  [OK] Is qovlugu: %WORK_DIR%

:: ── 3. agent.js yüklə (GitHub-dan, həmişə ən son versiya) ──
echo  [..] Agent kodu yuklenilir...
powershell -NoProfile -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object Net.WebClient).DownloadFile('https://raw.githubusercontent.com/ArifBabayev05/scrapev2/main/agent.js', '%WORK_DIR%\agent.js') } catch { Write-Host '[XETA] Yukleme ugursuz:' $_.Exception.Message; exit 1 }"
if %ERRORLEVEL% neq 0 (
    color 0C
    echo  [XETA] agent.js yukleye bilmedi. Internet baglantisini yoxlayin.
    pause
    exit /b 1
)
echo  [OK] agent.js yuklendi

:: ── 4. package.json yarat (əgər yoxdursa və ya yenilə) ──
echo  [..] package.json hazirlanlir...
(
echo {
echo   "name": "esocial-agent",
echo   "version": "1.0.0",
echo   "private": true,
echo   "dependencies": {
echo     "ws": "^8.18.0",
echo     "puppeteer": "^23.0.0",
echo     "dotenv": "^16.4.0"
echo   }
echo }
) > "%WORK_DIR%\package.json"
echo  [OK] package.json hazirdir

:: ── 5. .env faylı (əgər yoxdursa — ilk dəfə istifadəçi adı soruş) ──
if not exist "%WORK_DIR%\.env" (
    echo.
    echo  ─── Ilk defe qurulum ───
    set /p "UNAME=  Adinizi daxil edin (meselen: Arif): "
    (
        echo RELAY_URL=wss://scrape-production-5d7a.up.railway.app
        echo AGENT_SECRET=bot-secret-2024
        echo AGENT_LABEL=%UNAME%
        echo ESOCIAL_DEBUG_PORT=9222
        echo IMEI_DEBUG_PORT=9223
    ) > "%WORK_DIR%\.env"
    echo  [OK] .env faylı yaradildi (ad: %UNAME%^)
) else (
    echo  [OK] .env artiq movcuddur
)

:: ── 6. npm install (node_modules yoxdursa) ──
if not exist "%WORK_DIR%\node_modules" (
    echo  [..] Paketler yuklenilir (ilk defe, 1-2 deqiqe)...
    cd /d "%WORK_DIR%"
    npm install --production --no-fund --no-audit >nul 2>&1
    if %ERRORLEVEL% neq 0 (
        echo  [..] Yeniden cehd...
        npm install --production >nul 2>&1
    )
    echo  [OK] Paketler yuklendi
) else (
    echo  [OK] Paketler artiq movcuddur
)

:: ── 7. Agent-i başlat ──
echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║  Agent basladilir... Bu pencereni BAGLAMAYIN  ║
echo  ║  Edge brauzer avtomatik acilacaq.             ║
echo  ║  Sertifikat ile daxil olun.                   ║
echo  ╚══════════════════════════════════════════════╝
echo.

cd /d "%WORK_DIR%"
node agent.js

:: Əgər agent crash edərsə, yenidən cəhd et
echo.
echo  [!] Agent dayandi. 5 saniyeden sonra yeniden basladilir...
timeout /t 5 >nul
goto :restart

:restart
cd /d "%WORK_DIR%"
node agent.js
goto :restart
