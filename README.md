# Sendwich

![Sendwich panels in Figma and After Effects](FigmaCommunity/cover-1920x1080.png)

Sendwich sends selected artwork from Figma or Illustrator to After Effects on the same computer. Vectors become editable shape layers, text becomes text layers, and raster artwork is imported as images. Supported features include gradients, alpha mattes and some effects.

## Install

Download the installer for your platform from this repository’s **Releases** page. After Effects 22+ and, for Illustrator transfer, Illustrator 25+ are declared in the CEP manifests.

- **Windows** — close the Adobe apps and run `Sendwich-0.34.4-Windows.exe`. The installer includes signed Adobe CEP panels. The Figma development plugin is optional.
- **macOS** — close the Adobe apps, mount `Sendwich-0.34.4-macOS.dmg` and run **Install Sendwich**. The installer includes signed Adobe CEP panels and copies the Figma development plugin to Documents. The installer app is ad-hoc signed and has not been notarized by Apple.
- Restart After Effects and open **Window → Extensions → Sendwich**. Keep the panel open while sending. To send from Illustrator, open **Window → Extensions → Sendwich** in Illustrator.

## Install the combined ZXP

[Download Sendwich.zxp](https://github.com/saniochk/Sendwich/releases/download/v0.34.4/Sendwich.zxp) to install both the After Effects and Illustrator panels. The Figma plugin is installed separately. See the [Russian installation guide](INSTALL-ZXP-RU.md).

1. Save your work and close After Effects and Illustrator.
2. Open [aescripts ZXP/UXP Installer](https://aescripts.com/learn/post/zxp-installer) and drag `Sendwich.zxp` into its window.
3. If it says **“No application compatible with Sendwich was found on your computer”**, click **Install** or **Install Anyway** to continue. This compatibility warning can appear even when a supported Adobe application is installed; it did not prevent installation in our Windows test. You do not need to sign in to Creative Cloud to complete that tested installation.
4. After installation finishes, restart both Adobe applications and open **Window → Extensions → Sendwich** in each one. Keep the After Effects panel open while sending.

This advice applies specifically to the compatibility message above. If the installer reports a signature verification failure or an installation error, resolve that error before continuing. The signed CEP panels do not require PlayerDebugMode. Installation of this combined ZXP on macOS has not yet been verified.
## Code signing policy

Sendwich is applying for code signing through [SignPath Foundation](https://signpath.org/). The current Windows installer (`Sendwich-0.34.4-Windows.exe`) is unsigned.

## Connect Figma

1. In Figma Desktop, open a design file and use **Plugins → Development → Import plugin from manifest…**. Select the manifest path shown by the installer. On a fresh Windows installation, it is in `Documents/Sendwich/Figma`. A Community installation will use its listing instead.
2. Open Sendwich in After Effects. In Figma, run Sendwich and click **Connect to After Effects**.
3. Check that both panels show the same short code and click **Allow** in After Effects. Sendwich remembers the connection.
4. Select a layer or frame and click **Send to After Effects**. If you use Figma in a browser after publication, it may need permission to access the local network.

Use **Send as image** to flatten artwork to PNG. Import goes into the active composition, or a new composition based on the source dimensions. In After Effects, **Explode** separates shape groups into layers and **Merge** combines compatible shape layers.

Figma frame clipping is ignored. Explicit mask layers are imported as track mattes. Source group nesting is kept in Shape Layer Contents. Text, raster images, explicit track mattes and layer effects may require separate timeline layers. Inside/outside strokes are editable outlines. Background blur uses a Gaussian Blur adjustment layer with a separate alpha matte. Inner shadows remain unsupported. Mixed text styles need AE 24.3+. The local transfer of a single Figma clip is limited to 128 MiB including encoded images.

## Uninstall

If you installed the combined ZXP, use ZXP/UXP Installer to uninstall Sendwich. For the Windows EXE installation, remove **Sendwich** through Installed Apps. Earlier Sendwich panels found during installation are backed up outside the active Adobe extensions folder. Import the new Figma manifest and approve the connection again. On macOS, delete the `SendwichAE` and `SendwichAI` folders under `~/Library/Application Support/Adobe/CEP/extensions` and the Figma plugin folder in Documents. Remove the development plugin entry in Figma.

## Development

- [Release build and verification](RELEASE.md)
- [Figma Community submission checklist](FigmaCommunity/CHECKLIST_RU.md)
- [Privacy policy](FigmaCommunity/PRIVACY.md)

MIT License. Copyright 2026 Saniochk. See [third-party notices](THIRD_PARTY_NOTICES.txt). Sendwich is independently developed.
