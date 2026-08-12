@echo off
chcp 65001 >nul
title TrackDesk - Yayinda

:: Bu dosya TrackDesk'i bilgisayarindan INTERNETE ACIK bir tunel uzerinden
:: yayinlar (Cloudflare Quick Tunnel - hesap/kayit gerekmez). Kuzenin veya
:: musterin, ayni Wi-Fi'da olmasa bile internetten asagida verilecek linke
:: girip siteyi deneyebilir. Pencereyi kapatma - kapatirsan yayin durur.

set "PROJECT=%~dp0"
set "PROJECT=%PROJECT:~0,-1%"
set "PORT=8090"
set "PHP=C:\xampp\php\php.exe"
set "TUNNEL_LOG=%TEMP%\trackdesk-tunnel.log"

if not exist "%PHP%" (
  echo HATA: PHP bulunamadi: %PHP%
  echo XAMPP'i farkli bir yere kurduysan bu dosyadaki PHP satirini duzelt.
  pause
  exit /b 1
)

where cloudflared >nul 2>nul
if errorlevel 1 (
  echo HATA: cloudflared bulunamadi.
  echo Kurulum icin: winget install Cloudflare.cloudflared
  pause
  exit /b 1
)

if exist "%TUNNEL_LOG%" del /f /q "%TUNNEL_LOG%" >nul 2>nul

start "TrackDesk Sunucu" /MIN "%PHP%" -S 0.0.0.0:%PORT% -t "%PROJECT%"
start "TrackDesk Tunel" /MIN cmd /c "cloudflared tunnel --url http://localhost:%PORT% > "%TUNNEL_LOG%" 2>&1"

echo Tunel olusturuluyor, lutfen bekle...
echo.

set "TUNNELURL="
set /a tries=0
:waitloop
if defined TUNNELURL goto tunnelready
set /a tries+=1
if %tries% GEQ 25 goto tunnelready
timeout /t 1 /nobreak >nul
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "if (Test-Path '%TUNNEL_LOG%') { (Select-String -Path '%TUNNEL_LOG%' -Pattern 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1).Matches.Value }"`) do set "TUNNELURL=%%i"
goto waitloop
:tunnelready

echo ================================================
echo  TrackDesk yayinda!
echo ================================================
echo.
echo  Bu bilgisayardan:
echo    http://localhost:%PORT%/tanitim.html
echo.
if defined TUNNELURL (
  echo  Internetten herkese acik link ^(kuzenin dahil, her yerden^):
  echo    %TUNNELURL%/tanitim.html
  echo.
) else (
  echo  UYARI: Tunel linki 25 saniyede alinamadi.
  echo  Internet baglantini kontrol edip tekrar dene.
  echo.
)
echo  Ilk acilista Windows Guvenlik Duvari sorarsa "Erisime izin ver" de.
echo.
echo  Yayini durdurmak icin bu pencereye gel, herhangi bir tusa bas.
echo ================================================
echo.

start "" "http://localhost:%PORT%/tanitim.html"

pause >nul
taskkill /F /IM php.exe >nul 2>nul
taskkill /F /IM cloudflared.exe >nul 2>nul
echo  Yayin durduruldu.
timeout /t 2 /nobreak >nul
