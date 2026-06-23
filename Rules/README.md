# Algomancy Rules Corpus

Detailed rules and gameplay text for **Algomancy** (by Caleb Gannon), collected for use as a
RAG knowledge base. All content is from official / designer sources. Collected **2026-06-20**.

The companion `../AlgomancyCards/` directory holds the card images and the per-card
oracle text (`AlgomancyCards-OracleText.json` / `.txt`), which pairs with these rules.

## Authority & recency (read this first for RAG)

Prefer the canonical current rules when answers conflict. Ordering, most→least authoritative
for *current* rules:

1. **`Algomancy-Manual.{pdf,txt}`** — the professionally edited, illustrated rulebook with a
   full table of contents (Setup, Anatomy of a Card, Battle, Regroup & Deployment, The Stack,
   Attributes, etc.). **This is the primary, most up-to-date and complete rules reference.**
2. **`Algomancy-Rules-Glossary.md`** — alphabetical keyword/term definitions (Augment, Graft,
   Conjure, Electric, Formation, Skirmish, Adjacency, Historic, Resources, Target, …). Highest
   value per token for keyword lookups.
3. **`Algomancy-Rulebook-2023-07.{pdf,txt}`** — earlier, less-polished full rulebook. Good
   secondary coverage; superseded by the Manual where they differ.
4. **`The-Rules-of-Algomancy.md`** — long-form web rules write-up by the designer.
5. **`Mastering-Initiative-Strategy-Guide.md`** — official strategy article on the initiative
   system (rules-adjacent + strategy).

### Design blog / background (⚠ may contain OUTDATED rules)
These are designer dev-logs. They explain *why* mechanics exist and give worked examples, but
predate the final rules and **occasionally describe superseded mechanics**. Useful for context
and examples; do not treat as authoritative over the Manual/Glossary.

- `The-Making-of-Algomancy.md` — 10k-word design retrospective (mostly philosophy/lore).
- `DevLog-1-Complexity.md` — complexity rating system, design goals.
- `DevLog-2-Combat-Abilities.md` — early combat/attribute mechanics.
- `DevLog-4-Grafting-and-Continuity.md` — Graft / ability continuity.
- `DevLog-6-Mutations.md` — mutation mechanic.

## File formats

- `.txt` files are `pdftotext -layout` extractions of the PDFs (clean, RAG-ready plain text).
- `.md` files are the article bodies extracted from WordPress pages and converted with pandoc;
  embedded images and raw HTML have been stripped, leaving verbatim rules prose.
- The original `.pdf` files are kept alongside the `.txt` for reference / re-extraction.

## Core concepts covered (quick map for chunking/metadata)

- **Win condition & game modes**: Live Draft (standard), Pre-Draft, Constructed, Team Draft;
  player setups 1v1 / 3v3 / Free-for-All / 2v1.
- **Global turn & initiative**: turns are global (no individual player turns); initiative system
  decides who acts first; steps Draw → Draft → Combat → Main.
- **Resources / elements**: Fire, Water, Earth, Metal, Plant (Wood). Semi-thresholded system;
  each resource = 1 threshold + can be expended for 1 mana; tap/untap; affinity bonuses.
- **Combat**: Skirmishes, Formations, columns/rows, Adjacency, Attributes (Flying, Deadly,
  Poisonous, Electric, Devastating…), attacking/blocking/damage, Priority windows, the Stack.
- **Card-combination mechanics**: Augment (+), Graft (switch arrows), Conjure (offensive/
  defensive spell tokens), Mutations, Historic cards.
- **Card anatomy**: Units, Spells, Spell Units, timing, cost/threshold, complexity symbol.

## Sources

- Manual PDF: https://calebgannon.com/wp-content/uploads/Algomancy-manual-copy.pdf
- Rulebook PDF (2023-07): https://calebgannon.com/wp-content/uploads/2023/07/Algomancy-Rulebook.pdf
- Rules glossary: https://calebgannon.com/2022/09/06/algomancy-rules-glossary/
- The Rules of Algomancy: https://calebgannon.com/2022/07/06/the-rules-of-algomancy/
- Mastering Initiative: https://algomancy.io/mastering-initiative-essential-algomancy-strategy-guide/
- The Making of Algomancy: https://calebgannon.com/2023/07/08/the-making-of-algomancy/
- Dev logs: https://calebgannon.com/ (2022 "algomancy-development-log-*" posts)
- Card search / oracle data: https://calebgannon.com/algomancycards/
- Official site: https://algomancy.io/  •  Community: Algomancy Discord (https://discord.gg/EQyyjdf4Dr)

## Not captured (possible future additions)

- BoardGameGeek wiki/forums (https://boardgamegeek.com/boardgame/395771) — blocked automated
  fetch (HTTP 403); contains community rulings/FAQ worth adding manually.
- Official Discord rulings channel — not web-scrapable; richest source of edge-case rulings.
- Print-and-Play edition PDF (74 pp, paid): https://shop.calebgannon.com/products/algomancy-print-and-play-edition
- Video tutorials (Watch It Played; designer's YouTube playlist) — would need transcription.
