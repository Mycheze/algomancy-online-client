import type { CardTicket } from '../tickets.ts';

export default {
  id: 576, area: "client", severity: "minor",
  cards: [],
  title: "the main button says \"To Damage\" when two passes deal Swift damage first",
  detail: "Report #431 (mycheze, owner): \"When there's a \\\"Swift\\\" damage step, the button still says \\\"To Damage\\\" (but the \\\"normal\\\" and \\\"Sluggish\\\" damage steps are properly named)\". In the block window the button's words come from passOutcome's 'damage' case, which is always \"To Damage\". When the damage step is split (CR 608.3b: Swift and a later sub-step both have strikers), the two passes deal only the Swift sub-step and open the damage window, whose button then names the next sub-step (\"To normal damage\", \"To Sluggish damage\"). So the first sub-step is the only one not named. Likewise, a split battle whose first striking sub-step is normal (normal + Sluggish) is reached by an unnamed \"To Damage\".",
  evidence: "Triage 2026-11-22. PNPD (mycheze v Gember, draft, played on 1a0a0764) fetched and replayed FAITHFUL (163 of 163). Stepping it with passLabel: actions 110-111, turn 4 counterattack, blockWindow, button \"To Damage\"; after the passes the engine is in damageWindow with pendingSub 'normal' (Swift damage was dealt), button \"To normal damage\" (112-113), then \"To Sluggish damage\" (116-117). In the unsplit battle at 100-101 the same \"To Damage\" passes straight to the after-combat window, which is right.",
  fix: "In client/ui/nextstep.ts, the blockWindow case must know which sub-steps will strike before the engine computes damageSubs (it is set only when the damage step starts, engine.ts subStepsWithStrikes). Expose that computation as a pure engine helper the UI can call on the state, and label the block window \"To Swift damage\" (or \"To normal damage\") when the step is split and that is the first striking sub-step; keep \"To Damage\" for an unsplit step. Guard in ui/test/706-pass-label.",
  proof: null,
  verify: "Build a battle with a Swift attacker and a normal attacker both unblocked or blocked, reach the block window, and read passLabel: it says \"To Damage\" while the bug is there.",
  reportId: 431,
} satisfies CardTicket;
