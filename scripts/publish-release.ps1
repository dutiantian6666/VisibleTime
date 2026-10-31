param([Parameter(Mandatory=$true)][string]$Version)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$repository = 'dutiantian6666/VisibleTime'
$remote = git remote get-url origin
if ($remote -notmatch 'github\.com[:/]dutiantian6666/VisibleTime(?:\.git)?$') { throw 'Unexpected Git remote.' }
if (git status --porcelain) { throw 'Commit all release sources before publishing.' }
$commit = git rev-parse "v$Version^{}"
if ($LASTEXITCODE -ne 0) { throw 'Release tag does not exist.' }
$installer = Join-Path $projectRoot "release/VisibleTime-Setup-$Version-x64.exe"
$checksums = Join-Path $projectRoot "release/SHA256SUMS-$Version.txt"
if (!(Test-Path -LiteralPath $checksums)) { $checksums = Join-Path $projectRoot 'release/SHA256SUMS.txt' }
$file = Get-Item -LiteralPath $installer
if ($file.Length -gt 30000000) { throw 'Installer exceeds the 30 MB limit.' }
$hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
if ((Get-Content -LiteralPath $checksums -Raw).Trim() -ne "$hash  $($file.Name)") { throw 'Checksum file does not match installer.' }
$credentialLines = "protocol=https`nhost=github.com`nusername=dutiantian6666`n`n" | git credential-manager get --no-ui
$credential = @{}
foreach ($line in $credentialLines) {
    $parts = $line.Split('=', 2)
    if ($parts.Length -eq 2) { $credential[$parts[0]] = $parts[1] }
}
if (!$credential.password) { throw 'GitHub authentication is unavailable.' }
$headers = @{
    Authorization = "Bearer $($credential.password)"
    Accept = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
}
try {
    $releases = @(Invoke-RestMethod -Uri "https://api.github.com/repos/$repository/releases?per_page=100" -Headers $headers)
    $release = $releases | Where-Object tag_name -eq "v$Version" | Select-Object -First 1
    if ($release -and !$release.draft) { throw 'This version is already published. Published releases will not be overwritten.' }
    if (!$release) {
        $body = @{
            tag_name = "v$Version"; target_commitish = $commit
            name = "VisibleTime v$Version"
            body = (Get-Content -LiteralPath (Join-Path $projectRoot "docs/RELEASE-v$Version.md") -Raw -Encoding utf8)
            draft = $true; prerelease = $false
        } | ConvertTo-Json
        $release = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$repository/releases" -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
    }
    $upload = $release.upload_url.Split('{')[0]
    foreach ($assetFile in @($installer, $checksums)) {
        $assetInfo = Get-Item -LiteralPath $assetFile
        $assetName = if ($assetFile -eq $checksums) { 'SHA256SUMS.txt' } else { $assetInfo.Name }
        $assetHash = (Get-FileHash -LiteralPath $assetFile -Algorithm SHA256).Hash.ToLowerInvariant()
        $asset = $release.assets | Where-Object name -eq $assetName | Select-Object -First 1
        if (!$asset) {
            $asset = Invoke-RestMethod -Method Post -Uri ($upload + '?name=' + [Uri]::EscapeDataString($assetName)) -Headers $headers -ContentType 'application/octet-stream' -InFile $assetFile
        }
        if ($asset.size -ne $assetInfo.Length -or $asset.digest -ne "sha256:$assetHash") { throw 'Uploaded asset verification failed.' }
        Write-Output ("Verified {0}: {1} bytes, SHA256 {2}" -f $asset.name, $asset.size, $assetHash)
    }
    $published = Invoke-RestMethod -Method Patch -Uri "https://api.github.com/repos/$repository/releases/$($release.id)" -Headers $headers -ContentType 'application/json' -Body '{"draft":false,"make_latest":"true"}'
    Write-Output ("Published: " + $published.html_url)
} finally {
    $headers.Clear()
    $credential.Clear()
    $credentialLines = $null
}
