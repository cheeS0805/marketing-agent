# Запуск агента без людини: .\run.ps1
# Працює через вхід Claude Code (підписка), витрачає її ліміт.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (Select-String -Path 'knowledge\target.md' -Pattern 'ЗАПОВНИТИ' -Quiet) {
    Write-Error 'Спершу заповніть knowledge\target.md (сайт, Instagram).'
}

$date = Get-Date -Format 'yyyy-MM-dd-HHmm'
$report = "reports/audit-$date.md"
New-Item -ItemType Directory -Force reports | Out-Null

$prompt = "Проведи маркетинговий аудит за інструкцією з CLAUDE.md. Збережи звіт у файл $report."

claude -p $prompt --model sonnet --permission-mode dontAsk --output-format json | Out-File "reports/audit-$date.json" -Encoding utf8

node scripts/check-report.mjs $report
if ($LASTEXITCODE -ne 0) { exit 1 }
Write-Host "Готово: $report"
