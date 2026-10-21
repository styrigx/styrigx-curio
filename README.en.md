<div align="center">

[中文](README.md) | English

# Styrigx Curio

Curio (珍格): good things found on the web, kept one by one.

[curio.styrigx.com](https://curio.styrigx.com) · [styrigx.com](https://styrigx.com) · [Daymark](https://daymark.styrigx.com) · [Blog](https://blog.styrigx.com) · [GitHub @styrigx](https://github.com/styrigx)

![License](https://img.shields.io/badge/License-MIT-2563eb?style=flat-square)

</div>

---

A sub-site of Styrigx's Space, split out of the main site's bookmarks (2026-10-21) into its own repo, Pages project, Worker, D1 database and R2 bucket.

- **Categories and tiles**: each tile shows the site's icon, name and a one-line note; tap to open in a new tab. The search box in the top bar filters instantly.
- **Icons**: fetched once by the Worker (apple-touch-icon / favicon) and cached in R2 per host; a coloured initial when none can be found.
- **Owner**: "Keep" with auto-fill, long-press a tile to edit, manage categories from the "⋯" menu.
- **Import browser bookmarks**: the `.html` export from Samsung Internet, Chrome and others. Folders become categories, known URLs are skipped, imports are private by default, and the original file is stored in R2 before anything is written.
- **Export** everything as a bookmarks file any browser can import.
- **Private** categories and links are hidden from visitors.

Stack: Hugo + Tailwind on Cloudflare Pages (static only), Worker `styrigx-curio-core` on `curio.styrigx.com/api/*`, D1 `styrigx-curio`, R2 `styrigx-curio`. The repo holds no keys: pages are guarded by the main site's auth gateway and the API asks the gateway over a service binding.

See [STRUCTURE.md](STRUCTURE.md) for the layout and [README.md](README.md) for the API table.

```bash
npm ci && npm run build:css && hugo server -s web
npm test          # unit tests (Node 22+, real SQL via node:sqlite)
npm run test:e2e  # phone E2E (after hugo --minify -s web)
```

[MIT](LICENSE)
