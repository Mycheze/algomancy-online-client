import type { CardTicket } from '../tickets.ts';

export default {
  id: 570, area: "client", severity: "minor",
  cards: [],
  title: "the \"bring spell tokens into this battle?\" question is a small chip list in the prompt bar, not a picker with Bring all / Bring none",
  detail: "Report #406 (mycheze, owner, XUKH, 2026-11-15, ux, medium): a dialog of every spell token you may bring, picked by clicking, with \"Bring all\" and \"Bring none\" buttons, instead of the prompt bar's small chips. A new dialog in the attack flow: BL-78 carries it.",
  evidence: "Report #406, room XUKH, action 99; XUKH fetched and replayed 2026-11-15: 252 of 252, FAITHFUL. Read: ui/main.ts, the battle declare step's ui.confirmRide bar; ui/battle.ts ridableTokens.",
  fix: "Nothing here — it is BL-78's. This entry exists so the report is not lost, and closes when BL-78 is done.",
  proof: null,
  verify: "Attack with spell tokens that may ride: a dialog shows them as tiles, with Bring all and Bring none.",
  reportId: 406,
} satisfies CardTicket;
