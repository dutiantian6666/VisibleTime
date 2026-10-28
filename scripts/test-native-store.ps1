$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$directory = Join-Path $projectRoot ('desktop-test-data/native-store-' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
New-Item -ItemType Directory -Force $directory | Out-Null
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$executable = Join-Path $directory 'NativeStoreTests.exe'
& $compiler '/nologo' '/target:exe' '/platform:x64' "/out:$executable" '/reference:System.Web.Extensions.dll' "$projectRoot\desktop-native\Store.cs" "$projectRoot\tests\NativeStore.cs"
if ($LASTEXITCODE -ne 0) { throw 'Native store tests did not compile.' }
& $executable $directory
if ($LASTEXITCODE -ne 0) { throw 'Native store tests failed.' }
