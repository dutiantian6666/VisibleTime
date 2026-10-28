$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$installer = Join-Path $projectRoot "release/VisibleTime-Setup-$version-x64.exe"
if ((Get-Item -LiteralPath $installer).Length -gt 30000000) { throw 'Installer exceeds 30 MB.' }
$directory = Join-Path $projectRoot ('desktop-test-data/installed-' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
# /TEST disables shortcut and registry changes for this isolated installation.
$process = Start-Process -FilePath $installer -ArgumentList @('/S', '/TEST', "/D=$directory") -WindowStyle Hidden -PassThru -Wait
if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
$executable = Join-Path $directory 'VisibleTime.exe'
if (!(Test-Path -LiteralPath $executable)) { throw 'Installer did not create the application.' }
$env:VISIBLE_TIME_EXECUTABLE = $executable
try {
    node (Join-Path $projectRoot 'tests/native-desktop.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Installed application checks failed.' }
} finally { Remove-Item Env:VISIBLE_TIME_EXECUTABLE }
$sentinel = Join-Path $directory 'keep-user-file.txt'
Set-Content -LiteralPath $sentinel -Value 'Preserve files that are not owned by the application.'
Start-Process -FilePath (Join-Path $directory 'Uninstall.exe') -ArgumentList '/S' -WindowStyle Hidden -Wait
for ($attempt = 0; $attempt -lt 50 -and (Test-Path -LiteralPath $executable); $attempt++) { Start-Sleep -Milliseconds 200 }
if (Test-Path -LiteralPath $executable) { throw 'Uninstall did not remove the application.' }
if (!(Test-Path -LiteralPath $sentinel)) { throw 'Uninstall deleted an unrelated file.' }
Write-Output 'Installer checks passed: isolated install, installed application lifecycle, uninstall, and unrelated-file preservation.'
