#Requires -Version 7.4
param(
    [Parameter(Mandatory)][string]$OutputPath,
    [string]$ProfilePath = (Join-Path $env:APPDATA 'chessash'),
    [Parameter(Mandatory)][string]$ElectronPath
)

$ErrorActionPreference = 'Stop'
$profile = (Resolve-Path -LiteralPath $ProfilePath).Path
$electron = (Resolve-Path -LiteralPath $ElectronPath).Path
$output = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
$base = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$temp = [IO.Directory]::CreateTempSubdirectory('chessash-migration-')
$arguments = @((Join-Path $PSScriptRoot 'export-windows.cjs'), $profile, $output, $temp.FullName)
try {
    $body = New-Object System.Diagnostics.ProcessStartInfo
    $body.FileName = $electron
    $body.UseShellExecute = $false
    $body.CreateNoWindow = $true
    foreach ($argument in $arguments) { $body.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::Start($body)
    try {
        if (!$process.WaitForExit(60000)) {
            $process.Kill($true)
            $process.WaitForExit()
            throw 'The V1.5 export timed out. Close ChessAsh and retry.'
        }
        if ($process.ExitCode -ne 0 -or !(Test-Path -LiteralPath $output -PathType Leaf)) {
            throw 'The V1.5 library could not be exported.'
        }
    } finally {
        $process.Dispose()
    }
} finally {
    $temp.Refresh()
    if ($temp.Exists -and !(($temp.Attributes) -band [IO.FileAttributes]::ReparsePoint) -and
        [String]::Equals($temp.Parent.FullName, $base.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase) -and
        $temp.Name.StartsWith('chessash-migration-', [StringComparison]::Ordinal)) {
        for ($attempt = 0; $attempt -lt 8; $attempt++) {
            try {
                Remove-Item -LiteralPath $temp.FullName -Recurse -Force
                break
            } catch {
                if ($attempt -eq 7) { throw }
                Start-Sleep -Milliseconds 250
            }
        }
    }
}
