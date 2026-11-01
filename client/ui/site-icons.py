#!/usr/bin/env python3
"""Build the site's favicon, home-screen icons and link-preview image.

    python3 client/ui/site-icons.py

Writes, next to index.html: favicon.ico (16/32/48), icon-192.png,
apple-touch-icon.png (180, square — iOS rounds it itself) and og-image.jpg
(1200x630, what Discord and friends show under a pasted link) — and og/*.jpg,
one preview card per page, which server/linkpreview.ts picks by the URL.

Everything is made from the game's own art, so nothing here is drawn by hand:

  * the icon is the GRAFT glyph from data/icons/, tinted the wordmark's gold
    (--accent in style.css) on the panel colour. The glyphs ship white on
    transparent, which vanishes on a light browser tab — hence the tile.
  * the preview fans one card per base element under the wordmark.
  * each page's card is the same family: the page's name and a line on the
    left, a CTA, and three cards whose names fit the page fanned on the right.

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


# server/linkpreview.ts PAGE_IMAGES names these files (test 771 holds the two
# lists equal): headline, line, call to action, and three cards, the middle
# one on top. The cards come from the site's own numbers (owner, 2026-11-01:
# "look at what cards are more often played or put into decks"), read off
# /api/cardstats and /api/deck/played on 2026-11-01 — 141 games, 40 rated.
# Each page takes the best-ranked card of three DIFFERENT elements (owner:
# "strive to have several elements selected"), and no card is used twice:
PAGES = {
    # the three most played in rated games
    "league": ("The League",
               "Play a few games each week, whenever suits you, and finish with a final.",
               "Join the league", ["Astralith", "Vaporweave-Eidolon", "Molten-Upheaval"]),
    # the most played units
    "cards": ("Card search",
              "Look up any Algomancy card by its name, element, cost, type or rules text.",
              "Search the cards", ["Prismatic-Observer", "Arcane-Concentrator", "Graxxlid"]),
    # used most in players' runs of the challenges already closed (never the current week's)
    "challenge": ("Weekly Challenge",
                  "A new puzzle every week. Solve it, then see how your run compares.",
                  "Try this week's puzzle", ["Galactic-Germination", "Ancient-One", "Deferral-Drone"]),
    # in the most public decks
    "decks": ("Player decks",
              "See the decks other players have shared, and how each one has done.",
              "Browse the decks", ["Boon-of-Protection", "Celestial-Purge", "Enigmatic-Warder"]),
    # the best win rates when played (20+ games)
    "stats": ("Card stats",
              "See how every card performs, with win rates from every game played on the site.",
              "See the stats", ["Malformed-Monstrosity", "Seer-of-Empty-Spaces", "Arc-Lightning"]),
    # the most played cards a Learn to Play deck can hold
    "learn": ("Learn to play",
              "Play your first game against a bot that explains each rule as it comes up.",
              "Start the tutorial", ["Accelerated-Germination", "Lonely-Forager", "Recyclable-Sentinel"]),
    # the cards the comprehensive rules' examples use most
    "rules": ("The rules",
              "A quick reference, the full rulebook, and every rule of the game, numbered.",
              "Read the rules", ["Robot", "Fireball", "Bubb"]),
    # taken most often when offered in a draft
    "play": ("You're invited",
             "Algomancy runs in your browser, so there's nothing to install.",
             "Join the game", ["Interdiction-Rift", "Luminous-Arc", "Rebalance"]),
    # the most played cards of all
    "replay": ("Game replay",
               "Watch a finished game again from the start, one move at a time.",
               "Watch the replay", ["Unstable-Apparition", "Recall", "Maw-of-Despair"]),
}


def wrap(d: ImageDraw.ImageDraw, text: str, f, width: int) -> list[str]:
    lines, cur = [], ""
    for word in text.split():
        trial = f"{cur} {word}".strip()
        if d.textlength(trial, font=f) <= width or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    return lines + ([cur] if cur else [])


def card_im(name: str, cw: int, ch: int) -> Image.Image:
    card = Image.open(CARDS / f"{name}.jpg").convert("RGBA").resize((cw, ch), Image.LANCZOS)
    mask = Image.new("L", (cw, ch), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, cw - 1, ch - 1], radius=12, fill=255)
    card.putalpha(mask)
    return card


def page_preview(headline: str, line: str, cta: str, cards: list[str]) -> Image.Image:
    from PIL import ImageFilter
    W, H = 1200, 630
    im = Image.new("RGBA", (W, H), BG)
    glow = Image.new("L", (W, H), 0)
    ImageDraw.Draw(glow).ellipse([640, 60, 1260, 700], fill=70)
    glow = glow.filter(ImageFilter.GaussianBlur(100))
    im.paste(Image.new("RGBA", (W, H), ACCENT), (0, 0), glow)

    # three cards, fanned on the right; the middle one on top
    cw, ch = 240, 336
    for i in (0, 2, 1):
        off = i - 1
        rot = card_im(cards[i], cw, ch).rotate(-off * 9, expand=True, resample=Image.BICUBIC)
        shadow = Image.new("RGBA", rot.size, (0, 0, 0, 0))
        shadow.putalpha(rot.getchannel("A").point(lambda a: a * 0.55).filter(ImageFilter.GaussianBlur(14)))
        cx, cy = 912 + off * 138, 322 + abs(off) * 24
        im.alpha_composite(shadow, (int(cx - rot.width / 2) + 8, int(cy - rot.height / 2) + 14))
        im.alpha_composite(rot, (int(cx - rot.width / 2), int(cy - rot.height / 2)))

    d = ImageDraw.Draw(im)
    x, col = 72, 500
    # the wordmark, small and tracked, as a kicker
    kick = font(26, True)
    cx_ = x
    for ch_ in "ALGOMANCY":
        d.text((cx_, 92), ch_, font=kick, fill=ACCENT)
        cx_ += d.textlength(ch_, font=kick) + 9
    # the page's name: one line if it fits at 52px or more, else two at 68
    for size in range(76, 51, -4):
        hf = font(size, True)
        if d.textlength(headline, font=hf) <= col:
            lines = [headline]
            break
    else:
        size, hf = 68, font(68, True)
        lines = wrap(d, headline, hf, col)[:2]
    y = 150
    for l in lines:
        d.text((x, y), l, font=hf, fill="#f3f5f8")
        y += int(size * 1.12)
    y += 18
    lf = font(31, False)
    tag = wrap(d, line, lf, col - 20)
    # everything above the button, which sits at 476: never cut a sentence short
    if y + len(tag) * 43 > 456:
        raise SystemExit(f"{headline!r}: the line needs {len(tag)} rows and does not fit — shorten it")
    for l in tag:
        d.text((x, y), l, font=lf, fill=TEXT)
        y += 43
    # the call to action, a gold pill
    cf = font(30, True)
    label = f"{cta}  \u2192"
    tw = d.textlength(label, font=cf)
    py = 476   # fixed: the text above is sized to end before it
    d.rounded_rectangle([x, py, x + tw + 56, py + 64], radius=32, fill=ACCENT)
    d.text((x + 28, py + 15), label, font=cf, fill=BG)
    d.text((x, H - 58), "algomancy.online", font=font(24, False), fill="#8b96a3")
    return im.convert("RGB")


def deck_fan(files: list[str]) -> Image.Image:
    """A deck's link preview: its cover card in front, two more of its cards
    fanned behind, on the page pictures' ground. No text, so it needs no font:
    the server draws these on the fly (server/main.ts /og/deck/), on a box
    that has none, and Discord prints the deck's name above the picture."""
    from PIL import ImageFilter
    W, H = 1200, 630
    im = Image.new("RGBA", (W, H), BG)
    glow = Image.new("L", (W, H), 0)
    ImageDraw.Draw(glow).ellipse([W // 2 - 480, 120, W // 2 + 480, 760], fill=70)
    glow = glow.filter(ImageFilter.GaussianBlur(110))
    im.paste(Image.new("RGBA", (W, H), ACCENT), (0, 0), glow)
    cw, ch = 340, 476
    lead, rest = files[0], files[1:]
    # behind first, the cover last so it sits on top
    slots = [(-1, rest[0] if rest else None), (1, rest[1] if len(rest) > 1 else None), (0, lead)]
    for off, name in slots:
        if name is None:
            continue
        card = Image.open(CARDS / name).convert("RGBA").resize((cw, ch), Image.LANCZOS)
        mask = Image.new("L", (cw, ch), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, cw - 1, ch - 1], radius=18, fill=255)
        card.putalpha(mask)
        rot = card.rotate(-off * 10, expand=True, resample=Image.BICUBIC)
        shadow = Image.new("RGBA", rot.size, (0, 0, 0, 0))
        shadow.putalpha(rot.getchannel("A").point(lambda v: v * 0.6).filter(ImageFilter.GaussianBlur(16)))
        cx, cy = W / 2 + off * 290, H / 2 - 4 + abs(off) * 22
        im.alpha_composite(shadow, (int(cx - rot.width / 2) + 10, int(cy - rot.height / 2) + 16))
        im.alpha_composite(rot, (int(cx - rot.width / 2), int(cy - rot.height / 2)))
    return im.convert("RGB")


def main() -> None:
    tile(48, True).save(UI / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    tile(192, True).save(UI / "icon-192.png")
    tile(180, False).convert("RGB").save(UI / "apple-touch-icon.png")
    # a JPEG: the PNG of the same picture is ~650 KB, and a link preview is fetched cold
    preview().save(UI / "og-image.jpg", quality=86, optimize=True, progressive=True)
    for f in ("favicon.ico", "icon-192.png", "apple-touch-icon.png", "og-image.jpg"):
        print(f, (UI / f).stat().st_size, "bytes")
    (UI / "og").mkdir(exist_ok=True)
    for name, (headline, line, cta, cards) in PAGES.items():
        out = UI / "og" / f"{name}.jpg"
        page_preview(headline, line, cta, cards).save(out, quality=86, optimize=True, progressive=True)
        print(f"og/{name}.jpg", out.stat().st_size, "bytes")


if __name__ == "__main__":
    import sys
    # site-icons.py fan OUT.jpg COVER.jpg [CARD.jpg [CARD.jpg]] — one deck's
    # picture, scan file names as in data/cards/ (server/main.ts runs this)
    if len(sys.argv) > 1 and sys.argv[1] == "fan":
        out, files = Path(sys.argv[2]), sys.argv[3:6]
        if not files or any("/" in f or f.startswith(".") for f in files):
            raise SystemExit("fan: give one to three scan file names from data/cards/")
        tmp = out.with_suffix(".tmp.jpg")
        deck_fan(files).save(tmp, quality=84, optimize=True, progressive=True)
        tmp.replace(out)   # whole or not at all: the server serves whatever is at OUT
    else:
        main()
