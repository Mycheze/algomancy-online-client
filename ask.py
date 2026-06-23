#!/usr/bin/env python3
"""
ask.py — keyword retrieval over the Algomancy chunk corpus.

A lightweight, dependency-free way to test corpus quality before wiring up a real
embedding model. Uses TF-IDF-ish scoring (term frequency x inverse doc frequency)
with a small boost for higher-authority sources, so the Manual/glossary/cards
float above dev-log chatter when relevance ties.

Usage:
    python3 ask.py "what does flame juggle do"
    python3 ask.py "can I target opponents during deployment" -k 8
    python3 ask.py "graft timing" --type rulebook,glossary --full
    echo "conjure timing" | python3 ask.py        # reads query from stdin

Flags:
    -k N            number of results (default 5)
    --type a,b      restrict to source_types (card,rulebook,glossary,article,devlog)
    --full          print full chunk text instead of a snippet
"""

import argparse
import json
import sys

# Retrieval core lives in retriever.py so the CLI and the Discord bot share it.
from retriever import load, build_index, score, snippet


def main():
    ap = argparse.ArgumentParser(description="Keyword search over the Algomancy corpus.")
    ap.add_argument("query", nargs="*", help="the question / search terms")
    ap.add_argument("-k", type=int, default=5, help="number of results")
    ap.add_argument("--type", default="", help="comma-separated source_types filter")
    ap.add_argument("--full", action="store_true", help="print full chunk text")
    args = ap.parse_args()

    query = " ".join(args.query).strip() or sys.stdin.read().strip()
    if not query:
        sys.exit("No query given. Example: python3 ask.py \"what does flame juggle do\"")
    types = {t.strip() for t in args.type.split(",") if t.strip()} or None

    rows = load()
    index = build_index(rows)
    hits = score(query, rows, index, types)

    if not hits:
        print(f'No matches for: "{query}"')
        return
    print(f'Query: "{query}"   ({len(hits)} matches, showing {min(args.k, len(hits))})\n')
    for rank, (s, r) in enumerate(hits[:args.k], 1):
        print(f"{rank}. [{r['id']}]  auth{r['authority']} {r['authority_label']}"
              f"  ·  {r['source']}  (score {s:.2f})")
        body = r["text"] if args.full else snippet(r["text"], query)
        print("   " + body.replace("\n", "\n   ") + "\n")


if __name__ == "__main__":
    main()
