# Lumenform — A Creative AI Studio

A cinematic, single-page site for **Lumenform**, a fictional creative AI studio.
Dark stage, ember light, editorial serif typography — built with zero
dependencies: hand-rolled HTML, CSS and vanilla JavaScript.

## Run it

It's a static site. Serve the repo root with anything:

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

## What's inside

| Path | Purpose |
| --- | --- |
| `index.html` | The page — hero, manifesto, work, capabilities, process, contact |
| `css/style.css` | Design system: ink/bone/ember palette, fluid type, responsive layout |
| `js/main.js` | Interaction engine (see below) |
| `assets/img/` | All imagery — generated, not sourced |
| `tools/generate_assets.py` | The procedural pipeline that renders every image |

## Interaction engine

- **Smooth scroll** — Lenis-style wheel interception lerping the *native*
  scroll position, so `position: sticky`, anchors and accessibility keep
  working. Touch, keyboard and scrollbar stay native.
- **WebGL hero** — a domain-warped FBM shader renders slow molten light,
  reacting to the cursor. Falls back to a CSS gradient without WebGL and
  pauses once scrolled past.
- **Scroll-driven motion** — staggered character reveals, parallax
  overscan on work imagery, word-by-word manifesto lighting, sticky
  stacked process cards, animated counters.
- **Cursor & hover** — custom cursor with contextual labels, magnetic
  buttons, capability rows with floating image previews (fine pointers only).
- **Responsive & accessible** — fullscreen mobile menu, fluid `clamp()`
  type, `prefers-reduced-motion` honored throughout, ARIA labels on
  split text.

## Generated assets

Every image is rendered by `tools/generate_assets.py` — domain-warped
fractal value noise mapped through bespoke palettes (molten silk, ion
filaments, topographic etching, chromatic bloom, aurora columns), plus the
grain tile and favicon. To regenerate:

```bash
pip install pillow numpy
python3 tools/generate_assets.py
```

No stock. No scraping.
