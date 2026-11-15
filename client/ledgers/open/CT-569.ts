import type { CardTicket } from '../tickets.ts';

export default {
  id: 569, area: "client", severity: "minor",
  cards: [],
  title: "the card zoom works on the board but not on the card search, other players' decks or the meta deck list",
  detail: "Report #404 (mycheze, owner, 2026-11-14, ux, medium, page metadeck): \"The \\\"middle click to zoom in\\\" on a card should work in ALL pages that have cards! Including the card search, viewing other decks, the card metagame list, everything. We should make it a codified action to \\\"zoom in\\\" on a card.\" A feature, not a defect: BL-77 carries it (one zoom action, every page that draws a card).",
  evidence: "Report #404, no room. Read: ui/zoom.ts (the board's magnifier; the sideboard table, the draft pick and pool pages opt in); ui/pages/*.ts.",
  fix: "Nothing here — it is BL-77's. This entry exists so the report is not lost, and closes when BL-77 is done.",
  proof: null,
  verify: "Middle-click a card on the card search, a shared deck and the meta deck page: the big zoom shows on each.",
  reportId: 404,
} satisfies CardTicket;
