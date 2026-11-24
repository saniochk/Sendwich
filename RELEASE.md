# Build and publish Sendwich

The three runtime packages are checked in and can be installed without a JavaScript build. The original archive did not include the separate Figma bundling sources or test fixtures mentioned in the historical development notes.

## Build

- On Windows with [Inno Setup 6](https://jrsoftware.org/inno-setup/downloads) installed, run `./installers/windows/build.ps1 -Compiler 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe' -ZxpSigner 'C:\Tools\ZXPSignCmd.exe'` from PowerShell. Output is `dist/Sendwich-0.34.3-Windows.exe`. The default build is unsigned. Use your code-signing identity and timestamp service before public distribution if available.
- On macOS with Xcode Command Line Tools, run `bash installers/macos/build.sh`. Output is `dist/Sendwich-0.34.3-macOS.dmg`. Set `MACOS_SIGN_IDENTITY` to your Developer ID Application identity and `MACOS_NOTARY_PROFILE` to an existing local notarytool keychain profile to sign, notarize and staple the DMG. Builds without credentials are for testing. See [Apple’s distribution guide](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution).
- On GitHub, run **Actions → Build installers → Run workflow** after pushing the repository. Download the Windows and macOS artifacts. The workflow builds test artifacts. It verifies install/uninstall on a disposable Windows runner and mounts the DMG on a disposable macOS runner to verify the installer payload. Use a Mac with Adobe apps and Figma for the interactive checks below.

## Verify a release candidate

1. Windows and macOS. Install on a clean user profile and restart the Adobe apps. Check both panels appear and can be opened.
2. Figma Desktop. Test a rectangle, gradient, mixed text, alpha mask and image fill. Check connections with an unapproved or expired connection, an unopened AE panel and an oversized transfer. Repeat with Chrome on the published plugin before claiming browser support.
3. Illustrator. Test vector and PNG exports into an active and a new composition.
4. After Effects. Compare geometry, stacking and text against the source. Verify undo, Explode and Merge on a representative composition.
5. macOS public package. Verify the notarized DMG on a separate Mac. Test Gatekeeper, installation, the Documents permission prompt and both Adobe panels.
6. Verify removal and upgrade from the original 0.33 ZIP. Test that existing AE assets remain intact.

## GitHub publication

1. Create an empty repository under the chosen owner, then push the contents of this directory to its default branch. Include hidden GitHub configuration files. Exclude `.build/`, `dist/` and certificates.
2. Run the workflow or use the verified local builds. Create the `v0.34.1` release, attach the EXE and DMG, and add SHA-256 hashes. The changelog below can be used as the release description.
3. Add the public Releases URL and support contact to the Figma listing, then follow the submission checklist.

## v0.34.3 release notes

- Completed the Sendwich naming update across the active source, installers, Adobe CEP locations, Figma development ID, and transfer paths. Back up prior panels before changing install locations.
- Windows installs signed and timestamped CEP panels. Illustrator uses the existing four-point sparkles.

## v0.34.1 release notes

- Renamed the source and package directories to SendwichAE, SendwichAI and SendwichFigma. Installed CEP paths and extension identifiers remain compatible with existing installations.

## v0.34 release notes

- The gradient template supports 64 fills and 64 strokes. The importer writes the source shape hierarchy into the template directly, without splitting groups by gradient count.

- Figma transfer preserves group hierarchy, skips frame clipping, imports explicit masks, outlines aligned strokes, and uses adjustment layers with alpha mattes for background blur.

- After Effects stages layer work in short slices. A disconnected Figma request is cancelled before commit when possible. The final copy remains one undo group.

- Windows EXE and macOS disk-image packaging.
- Editable vectors, text, gradients and mattes from Figma and Illustrator.
- Local Figma transfer with one-time approval in After Effects. Install the matching versions of both panels.
- **Explode** and **Merge** tools for After Effects shape layers.
