#!/usr/bin/env python3
"""Procedural asset generator for the Lumenform site.

Every image on the site is generated here — domain-warped fractal noise
fields mapped through bespoke palettes. Run from the repo root:

    python3 tools/generate_assets.py
"""

import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "img")
RNG = np.random.default_rng(7)


# ---------------------------------------------------------------- noise core

def _fade(t):
    return t * t * t * (t * (t * 6 - 15) + 10)


def value_noise(shape, freq, seed):
    """Tile-free value noise on a grid of `freq` cells."""
    rng = np.random.default_rng(seed)
    h, w = shape
    grid = rng.random((freq + 2, freq + 2)).astype(np.float32)

    ys = np.linspace(0, freq, h, endpoint=False, dtype=np.float32)
    xs = np.linspace(0, freq, w, endpoint=False, dtype=np.float32)
    yi, xi = np.floor(ys).astype(int), np.floor(xs).astype(int)
    yf, xf = _fade(ys - yi)[:, None], _fade(xs - xi)[None, :]

    g00 = grid[np.ix_(yi, xi)]
    g10 = grid[np.ix_(yi + 1, xi)]
    g01 = grid[np.ix_(yi, xi + 1)]
    g11 = grid[np.ix_(yi + 1, xi + 1)]

    top = g00 * (1 - xf) + g01 * xf
    bot = g10 * (1 - xf) + g11 * xf
    return top * (1 - yf) + bot * yf


def fbm(shape, freq=4, octaves=5, seed=0, gain=0.5):
    total = np.zeros(shape, dtype=np.float32)
    amp, norm = 1.0, 0.0
    for o in range(octaves):
        total += amp * value_noise(shape, freq * (2 ** o), seed + o * 101)
        norm += amp
        amp *= gain
    return total / norm


def warped(shape, freq=3, octaves=5, seed=0, warp=2.0, layers=2):
    """Domain-warped fbm — the silky, fluid look."""
    field = fbm(shape, freq, octaves, seed)
    for i in range(layers):
        dx = fbm(shape, freq, octaves, seed + 50 + i * 7)
        dy = fbm(shape, freq, octaves, seed + 90 + i * 13)
        h, w = shape
        ys = np.clip((np.arange(h)[:, None] + (dy - 0.5) * warp * h * 0.2).astype(int), 0, h - 1)
        xs = np.clip((np.arange(w)[None, :] + (dx - 0.5) * warp * w * 0.2).astype(int), 0, w - 1)
        field = field[ys, xs]
    return field


def normalize(a):
    a = a - a.min()
    return a / (np.ptp(a) + 1e-9)


# ------------------------------------------------------------------ palettes

def palette_map(field, stops):
    """Map a 0..1 field through a list of (pos, (r,g,b)) gradient stops."""
    field = normalize(field)
    pos = np.array([s[0] for s in stops], dtype=np.float32)
    cols = np.array([s[1] for s in stops], dtype=np.float32)
    out = np.zeros(field.shape + (3,), dtype=np.float32)
    for c in range(3):
        out[..., c] = np.interp(field, pos, cols[:, c])
    return out


def vignette(img, strength=0.55):
    h, w = img.shape[:2]
    y = np.linspace(-1, 1, h)[:, None]
    x = np.linspace(-1, 1, w)[None, :]
    d = np.sqrt(x * x + y * y) / np.sqrt(2)
    mask = 1 - strength * (d ** 2.2)
    return img * mask[..., None]


def to_image(arr):
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")


def add_grain(im, amount=8, seed=3):
    rng = np.random.default_rng(seed)
    a = np.asarray(im).astype(np.int16)
    a = a + rng.integers(-amount, amount + 1, a.shape, dtype=np.int16)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGB")


def save(im, name, quality=88):
    path = os.path.join(OUT, name)
    im.save(path, quality=quality)
    print(f"  wrote {name}  {im.size[0]}x{im.size[1]}")


# ------------------------------------------------------------------ artworks

def art_lumen_silk(shape, seed):
    """Warm light streams folding through darkness — the house style."""
    f = warped(shape, freq=2, octaves=6, seed=seed, warp=2.6, layers=2)
    # carve thin bright filaments out of the field
    bands = np.abs(np.sin(f * 14.0))
    glow = normalize(f) ** 1.6
    field = normalize(glow * 0.65 + (1 - bands) ** 3 * 0.6)
    img = palette_map(field, [
        (0.00, (8, 8, 11)),
        (0.38, (26, 18, 22)),
        (0.62, (94, 44, 30)),
        (0.80, (214, 116, 52)),
        (0.93, (255, 196, 120)),
        (1.00, (255, 244, 214)),
    ])
    return to_image(vignette(img, 0.5))


def art_ion_field(shape, seed):
    """Cold electric topology — cyan filaments on deep blue-black."""
    f = warped(shape, freq=3, octaves=6, seed=seed, warp=1.8, layers=2)
    ridges = 1 - np.abs(2 * normalize(f) - 1)
    field = normalize(ridges ** 4 + normalize(f) * 0.25)
    img = palette_map(field, [
        (0.00, (6, 9, 14)),
        (0.45, (12, 26, 44)),
        (0.72, (24, 98, 134)),
        (0.90, (96, 214, 222)),
        (1.00, (228, 255, 250)),
    ])
    return to_image(vignette(img, 0.45))


