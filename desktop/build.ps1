$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
& node (Join-Path $projectRoot 'scripts/build-icons.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Icon generation failed.' }
$sdk = Join-Path $projectRoot '.desktop-deps/webview2'
if (!(Test-Path -LiteralPath "$sdk/lib/net462/Microsoft.Web.WebView2.Core.dll")) {
    New-Item -ItemType Directory -Force (Join-Path $projectRoot '.desktop-deps') | Out-Null
    Invoke-WebRequest -Uri 'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.4191.47/microsoft.web.webview2.1.0.4191.47.nupkg' -OutFile (Join-Path $projectRoot '.desktop-deps/webview2.zip')
    Expand-Archive -LiteralPath (Join-Path $projectRoot '.desktop-deps/webview2.zip') -DestinationPath $sdk -Force
}
Copy-Item -LiteralPath "$sdk/lib/net462/Microsoft.Web.WebView2.Core.dll" -Destination $PSScriptRoot -Force
Copy-Item -LiteralPath "$sdk/lib/net462/Microsoft.Web.WebView2.WinForms.dll" -Destination $PSScriptRoot -Force
Copy-Item -LiteralPath "$sdk/runtimes/win-x64/native/WebView2Loader.dll" -Destination $PSScriptRoot -Force
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /platform:x64 /optimize+ "/out:$PSScriptRoot\ReasonContour.App.exe" "/win32icon:$projectRoot\app\ui\public\logo.ico" "/resource:$projectRoot\app\ui\public\logo.ico,ReasonContour.Icon" "/win32manifest:$PSScriptRoot\app.manifest" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll "/reference:$PSScriptRoot\Microsoft.Web.WebView2.Core.dll" "/reference:$PSScriptRoot\Microsoft.Web.WebView2.WinForms.dll" "$PSScriptRoot\ReasonContour.cs"
if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed.' }
# Refresh this file and its image-list slot. UPDATEITEM alone can leave an
# already-open Explorer view displaying the icon previously used at this path.
if (-not ('ReasonContourIconRefresh' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ReasonContourIconRefresh {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct FileInfo {
        public IntPtr icon; public int index; public uint attributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string name;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string type;
    }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr SHGetFileInfo(string path, uint attributes, out FileInfo info, uint size, uint flags);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    public static extern void SHUpdateImage(string path, int iconIndex, uint flags, int imageIndex);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    public static extern void SHChangeNotify(uint eventId, uint flags, string item, IntPtr other);
    [DllImport("shell32.dll", EntryPoint = "SHChangeNotify")]
    public static extern void NotifyImage(uint eventId, uint flags, IntPtr item, IntPtr other);
}
'@
}
$rcExecutable = Join-Path $PSScriptRoot 'ReasonContour.App.exe'
$rcFileInfo = New-Object ReasonContourIconRefresh+FileInfo
$rcImageList = [ReasonContourIconRefresh]::SHGetFileInfo($rcExecutable, 0, [ref]$rcFileInfo, [Runtime.InteropServices.Marshal]::SizeOf($rcFileInfo), 0x4000)
if ($rcImageList -ne [IntPtr]::Zero) {
    [ReasonContourIconRefresh]::SHUpdateImage($rcExecutable, 0, 0, $rcFileInfo.index)
    [ReasonContourIconRefresh]::NotifyImage(0x8000, 0x1003, [IntPtr]::Zero, [IntPtr]::new($rcFileInfo.index))
}
[ReasonContourIconRefresh]::SHChangeNotify(0x2000, 0x1005, $rcExecutable, [IntPtr]::Zero)
[ReasonContourIconRefresh]::SHChangeNotify(0x1000, 0x1005, $PSScriptRoot, [IntPtr]::Zero)
if (Test-Path -LiteralPath (Join-Path $sdk 'LICENSE.txt')) { Copy-Item -LiteralPath (Join-Path $sdk 'LICENSE.txt') -Destination (Join-Path $PSScriptRoot 'WebView2-LICENSE.txt') -Force }
Write-Output "Built desktop/ReasonContour.App.exe"
