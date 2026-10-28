<div align="center">

[中文](README.md) | English

# Styrigx Curio

Curio (奇趣): good things found on the web, kept one by one.

[curio.styrigx.com](https://curio.styrigx.com) · [styrigx.com](https://styrigx.com) · [Daymark](https://daymark.styrigx.com) · [Blog](https://blog.styrigx.com) · [GitHub @styrigx](https://github.com/styrigx)

![Hugo](https://img.shields.io/badge/dynamic/yaml?url=https://raw.githubusercontent.com/styrigx/styrigx-space/main/.github/actions/setup-hugo/action.yml&query=%24..HUGO_VERSION&label=Hugo&style=flat-square&color=2563eb&logo=hugo)
![Tailwind CSS](https://img.shields.io/badge/dynamic/json?url=https://raw.githubusercontent.com/styrigx/styrigx-curio/main/package-lock.json&query=%24.packages%5B%27node_modules%2Ftailwindcss%27%5D.version&label=Tailwind%20CSS&style=flat-square&color=2563eb&logo=tailwindcss)
![Styrigx UI](https://img.shields.io/badge/dynamic/yaml?url=https://raw.githubusercontent.com/styrigx/styrigx-space/main/web/data/version.yaml&query=%24.ui&label=Styrigx%20UI&style=flat-square&color=2563eb)
![Version](https://img.shields.io/badge/dynamic/yaml?url=https://raw.githubusercontent.com/styrigx/styrigx-curio/main/web/hugo.yaml&query=%24.params.version&label=Curio&style=flat-square&color=2563eb)
![Deploy](https://img.shields.io/github/actions/workflow/status/styrigx/styrigx-curio/deploy.yml?style=flat-square&label=Deploy&color=2563eb)
![License](https://img.shields.io/badge/License-MIT-2563eb?style=flat-square)

</div>

---

A sub-site of Styrigx's Space, split out of the main site's bookmarks on 2026-10-21 into its own repo, Pages project, Worker (`styrigx-curio-core`), D1 database and R2 bucket — a private collection of good things found on the web, kept one per compartment, like a curio cabinet. It shares the Styrigx UI immersive app with Daymark and the Blog: the top-bar slider, the drawer, colours and appearance all follow the main site.

- **Three tabs** in the top bar (swipe works too): **Finds** (saved sites: categories and tiles, tap to open), **Devices** (photo, type, bought / retired dates with days in use worked out, system version, specs, accessories, notes, and what replaced it) and **Games** (cover, platform, device played on, version, status, rating, thoughts).
- **Icons**: fetched once by the Worker (apple-touch-icon / favicon) and cached in R2 per host; a coloured initial when none can be found.
- **Admin**: "Keep" with auto-fill, long-press a tile to edit, manage categories from the "⋯" menu.
- **Import browser bookmarks**: the `.html` export from Samsung Internet, Chrome and others. Folders become categories, known URLs are skipped, imports are private by default, and the original file is stored in R2 before anything is written.
- **Export** everything as a bookmarks file any browser can import.
- **Private** categories and links are hidden from visitors.

Stack: Hugo + Tailwind 4 (CSS-first config in `web/assets/css/input.css`, built by `@tailwindcss/cli`) on Cloudflare Pages (static only), Worker `styrigx-curio-core` on `curio.styrigx.com/api/*`, D1 `styrigx-curio-core`, R2 `styrigx-curio-core`. The repo holds no keys: pages are guarded by the main site's auth gateway and the API asks the gateway over a service binding.

See [STRUCTURE.md](STRUCTURE.md) for the layout and [README.md](README.md) for the API table.

```bash
npm ci && npm run build:css && hugo server -s web
npm test          # unit tests (Node 22+, real SQL via node:sqlite)
npm run test:e2e  # phone E2E (after hugo --minify -s web)
```

[MIT](LICENSE)
