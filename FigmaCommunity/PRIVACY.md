# Sendwich privacy policy

Last updated November 22, 2026. Sendwich is developed by Saniochk.

## Figma data

When you explicitly send artwork, the plugin reads the layers in the selected scope and the metadata needed to reconstruct them. Depending on the selection, this can include names, dimensions, geometry, text, styles, masks and rendered PNG images. The plugin reads the current selection count to update its controls. To export aligned strokes and frame image fills, Sendwich creates temporary Figma nodes and removes them after reading the geometry or rendering the image. The original layers remain intact.

The plugin sends the export to the Sendwich panel in After Effects on the same computer at `http://localhost:7789`. The receiver requires one-time approval in the After Effects panel. The plugin and panel store a randomly generated connection credential locally for future transfers. Sendwich does not upload artwork to the developer or to a third-party service and does not use analytics or tracking.

## Local files

The receiver writes the exported clip and images to a temporary directory on your computer. On startup, the panel attempts to clear timestamped transfer directories that are at least 24 hours old. Imported image files are copied to a Sendwich Assets folder (or an existing asset folder from a previous version) next to the After Effects project, or to Documents for an unsaved project. These project assets persist until you remove them.

## Contact

Use the support contact shown on the Sendwich Figma Community listing for privacy questions.
