# Build and publish Sendwich

## Build the combined ZXP

The release contains one signed `Sendwich.zxp` for After Effects and Illustrator, plus a separate Figma plugin ZIP. Runtime sources are in `SendwichAE`, `SendwichAI` and `SendwichFigma`.

Stage the Adobe panels from PowerShell:

```powershell
./scripts/stage-zxp.ps1 -OutputDirectory ./dist/zxp-bundle
```

The output directory must not already exist. The script includes one shared manifest, host-specific panel entry points, required runtime files, licenses and standard/high-DPI hat icons. Individual panel manifests, debug metadata and previous signatures are excluded.

Use Adobe ZXPSignCmd to sign the output. Store your certificate outside the repository:

```powershell
& $ZxpSigner -sign ./dist/zxp-bundle ./dist/Sendwich.zxp $CertificatePath $CertificatePassword -tsa http://timestamp.digicert.com
& $ZxpSigner -verify ./dist/Sendwich.zxp -certInfo
```

Never commit the certificate or password. Keep a signed package unchanged after testing; editing it invalidates its signature.

## Package Figma

ZIP the `SendwichFigma` directory with `manifest.json`, `code.js`, `ui.html`, `LICENSE` and `THIRD_PARTY_NOTICES.txt`. Keep that directory name inside the archive. Users extract the full archive and import `SendwichFigma/manifest.json` in Figma Desktop.

The checked-in development manifest is for local installation. Figma Community publication needs the publisher's permanent plugin ID; see the [submission checklist](FigmaCommunity/CHECKLIST_RU.md).

## Verify a release

1. Run `node --test tests/*.test.cjs`.
2. Stage the combined bundle and verify exactly one `CSXS/manifest.xml`, both panel IDs and all declared icon/entry-point paths.
3. Check the signed package for unexpected files, private keys, logs and old signatures. Verify its signature and timestamp with Adobe ZXPSignCmd.
4. Install the exact signed package through ZXP/UXP Installer. Restart Adobe apps and check both panels open and transfer artwork. An installation check does not establish that transfer works.
5. Extract the Figma ZIP and check the manifest's `main` and `ui` files exist. Test the connection approval and a transfer with editable text, gradients, images and explicit masks.
6. Calculate SHA-256 hashes for the final downloads and put both in `SHA256SUMS.txt`.

## Publish

Keep a single current release. Attach only `Sendwich.zxp`, `Sendwich-0.34.4-Figma.zip`, `INSTALL-UNIFIED-RU.txt` and `SHA256SUMS.txt`. GitHub supplies source archives from the release tag; a separate source ZIP is unnecessary. Ensure the release tag points to the reviewed source and documentation. Put the Adobe and Figma download links side by side in README and the release description.

## Current validation

The user confirmed installation and hat-icon display for the published ZXP on Windows with After Effects 25.6 and Illustrator 29.8.4. The package has one shared manifest and 30 files; signature, timestamp and resource checks passed. Opening both panels after this package installation has not yet been separately confirmed. Installation of the combined ZXP on macOS is not yet verified. Automated tests do not replace these Adobe host checks.

## Code signing policy

The Adobe CEP package is signed and timestamped. Its self-signed certificate provides package-integrity verification. PlayerDebugMode is not required. The repository contains no signing certificate or private key.
