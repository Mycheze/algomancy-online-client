import type { CardTicket } from '../tickets.ts';

export default {
  id: 568, area: "engine", severity: "minor",
  cards: ["Insidious Invitation", "Tiderunner Initiate"],
  title: "Tiderunner Initiate played off Insidious Invitation is not offered an open spot in the formation",
  detail: "Report #405 (StubTailDstroyer, KNQX, 2026-11-14, bug, minor): \"When playing out Tiderunner Initiate with Insidious Invitation, you should be able to play Tiderunner into an open slot in formation\". The same gap as report #399 (The Everywhere names nothing when played this way): a card played by another card's effect skips its own as-played stages. CT-564 carries the class, the evidence and the fix.",
  evidence: "KNQX fetched and replayed 2026-11-15 (steward triage): 211 of 211, FAITHFUL; from hand the Initiate goes \"played straight into the formation\", off Insidious Invitation it spawns with no spot asked. See CT-564.",
  fix: "Nothing here — it is CT-564's. This entry exists so report #405 is not lost, and closes with CT-564 (naming the Tiderunner Initiate guard CT-564 adds).",
  proof: null,
  verify: "In a battle, with a formation, cast Insidious Invitation and play Tiderunner Initiate from hand with it: you are asked which open spot it goes into.",
  reportId: 405,
} satisfies CardTicket;
