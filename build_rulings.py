#!/usr/bin/env python3
"""Ingest community / judge / designer rulings into corpus records.

Two input sources, both optional:

  1. rulings/seed_rulings.jsonl
     Hand-transcribed rulings (e.g. screenshots pasted into chat). One JSON
     object per line. Two shapes are accepted:

       Q&A:   {"id", "question", "answer", "answered_by", "role", "date",
               "source_channel", "cards": [...], "note", "outdated": false}
       Post:  {"id", "title", "body", "answered_by"/"role", "date",
               "source_channel", "cards": [...], "note", "outdated": false}

  2. rulings/exports/*.json
     Raw DiscordChatExporter (Tyrrrz) JSON exports. Two channel shapes:

       * Forum threads (the "rarely-asked-questions" channel): each thread is
         its own file whose channel.name is the thread TITLE and whose messages
         are the curated write-up + discussion. The title marker gates it —
         [Solved]/[Solved & Expanding?]/none are kept, [TODO]/[Asked] (transient,
         superseded) are skipped, [Considered] is kept but flagged outdated. Bot
         messages are dropped; the designer's messages elevate the thread to
         authority 0 (designer's word).

       * Flat channels (general rules-questions): Q&A pairs reconstructed from
         reply-references; only messages from authoritative authors are kept.

     Image-only messages from kept authors are written to rulings/needs_ocr.jsonl
     for a later vision/OCR pass instead of being dropped.

The corpus chunk KEEPS the question/title text so BM25 matches question
phrasing. `role`/detected author selects the authority tier via ROLE_AUTHORITY
(discord_ruling=0 outranks the Manual; judge_ruling=1; community_ruling=2).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

# Locations live in paths.py.
from paths import (
    RULINGS_DIR,
    GENERATED_RULINGS,
    SEED_RULINGS as SEED_FILE,
    RULINGS_EXPORTS as EXPORTS_DIR,
    NEEDS_OCR as NEEDS_OCR_FILE,
)

# role (lower-cased) -> auth_key in build_corpus.AUTHORITY.
ROLE_AUTHORITY = {
    "designer": "discord_ruling",
    "judge": "judge_ruling",
    "moderator": "judge_ruling",
    "mod": "judge_ruling",
    "": "community_ruling",
}
# Discord authors whose word is the designer's, matched on name/nickname
# lower-cased (wins over role). These literals have to match the raw export, so
# the game's designer is named here — but the authority TIER this maps to is
# "discord_ruling", because the tier holds rulings from the whole Discord
# (designer answers, judge write-ups, community threads), not one person's.
DESIGNER_NAMES = {"caleb gannon"}
USER_AUTHORITY = {name: "discord_ruling" for name in DESIGNER_NAMES}
DEFAULT_AUTH = "community_ruling"

# Roles we trust as *answers* when parsing flat (non-forum) channels.
AUTHORITATIVE_ROLES = {r for r in ROLE_AUTHORITY if r and ROLE_AUTHORITY[r] != "community_ruling"}

# Forum thread title markers (lower-cased) -> handling.
SKIP_MARKERS = {"todo", "asked"}        # unanswered / superseded, no content yet
OUTDATED_MARKERS = {"considered"}       # proposed rule, may change


# --------------------------------------------------------------------------- #
# Card detection (tags each ruling with the cards it references -> powers &ruling)
# --------------------------------------------------------------------------- #
_CARD_INDEX = None
_NAME_RE = None


def _card_names():
    global _CARD_INDEX
    if _CARD_INDEX is None:
        from cards import CardIndex
        _CARD_INDEX = CardIndex()
    return _CARD_INDEX.names


def _detect_cards(text: str) -> list[str]:
    """Case-sensitive whole-name matches of known cards in `text`.

    Case-sensitivity keeps common lowercase prose words from matching short
    card names, while still catching capitalised card names in titles/text and
    inside [card:Name] tokens (the ':' / '[' boundaries don't block \\b).
    """
    global _NAME_RE
    names = _card_names()
    if _NAME_RE is None:
        ordered = sorted(names, key=len, reverse=True)  # longest first -> multi-word wins
        _NAME_RE = re.compile(r"(?<!\w)(?:" + "|".join(re.escape(n) for n in ordered) + r")(?!\w)")
    return sorted(set(_NAME_RE.findall(text)))


# --------------------------------------------------------------------------- #
# Formatting
# --------------------------------------------------------------------------- #
def _auth_key(role: str | None, author: str | None = None) -> str:
    if author and author.strip().lower() in USER_AUTHORITY:
        return USER_AUTHORITY[author.strip().lower()]
    return ROLE_AUTHORITY.get((role or "").strip().lower(), DEFAULT_AUTH)


def _cards_line(cards) -> str:
    cards = [c for c in (cards or []) if c]
    return f"\nRelated cards: {', '.join(cards)}" if cards else ""


def _format_qa(r: dict) -> tuple[str, str]:
    q = (r.get("question") or "").strip()
    a = (r.get("answer") or "").strip()
    attrib = [x for x in (r.get("answered_by"), r.get("role"), r.get("date")) if x]
    tail = f"\n\n(Answered by {', '.join(attrib)})" if attrib else ""
    if r.get("note"):
        tail += f"\n{r['note']}"
    return q or r.get("id", "ruling"), f"Ruling — {q}\n\n{a}{tail}{_cards_line(r.get('cards'))}"


def _format_post(r: dict) -> tuple[str, str]:
    title = (r.get("title") or "").strip()
    body = (r.get("body") or "").strip()
    attrib = [x for x in (r.get("source_channel"), r.get("answered_by"), r.get("date")) if x]
    tail = f"\n\n(Source: {', '.join(attrib)})" if attrib else ""
    if r.get("note"):
        tail += f"\n{r['note']}"
    return title or r.get("id", "ruling"), f"{title}\n\n{body}{tail}{_cards_line(r.get('cards'))}"


def _record_from_ruling(r: dict, make_record, source: str) -> list:
    """Return one or more corpus records (long threads split, title on each)."""
    from build_corpus import split_prose, MAX_CHARS

    is_qa = bool(r.get("question"))
    title, text = _format_qa(r) if is_qa else _format_post(r)
    auth_key = r.get("auth_key") or _auth_key(r.get("role"), r.get("answered_by"))
    base_id = f"ruling:{r.get('id') or title[:40]}"
    outdated = bool(r.get("outdated"))
    metadata = {
        "answered_by": r.get("answered_by", ""),
        "role": r.get("role", ""),
        "date": r.get("date", ""),
        "source_channel": r.get("source_channel", ""),
        "cards": r.get("cards", []),
        "kind": "qa" if is_qa else "post",
        "marker": r.get("marker", ""),
        "url": r.get("url", ""),
    }

    if len(text) <= int(MAX_CHARS * 1.4):
        return [make_record(base_id, text, source, "ruling", auth_key, title,
                            metadata, outdated)]
    # Oversized thread: split on paragraphs, keep the title heading on each part.
    recs = []
    for i, part in enumerate(split_prose(text)):
        ptext = part if part.lstrip().startswith(title[:24]) else f"{title}\n\n{part}"
        recs.append(make_record(
            f"{base_id}#{i}", ptext, source, "ruling", auth_key,
            f"{title} (part {i + 1})", metadata, outdated))
    return recs


# --------------------------------------------------------------------------- #
# DiscordChatExporter JSON parsing
# --------------------------------------------------------------------------- #
def _author_name(msg) -> str:
    a = msg.get("author", {})
    return a.get("nickname") or a.get("name") or ""


def _is_designer(msg) -> bool:
    a = msg.get("author", {})
    return (a.get("name", "").strip().lower() in USER_AUTHORITY
            or (a.get("nickname") or "").strip().lower() in USER_AUTHORITY)


def _clean_title(name: str) -> tuple[str, str | None]:
    m = re.match(r"\s*\[([^\]]+)\]\s*(.*)", name)
    if m:
        return (m.group(2).strip() or name.strip()), m.group(1).strip()
    return name.strip(), None


def _parse_forum_thread(d: dict, needs_ocr: list) -> dict | None:
    """A forum thread (RAQ) -> one 'post' ruling dict, or None to skip."""
    ch = d["channel"]
    title, marker = _clean_title(ch["name"])
    if (marker or "").lower() in SKIP_MARKERS:
        return None
    outdated = (marker or "").lower() in OUTDATED_MARKERS

    lines, designer = [], False
    for m in d.get("messages", []):
        if m.get("author", {}).get("isBot"):
            continue
        content = (m.get("content") or "").strip()
        if not content:
            if m.get("attachments"):
                needs_ocr.append({
                    "id": f"{ch['id']}-{m['id']}", "thread": title,
                    "author": _author_name(m), "date": (m.get("timestamp") or "")[:10],
                    "source_channel": ch.get("category") or ch["name"],
                    "images": [a.get("url") for a in m["attachments"]],
                })
            continue
        if _is_designer(m):
            designer = True
            lines.append(f"{_author_name(m)} (designer): {content}")
        else:
            lines.append(f"{_author_name(m)}: {content}")
    if not lines:
        return None

    body = "\n\n".join(lines)
    guild_id = (d.get("guild") or {}).get("id", "")
    return {
        "id": f"raq-{ch['id']}",
        "title": title,
        "body": body,
        "url": f"https://discord.com/channels/{guild_id}/{ch['id']}" if guild_id else "",
        "auth_key": "discord_ruling" if designer else "judge_ruling",
        "role": "designer" if designer else "judge",
        "answered_by": "designer" if designer else "RAQ write-up",
        "date": (d["messages"][0].get("timestamp") or "")[:10] if d.get("messages") else "",
        "source_channel": ch.get("category") or "rarely-asked-questions",
        "marker": marker or "",
        "outdated": outdated,
        "cards": _detect_cards(title + "\n" + body),
    }


def _parse_flat_channel(d: dict, needs_ocr: list) -> list[dict]:
    """A flat channel -> Q&A dicts from replies by authoritative authors."""
    ch = d["channel"]
    channel = ch.get("name", "")
    by_id = {m["id"]: m for m in d.get("messages", [])}
    out = []
    for m in d.get("messages", []):
        if m.get("author", {}).get("isBot"):
            continue
        designer = _is_designer(m)
        roles = {str(rr.get("name", "")).lower() for rr in m.get("author", {}).get("roles", [])}
        if not designer and not (roles & AUTHORITATIVE_ROLES):
            continue  # not a trusted answerer
        content = (m.get("content") or "").strip()
        date = (m.get("timestamp") or "")[:10]
        author = _author_name(m)
        cid = f"{channel}-{m['id']}"
        if not content:
            if m.get("attachments"):
                needs_ocr.append({
                    "id": cid, "author": author, "date": date,
                    "source_channel": channel,
                    "images": [a.get("url") for a in m["attachments"]],
                    "reply_to": (m.get("reference") or {}).get("messageId"),
                })
            continue
        ref = (m.get("reference") or {}).get("messageId")
        parent = by_id.get(ref) if ref else None
        role = "designer" if designer else "judge"
        if parent and (parent.get("content") or "").strip():
            out.append({
                "id": cid, "question": parent["content"].strip(), "answer": content,
                "answered_by": author, "role": role, "date": date,
                "source_channel": channel,
                "cards": _detect_cards(parent["content"] + "\n" + content),
            })
        else:
            out.append({
                "id": cid, "title": content.split("\n", 1)[0][:80].lstrip("# ").strip(),
                "body": content, "answered_by": author, "role": role, "date": date,
                "source_channel": channel, "cards": _detect_cards(content),
            })
    return out


def _parse_dce_export(path: Path, needs_ocr: list) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if "Thread" in data.get("channel", {}).get("type", ""):
        one = _parse_forum_thread(data, needs_ocr)
        return [one] if one else []
    return _parse_flat_channel(data, needs_ocr)


# --------------------------------------------------------------------------- #
# Loading
# --------------------------------------------------------------------------- #
def _load_seed() -> list[dict]:
    if not SEED_FILE.exists():
        return []
    return [json.loads(l) for l in SEED_FILE.read_text(encoding="utf-8").splitlines() if l.strip()]


def _load_exports(needs_ocr: list) -> list[dict]:
    """Parse forum-thread exports. Big flat chat channels (GuildTextChat) are
    NOT naively parsed here — their designer Q&A is mined + quality-filtered by the
    curation fleet into rulings/generated_rulings.jsonl (see _load_generated)."""
    if not EXPORTS_DIR.exists():
        return []
    out = []
    for path in sorted(EXPORTS_DIR.glob("*.json")):
        try:
            ctype = json.loads(path.read_text(encoding="utf-8")).get("channel", {}).get("type", "")
            if "Thread" not in ctype:
                continue  # flat channel -> handled by curation, skip the noisy naive parse
            out.extend(_parse_dce_export(path, needs_ocr))
        except (json.JSONDecodeError, KeyError) as e:
            # Skip a partial (mid-export) or malformed file rather than aborting
            # the whole corpus build.
            print(f"  [skip] {path.name}: {type(e).__name__} {e}")
    return out


# Only ingest designer Q&A from the current rules era. Pre-2025 answers in the flat
# channel are largely design-era deliberation with obsolete mechanics (old phase
# names, changed rules) and would contradict the current rulebook if retrieved.
# All 764 curated rulings stay in generated_rulings.jsonl for provenance; the
# corpus takes only >= this year.
GENERATED_MIN_YEAR = "2025"


def _load_generated() -> list[dict]:
    """Curated designer rulings produced by the fan-out fleet (all designer=auth 0)."""
    path = GENERATED_RULINGS
    if not path.exists():
        return []
    seen, out, dropped_old = set(), [], 0
    for i, line in enumerate(path.read_text(encoding="utf-8").splitlines()):
        line = line.strip()
        if not line:
            continue
        try:
            g = json.loads(line)
        except json.JSONDecodeError:
            continue
        q, a = (g.get("question") or "").strip(), (g.get("answer") or "").strip()
        if not q or not a:
            continue
        if (g.get("date") or "")[:4] < GENERATED_MIN_YEAR:
            dropped_old += 1
            continue
        key = (q.lower(), a.lower())
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "id": f"discord-{i}",
            "question": q,
            "answer": a,
            "answered_by": "designer",
            "role": "designer",
            "auth_key": "discord_ruling",
            "date": g.get("date", ""),
            "source_channel": "rules-questions",
            "cards": g.get("cards", []),
            "url": g.get("url", ""),
            "outdated": bool(g.get("outdated")),
        })
    if dropped_old:
        print(f"  (curated: dropped {dropped_old} pre-{GENERATED_MIN_YEAR} designer Q&A "
              f"as design-era/obsolete; kept {len(out)})")
    return out


def build_rulings() -> list:
    """Return corpus records for all seeded + exported rulings."""
    from build_corpus import make_record  # local import avoids circular load

    needs_ocr: list = []
    seed = _load_seed()
    exported = _load_exports(needs_ocr)
    generated = _load_generated()

    records = []
    for r in seed:
        records += _record_from_ruling(r, make_record, source="seed_rulings.jsonl")
    for r in exported:
        records += _record_from_ruling(r, make_record, source="discord-export")
    for r in generated:
        records += _record_from_ruling(r, make_record, source="rules-questions (curated)")

    if needs_ocr:
        RULINGS_DIR.mkdir(exist_ok=True)
        with NEEDS_OCR_FILE.open("w", encoding="utf-8") as f:
            for item in needs_ocr:
                f.write(json.dumps(item, ensure_ascii=False) + "\n")
        print(f"  {len(needs_ocr)} image-only messages -> {NEEDS_OCR_FILE.name} "
              f"(run an OCR/vision pass, then add to seed_rulings.jsonl)")

    print(f"  rulings: {len(seed)} seeded + {len(exported)} threads/Q&A "
          f"+ {len(generated)} curated designer Q&A -> {len(records)} chunks")
    return records


if __name__ == "__main__":
    for rec in build_rulings():
        cards = rec["metadata"].get("cards", [])
        print(f"[auth {rec['authority']}] {rec['id']}  cards={cards}")
        print(f"    {rec['title'][:70]}")
