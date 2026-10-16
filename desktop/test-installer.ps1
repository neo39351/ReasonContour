[CmdletBinding()]
param([string]$Installer)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
if (!$Installer) { $Installer = Join-Path $projectRoot "release/ReasonContour-$version-windows-x64-setup.exe" }
$Installer = (Resolve-Path -LiteralPath $Installer).Path
# Do not replace an existing user's registered installation during a smoke test.
$uninstallKey = 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/{5D0B872F-AB0A-48D7-A9D4-C2FA98BD633B}_is1'
if (Test-Path -LiteralPath $uninstallKey) { throw 'An installed ReasonContour already exists. Run this test in a clean Windows account or CI.' }
$base = [IO.Path]::GetFullPath((Join-Path $projectRoot '.test-data'))
$testRoot = [IO.Path]::GetFullPath((Join-Path $base ('installer-smoke-' + [guid]::NewGuid().ToString('N'))))
if (!$testRoot.StartsWith($base + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected smoke-test path.' }
$installDir = Join-Path $testRoot 'Installed App'
New-Item -ItemType Directory -Force $testRoot | Out-Null
$oldPath = $env:PATH
$oldNode = $env:REASONCONTOUR_NODE
$oldData = $env:REASONCONTOUR_DATA_DIR
$uninstalled = $false
try {
    $setup = Start-Process -FilePath $Installer -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/NOICONS','/TASKS=',"/DIR=`"$installDir`"", "/LOG=`"$testRoot/setup.log`"") -WindowStyle Hidden -Wait -PassThru
    if ($setup.ExitCode -ne 0) { throw "Installation failed ($($setup.ExitCode)). See $testRoot/setup.log" }
    if (Test-Path -LiteralPath (Join-Path $installDir 'node_modules')) { throw 'Unexpected node_modules in installer.' }
    $env:PATH = "$env:WINDIR/System32;$env:WINDIR"
    $env:REASONCONTOUR_NODE = $null
    $env:REASONCONTOUR_DATA_DIR = $null
    $app = Start-Process -FilePath (Join-Path $installDir 'desktop/ReasonContour.App.exe') -ArgumentList '--self-test' -WindowStyle Hidden -PassThru
    if (!$app.WaitForExit(90000)) { $app.Kill(); throw 'Installed application self-test timed out.' }
    $app.Refresh()
    if ($app.ExitCode -ne 0) {
        $errorFile = Join-Path $installDir '.test-data/desktop-test-error.txt'
        if (Test-Path -LiteralPath $errorFile) { Get-Content -LiteralPath $errorFile | Write-Host }
        throw "Installed application self-test failed ($($app.ExitCode))."
    }
    $report = Get-Content -LiteralPath (Join-Path $installDir '.test-data/desktop-package-test.json') -Raw | ConvertFrom-Json
    if (!$report.installedMode -or !$report.bundledNode) { throw 'Installed application did not use its bundled runtime.' }
    $expectedData = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'ReasonContour/projects'
    if ([IO.Path]::GetFullPath($report.defaultDataDirectory) -ne [IO.Path]::GetFullPath($expectedData)) { throw 'Installed data path is incorrect.' }
    $data = Join-Path $installDir '.test-data/desktop-data'
    $cli = & (Join-Path $installDir 'runtime/node.exe') (Join-Path $installDir 'app/cli.mjs') --data-dir $data projects
    if ($LASTEXITCODE -ne 0) { throw 'Installed CLI failed.' }
    $null = $cli | ConvertFrom-Json
    # A private fixture inside the test install must survive an upgrade and uninstall.
    $retained = Join-Path $installDir '.test-data/retained-user-data.txt'
    Set-Content -LiteralPath $retained -Value 'preserve me'
    $upgrade = Start-Process -FilePath $Installer -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/NOICONS','/TASKS=',"/DIR=`"$installDir`"") -WindowStyle Hidden -Wait -PassThru
    if ($upgrade.ExitCode -ne 0 -or !(Test-Path -LiteralPath $retained)) { throw 'Reinstallation failed to preserve existing data.' }
    $uninstall = Start-Process -FilePath (Join-Path $installDir 'unins000.exe') -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART', "/LOG=`"$testRoot/uninstall.log`"") -WindowStyle Hidden -Wait -PassThru
    if ($uninstall.ExitCode -ne 0 -or (Test-Path -LiteralPath (Join-Path $installDir 'desktop/ReasonContour.App.exe'))) { throw 'Uninstallation failed.' }
    $uninstalled = $true
    if (!(Test-Path -LiteralPath $retained)) { throw 'Uninstallation removed user-created data.' }
    Write-Host 'PASS: install, bundled Node without PATH, real WebView2 UI, CLI, reinstall, uninstall, retained user-created files.'
} finally {
    $env:PATH = $oldPath
    $env:REASONCONTOUR_NODE = $oldNode
    $env:REASONCONTOUR_DATA_DIR = $oldData
    if (!$uninstalled -and (Test-Path -LiteralPath (Join-Path $installDir 'unins000.exe'))) {
        Start-Process -FilePath (Join-Path $installDir 'unins000.exe') -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART') -WindowStyle Hidden -Wait | Out-Null
    }
    # The resolved target is checked again immediately before recursive cleanup.
    $resolved = [IO.Path]::GetFullPath($testRoot)
    if (!$resolved.StartsWith($base + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe cleanup target.' }
    if ($uninstalled) { Remove-Item -LiteralPath $resolved -Recurse -Force }
    else { Write-Host "Test evidence retained in $testRoot" }
}
