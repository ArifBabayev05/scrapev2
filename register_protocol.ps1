# LegalBot Protocol Handler Registration Script
# Bu script "legalbot://" protokolunu qeydiyyata alır ki,
# brauzerdən legalbot:// linki kliklənəndə EXE avtomatik açılsın.

$path = "C:\bot\bot_service.exe"
$protocol = "legalbot"
$regPath = "HKCU:\Software\Classes\$protocol"

# Əgər artıq qeydiyyatda varsa, yenidən yazmaq üçün silib yenidən yaradırıq
if (Test-Path $regPath) {
    Remove-Item -Path $regPath -Recurse -Force
    Write-Host "Kohne qeydiyyat silindi, yenisi yaradilir..." -ForegroundColor Yellow
}

# Protocol handler yaradılır
New-Item -Path $regPath -Force | Out-Null
Set-ItemProperty -Path $regPath -Name "(Default)" -Value "URL:Legal Bot Protocol"
Set-ItemProperty -Path $regPath -Name "URL Protocol" -Value ""

# Shell command yaradılır (%1 URL-i EXE-yə ötürür)
New-Item -Path "$regPath\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$regPath\shell\open\command" -Name "(Default)" -Value "`"$path`" `"%1`""

# Yoxlama
$registeredValue = Get-ItemProperty -Path "$regPath\shell\open\command" -Name "(Default)" -ErrorAction SilentlyContinue
if ($registeredValue) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host " Ugurlu! Protokol qeydiyyata alindi!" -ForegroundColor Green
    Write-Host " Protokol: $protocol://" -ForegroundColor Cyan
    Write-Host " EXE yolu: $path" -ForegroundColor Cyan
    Write-Host " Registry: $($registeredValue.'(Default)')" -ForegroundColor Gray
    Write-Host "========================================" -ForegroundColor Green
} else {
    Write-Host "XETA: Protokol qeydiyyata alinmadi!" -ForegroundColor Red
}
