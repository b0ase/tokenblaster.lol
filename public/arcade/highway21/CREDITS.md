# Highway 21M: credits and licences

## Code
- **Road projection, segment and traffic-steering approach**: javascript-racer by Jake Gordon
  (https://github.com/jakesgordon/javascript-racer), MIT licence, copyright (c) 2012-2016 Jake Gordon and
  contributors. The licence text is in `LICENSE` next to this file. The engine here
  (`src/lib/highway/engine.ts`) is a TypeScript re-write of that technique with our own track layout,
  rules (checkpoint clock, overtakes, scoring) and rendering tweaks.

## Assets: none from upstream
- The upstream sprite sheet, background images and music are **not used and not shipped**. Their
  provenance is unverified, so we did not take them.
- **Sprites and backdrop**: all drawn in code on offscreen canvases at load (`src/lib/highway/art.ts`):
  cars, trucks, billboards, pines, node racks, columns, crystals, the dusk sky, sun and skyline.
  Original to this project, no third-party image or model files. Licence: this repo's MIT.
- **Music and sound effects**: the site's shared procedural audio (`src/lib/sfx.ts`), synthesised in the
  browser; the soundtrack is the arcade playlist credited in the in-game sound panel.
- **Card / social images** (`public/arcade/highway21.jpg`, `src/app/arcade/highway21/*-image.jpg`):
  screenshots of this game.
