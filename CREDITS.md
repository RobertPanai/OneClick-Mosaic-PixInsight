# Credits and third-party licences

OneClick Mosaic is an orchestration layer. **All the real mosaic work is done by tools written by others**;
this project only calls them, in order, with their default settings. It contains none of their code: they are
read from your own PixInsight installation (`<PixInsight>/src/scripts`) at run time and are neither copied,
bundled nor modified.

| Tool | Author(s) | Role in the pipeline | Licence / terms |
|---|---|---|---|
| **ImageSolver** (AdP) | Copyright (C) 2012-2024 Andrés del Pozo; (C) 2019-2024 Juan Conejero (PTeam) | Plate solving of panels without astrometric solution | PixInsight Class Library licence terms (BSD-style, see the header of `ImageSolver.js`) |
| **MosaicByCoordinates** (AdP) | Copyright (C) 2013-2024 Andrés del Pozo; (C) 2019-2024 Juan Conejero (PTeam) | Registers all panels of a filter on a common grid from their astrometric solutions | Same as above (see the header of `MosaicByCoordinates.js`) |
| **TrimMosaicTile** | Copyright (C) 2019-2023 John Murphy | Erodes rough tile edges before blending | "Free for personal use only. You may not redistribute or modify it." Official site: <https://astroprocessing.com/> |
| **PhotometricMosaic** | Copyright (C) 2019-2021 John Murphy (includes StarDetector.jsh, (C) 2003-2020 Pleiades Astrophoto S.L.) | Photometric, gradient-corrected joining of the tiles | "Free for personal use only. You may not redistribute or modify it." Official site: <https://astroprocessing.com/> |
| **PixInsight** | Pleiades Astrophoto S.L. | The platform, DynamicCrop, PixelMath, IntegerResample | Commercial software, <https://pixinsight.com/> |

Please credit these authors whenever you publish a result obtained with this tool: **the quality of the mosaics comes from
their work**. In particular, John Murphy's scripts are for personal use and must be obtained from his official site; this
repository deliberately does not include them.

## This project
OneClick Mosaic - PixInsight, Copyright (c) 2026 Robert Panai, released under the MIT licence (see `LICENSE`, which covers
only the files of this repository). The program was developed with the assistance of Claude (Anthropic).

## Integrated engine (0.3.0)
The integrated engine re-implements the mosaic steps independently. Its registration stage follows the approach of
MosaicByCoordinates (BSD-2, Andrés del Pozo, Juan Conejero). TrimMosaicTile and PhotometricMosaic (John Murphy) were
only studied through their public documentation; their algorithms are re-implemented from scratch and no code was copied.
