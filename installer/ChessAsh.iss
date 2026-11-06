#ifndef AppVersion
  #define AppVersion "1.3.0"
#endif
#ifndef AppPublisher
  #define AppPublisher "FlameDev Studios"
#endif
#ifndef AppURL
  #define AppURL "https://github.com/FlameFirelife"
#endif
#ifndef ProjectRoot
  #define ProjectRoot AddBackslash(SourcePath) + ".."
#endif
#ifndef AppSourceDir
  #define AppSourceDir ProjectRoot + "\release\win-unpacked"
#endif
#ifndef AppDocsDir
  #define AppDocsDir ProjectRoot + "\work\release-docs"
#endif
#ifndef InstallerOutputDir
  #define InstallerOutputDir ProjectRoot + "\release"
#endif
#ifdef TestBuild
  #define SetupAppId "6907BD72-BAAF-4FC5-9D7B-B5A41CD239A1"
  #define EnvironmentKey "Software\ChessAsh\InstallerTest\Environment"
  #define OwnershipKey "Software\ChessAsh\InstallerTest\Ownership"
  #define SetupFilename "ChessAsh-Installer-Test-" + AppVersion
#else
  #define SetupAppId "dc27b760-2c31-5d3e-8bbe-268581f01223"
  #define EnvironmentKey "Environment"
  #define OwnershipKey "Software\ChessAsh\Installer"
  #define SetupFilename "ChessAsh-Setup-" + AppVersion
#endif

