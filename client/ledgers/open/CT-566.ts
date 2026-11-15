import type { CardTicket } from '../tickets.ts';

export default {
  id: 566, area: "client", severity: "minor",
  cards: [],
  title: "the board's Cache area is drawn bigger than the Bin, though the bin is the pile that fills up",
  detail: "Report #401 (mycheze, owner, ENUC, 2026-11-14, ux, minor): \"The Cache zone is much larger than the Bin, which doesn't make sense. Usually, the cache has like 1 or two cards in it, if any and the bin has many. Just swap their sizes on screen, I think\". Each player's info line (ui/main.ts, the `info` builder in the board renderer: `.lbin` holds r.binMini, `.lcache` holds r.cache or the empty placeholder) draws the two piles side by side; the owner wants the bin given the cache's room and the cache the bin's.",
  evidence: "Report #401, room ENUC (mycheze v Gember), action 71. ENUC fetched and replayed 2026-11-15: 183 of 183, FAITHFUL. Read: ui/main.ts info line (bin · cache · name on my side, the mirror on theirs); styles/board/40-info-line-phase-icons.css (.linfo .lbin, .linfo .lcache flex: none). The actual widths come from the bin mini and the cache entries' card thumbs; not measured in a browser (none on the box).",
  fix: "Find what sizes the two (the binMini thumb vs the regioncache thumbs and the empty placeholder) and swap them, on both players' lines and in every layout the info line has (desktop, tablet, phone), so the bin is the bigger slot and the cache the smaller. Keep the cache's stable empty slot (owner, 2026-10-27). Guard: a ui test over the CSS read through ui/test/read-styles.ts (or the markup) that the bin's slot is at least the cache's. Player-visible: an updates.ts line.",
  proof: null,
  verify: "In a game with cards in both piles, the bin's area on each player's line is the larger and the cache's the smaller.",
  reportId: 401,
} satisfies CardTicket;
