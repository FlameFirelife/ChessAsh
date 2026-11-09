# Signing and installation warnings

Windows release installers are unsigned until a trusted signing identity is configured. The Android release APK is signed with the project's existing update key. Editing the publisher name does not change either status.

## Windows

Public Windows signing requires an identity issued by a trusted certificate authority or an approved signing service. A self-signed certificate does not establish a trusted publisher on other people's PCs. A valid signature identifies the publisher; a new release can still show a SmartScreen reputation warning. See [Microsoft's signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options).

The local build supports a trusted code-signing certificate installed in `Cert:\CurrentUser\My`, with its private key accessible to the current Windows account. Hardware-backed certificates must have their provider installed. The publisher displayed by Windows comes from that certificate and may differ from the app's metadata.

After obtaining and installing the certificate, open PowerShell in the project folder:

```powershell
Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Select-Object Subject, Thumbprint, NotAfter
$env:CHESSASH_SIGNING_THUMBPRINT = 'REPLACE_WITH_YOUR_CERTIFICATE_THUMBPRINT'
.\scripts\sign-windows.ps1 -CheckOnly
.\Build-Windows.bat -RequireSigned
```

The build validates the certificate before packaging, signs `release/win-unpacked/ChessAsh.exe`, then uses Inno Setup's signing hook for the installer, uninstaller and temporary installer copies. Signing uses SHA-256 and requires a timestamp. The final installer is checked for a valid timestamped signature from the selected certificate. [Inno Setup documents the signing hook here](https://jrsoftware.org/ishelp/topic_setup_signtool.htm).

`CHESSASH_TIMESTAMP_SERVER` optionally overrides the default `http://timestamp.digicert.com` Authenticode timestamp endpoint. It must support the timestamp protocol used by PowerShell's [Set-AuthenticodeSignature](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/set-authenticodesignature).

With no identity configured, `Build-Windows.bat` warns and builds unsigned for local testing. `-RequireSigned` fails before packaging if no usable identity exists. An invalid configured identity stops the build rather than silently producing an unsigned installer.

No trusted Windows signing certificate is configured for the v1.5 source build. The signed build path has not been exercised with a real certificate. Cloud signing services need their own approved account and integration; this local certificate-store setup does not configure those services automatically.

[SignPath Foundation](https://signpath.org/apply) accepts applications for free open-source signing, subject to its [conditions and review](https://signpath.org/terms). Its certificate identifies SignPath Foundation as publisher.

Keep private keys, tokens, passwords and certificate exports out of the repository. Do not add a locally generated certificate to users' trusted roots to bypass installation warnings.

## Android

Android release builds already verify the APK signature. Keep `.private/android-release.jks` and its password safe so future versions update existing installations. Do not replace this key to change a warning or displayed name. See [BUILDING.md](BUILDING.md) for backup details and [Android's signing documentation](https://developer.android.com/studio/publish/app-signing) for the update requirements.

A signed APK is not proof of store approval or developer verification. Sideloading, Play Protect and developer-verification messages need to be identified by their exact wording before choosing a remedy. Android version code is 9; the existing Android update identity must be preserved when building it.
