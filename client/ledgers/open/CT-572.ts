import type { CardTicket } from '../tickets.ts';

export default {
  id: 572, area: "client", severity: "minor",
  cards: [],
  title: "the board's bin shows three thumbs side by side; the owner wants an overlapping pile that shows more of it",
  detail: "Report #414 (mycheze, owner, VHRU, 2026-11-16, ux, medium), on CT-566's wider bin: \"The larger and wider bin does look better, but now you can, at most, see the top 3 cards and they look a bit odd. I think it'd be better if it actually looked like they were piling up a bit and overlapping with each other, sorta like people do in real life.\" Today each player's info line draws binMini (ui/main.ts, the region builder: binShown is at most three indices, the last three with targeted cards surfaced last per CR D6.6d) as three thumbs placed side by side in a 3 x --binth + 12px slot (styles/board/40-info-line-phase-icons.css, .linfo .regionbinthumbs and its nth-child(2)/(3) lefts).",
  evidence: "Report #414, room VHRU (mycheze v Gember, constructed, played on 92ef778d, after CT-566 landed in 0890b0aa). VHRU fetched and replayed 2026-11-16: 218 of 218, FAITHFUL; at [169] turn 4 battle, block window, Spewing Mushroom on the stack — nothing wrong in the game. Read: ui/main.ts binShown/binMini; the CSS above; CT-566's commit message. Not seen in a browser (none on the box).",
  fix: "Keep the bin's slot as wide as CT-566 made it (ui/test/368 pins bin wider than cache), but draw the pile as overlapping thumbs offset a little each, so more than three of the newest cards show (as many as the slot fits; the top card whole, the ones under it peeking), like a real discard pile. Keep: a targeted bin card surfaced on top (CR D6.6d), a playable bin card's own click (data-btn=\"binplay\") reachable, the empty placeholder, the narrow line's --binslot, and the bin-open click on the rest. Guard: a ui test over the markup and readStyles() that the bin shows more than three cards when it holds them and that consecutive thumbs overlap. Player-visible: an updates.ts line.",
  proof: null,
  verify: "In a game with eight or more cards in a bin, the bin on that player's line looks like a pile: more than three cards, each overlapping the one under it, the newest on top whole.",
  reportId: 414,
} satisfies CardTicket;
