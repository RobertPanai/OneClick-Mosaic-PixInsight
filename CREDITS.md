# Credits

OneClick Mosaic - PixInsight, Copyright (c) 2026 Robert Panai, released under the MIT licence (see `LICENSE`).
The program was developed with the assistance of Claude (Anthropic).

It runs on **PixInsight** (Pleiades Astrophoto S.L., <https://pixinsight.com/>): the image engine, astrometric
reprojection, star detection and the process used by the autocrop come from the platform. For panels without astrometric
data it calls PixInsight's own **ImageSolver** script, which is part of the standard PixInsight installation and is read
from it at run time (not copied, bundled or modified).

The registration, trim and photometric join code in `lib/engine` is original work written from public descriptions of
how mosaicking is done in astro-imaging; it contains no code from other mosaic scripts.
