import type { CardTicket } from '../tickets.ts';

export default {
  id: 567, area: "client", severity: "minor",
  cards: [],
  title: "a cached card shown in your hand: a \"Cache\" chip on the card instead of the floating \"cached\" label and the \"⚡ turn\" chip",
  detail: "Report #407 (mycheze, owner, XUKH, 2026-11-15, ux, minor): \"When a cached card is in your hand, rather than having the \\\"Cache\\\" title float above the card and a \\\"Turn\\\" chip be on the card, let's remove the \\\"Turn\\\" chip and make it a \\\"Cache\\\" chip instead. It would take up less space and get the same idea across\". The hand strip draws cached-and-playable cards in a `.handcached` group under a `.handcachedlabel` (\"cached · playable now\" / \"cached\"), each wearing the cache row's chip from `cacheChip` (ui/main.ts): \"⚡ turn\" for a glimpse, \"✓ free\" / \"⏳ n/m\" / \"waiting\" for a prophecy.",
  evidence: "Report #407, room XUKH (mycheze v Gember), action 122. XUKH fetched and replayed 2026-11-15: 252 of 252, FAITHFUL. Read: ui/main.ts handcached markup (\"in your cache, not your hand — also shown in the cache row\") and cacheChip.",
  fix: "In the HAND strip only (the cache row and the cache dialog keep their chips), drop the floating label and give each cached card one \"Cache\" chip. The owner names the glimpse case (\"Turn\"); a prophecy card's chip carries a count or \"free\", so keep that detail in the chip's title (tooltip) or as \"Cache ✓\" — pick the one that changes least and say so. Guards: ui tests that the hand's cached cards wear the Cache chip and no label, and that the cache row still shows ⚡ turn. Player-visible: an updates.ts line.",
  proof: null,
  verify: "Glimpse a card in a battle: in your hand it shows one \"Cache\" chip and no \"cached\" label above it; the cache row still shows ⚡ turn.",
  reportId: 407,
} satisfies CardTicket;
