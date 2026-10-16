#ifndef AppVersion
  #error AppVersion must be supplied by build-installer.ps1
#endif

[Setup]
AppId={{5D0B872F-AB0A-48D7-A9D4-C2FA98BD633B}
AppName=ReasonContour
AppVersion={#AppVersion}
AppPublisher=ReasonContour contributors
AppPublisherURL=https://github.com/neo39351/ReasonContour
AppSupportURL=https://github.com/neo39351/ReasonContour/issues
AppUpdatesURL=https://github.com/neo39351/ReasonContour/releases
DefaultDirName={localappdata}\Programs\ReasonContour
DefaultGroupName=ReasonContour
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
AppMutex=Local\ReasonContour.Desktop
CloseApplications=no
RestartApplications=no
AllowNoIcons=yes
DisableProgramGroupPage=yes
LicenseFile={#SourceRoot}\LICENSE
SetupIconFile={#SourceRoot}\app\ui\public\logo.ico
UninstallDisplayIcon={app}\desktop\ReasonContour.App.exe
OutputDir={#OutputDir}
OutputBaseFilename=ReasonContour-{#AppVersion}-windows-x64-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "chinesesimplified"; MessagesFile: "{#ChineseLanguage}"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#Bootstrapper}"; DestName: "MicrosoftEdgeWebview2Setup.exe"; Flags: dontcopy

[Icons]
Name: "{group}\ReasonContour"; Filename: "{app}\desktop\ReasonContour.App.exe"
Name: "{autodesktop}\ReasonContour"; Filename: "{app}\desktop\ReasonContour.App.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\desktop\ReasonContour.App.exe"; Description: "{cm:LaunchProgram,ReasonContour}"; Flags: nowait postinstall skipifsilent

[CustomMessages]
english.WebViewStatus=Installing Microsoft Edge WebView2 Runtime...
english.WebViewError=WebView2 Runtime could not be installed. Connect to the internet and run Setup again.
chinesesimplified.WebViewStatus=正在安装 Microsoft Edge WebView2 Runtime...
chinesesimplified.WebViewError=无法安装 WebView2 Runtime。请连接互联网后重新运行安装程序。

[Code]
function RuntimeInRoot(RootKey: Integer): Boolean;
var Version: String;
begin
  Result := RegQueryStringValue(RootKey, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version)
    and (Version <> '') and (Version <> '0.0.0.0');
end;

function HasWebView2: Boolean;
begin
  Result := RuntimeInRoot(HKCU32) or RuntimeInRoot(HKCU64) or RuntimeInRoot(HKLM32) or RuntimeInRoot(HKLM64);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var ExitCode: Integer;
begin
  Result := '';
  if not HasWebView2 then begin
    WizardForm.StatusLabel.Caption := CustomMessage('WebViewStatus');
    ExtractTemporaryFile('MicrosoftEdgeWebview2Setup.exe');
    if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then
      Result := CustomMessage('WebViewError')
    else if not HasWebView2 then
      Result := CustomMessage('WebViewError');
  end;
end;
