# Sendwich — Figma Community listing (copy into the publish form)

## Name
Sendwich

## Tagline
Send Figma layers to After Effects as editable shape layers, text and images — in one click.

## Category
Design tools (or: Prototyping & animation)

## Description
Sendwich sends the selected Figma layers to Adobe After Effects as native, editable layers — with names and hierarchy kept.

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

**Requirements**
- Adobe After Effects 2022 or newer with the free Sendwich panel installed and open (Window › Extensions › Sendwich).
  Download and setup guide: <LINK TO YOUR DOWNLOAD / GUIDE PAGE>
- Figma and After Effects on the same computer. The plugin talks only to the panel on this computer (localhost);
  nothing is uploaded anywhere.
- Click Connect to After Effects in Figma and approve the connection in the After Effects panel once.
- In a browser, Chrome may ask to allow access to devices on your local network for figma.com — allow it, or use the Figma desktop app.

Background blur uses an adjustment layer with a separate alpha matte. Inside/outside strokes are transferred as editable outlines. Inner shadows remain unsupported. Angular and diamond gradients become radial.

Free and open source (MIT License). Not affiliated with Adobe or Figma.

Support: <YOUR SUPPORT EMAIL OR PAGE>

## Network access (shown from manifest.json)
http://localhost:7789 — reason: sends the selected layers to the Sendwich panel in After Effects on the same computer.