[Setup]
AppId={#SetupAppId}
AppName=ChessAsh
AppVersion={#AppVersion}
AppVerName=ChessAsh {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
VersionInfoDescription=ChessAsh Setup
VersionInfoProductName=ChessAsh
VersionInfoProductVersion={#AppVersion}
VersionInfoCompany={#AppPublisher}
DefaultDirName={code:DefaultInstallDirectory}
DefaultGroupName=ChessAsh
UsePreviousAppDir=yes
UsePreviousTasks=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19045
OutputDir={#InstallerOutputDir}
OutputBaseFilename={#SetupFilename}
SetupIconFile={#ProjectRoot}\build\icon.ico
UninstallDisplayIcon={app}\ChessAsh.exe
LicenseFile={#ProjectRoot}\LICENSE
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
ChangesEnvironment=yes
CloseApplications=yes
CloseApplicationsFilter=ChessAsh.exe
RestartApplications=no
DisableProgramGroupPage=yes
SetupMutex=ChessAshInstallerMutex
UninstallDisplayName=ChessAsh
#ifdef SignWindows
SignTool=ChessAsh
SignedUninstaller=yes
#endif

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "addtopath"; Description: "Add ChessAsh to my PATH (run chessash from a new terminal)"; GroupDescription: "Command line:"
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked

[Files]
Source: "{#AppSourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#AppDocsDir}\*"; DestDir: "{app}\docs"; Flags: ignoreversion recursesubdirs createallsubdirs

#ifndef TestBuild
[Icons]
Name: "{autoprograms}\ChessAsh"; Filename: "{app}\ChessAsh.exe"; WorkingDir: "{app}"; AppUserModelID: "dev.flamedev.chessash"
Name: "{autodesktop}\ChessAsh"; Filename: "{app}\ChessAsh.exe"; WorkingDir: "{app}"; AppUserModelID: "dev.flamedev.chessash"; Tasks: desktopicon

[Run]
Filename: "{app}\ChessAsh.exe"; Description: "Open ChessAsh"; Flags: nowait postinstall skipifsilent
#endif

[Code]
#include "PathFunctions.iss"

const
  PathEnvironmentKey = '{#EnvironmentKey}';
  PathOwnershipKey = '{#OwnershipKey}';
  LegacyGuid = 'dc27b760-2c31-5d3e-8bbe-268581f01223';

function OwnedPathEntry(var Entry: String): Boolean;
var
  Owned: Cardinal;
begin
  Owned := 0;
  Result := RegQueryDWordValue(HKCU, PathOwnershipKey, 'OwnsPath', Owned);
  if Result then Result := Owned = 1;
  if Result then Result := RegQueryStringValue(HKCU, PathOwnershipKey, 'PathEntry', Entry);
end;

procedure RemoveOwnedPath;
var
  Entry, Current, Before, After, Updated: String;
  HadValue: Cardinal;
begin
  if not OwnedPathEntry(Entry) then Exit;
  Current := '';
  RegQueryStringValue(HKCU, PathEnvironmentKey, 'Path', Current);
  Before := '';
  After := '';
  HadValue := 1;
  RegQueryStringValue(HKCU, PathOwnershipKey, 'PathBefore', Before);
  RegQueryStringValue(HKCU, PathOwnershipKey, 'PathAfter', After);
  RegQueryDWordValue(HKCU, PathOwnershipKey, 'HadPathValue', HadValue);
  if Current = After then begin
    Updated := Before;
    if HadValue = 0 then begin
      if not RegDeleteValue(HKCU, PathEnvironmentKey, 'Path') then
        Log('The installer could not remove its empty PATH value.');
    end else if not RegWriteExpandStringValue(HKCU, PathEnvironmentKey, 'Path', Updated) then
      Log('The installer could not restore its previous PATH value.');
  end else begin
    Updated := RemovePathEntry(Current, Entry);
    if Updated <> Current then
      if not RegWriteExpandStringValue(HKCU, PathEnvironmentKey, 'Path', Updated) then
        Log('The installer could not remove its PATH entry.');
  end;
  RegWriteDWordValue(HKCU, PathOwnershipKey, 'OwnsPath', 0);
end;

procedure ConfigureUserPath;
var
  Entry, PreviousEntry, Existing, Updated: String;
  Owned, HadValue: Boolean;
begin
  Entry := ExpandConstant('{app}');
  Owned := OwnedPathEntry(PreviousEntry);
  if Owned then begin
    if (NormalizedPathEntry(Entry) <> NormalizedPathEntry(PreviousEntry)) or
       (not WizardIsTaskSelected('addtopath')) then begin
      RemoveOwnedPath;
      Owned := False;
    end;
  end;
  if not WizardIsTaskSelected('addtopath') then Exit;
  Existing := '';
  HadValue := RegQueryStringValue(HKCU, PathEnvironmentKey, 'Path', Existing);
  if PathContainsEntry(Existing, Entry) then begin
    if not Owned then RegWriteDWordValue(HKCU, PathOwnershipKey, 'OwnsPath', 0);
    Exit;
  end;
  Updated := AppendPathEntry(Existing, Entry);
  if not RegWriteExpandStringValue(HKCU, PathEnvironmentKey, 'Path', Updated) then
    RaiseException('ChessAsh was installed, but its PATH entry could not be saved.');
  RegWriteStringValue(HKCU, PathOwnershipKey, 'PathEntry', Entry);
  RegWriteStringValue(HKCU, PathOwnershipKey, 'PathBefore', Existing);
  RegWriteStringValue(HKCU, PathOwnershipKey, 'PathAfter', Updated);
  if HadValue then RegWriteDWordValue(HKCU, PathOwnershipKey, 'HadPathValue', 1)
  else RegWriteDWordValue(HKCU, PathOwnershipKey, 'HadPathValue', 0);
  RegWriteDWordValue(HKCU, PathOwnershipKey, 'OwnsPath', 1);
end;

function KnownLegacyInstallation(const Root: Integer; var Directory, Uninstaller: String): Boolean;
var
  Key, DisplayName, Publisher, Command, VersionSuffix: String;
  I: Integer;
begin
  Result := False;
  Key := 'Software\Microsoft\Windows\CurrentVersion\Uninstall\' + LegacyGuid;
  if not RegQueryStringValue(Root, Key, 'DisplayName', DisplayName) then Exit;
  if CompareText(DisplayName, 'ChessAsh') <> 0 then begin
    if CompareText(Copy(DisplayName, 1, 9), 'ChessAsh ') <> 0 then Exit;
    VersionSuffix := Copy(DisplayName, 10, Length(DisplayName));
    if VersionSuffix = '' then Exit;
    for I := 1 to Length(VersionSuffix) do begin
      if Pos(VersionSuffix[I], '0123456789.') = 0 then Exit;
    end;
  end;
  if not RegQueryStringValue(Root, Key, 'Publisher', Publisher) then Exit;
  if (CompareText(Publisher, 'FlameDev') <> 0) and
     (CompareText(Publisher, 'FlameDev Studios') <> 0) then Exit;
  if not RegQueryStringValue(Root, 'Software\' + LegacyGuid, 'InstallLocation', Directory) then Exit;
  Directory := RemoveBackslashUnlessRoot(Trim(RemoveQuotes(Directory)));
  if Length(Directory) < 4 then Exit;
  if Copy(Directory, 1, 2) = '\\' then Exit;
  Uninstaller := AddBackslash(Directory) + 'Uninstall ChessAsh.exe';
  if not FileExists(AddBackslash(Directory) + 'ChessAsh.exe') then Exit;
  if not FileExists(Uninstaller) then Exit;
  if not RegQueryStringValue(Root, Key, 'UninstallString', Command) then Exit;
  if Pos('"' + Uppercase(Uninstaller) + '"', Uppercase(Command)) <> 1 then Exit;
  Result := True;
end;

function DefaultInstallDirectory(Param: String): String;
var
  Directory, Uninstaller: String;
begin
  Result := ExpandConstant('{localappdata}\Programs\ChessAsh');
#ifndef TestBuild
  if KnownLegacyInstallation(HKCU, Directory, Uninstaller) then Result := Directory;
#endif
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Directory, Uninstaller, TemporaryUninstaller: String;
  ExitCode: Integer;
begin
  Result := '';
#ifndef TestBuild
  if KnownLegacyInstallation(HKLM, Directory, Uninstaller) then begin
    Result := 'An older all-users ChessAsh installation was found. Uninstall it from Windows Settings first, then run this per-user installer. Your saved games and settings are kept.';
    Exit;
  end;
  if KnownLegacyInstallation(HKCU, Directory, Uninstaller) then begin
    Log('Migrating the earlier per-user ChessAsh installer.');
    TemporaryUninstaller := ExpandConstant('{tmp}\ChessAsh-Legacy-Uninstall.exe');
    if not FileCopy(Uninstaller, TemporaryUninstaller, False) then begin
      Result := 'The previous ChessAsh uninstaller could not be prepared. Close ChessAsh and try again.';
      Exit;
    end;
    if not Exec(TemporaryUninstaller, '/S /currentuser --updated _?=' + Directory, ExpandConstant('{tmp}'), SW_HIDE, ewWaitUntilTerminated, ExitCode) then
      Result := 'The previous ChessAsh uninstaller could not run. Close ChessAsh and try again.'
    else if ExitCode <> 0 then
      Result := 'The previous ChessAsh installer could not be upgraded (exit ' + IntToStr(ExitCode) + '). Close ChessAsh and try again.';
  end;
#endif
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then ConfigureUserPath;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then RemoveOwnedPath;
  if CurUninstallStep = usPostUninstall then RegDeleteKeyIncludingSubkeys(HKCU, PathOwnershipKey);
end;
