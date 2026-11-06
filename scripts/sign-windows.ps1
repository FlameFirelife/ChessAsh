param(
    [string]$Path,
    [switch]$CheckOnly,
    [switch]$VerifyOnly
)
$ErrorActionPreference = 'Stop'
if ($CheckOnly -and $VerifyOnly) { throw 'Choose CheckOnly or VerifyOnly.' }
$thumbprint = ($env:CHESSASH_SIGNING_THUMBPRINT -replace '\s', '').ToUpperInvariant()
if ($thumbprint -notmatch '^[0-9A-F]{40}$') {
    throw 'Set CHESSASH_SIGNING_THUMBPRINT to the thumbprint of a trusted code-signing certificate in Cert:\CurrentUser\My. No signing identity is configured.'
}
$certificate = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object Thumbprint -eq $thumbprint | Select-Object -First 1
if (-not $certificate) { throw 'The configured code-signing certificate and private key were not found in Cert:\CurrentUser\My.' }
if ($certificate.NotBefore -gt (Get-Date) -or $certificate.NotAfter -le (Get-Date)) { throw 'The signing certificate is not currently valid.' }
if ($certificate.Subject -eq $certificate.Issuer) { throw 'Self-signed Windows certificates are for testing and cannot establish a public publisher identity.' }
$chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
try {
    $chain.ChainPolicy.ApplicationPolicy.Add((New-Object System.Security.Cryptography.Oid '1.3.6.1.5.5.7.3.3'))
    $chain.ChainPolicy.UrlRetrievalTimeout = [TimeSpan]::FromSeconds(15)
    if (-not $chain.Build($certificate)) { throw 'Windows could not validate the code-signing certificate trust chain. Check certificate installation, revocation status and network access.' }
} finally { $chain.Dispose() }
if ($CheckOnly) {
    Write-Host "Signing identity ready: $($certificate.Subject)"
    return
}
if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'Path must point to an existing executable.' }
$target = (Resolve-Path -LiteralPath $Path).Path
if (-not $VerifyOnly) {
    $timestampServer = 'http://timestamp.digicert.com'
    if ($env:CHESSASH_TIMESTAMP_SERVER) { $timestampServer = $env:CHESSASH_TIMESTAMP_SERVER }
    $timestampUri = $null
    if (-not [Uri]::TryCreate($timestampServer, [UriKind]::Absolute, [ref]$timestampUri) -or $timestampUri.Scheme -notin @('http', 'https')) { throw 'CHESSASH_TIMESTAMP_SERVER must be an absolute HTTP or HTTPS timestamp URL.' }
    $signature = Set-AuthenticodeSignature -LiteralPath $target -Certificate $certificate -HashAlgorithm SHA256 -IncludeChain NotRoot -TimestampServer $timestampServer
    if ($signature.Status -ne 'Valid') { throw "Signing failed for ${target}: $($signature.StatusMessage)" }
}
$verified = Get-AuthenticodeSignature -LiteralPath $target
if ($verified.Status -ne 'Valid' -or $verified.SignerCertificate.Thumbprint -ne $thumbprint -or -not $verified.TimeStamperCertificate) {
    throw "A valid timestamped signature from the configured publisher is required: $target"
}
Write-Host "Verified signature: $target"
