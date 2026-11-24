# Sendwich — Figma Community listing (copy into the publish form)

## Name
Sendwich

## Tagline
Send editable Figma layers to After Effects.

## Category
Design tools

## Description
Sendwich sends selected Figma artwork to Adobe After Effects as editable shape and text layers and raster footage. Free and open source under the MIT License.

**Download the signed Sendwich ZXP and Figma development plugin:** https://github.com/saniochk/Sendwich/releases/latest

**What comes across**
- Frames, groups, components and instances keep their nesting
- Vectors, booleans, rectangles, ellipses, polygons and stars → shape layers (parametric where possible)
- Solid and gradient fills (linear, radial) with the opacity of every fill, strokes with caps, joins and dashes
- Text → editable text layers: font, size, letter spacing, line height, alignment, mixed styles
- Explicit masks → alpha track mattes. Frame clipping is ignored.
- Layer blur → Gaussian Blur, drop shadow → Drop Shadow, blend modes → blending modes
- Image fills and some unsupported content → images at 1×, 2× or 4×
- "Send as image": one flattened PNG of the selection or the whole frame

Undo the whole import in After Effects with a single Ctrl/Cmd + Z.

Installation of the combined ZXP is verified on Windows; macOS installation validation is pending.

**Requirements**
- A separately installed copy of Adobe After Effects 2022 or newer, plus the free Sendwich companion panel. In After Effects, open Window › Extensions › Sendwich.
- Figma and After Effects on the same computer. The plugin talks only to the panel on this computer (localhost);
  nothing is uploaded anywhere.
- Click Connect to After Effects in Figma and approve the connection in the After Effects panel once.
- In a browser, Chrome may ask to allow access to devices on your local network for figma.com — allow it, or use the Figma desktop app.

Background blur uses an adjustment layer with a separate alpha matte. Inside/outside strokes are transferred as editable outlines. Inner shadows remain unsupported. Angular and diamond gradients become radial.

Sendwich is an independent project.

Privacy policy: https://github.com/saniochk/Sendwich/blob/main/FigmaCommunity/PRIVACY.md

Support: https://github.com/saniochk/Sendwich/issues

## Network access (shown from manifest.json)
http://localhost:7789 — reason: sends the selected layers to the Sendwich panel in After Effects on the same computer.
