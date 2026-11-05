[Setup]
AppName=ChessAsh PATH function tests
AppVersion=1.0.0
DefaultDirName={tmp}\ChessAshPathTests
Uninstallable=no
CreateAppDir=no
PrivilegesRequired=lowest
OutputDir=..\..\work\inno-tests
OutputBaseFilename=path-functions
Compression=none
SetupLogging=yes

[Code]
#include "..\PathFunctions.iss"

procedure Require(Condition: Boolean; const Message: String);
begin
  if not Condition then RaiseException(Message);
end;

function InitializeSetup: Boolean;
var
  Report, Temp: String;
begin
  Report := ExpandConstant('{param:REPORT|}');
  Require(Report <> '', 'A report path is required.');
  Require(PathContainsEntry('C:\Keep; "c:\ChessAsh\" ;C:\Tail', 'C:\ChessAsh'), 'quoted case-insensitive path');
  Require(not PathContainsEntry('C:\ChessAshExtra;C:\Keep', 'C:\ChessAsh'), 'no substring matching');
  Require(AppendPathEntry('C:\Keep;', 'C:\ChessAsh') = 'C:\Keep;C:\ChessAsh', 'trailing delimiter append');
  Require(AppendPathEntry('C:\Keep;C:\ChessAsh', 'C:\ChessAsh\') = 'C:\Keep;C:\ChessAsh', 'no duplicate append');
  Require(RemovePathEntry('C:\Keep;C:\ChessAshExtra;"c:\chessash\";C:\Tail', 'C:\ChessAsh') = 'C:\Keep;C:\ChessAshExtra;C:\Tail', 'exact removal preserves other tokens');
  Require(RemovePathEntry('C:\Keep;;C:\ChessAsh;C:\Tail;', 'C:\ChessAsh') = 'C:\Keep;;C:\Tail;', 'empty tokens preserved');
  Temp := GetEnv('TEMP');
  Require(PathContainsEntry('%TEMP%\ChessAsh', AddBackslash(Temp) + 'ChessAsh'), 'environment expansion match');
  SaveStringToFile(Report, '{"passed":true,"checks":7}', False);
  Result := False;
end;
