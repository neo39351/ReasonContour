[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$cache = Join-Path $projectRoot '.desktop-deps/installer'
$releaseRoot = Join-Path $projectRoot 'release'
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Installer requires a numeric major.minor.patch version.' }
$nodeVersion = '24.18.1'
$innoVersion = '6.7.3'
New-Item -ItemType Directory -Force $cache, $releaseRoot | Out-Null
function Download([string]$Url, [string]$Destination) {
    if (!(Test-Path -LiteralPath $Destination)) {
        Write-Host "Downloading $Url"
        Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile "$Destination.download"
        Move-Item -LiteralPath "$Destination.download" -Destination $Destination -Force
    }
}
function SignedBy([string]$File, [string]$Publisher) {
    $signature = Get-AuthenticodeSignature -LiteralPath $File
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch $Publisher) {
        throw "Publisher verification failed: $File ($($signature.Status))"
    }
}
Push-Location $projectRoot
try {
    & (Join-Path $PSScriptRoot 'build.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Windows host build failed.' }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }

    $nodeArchive = Join-Path $cache "node-v$nodeVersion-win-x64.zip"
    Download "https://nodejs.org/dist/v$nodeVersion/node-v$nodeVersion-win-x64.zip" $nodeArchive
    $checksums = (Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$nodeVersion/SHASUMS256.txt").Content
    $escapedName = [regex]::Escape("node-v$nodeVersion-win-x64.zip")
    $match = [regex]::Match($checksums, "(?m)^([a-f0-9]{64})\s+$escapedName\s*$")
    if (!$match.Success -or (Get-FileHash -LiteralPath $nodeArchive -Algorithm SHA256).Hash -ne $match.Groups[1].Value) { throw 'Node.js archive SHA-256 verification failed.' }
    $nodeDir = Join-Path $cache "node-v$nodeVersion-win-x64"
    if (!(Test-Path -LiteralPath (Join-Path $nodeDir 'node.exe'))) { Expand-Archive -LiteralPath $nodeArchive -DestinationPath $cache -Force }

    $innoSetup = Join-Path $cache "innosetup-$innoVersion.exe"
    $compiler = Join-Path $cache "inno-$innoVersion/ISCC.exe"
    if (!(Test-Path -LiteralPath $compiler)) {
        $tag = 'is-' + $innoVersion.Replace('.', '_')
        Download "https://github.com/jrsoftware/issrc/releases/download/$tag/innosetup-$innoVersion.exe" $innoSetup
        SignedBy $innoSetup 'Pyrsys|Jordan Russell'
        $innoDir = Split-Path -Parent $compiler
        $process = Start-Process -FilePath $innoSetup -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/CURRENTUSER','/NOICONS',"/DIR=`"$innoDir`"") -WindowStyle Hidden -Wait -PassThru
        if ($process.ExitCode -ne 0 -or !(Test-Path -LiteralPath $compiler)) { throw "Inno Setup compiler installation failed ($($process.ExitCode))." }
    }
    $chinese = Join-Path $cache "ChineseSimplified-$innoVersion.isl"
    Download "https://raw.githubusercontent.com/jrsoftware/issrc/is-$($innoVersion.Replace('.','_'))/Files/Languages/Unofficial/ChineseSimplified.isl" $chinese
    $bootstrapper = Join-Path $cache 'MicrosoftEdgeWebview2Setup.exe'
    Download 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' $bootstrapper
    SignedBy $bootstrapper 'O=Microsoft Corporation'

    # Fresh staging avoids stale files and never traverses project data or caches.
    $stage = Join-Path $cache ('stage-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force (Join-Path $stage 'app'), (Join-Path $stage 'desktop'), (Join-Path $stage 'runtime'), (Join-Path $stage 'licenses') | Out-Null
    $serverFiles = @('agent-context.mjs','preferences.mjs','storage.mjs','model.mjs','service.mjs','server.mjs','connection.mjs','cli.mjs','mcp.mjs','tools.mjs')
    foreach ($file in $serverFiles) { Copy-Item -LiteralPath (Join-Path $projectRoot "app/$file") -Destination (Join-Path $stage 'app') }
    Copy-Item -LiteralPath (Join-Path $projectRoot 'app/dist') -Destination (Join-Path $stage 'app') -Recurse
    foreach ($file in @('ReasonContour.App.exe','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll','WebView2-LICENSE.txt')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $stage 'desktop')
    }
    Copy-Item -LiteralPath (Join-Path $nodeDir 'node.exe') -Destination (Join-Path $stage 'runtime')
    Copy-Item -LiteralPath (Join-Path $nodeDir 'LICENSE') -Destination (Join-Path $stage 'licenses/Node.js-LICENSE.txt')
    foreach ($file in @('LICENSE','THIRD_PARTY_NOTICES.md','package.json')) { Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $stage }
    & node (Join-Path $projectRoot 'scripts/bundle-notices.mjs') (Join-Path $stage 'licenses')
    if ($LASTEXITCODE -ne 0) { throw 'Dependency license collection failed.' }
    @{ version = $version; platform = 'windows-x64'; node = $nodeVersion } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'installed.json') -Encoding UTF8
    & $compiler "/DAppVersion=$version" "/DSourceRoot=$projectRoot" "/DStageDir=$stage" "/DOutputDir=$releaseRoot" "/DBootstrapper=$bootstrapper" "/DChineseLanguage=$chinese" (Join-Path $PSScriptRoot 'installer.iss')
    if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed.' }
    $installer = Join-Path $releaseRoot "ReasonContour-$version-windows-x64-setup.exe"
    $hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $([IO.Path]::GetFileName($installer))" | Set-Content -LiteralPath (Join-Path $releaseRoot 'SHA256SUMS.txt') -Encoding ASCII
    Write-Host "Installer: $installer"
} finally { Pop-Location }
