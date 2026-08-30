#!/usr/bin/env python3
"""build_cost_icons.py — draw the cost/restriction icons the card set never shipped.

Algomancy's art has icons for its keywords ([Augment], {Battle}, …) and its
factions, and those we have as files. It also prints two families we had no image
for, so they rendered as raw "[once] [one]" in both front-ends:

  [once]                     a white hexagon with a serif "1x"  -> once.webp
  [one] [two] [x] [4bb] …    a white circle with a serif numeral -> cost_<n>.webp

Both are redrawn here rather than cut out of a card scan: on a card they are ~30px
tall and sit on painted art, so a crop is both low-res and dirty. Redrawing keeps
them at the 125px transparent-RGBA size the shipped icons already use.

The hexagon is not redrawn — it IS the shipped one. augment.webp is that same white
hexagon with a black plus on it, so blanking its colour to white and keeping its
alpha gives the empty hexagon back, antialiased edge and all. The "1x" then goes on
top. That way [once] and [Augment] sit at exactly the same size on a line of text,
as they do on a card.

Proportions are measured off Slag-Spewer.jpg, the card that prints [Augment][once]
[one] in one line (at 720x1000: hexagon 29x32 with 19x14 of ink, circle 32x33 with
a 10x19 numeral) — hence the ratios below. Run after changing a ratio or the font:

    python3 build_cost_icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# Locations live in paths.py.
from paths import ICONS_DIR as ICONS

# Liberation Serif is metrically Times New Roman, which is what the cards set their
# numerals in. Bold, to match: on a card the "1x" and the "1" are as heavy as the
# bold body text around them, and the regular weight reads visibly thin beside a
# real card.
FONT = "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf"

SIZE = 125            # canvas, matching augment.webp and the other shipped icons
SS = 8                # supersample factor; the circle's edge has to be as clean as
                      # the shipped icons', which were exported from vector art

# Ink height as a fraction of the shape it sits in (from the card, see docstring).
HEX_INK = 14 / 32     # the "1x" inside the hexagon
DOT_INK = 19 / 33     # the numeral inside the circle
# The circle is a touch bigger than the hexagon on a card (33 vs 32 tall), and the
# hexagon's own ink stops 2px shy of its 125px canvas — so a full-bleed circle
# reproduces that difference on its own, with no fudge factor.

# 0-9 covers every printed amount ([4bb] is the largest) with room to spare; x is the
# variable amount ([x]: "I become base X/X").
AMOUNTS = [*"0123456789", "x"]


def fit_font(text, target_h):
    """The font size whose rendered ink is `target_h` tall — measured, not asked for.

    Point size is not ink height: it includes ascent and descent the glyph may not
    use, and "1x" (digit + x-height) uses less of it than "8" does. Since the card
    sizes these by their ink, so do we — bisect on the actual bounding box.
    """
    lo, hi = 1, SIZE * SS
    while lo < hi:
        mid = (lo + hi + 1) // 2
        f = ImageFont.truetype(FONT, mid)
        box = f.getbbox(text)
        if box[3] - box[1] <= target_h:
            lo = mid
        else:
            hi = mid - 1
    return ImageFont.truetype(FONT, lo)


def stamp(img, text, target_h):
    """Draw `text` in black, `target_h` tall, optically centred on `img`.

    Centred on the ink, not on the font's line box: a "1" carries empty descender
    space a "0" doesn't, and centring on the line box would leave the 1 sitting high.
    """
    font = fit_font(text, target_h)
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1 = d.textbbox((0, 0), text, font=font)
    w, h = img.size
    d.text(((w - (x1 - x0)) / 2 - x0, (h - (y1 - y0)) / 2 - y0), text,
           font=font, fill=(0, 0, 0, 255))


def hexagon():
    """The empty white hexagon: augment.webp's silhouette with its plus painted out."""
    src = Image.open(ICONS / "augment.webp").convert("RGBA")
    # Keep the alpha (the hexagon's shape and its antialiased rim), throw away the
    # colour (the black plus). White everywhere the hexagon is.
    white = Image.new("RGBA", src.size, (255, 255, 255, 0))
    white.putalpha(src.getchannel("A"))
    return white


def circle():
    """A white disc, full-bleed, drawn big and shrunk down for a clean edge."""
    big = Image.new("RGBA", (SIZE * SS, SIZE * SS), (255, 255, 255, 0))
    ImageDraw.Draw(big).ellipse((0, 0, SIZE * SS - 1, SIZE * SS - 1),
                               fill=(255, 255, 255, 255))
    return big.resize((SIZE, SIZE), Image.LANCZOS)


def save(img, name):
    img.save(ICONS / f"{name}.webp", lossless=True, quality=100)
    print(f"  data/icons/{name}.webp")


def main():
    if not Path(FONT).exists():
        raise SystemExit(f"font not found: {FONT}\n"
                         "Install it (Debian/Ubuntu: apt install fonts-liberation) "
                         "or point FONT at another Times-metric serif.")

    print(f"drawing {len(AMOUNTS) + 1} icons into {ICONS}/")

    # [once] — the hexagon, at the hexagon's own ink height (its alpha bbox), not the
    # canvas height, so the "1x" is as big relative to the hexagon as it is on a card.
    hexa = hexagon()
    hex_h = hexa.getchannel("A").getbbox()[3] - hexa.getchannel("A").getbbox()[1]
    stamp(hexa, "1x", round(hex_h * HEX_INK))
    save(hexa, "once")

    # [one], [two], [x], and the numeral half of a compound cost like [4bb].
    for amount in AMOUNTS:
        disc = circle()
        stamp(disc, amount.upper(), round(SIZE * DOT_INK))
        save(disc, f"cost_{amount}")


if __name__ == "__main__":
    main()
