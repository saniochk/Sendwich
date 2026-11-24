# Sendwich development

Current installation uses a combined signed ZXP for the Adobe panels and a separate Figma development-plugin ZIP. See [README](README.md), the [Russian installation guide](INSTALL-ZXP-RU.md) and [release packaging](RELEASE.md).

## Source map

- `SendwichAE`: CEP interface, local receiver and ExtendScript importer for After Effects.
- `SendwichAI`: CEP interface and ExtendScript exporter for Illustrator.
- `SendwichFigma`: checked-in Figma runtime (`manifest.json`, `code.js`, `ui.html`). No separate Figma build step is required to install these files.
- `scripts/stage-zxp.ps1`: stages both Adobe panels in one bundle, with a shared manifest and host-specific paths. Do not concatenate or install the source panel directories inside the signed bundle unchanged.
- `scripts/build-gradient-template.cjs`: gradient-template maintenance utility; `SendwichAE/jsx/gradients.aep` is a required runtime resource.
- `tests`: Node regression tests for connection handling, batch import, hierarchy and masks, gradients and raster placement.
- `FigmaCommunity`: approved branding, listing, privacy policy and publication checklist. `mascot.png` is the original dimensional hat artwork; `icon-*.png` are the compact pictogram.

## Transfer and editing

Figma sends to the local After Effects receiver on `localhost:7789`, after connection approval. The Adobe panels also use local transfer files. Review the [privacy policy](FigmaCommunity/PRIVACY.md) for storage details.

The importer processes work in batches. Preserve its cancellation and progress handling when changing the importer. Source nesting, layer order, editable text, explicit mattes and image placement have dedicated regression coverage. The gradient template supports 64 fills and 64 strokes.

## Checks

```powershell
node --test tests/*.test.cjs
./scripts/stage-zxp.ps1 -OutputDirectory ./dist/zxp-bundle
```

The GitHub workflow runs the tests and checks the staged bundle. It does not publish builds or claim live Adobe-host compatibility. Manual checks in After Effects, Illustrator and Figma are required before making those claims.

Keep private certificates and transfer data outside the repository. The signed published package is immutable after testing: packaging changes require signing and installation verification again.
