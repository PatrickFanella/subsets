# Subsets landing page

This is the Personal Utility direction selected by the owner on October 4, 2026. It is a static landing page with no backend, maintained separately from the npm package. The production hostname is `subsets.subcult.tv`; deployment instructions and release evidence live in `deploy/`.

The site uses self-hosted OFL fonts, original SVG marks, semantic HTML, responsive CSS, and a small script for selecting captured terminal views and copying installation commands. The terminal content comes from the actual Ink component with disposable sample skill files; it is not an interactive browser version of Subsets.

## Preview

From the Subsets repository:

```sh
python -m http.server 18783 --bind 127.0.0.1 --directory site
```

Open `http://127.0.0.1:18783/` for the landing page and `/brand.html` for the brand study. Stop the server with Ctrl+C. The page needs HTTP to load its captured terminal data.

## Ownership and refresh

Maintained branding lives in `subcult-tv/studio/branding/library/brands/subsets/`. The product owns this HTML, CSS, JavaScript, and the real TUI capture. Do not edit exported brand files independently. Run Studio's Subsets builder with `--export` pointing to `site/assets/brand`; its explicit selection is recorded in `brand-export.json` with SHA-256 hashes. Font licenses travel with the exports.

Refresh the terminal captures from the product source:

```sh
npm run build
node scripts/capture-tui.mjs
```

The capture script creates and removes a disposable fixture. It does not adopt real user folders or select a user's profiles. The source commit and package version are recorded in `assets/tui-capture.json`. The snapshots capture Skills, Groups, and Search; their buttons only change the displayed snapshot.

## Review boundaries

The current copy follows the native alpha's README and npm qualification record. It makes no desktop GUI, cloud sync, Windows, or verified macOS claim. Source and guide links point to the canonical Gitea repository. Approved public assets are explicitly exported from Studio. The full source and social/video pack remain in the SUBCULT Studio repository. Browser verification is recorded separately from build and HTTP checks.