def art_terra_contours(shape, seed):
    """Topographic contour etching — bone lines on charcoal."""
    f = warped(shape, freq=2, octaves=5, seed=seed, warp=1.2, layers=1)
    levels = np.abs(((f * 26.0) % 1.0) - 0.5) * 2
    lines = np.clip((levels - 0.82) / 0.18, 0, 1)
    base = normalize(f) * 0.16
    field = normalize(base + lines * (0.4 + 0.6 * normalize(f)))
    img = palette_map(field, [
        (0.00, (12, 12, 13)),
        (0.30, (24, 23, 22)),
        (0.75, (142, 130, 112)),
        (1.00, (236, 226, 206)),
    ])
    return to_image(vignette(img, 0.35))


def art_bloom(shape, seed):
    """Soft chromatic bloom — molten rose/violet glass."""
    f1 = warped(shape, freq=2, octaves=5, seed=seed, warp=3.0, layers=2)
    f2 = warped(shape, freq=3, octaves=4, seed=seed + 31, warp=2.0, layers=1)
    field = normalize(f1 * 0.7 + f2 * 0.3) ** 1.3
    img = palette_map(field, [
        (0.00, (10, 7, 14)),
        (0.35, (38, 18, 48)),
        (0.60, (120, 42, 96)),
        (0.80, (224, 92, 110)),
        (0.93, (255, 170, 130)),
        (1.00, (255, 236, 200)),
    ])
    return to_image(vignette(img, 0.5))


def art_meridian(shape, seed):
    """Vertical light columns — aurora through architecture."""
    h, w = shape
    f = warped(shape, freq=4, octaves=5, seed=seed, warp=1.4, layers=1)
    x = np.linspace(0, np.pi * 7, w, dtype=np.float32)[None, :]
    columns = (np.sin(x + f * 6.0) * 0.5 + 0.5) ** 2.2
    fade = np.linspace(1.15, 0.35, h, dtype=np.float32)[:, None]
    field = normalize(columns * fade * (0.4 + normalize(f)))
    img = palette_map(field, [
        (0.00, (7, 9, 10)),
        (0.40, (14, 32, 34)),
        (0.70, (32, 110, 96)),
        (0.88, (130, 220, 168)),
        (1.00, (240, 255, 228)),
    ])
    return to_image(vignette(img, 0.4))


def art_hero_nebula(shape, seed):
    """Wide, quiet light-form for the about/hero poster."""
    f = warped(shape, freq=2, octaves=6, seed=seed, warp=2.2, layers=2)
    core = normalize(f) ** 2.0
    img = palette_map(core, [
        (0.00, (8, 8, 11)),
        (0.50, (22, 18, 24)),
        (0.74, (84, 52, 44)),
        (0.88, (198, 120, 70)),
        (0.96, (255, 206, 140)),
        (1.00, (255, 248, 230)),
    ])
    return to_image(vignette(img, 0.42))


def grain_tile(size=256):
    rng = np.random.default_rng(11)
    a = rng.integers(0, 255, (size, size), dtype=np.uint8)
    im = Image.fromarray(a, "L").convert("RGBA")
    px = np.asarray(im).copy()
    px[..., 3] = 255
    return Image.fromarray(px)


def favicon():
    s = 128
    im = Image.new("RGBA", (s, s), (10, 10, 13, 255))
    d = ImageDraw.Draw(im)
    for r, col in [(46, (94, 44, 30)), (34, (214, 116, 52)), (20, (255, 206, 140))]:
        d.ellipse([s/2 - r, s/2 - r, s/2 + r, s/2 + r], fill=col)
    im = im.filter(ImageFilter.GaussianBlur(7))
    d = ImageDraw.Draw(im)
    d.ellipse([s/2 - 7, s/2 - 7, s/2 + 7, s/2 + 7], fill=(255, 248, 230, 255))
    return im


def main():
    os.makedirs(OUT, exist_ok=True)
    W = (1600, 2000)   # 4:5 work cards
    print("rendering artworks…")
    save(add_grain(art_lumen_silk(W, seed=7)),     "work-aurelia.jpg")
    save(add_grain(art_ion_field(W, seed=21)),     "work-ion.jpg")
    save(add_grain(art_terra_contours(W, seed=4)), "work-terra.jpg")
    save(add_grain(art_bloom(W, seed=15)),         "work-bloom.jpg")
    save(add_grain(art_meridian(W, seed=9)),       "work-meridian.jpg")
    save(add_grain(art_hero_nebula((1200, 1920), seed=3)), "poster-nebula.jpg")
    save(add_grain(art_lumen_silk((720, 1280), seed=33)),  "preview-a.jpg", 82)
    save(add_grain(art_ion_field((720, 1280), seed=44)),   "preview-b.jpg", 82)
    save(add_grain(art_bloom((720, 1280), seed=55)),       "preview-c.jpg", 82)
    save(add_grain(art_meridian((720, 1280), seed=66)),    "preview-d.jpg", 82)
    save(add_grain(art_hero_nebula((1260, 2400), seed=3)), "og.jpg", 84)
    grain_tile().save(os.path.join(OUT, "grain.png"))
    print("  wrote grain.png")
    favicon().save(os.path.join(OUT, "favicon.png"))
    print("  wrote favicon.png")
    print("done.")


if __name__ == "__main__":
    main()
