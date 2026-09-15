#!/usr/bin/env python3
"""Build the site's favicon, home-screen icons and link-preview image.

    python3 client/ui/site-icons.py

Writes, next to index.html: favicon.ico (16/32/48), icon-192.png,
apple-touch-icon.png (180, square — iOS rounds it itself) and og-image.png
(1200x630, what Discord and friends show under a pasted link).

Everything is made from the game's own art, so nothing here is drawn by hand:

  * the icon is the GRAFT glyph from data/icons/, tinted the wordmark's gold
    (--accent in style.css) on the panel colour. The glyphs ship white on
    transparent, which vanishes on a light browser tab — hence the tile.
  * the preview fans one card per base element under the wordmark.

Needs Pillow. The outputs are committed; re-run only when the art changes.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

UI = Path(__file__).resolve().parent
REPO = UI.parent.parent
ICONS = REPO / "data" / "icons"
CARDS = REPO / "data" / "cards"

BG = "#12151a"      # --bg
PANEL = "#1a1f27"   # --panel
ACCENT = "#d9a441"  # --accent
TEXT = "#d6dde6"    # --text

PREVIEW_CARDS = [
    "Voltwrath-Behemoth",       # fire
    "Xenopod-Progenitor",       # water
    "Eminence-of-the-Barrens",  # earth
    "Pack-Leader",              # wood
    "Automaton-of-Abundance",   # metal
]


def glyph(size: int, colour: str) -> Image.Image:
    src = Image.open(ICONS / "graft.webp").convert("RGBA").resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", src.size, colour)
    out.putalpha(src.getchannel("A"))
    return out


def tile(n: int, rounded: bool) -> Image.Image:
    # drawn at 4x and scaled down, so the rounded corner is antialiased
    big = n * 4
    im = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if rounded:
        d.rounded_rectangle([0, 0, big - 1, big - 1], radius=big // 5, fill=PANEL)
    else:
        d.rectangle([0, 0, big - 1, big - 1], fill=PANEL)
    g = int(big * 0.68)
    im.alpha_composite(glyph(g, ACCENT), ((big - g) // 2, (big - g) // 2))
    return im.resize((n, n), Image.LANCZOS)


def font(size: int, bold: bool) -> ImageFont.FreeTypeFont:
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    for d in ("/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/TTF", "/usr/share/fonts/dejavu"):
        p = Path(d) / name
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def spaced(d: ImageDraw.ImageDraw, text: str, y: int, f, fill: str, track: int, width: int) -> None:
    """centred text with letter-spacing (the wordmark is .3em tracked)"""
    widths = [d.textlength(ch, font=f) for ch in text]
    total = sum(widths) + track * (len(text) - 1)
    x = (width - total) / 2
    for ch, w in zip(text, widths):
        d.text((x, y), ch, font=f, fill=fill)
        x += w + track


def preview() -> Image.Image:
    W, H = 1200, 630
    im = Image.new("RGBA", (W, H), BG)
    # a soft gold glow behind the fan
    glow = Image.new("L", (W, H), 0)
    ImageDraw.Draw(glow).ellipse([W // 2 - 520, 250, W // 2 + 520, 900], fill=60)
    from PIL import ImageFilter
    glow = glow.filter(ImageFilter.GaussianBlur(90))
    im.paste(Image.new("RGBA", (W, H), ACCENT), (0, 0), glow)

    cw, ch = 236, 330
    n = len(PREVIEW_CARDS)
    for i, name in enumerate(PREVIEW_CARDS):
        off = i - (n - 1) / 2
        card = Image.open(CARDS / f"{name}.jpg").convert("RGBA").resize((cw, ch), Image.LANCZOS)
        mask = Image.new("L", (cw, ch), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, cw - 1, ch - 1], radius=12, fill=255)
        card.putalpha(mask)
        rot = card.rotate(-off * 7, expand=True, resample=Image.BICUBIC)
        cx = W / 2 + off * 190
        cy = 430 + abs(off) ** 2 * 9
        im.alpha_composite(rot, (int(cx - rot.width / 2), int(cy - rot.height / 2)))

    d = ImageDraw.Draw(im)
    spaced(d, "ALGOMANCY", 58, font(78, True), ACCENT, 26, W)
    spaced(d, "Draft and play online  ·  free, in your browser", 158, font(28, False), TEXT, 1, W)
    return im.convert("RGB")


def main() -> None:
    tile(48, True).save(UI / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    tile(192, True).save(UI / "icon-192.png")
    tile(180, False).convert("RGB").save(UI / "apple-touch-icon.png")
    # a JPEG: the PNG of the same picture is ~650 KB, and a link preview is fetched cold
    preview().save(UI / "og-image.jpg", quality=86, optimize=True, progressive=True)
    for f in ("favicon.ico", "icon-192.png", "apple-touch-icon.png", "og-image.jpg"):
        print(f, (UI / f).stat().st_size, "bytes")


if __name__ == "__main__":
    main()
