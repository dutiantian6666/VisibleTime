param([switch]$CompileOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$package = Get-Content (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$version = $package.version
$sdkRoot = Join-Path $projectRoot 'artifacts/native-sdk'
$sdk = Join-Path $sdkRoot 'webview2'
$sdkVersion = '1.0.4314.35'
$sdkHash = '90778DEB1B77E36292828B4B5833C9255C27533F40E0DDD55891AE718944EDC4'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw 'The Windows .NET Framework C# compiler is required.' }
New-Item -ItemType Directory -Force $sdkRoot | Out-Null
$archive = Join-Path $sdkRoot 'webview2.zip'
if (!(Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$sdkVersion/microsoft.web.webview2.$sdkVersion.nupkg" -OutFile $archive
}
if ((Get-FileHash -LiteralPath $archive).Hash -ne $sdkHash) { throw 'WebView2 SDK checksum mismatch.' }
if (!(Test-Path -LiteralPath (Join-Path $sdk 'lib/net462/Microsoft.Web.WebView2.Core.dll'))) {
    Expand-Archive -LiteralPath $archive -DestinationPath $sdk -Force
}
$appDirectory = Join-Path $projectRoot "release/native-$version"
$uiDirectory = Join-Path $appDirectory 'ui'
New-Item -ItemType Directory -Force $uiDirectory | Out-Null
$uiFiles = @('index.html', 'styles.css', 'app.js', 'core.js', 'history.js', 'favicon.svg')
if (Test-Path -LiteralPath (Join-Path $projectRoot 'calendar.js')) { $uiFiles += 'calendar.js' }
foreach ($file in $uiFiles) { Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $uiDirectory }
foreach ($file in @('Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll')) {
    Copy-Item -LiteralPath (Join-Path $sdk "lib/net462/$file") -Destination $appDirectory
}
Copy-Item -LiteralPath (Join-Path $sdk 'runtimes/win-x64/native/WebView2Loader.dll') -Destination $appDirectory
Copy-Item -LiteralPath (Join-Path $sdk 'LICENSE.txt') -Destination (Join-Path $appDirectory 'WebView2-LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $projectRoot 'desktop/assets/icon.ico') -Destination $appDirectory
Copy-Item -LiteralPath (Join-Path $projectRoot 'desktop-native/bridge.js') -Destination $appDirectory
Copy-Item -LiteralPath (Join-Path $projectRoot 'desktop-native/App.config') -Destination (Join-Path $appDirectory 'VisibleTime.exe.config')
$versionSource = Join-Path $sdkRoot 'Version.cs'
Set-Content -LiteralPath $versionSource -Encoding utf8 -Value @"
using System.Reflection;
[assembly: AssemblyVersion("$version.0")]
[assembly: AssemblyFileVersion("$version.0")]
"@
$arguments = @(
    '/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/utf8output',
    "/out:$appDirectory\VisibleTime.exe",
    "/win32icon:$projectRoot\desktop\assets\icon.ico",
    "/win32manifest:$projectRoot\desktop-native\app.manifest",
    '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll',
    "/reference:$appDirectory\Microsoft.Web.WebView2.Core.dll",
    "/reference:$appDirectory\Microsoft.Web.WebView2.WinForms.dll",
    "$projectRoot\desktop-native\Store.cs", "$projectRoot\desktop-native\App.cs", $versionSource.Replace('/', '\')
)
& $compiler @arguments
if ($LASTEXITCODE -ne 0) { throw 'Native compilation failed.' }
if ($CompileOnly) { Write-Output "Compiled $appDirectory"; exit }
$bootstrapper = Join-Path $sdkRoot 'MicrosoftEdgeWebview2Setup.exe'
if (!(Test-Path -LiteralPath $bootstrapper)) {
    Invoke-WebRequest 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $bootstrapper
}
$signature = Get-AuthenticodeSignature -LiteralPath $bootstrapper
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
    throw 'The WebView2 bootstrapper must have a valid Microsoft signature.'
}
$nsis = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'electron-builder/Cache/nsis-*') -Filter makensis.exe -Recurse |
    Where-Object { $_.Directory.Name -ne 'Bin' } | Select-Object -First 1 -ExpandProperty FullName
if (!$nsis) {
    $command = Get-Command makensis.exe -ErrorAction SilentlyContinue
    if ($command) { $nsis = $command.Source }
}
if (!$nsis) { throw 'NSIS 3 is required to create the installer. Install it or set it on PATH.' }
$installer = Join-Path $projectRoot "release/VisibleTime-Setup-$version-x64.exe"
& $nsis '/INPUTCHARSET' 'UTF8' "/DVERSION=$version" "/DAPPDIR=$appDirectory" "/DBOOTSTRAPPER=$bootstrapper" "/DOUTPUT=$installer" (Join-Path $projectRoot 'desktop-native/installer.nsi')
if ($LASTEXITCODE -ne 0) { throw 'NSIS packaging failed.' }
$size = (Get-Item -LiteralPath $installer).Length
if ($size -gt 30000000) { throw "Installer exceeds the 30 MB release budget: $size bytes." }
$hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath (Join-Path $projectRoot 'release/SHA256SUMS.txt') -Encoding ascii -Value "$hash  VisibleTime-Setup-$version-x64.exe"
Write-Output ("Installer: {0}, {1:N2} MB ({2:N2} MiB)" -f $installer, ($size / 1000000), ($size / 1MB))
