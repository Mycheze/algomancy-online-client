/**
 * THE PLAYTEST REPORT LEDGER — every bug report the owner has ever filed,
 * with its status and the test that keeps it fixed.
 *
 * WHY THIS EXISTS
 *
 * Reports arrive through the in-game 🐛 button and land in
 * `server/issues.jsonl` on the game server. That file is not in git, so the
 * reports themselves were never version-controlled, never reviewed, and never
 * connected to anything that could fail. The result, in the owner's words on
 * 2026-08-22: "Things that I mention as being problematic in games should STOP
 * BEING PROBLEMS."
 *
 * Two reports proved the point on the same day:
 *
 *  - Tempest Wrangler / Alluring was reported on 2026-08-20 (BRDM), fixed in
 *    round 7 with a whole test file — and reported again, verbatim, on
 *    2026-08-22 (UFAB). Round 7's tests only ever attacked with columns that
 *    were ALL Alluring, so the one board shape that mattered (a mixed attack,
 *    where a blocker can be dumped on a non-Alluring column) was never
 *    asserted. A fix with a test that misses the reported shape is not a fix.
 *
 *  - Harbinger of Immolation's "your spell tokens stay through regroup" was
 *    reported on 2026-08-20 (ZQPC) and was still completely unimplemented on
 *    2026-08-22, when it cost the owner a constructed game. `git log` shows no
 *    commit ever touched it in response. It LOOKED handled because a PARKED
 *    note and a `{todo:true}` placeholder already existed — and a `{todo:true}`
 *    test can never fail, so the repo stayed green while the card stayed dead.
 *
 * So the rule this ledger enforces is narrow and deliberate: **a report marked
 * FIXED must name a test that actually exists.** Not a commit message, not a
 * comment, not a rule number — a test. `70-playtest-ledger.test.ts` checks it.
 *
 * HOW TO USE IT
 *
 *  - A new report comes in: add an entry. The count assertion fails until you
 *    do, so a report cannot be silently dropped on the floor.
 *  - You fix something: set `status: 'fixed'` and name the guard. If you cannot
 *    name a guard, it is not fixed — it is `live` with a note.
 *  - `{ todo: true }` tests do NOT count as guards. That is the exact trap
 *    Harbinger fell into. `guards` must name a test that runs and can fail.
 *
 * STATUS VALUES
 *   'fixed'    — resolved, and `guards` names test(s) that would fail if
 *                someone re-broke it.
 *   'live'     — still broken. `note` says why / what the root cause is.
 *   'partial'  — some of the report is done. `note` says which part is not.
 *   'by-design'— the engine deliberately does something else. `note` MUST cite
 *                the ruling, Manual page, or rule number that justifies it,
 *                because this is us telling the owner he was wrong and that
 *                needs a source.
 *   'wontfix'  — acknowledged, not being done. `note` says why.
 */

export type ReportStatus = 'fixed' | 'live' | 'partial' | 'by-design' | 'wontfix';

export interface LedgerEntry {
  /** index into issues.jsonl, oldest first — the stable id */
  id: number;
  /** room code the report came from */
  room: string;
  /** ISO date (day precision is enough) */
  date: string;
  /** the report, trimmed to its essence but not paraphrased into something else */
  report: string;
  status: ReportStatus;
  /**
   * Test(s) that keep this fixed. Each is `file::substring-of-the-test-name`.
   * The substring must appear in a `test('...')` title in that file. Required
   * when status is 'fixed'; a `{todo:true}` test does not qualify.
   */
  guards?: string[];
  /** required for every status except 'fixed' */
  note?: string;
}

export const LEDGER: LedgerEntry[] = [
  {
    id: 0, room: 'SMOKE', date: '2026-08-18',
    report: 'deploy smoke test - ignore',
    status: 'wontfix', note: 'Not a report — the deploy smoke test wrote this row.',
  },

  // ── MNWK, 2026-08-19 ────────────────────────────────────────────────────
  {
    id: 1, room: 'MNWK', date: '2026-08-19',
    report: "Mohruung didn't activate for some reason after being targeted",
    status: 'fixed',
    guards: ['48-playtest-hotfix.test.ts::Mohruung', '17-earth-b.test.ts::Mohruung'],
  },
  {
    id: 2, room: 'MNWK', date: '2026-08-19',
    report: "I can't mod Brough from my bin to a unit for some reason",
    status: 'fixed',
    guards: ['48-playtest-hotfix.test.ts::[Augment]'],
  },
  {
    id: 3, room: 'MNWK', date: '2026-08-19',
    report: "Tranquility isn't making spells more expensive",
    status: 'fixed',
    guards: ['49-playtest-round6.test.ts::Tranquility'],
  },
  {
    id: 4, room: 'MNWK', date: '2026-08-19',
    report: "Flight doesn't make me pick two targets when casting it. It just has me pick an ally",
    status: 'fixed',
    guards: ['49-playtest-round6.test.ts::Fight', '68-target-conformance.test.ts::target'],
    note: 'There is no card called "Flight" — the card is FIGHT. Fixed in round 6 (R58).',
  },
  {
    id: 5, room: 'MNWK', date: '2026-08-19',
    report: "Mohruung STILL isn't making Crystal tokens",
    status: 'fixed',
    guards: ['48-playtest-hotfix.test.ts::Crystal'],
  },
  {
    id: 6, room: 'MNWK', date: '2026-08-19',
    report: "I'm unable to cast Divine Intervention at all",
    status: 'fixed',
    guards: ['23-wood-a.test.ts::target effect', '39-light-b.test.ts::Divine Intervention',
      '39-light-b.test.ts::reaches a TRIGGER on the stack'],
    note: 'R60. CLOSED in round 17. The two original DI tests only ever aimed at a SPELL, so both '
      + 'would have survived a revert of the spec to `stackSpell` — the only thing actually '
      + "holding the line was Hush Mush's test, one card away. The new case puts a spell AND a "
      + 'trigger on the stack at once, each holding a target, and asserts the TRIGGER is on DI\'s '
      + 'menu. Verified: narrowing the spec back to `stackSpell` leaves the two old tests green '
      + 'and reddens only the new one, which is exactly the hole this entry described.',
  },
  {
    id: 7, room: 'MNWK', date: '2026-08-19',
    report: 'Burgeon resolving didn\'t give me the choice to double the power or defense. It just did nothing',
    status: 'fixed',
    guards: ['23-wood-a.test.ts::Burgeon', '65-effect-conformance.test.ts::silence'],
  },
  {
    id: 8, room: 'MNWK', date: '2026-08-19',
    report: 'I was able to Prophecy Air Plant without having any Wood resources. I just wanted to '
      + 'click the card to see what would happen and it just immediately went to the Cache zone',
    status: 'fixed',
    guards: ['36-cache-prophecy.test.ts::banner',
      '70-playtest-round15.test.ts::only option is prophesy opens a menu'],
    note: 'The COST half was always correct: R42 says the banner costs plain mana with no '
      + 'affinity, so no Wood was needed. The CLICK half was the real bug — offer() auto-fired '
      + 'when prophesy was the only menu item. It now always opens a menu.',
  },
  {
    id: 9, room: 'MNWK', date: '2026-08-19',
    report: "I can't Prophecy Calming Force",
    status: 'by-design',
    guards: ['36-cache-prophecy.test.ts::no banner',
      '40-light-c.test.ts::is enforced, and not just un-offered'],
    note: 'Correct: Calming Force has no prophecy banner in the printed data or upstream oracle, '
      + 'and R42 refuses a banner-less card. The SEPARATE LIVE HOLE this note used to describe is '
      + 'CLOSED as of R100 (round 17): its other line "I can\'t be played from your hand" was '
      + 'unenforced, so the engine was strictly more permissive than print. There is now a '
      + '`CardBehavior.noPlayFromHand` flag — the mirror of prophesyFromBin, defaulting permissive '
      + '— checked in doPlayCard AND at all three legalActions hand-play sites, because a refusal '
      + 'the UI still offers as a legal click is its own playtest report. Collateral worth '
      + 'knowing: two R68 negation tests used Calming Force played from hand as their vehicle and '
      + 'had to be rerouted through a glimpse-stamped cache release.',
  },

  // ── BRDM, 2026-08-20 ────────────────────────────────────────────────────
  {
    id: 10, room: 'BRDM', date: '2026-08-20',
    report: 'Tempest Wrangler (with alluring) didn\'t trigger on attack',
    status: 'fixed',
    guards: ['53-playtest-round7.test.ts::R84 UFAB',
      '53-playtest-round7.test.ts::the minimal form',
      '75-ui-reachability.test.ts::declining is illegal here'],
    note: 'THE RECURRENCE THAT MOTIVATED THIS LEDGER, and it took two fixes. Round 7 built an '
      + 'engine rule and tested it hard, but every scenario attacked with ONLY Alluring columns, '
      + 'so the mixed-attack shape — where a blocker can be dumped on a plain column — was never '
      + 'asserted, and the bug returned verbatim as id 57. It also turned out to be the WRONG '
      + 'RULE: R84 replaces it per Caleb\'s rulings ({Alluring} targets ONE enemy unit, from the '
      + 'stack). And the client had no Alluring awareness at all, so the duty was invisible until '
      + 'the server refused your declaration — the block bar now names it and gates Confirm.',
  },
  {
    id: 11, room: 'BRDM', date: '2026-08-20',
    report: 'Eldritch Dreamtender needs to be sacrificed for its ability to go on the stack, but '
      + "it's still visually in play while resolving its trigger",
    status: 'fixed',
    guards: ['26-metal-a.test.ts::sacrifice', '32-cast-costs.test.ts::sacrifice'],
  },
  {
    id: 12, room: 'BRDM', date: '2026-08-20',
    report: 'Body Swap puts into the log that the units get -X/+X for the swap. It\'s supposed to '
      + 'just be a pure swap of numbers',
    status: 'fixed',
    guards: ['53-playtest-round7.test.ts::Body Swap', '59-base-stats.test.ts::base'],
  },
  {
    id: 13, room: 'BRDM', date: '2026-08-20',
    report: 'Formless is broken — it should have set Manablub to a 4/4. Stats need to be able to '
      + 'be set without using + or -',
    status: 'fixed',
    guards: ['53-playtest-round7.test.ts::Formless', '59-base-stats.test.ts::base'],
  },
  {
    id: 14, room: 'BRDM', date: '2026-08-20',
    report: "Necromorph doesn't have me select two targets on cast",
    status: 'fixed',
    guards: ['43-dark-c.test.ts::Necromorph', '68-target-conformance.test.ts::target'],
  },
  {
    id: 15, room: 'BRDM', date: '2026-08-20',
    report: "Why didn't Refuse Reclaimer get a counter from my Oracle dying?",
    status: 'by-design',
    guards: ['28-metal-c.test.ts::a death in the battle region it attacked into',
      '28-metal-c.test.ts::a death in a region it is not in'],
    note: 'R12 — REGION SCOPING, and the caveat this entry carried since round 7 turns out to be '
      + 'the whole explanation rather than a loose end. Caleb Gannon, #rules-questions 2025-03-09: '
      + '"Everything in the game is region specific. So nothing will ever impact anything in '
      + 'another region. You should be able to completely ignore cards in other regions when '
      + 'resolving a battle. Units don\'t need to block to trigger (unless the card specifically '
      + 'says so). Just being in the region is enough." A Reclaimer standing at home genuinely '
      + 'does not see an Oracle die in the battle region, and that is the rule, not a bug. Round '
      + '7 reached the same verdict but left only a commit message behind; round 17 replaced it '
      + 'with the two tests named above, which pin BOTH directions — it fires on a death in its '
      + 'own region without blocking, and stays cold for one in another region. Verified '
      + 'load-bearing by breaking the region filter each way.',
  },
  {
    id: 16, room: 'BRDM', date: '2026-08-20',
    report: 'Sometimes the system wants you to block in a specific order. I was forced to do '
      + 'creature B as a blocker before creature A despite it being pointless',
    status: 'fixed',
    guards: ['55-ui-formation.test.ts::dropIntoRow', '55-ui-formation.test.ts::block builder in ui/main.ts',
      '75-ui-reachability.test.ts::affordance for every offered shape'],
    note: 'The insert itself is now ui/formation.ts dropIntoRow — both rows always drawn, and '
      + 'dropping into an occupied FRONT row pushes the sitting unit back rather than refusing. '
      + 'The three lines of ui/main.ts between it and the page (the data-row on the slot, the '
      + 'click that reads it, both rows drawn) are read as text in the same file.',
  },
  {
    id: 17, room: 'BRDM', date: '2026-08-20',
    report: 'FORMLESS SHOULD BE ABLE TO TARGET ITSELF',
    status: 'fixed',
    guards: ['27-metal-b.test.ts::Formless: BRDM'],
    note: 'It always worked — a bare what:"unit" spec includes the source, and "another target …" '
      + 'is a separate clause (dsl.ts notSelf) Formless does not print. What was missing was the '
      + 'assertion: 16-earth-a.test.ts pins the OPPOSITE for Eminence of Fire, which really does '
      + 'print "another", so an "exclude self" refactor would have looked sanctioned. The guard '
      + 'pins both halves — the declaration carries no restrict, and the live trigger menu really '
      + 'offers Formless to itself.',
  },
  {
    id: 18, room: 'BRDM', date: '2026-08-20',
    report: 'When a decision is pending for the other player, I get the window for priority and it '
      + "asks me to pass but I can't, since it's not actually my priority",
    status: 'fixed',
    guards: ['53-playtest-round7.test.ts::pending', '50-ui-inspect.test.ts::waiting'],
  },
  {
    id: 19, room: 'BRDM', date: '2026-08-20',
    report: 'When a column becomes empty during combat, the columns to the right should '
      + 'immediately collapse and fill the gap',
    status: 'by-design',
    guards: ['64-formation-collapse.test.ts::collapse', '64-formation-collapse.test.ts::blocks'],
    note: 'DIVERGES FROM THE REPORT ON PURPOSE. R72: vertical gravity is untimed, but horizontal '
      + 'collapse only runs BEFORE blocks are declared, citing Manual p.22 — "This only happens '
      + 'before blocks are declared. After blocks, columns will not move to fill gaps." Tested '
      + 'both ways. CONFIRMED BY THE OWNER on 2026-08-22, having read the Manual text: "I made '
      + 'assumptions but have now seen the real rulings." Settled — do not re-open.',
  },

  // ── DEYK, 2026-08-20 ────────────────────────────────────────────────────
  {
    id: 20, room: 'DEYK', date: '2026-08-20',
    report: 'Pure units should be able to block evasive or flying units',
    status: 'fixed',
    guards: ['40-light-c.test.ts::Pure'],
  },
  {
    id: 21, room: 'DEYK', date: '2026-08-20',
    report: "I didn't have to pay 2 life from Arbiter of Armistice's ability when casting a spell "
      + 'during battle',
    status: 'fixed',
    guards: ['38-light-a.test.ts::2 life'],
  },
  {
    id: 22, room: 'DEYK', date: '2026-08-20',
    report: 'The blocks that show that my opponent are doing are wrong on my screen. It fixed '
      + "itself when blocks were declared, so it's just visual",
    status: 'fixed',
    guards: ['55-ui-formation.test.ts::hole keeps its lane'],
    note: 'Root cause was column compaction, not the Generic Units the owner suspected.',
  },
  {
    id: 23, room: 'DEYK', date: '2026-08-20',
    report: "I'm not able to cast Hush Mush, though I have priority and there's an effect I want to negate",
    status: 'fixed',
    guards: ['23-wood-a.test.ts::Hush Mush'],
  },

  // ── ZQPC, 2026-08-20 ────────────────────────────────────────────────────
  {
    id: 24, room: 'ZQPC', date: '2026-08-20',
    report: "Scholar of the Void doesn't say what the Beyond card it can transform into does",
    status: 'fixed',
    guards: ['43-dark-c.test.ts::R101 — discard your hand and transform into Beyond',
      '43-dark-c.test.ts::R101 — a transformed Scholar is a TOKEN',
      '50-ui-inspect.test.ts::the inspector says what Scholar of the Void transforms into',
      '50-ui-inspect.test.ts::a card that has already transformed shows no row',
      '75-ui-reachability.test.ts::the details page really renders the Transforms into row'],
    note: 'R101. Blocked for two days on something no amount of research could fix: '
      + '"Beyond, Codex Incarnate" existed in NO data we held — not the 534-card oracle file, '
      + 'not the corpus, not the rulings export, and there was no art. The owner supplied the '
      + 'card face on 2026-08-22 (0 mana, 8/3, "Book Token Unit") and it is now a '
      + 'registerSynthetic in registry.ts, deliberately NOT in printed.json, which '
      + 'scripts/pool.mjs regenerates and would silently drop it. NO TRANSFORM LAYER WAS NEEDED: '
      + 'Entity.card IS the identity — baseStatsOf reads this.card(e.card), the bin push reads '
      + 'u.card, the client keys off it — so turning the card over is one assignment on the SAME '
      + 'object, which is why the id, the counters, the marked damage, the formation slot and '
      + 'every "since it entered play" fact all survive for free, and no spawned/died event '
      + 'fires. It also sets token:true, because the type line says "Book TOKEN Unit" and without '
      + 'it a 0-cost 8/3 would sit in a bin for any exhume or bin-play effect to fetch. The '
      + 'REPORTED symptom — you cannot see what you would become before discarding your hand — is '
      + 'fixed by a declarative "Transforms into" inspector row fed the way tokensCreatedBy is. '
      + 'BEYOND ITSELF is complete too, in the same round: its "Your units are inverted" clause '
      + 'works only because R93 shipped stat layer 5 the same day, and its rot replacement '
      + 'landed as R102 on the owner\'s own ruling — "In Deployment, you\'re in your own region, '
      + 'alone. So you can only target your own units. It would trigger, ask you what you want to '
      + 'target, then put the -1/-1 counters on during deployment (which still has and uses a '
      + 'stack)." That ruling is what made it small: the first design called for a new Suspension '
      + 'variant, and the stack route needed only a new listenable `rotReplaced` EVENT, after '
      + 'which R67\'s ordinary trigger machinery does the asking.',
  },
  {
    id: 25, room: 'ZQPC', date: '2026-08-20',
    report: 'The spell tokens shouldn\'t get smushed in with the units. They should have their own '
      + 'spot, over by the bin',
    status: 'fixed',
    guards: ['70-playtest-round15.test.ts::floor still fits two cards abreast',
      '70-playtest-round15.test.ts::.zone still wraps'],
    note: 'The strip existed but was a fixed 118px against 108px for two cards — one per row by '
      + 'arithmetic. Now fluid with a cap. Reported twice; the follow-up was id 61.',
  },
  {
    id: 26, room: 'ZQPC', date: '2026-08-20',
    report: 'Can you make the arrows originate from and point to the middle of the cards?',
    status: 'fixed',
    guards: ['70-playtest-round15.test.ts::arrow starts at one card',
      '70-playtest-round15.test.ts::only the arrowHEAD is inset'],
    note: 'The geometry was right but untested; arrowGeometry() is now extracted and guarded.',
  },
  {
    id: 27, room: 'ZQPC', date: '2026-08-20',
    report: 'I have infernal wispweaver, but my wisps sacrificed themselves anyway',
    status: 'fixed',
    guards: ['12-fire-a.test.ts::wisps do not sacrifice'],
  },
  {
    id: 28, room: 'ZQPC', date: '2026-08-20',
    report: 'My fireball was erased during regroup even tho I have the Harbinger',
    status: 'fixed',
    guards: ['12-fire-a.test.ts::spell tokens stay through regroup'],
    note: 'THE SECOND LEDGER-MOTIVATING CASE. startRegroup deletes every spellToken '
      + 'unconditionally and Harbinger\'s "[Augment] Your spell tokens stay through regroup" was a '
      + 'stub with events:[] . git log shows NO commit ever responded to this report. It looked '
      + 'handled because a PARKED note and a {todo:true} already existed. Recurred as id 62 and '
      + 'cost a conceded game. Being fixed as a StaticMod (it is a continuous effect, not an '
      + 'event replacement).',
  },

  // ── PEMC, 2026-08-21 ────────────────────────────────────────────────────
  {
    id: 29, room: 'PEMC', date: '2026-08-21',
    report: 'I can\'t discard Sacrifice Dude at "instant" speed',
    status: 'fixed',
    guards: ['58-playtest-round9.test.ts::Discard me'],
    note: '"Sacrifice Dude" is the literal printed card name. R65: discarding is not playing.',
  },
  {
    id: 30, room: 'PEMC', date: '2026-08-21',
    report: 'We need a way to right click -> concede match',
    status: 'fixed',
    guards: ['58-playtest-round9.test.ts::concede',
      '70-playtest-round15.test.ts::board menu offers concede'],
    note: 'The engine/server halves were always guarded; the menu ENTRY was not, and '
      + 'server/test-concede.ts was run by no npm script at all until the server suite was wired.',
  },
  {
    id: 31, room: 'PEMC', date: '2026-08-21',
    report: "I don't think there's currently a way to view erased cards",
    status: 'fixed',
    guards: ['58-playtest-round9.test.ts::erased', '50-ui-inspect.test.ts::erased',
      '70-playtest-round15.test.ts::board menu offers BOTH erased piles'],
  },
  {
    id: 32, room: 'PEMC', date: '2026-08-21',
    report: "Download didn't have me target anything",
    status: 'fixed',
    guards: ['58-playtest-round9.test.ts::Download', '68-target-conformance.test.ts::target'],
  },
  {
    id: 33, room: 'PEMC', date: '2026-08-21',
    report: 'Shouldn\'t Discharge have you remove counters as an additional cost? Not on resolution',
    status: 'fixed',
    guards: ['58-playtest-round9.test.ts::Discharge'],
  },
  {
    id: 34, room: 'PEMC', date: '2026-08-21',
    report: 'I was allowed to choose illegal targets for Reconfigure',
    status: 'fixed',
    guards: ['58-playtest-round9.test.ts::Reconfigure'],
  },

  // ── UZRG, 2026-08-21 ────────────────────────────────────────────────────
  {
    id: 35, room: 'UZRG', date: '2026-08-21',
    report: "Units with activated abilities don't get a green highlight indicating you can "
      + 'activate their abilities',
    status: 'fixed',
    guards: ['50-ui-inspect.test.ts::activatable',
      '70-playtest-round15.test.ts::drawn with the .activatable class',
      '70-playtest-round15.test.ts::halo itself is still in the stylesheet'],
  },
  {
    id: 36, room: 'UZRG', date: '2026-08-21',
    report: "Primordial Coalescence isn't showing the Tokens it creates in the details page",
    status: 'fixed',
    guards: ['50-ui-inspect.test.ts::Primordial Coalescence', '65-effect-conformance.test.ts::creates'],
  },
  {
    id: 37, room: 'UZRG', date: '2026-08-21',
    report: 'Planning should be like deployment, entirely divorced from what your opponent is '
      + 'doing — you can\'t take back a wrong resource, and you can see what they do live',
    status: 'fixed',
    guards: ['server/test-new-features.ts::recycle was untouched',
      'server/test-hidden.ts::freeze is captured at room creation'],
    note: 'Implemented as three hidden segments (plan/haste/deploy). The guard existed but was '
      + 'NOT RUN by any npm script until the server suite was wired up.',
  },
  {
    id: 38, room: 'UZRG', date: '2026-08-21',
    report: "Wraith tokens aren't using their actual token image (it's incorrectly named Wight)",
    status: 'fixed',
    guards: ['63-card-art.test.ts::art', '63-card-art.test.ts::Wraith'],
  },
  {
    id: 39, room: 'UZRG', date: '2026-08-21',
    report: 'Tokens aren\'t technically erased when they leave play — they should go to another '
      + 'zone and cease to exist when state based actions are checked',
    status: 'fixed',
    guards: ['35-rot-debt-trash.test.ts::erase', '37-attrs-wight.test.ts::Unstable'],
  },
  {
    id: 40, room: 'UZRG', date: '2026-08-21',
    report: 'My Wraith dying was NOT handled correctly. Since it was Unstable from the mod, it '
      + 'shouldn\'t have even technically died and nothing should have triggered on death',
    status: 'fixed',
    guards: ['37-attrs-wight.test.ts::MODDED token'],
    note: 'The real bug (branch order in destroy(), so a modded token took the token carve-out) is '
      + 'fixed. But the owner\'s second premise is REJECTED BY RULING: R69 §2 with two direct Caleb '
      + 'rulings says Unstable replaces the BIN, not the DEATH — so death triggers DO still fire. '
      + 'CONFIRMED BY THE OWNER on 2026-08-22, having read the rulings. Settled — do not re-open.',
  },
  {
    id: 41, room: 'UZRG', date: '2026-08-21',
    report: 'Is negate supposed to remove effects from the stack? Not just grey them out',
    status: 'fixed',
    guards: ['61-negation.test.ts::negate'],
  },
  {
    id: 42, room: 'UZRG', date: '2026-08-21',
    report: "Necromantic Rebuke didn't properly negate my effect",
    status: 'fixed',
    guards: ['42-dark-b.test.ts::X = 0'],
    note: 'Behaviour was correct as printed — X=0 makes the ransom trivially met. Owner ruled '
      + '(R74) that this warrants a warning, not a prohibition; the warning is what was added.',
  },
  {
    id: 43, room: 'UZRG', date: '2026-08-21',
    report: "It's not possible to see the X value for an effect while it's on the stack",
    status: 'fixed',
    guards: ['50-ui-inspect.test.ts::X'],
  },

  // ── XCYX / VEAV, 2026-08-22 (rounds 14-15) ──────────────────────────────
  {
    id: 44, room: 'XCYX', date: '2026-08-22',
    report: 'Throwing Boulder was allowed to be activated without having adjacent allies, and '
      + 'sacrificing him should have been a cost to even put the ability on the stack',
    status: 'fixed',
    guards: ['18-earth-c.test.ts::Throwing Boulder'],
    note: 'R77: a printed precondition is a GATE checked before anything is paid; a self-sacrifice '
      + 'is a COST. Ordering is load-bearing — the gate is checked first so the cost cannot '
      + 'invalidate its own condition.',
  },
  {
    id: 45, room: 'VEAV', date: '2026-08-22',
    report: "Awoken Tomb's trigger, while on the stack, doesn't say what X is equal to",
    status: 'fixed',
    guards: ['50-ui-inspect.test.ts::event'],
  },
  {
    id: 46, room: 'VEAV', date: '2026-08-22',
    report: 'The "I get -2/-2" isn\'t a trigger that should go on the stack. It\'s a static effect',
    status: 'fixed',
    guards: ['18-earth-c.test.ts::Bulborb'],
  },
  {
    id: 47, room: 'VEAV', date: '2026-08-22',
    report: 'I was able to see in the deployment recap that "Rashi undid an action." No need to '
      + 'show that to the other person',
    status: 'fixed',
    guards: ["server/test-new-features.ts::log never mentions the undo"],
  },
  {
    id: 48, room: 'VEAV', date: '2026-08-22',
    report: 'Squish, on cast, only has you select 1 target unit, but it needs 2. This is a '
      + 'recurring issue — do a full text search for anything that has 2 targets',
    status: 'fixed',
    guards: ['18-earth-c.test.ts::Squish', '68-target-conformance.test.ts::target'],
    note: 'The owner asked for a sweep; the answer was a permanent conformance test instead, '
      + 'because a one-time sweep is what makes a class of bug recur.',
  },
  {
    id: 49, room: 'VEAV', date: '2026-08-22',
    report: 'Channel Through caused Restitution to make 2 triggers, but it should have made one',
    status: 'fixed',
    guards: ['69-damage-batch.test.ts::batch'],
    note: 'R80: one effect resolution is ONE batch of damage.',
  },
  {
    id: 50, room: 'VEAV', date: '2026-08-22',
    report: 'I only made 2 units from my Channel Through, but it dealt 12 damage total, so I '
      + 'should have made 12 units',
    status: 'fixed',
    guards: ['69-damage-batch.test.ts::total'],
  },
  {
    id: 51, room: 'VEAV', date: '2026-08-22',
    report: 'The game is forcing me to cast my Fireball because of Burst, but Burst only applies '
      + 'to spell tokens with the same NAME',
    status: 'fixed',
    guards: ['69-damage-batch.test.ts::Burst'],
    note: 'R81.',
  },

  // ── UFAB, 2026-08-22 ────────────────────────────────────────────────────
  {
    id: 52, room: 'UFAB', date: '2026-08-22',
    report: 'During the resolution of Insidious Invitation, I should have seen what my opponent '
      + "played and what they paid. I couldn't see anything until I declined",
    status: 'fixed',
    guards: ['72-resolution-window.test.ts::at the OPPONENT',
      '72-resolution-window.test.ts::narrates nothing twice',
      '72-resolution-window.test.ts::shows each step as it is reached'],
    note: 'R85. Not a delivery bug — the information did not EXIST. ctx.choose is not a coroutine: '
      + 'it throws, and resolveParts did `this.s = snap; this.events.length = evLen`, rolling the '
      + 'whole state and all narration back and replaying the part on resume. The entire card body '
      + 'is one EffectPart, so at the moment the prompt was raised the opponent\'s unit was not in '
      + 'play and the log was empty. Fixed by rolling back at RESUME: the snapshot rides on the '
      + 'suspension and is applied when the answer arrives, and the replay suppresses the events '
      + 'the table has already seen. BOTH halves of the report land — the unit AND what was paid '
      + 'for it, since the payment is no longer inside a rolled-back window. Fixes the whole class '
      + '(glimpse chains, electric paths, any per-seat loop), not the one card.',
  },
  {
    id: 53, room: 'UFAB', date: '2026-08-22',
    report: 'Neither of us had anything to do during the end of that combat, but damage and all '
      + 'effects happened instantly. We should have been able to see it much slower',
    status: 'fixed',
    guards: ['56-ui-flash.test.ts::combat batch is cut at the seams',
      '56-ui-flash.test.ts::three beats'],
    note: 'Not a correctness bug. ui/flash.ts already was a beat queue but was fed only by '
      + 'stackFlash; it now stages combat sub-steps too, and auto-passes are delayed.',
  },
  {
    id: 54, room: 'UFAB', date: '2026-08-22',
    report: 'Tiderunner Initiate should never have entered the Invader\'s zone. It gets played '
      + 'directly into the formation, not as a trigger that happens when it enters',
    status: 'fixed',
    guards: ['73-play-into-formation.test.ts::THE REPORT',
      '73-play-into-formation.test.ts::THE REPORTED SHAPE',
      '73-play-into-formation.test.ts::spawn event itself already sees it'],
    note: 'R29. Modelled as a triggered ability on its own spawned event, so playing it spawned '
      + 'into the region with no column (that IS the invader\'s zone), stacked a trigger, and '
      + 'handed the opponent a response window — which is how it got bounced in the reported game. '
      + 'Root cause: R75\'s "placement happens at resolution" was written for "create a unit in my '
      + 'formation" effects and Tiderunner was wrongly folded into that class. Fixed with a '
      + 'play-time placement primitive: CardBehavior.playsIntoFormation, a \'formation\' cast '
      + 'stage, and E.takeSpot inside spawnUnit so the unit is in the line before the spawn event '
      + 'exists. R75 keeps placeInFormation for the genuine create-in-formation class. Trench '
      + 'Stalker is the only other card in this class and is still parked on its play-from-bin '
      + 'half (see test/card-ledger.ts).',
  },
  {
    id: 55, room: 'UFAB', date: '2026-08-22',
    report: 'In the game log, all strings that match card names become hoverable cards, so '
      + '"Battle:" looks like a card name. Only highlight actual cards used in the game',
    status: 'fixed',
    guards: ['50-ui-inspect.test.ts::must NOT link in the phase line',
      '50-ui-inspect.test.ts::links on its very first mention'],
    note: 'Battle really is a card ("Two target units fight"), as are 132 other one-word names. '
      + 'The log now links only names this game has actually shown.',
  },
  {
    id: 56, room: 'UFAB', date: '2026-08-22',
    report: 'Bripp can target units. All cards that say "target player" or "target opponent" '
      + 'should only be able to have PLAYERS selected',
    status: 'fixed',
    guards: ['14-water-a.test.ts::Bripp', '68-target-conformance.test.ts::any target'],
    note: 'Nine cards had the same defect, all traceable to a false comment repeated across the '
      + 'card files claiming "the engine has no player-only scope — the Bripp precedent". It has '
      + 'had one since R64/R67. The new conformance test needs zero exemptions.',
  },
  {
    id: 57, room: 'UFAB', date: '2026-08-22',
    report: "Tempest Wrangler (with Alluring) didn't trigger on attacks",
    status: 'fixed',
    guards: ['53-playtest-round7.test.ts::R84 UFAB',
      '53-playtest-round7.test.ts::RAQ 3/3'],
    note: 'Verbatim recurrence of id 10, two days later — see that entry for why.',
  },
  {
    id: 58, room: 'UFAB', date: '2026-08-22',
    report: "lurking slimebeast ambush ability can't be activated",
    status: 'fixed',
    guards: ['14-water-a.test.ts::Lurking Slimebeast'],
    note: 'The printed cost word [three_blue] was not understood by the card extractor, so the '
      + 'card had no ambush data at all. Fixed ~13 minutes after this report was filed.',
  },

  // ── XBYN / SAAY / GETD, 2026-08-22 ──────────────────────────────────────
  {
    id: 59, room: 'XBYN', date: '2026-08-22',
    report: 'Auto yield works, but I see a flash of the top of the screen that looks like it\'s '
      + 'giving me prio for 1 frame AND a "You do not have priority" note',
    status: 'fixed',
    guards: ['70-playtest-round15.test.ts::produce ONE pass, not two',
      '70-playtest-round15.test.ts::decides about auto-passing BEFORE it writes the markup',
      '70-playtest-round15.test.ts::clears the error from the previous one'],
    note: 'Two defects, one mechanism. The paint happened before the auto-pass decision (and the '
      + 'send is a round trip, so the wrong bar stood for the whole RTT); and three separate '
      + 'one-shot guards with no shared latch let two passes go for one state, whose refusal '
      + 'stuck because the update handler never cleared uiError. Now one latch, decided '
      + 'before the paint.',
  },
  {
    id: 60, room: 'XBYN', date: '2026-08-22',
    report: 'The engine makes so many things "triggers" despite them not technically being '
      + 'triggers. We need a whole layer that deals with replacement effects',
    status: 'fixed',
    guards: [
      '88-replacement-conformance.test.ts::a card whose whole text is an untargeted replacement',
      '88-replacement-conformance.test.ts::a replacement that names NO target is built out of',
      '87-replacement-layer.test.ts::Containment Protocol RESOLVING negates nothing',
      '87-replacement-layer.test.ts::Nothyr finds no nonspell effect to target',
      '87-replacement-layer.test.ts::a replaced life gain fires no lifeGained',
      '87-replacement-layer.test.ts::a replaced token creation fires no spawned',
      '87-replacement-layer.test.ts::one resolving part is one creation batch',
    ],
    note: 'R104. The layer is TWO families, because the seven cards split cleanly and compose '
      + 'differently. `AmountMod` is continuous and SUMMED, modelled on CostMod (Conduit of Pain, '
      + 'Flux Resonator, Proliferating Slime) — Caleb: "a replacement only happens once … The '
      + 'replacement just takes what would be 1 and makes it 2", so two different modifiers both '
      + 'apply. The named `replaceX` hooks are first-true-consumes, modelled on replaceRotDamage '
      + '(Nullbringer, Counter Thief, Cosmic Conspirator, Automaton of Abundance), plus a '
      + 'battle-scoped life LOCK for Suspend. Deliberately NO general "any event" framework: one '
      + 'named hook per replaceable quantity, which 88-replacement-conformance asserts is read '
      + 'somewhere in the engine so a hook cannot look implemented and do nothing. All five '
      + 'module-level mutable flags this report counted are gone — an AmountMod is CONSULTED, not '
      + 're-entered — and the one latch that is still needed (a counter redirect really does '
      + 're-enter) lives in the engine in E.inCostMods\' shape. NOTE: Harbinger (id 28/62) was '
      + 'never in this class — it is continuous, not a replacement.',
  },
  {
    id: 61, room: 'SAAY', date: '2026-08-22',
    report: 'Instead of all the spell tokens stacking up vertically, their box can expand and they '
      + 'can be grouped horizontally',
    status: 'fixed',
    guards: ['70-playtest-round15.test.ts::floor still fits two cards abreast'],
    note: 'Follow-up to id 25, fixed with it.',
  },
  {
    id: 62, room: 'SAAY', date: '2026-08-22',
    report: 'My spell tokens were erased despite me having Harbinger of Immolation',
    status: 'fixed',
    guards: ['12-fire-a.test.ts::spell tokens stay through regroup',
      '12-fire-a.test.ts::surviving token keeps its X'],
    note: 'Verbatim recurrence of id 28, two days later, and it cost a conceded game. See id 28.',
  },
  {
    id: 63, room: 'GETD', date: '2026-08-22',
    report: 'In constructed, the resource options from recycling and prismites should be limited '
      + 'to the elements that are in your deck',
    status: 'fixed',
    guards: ['34-constructed.test.ts::deckElements: constructed records each seat',
      '34-constructed.test.ts::it is a PRESENTATION default — all seven stay legal',
      '50-ui-inspect.test.ts::the resource menu leads with your own decks elements',
      '50-ui-inspect.test.ts::a mono element deck still gets a prismite MENU',
      '75-ui-reachability.test.ts::the prismite click never counts the shortened list'],
    note: 'R99. Deliberately a PRESENTATION default and not a rules change: GameState.'
      + 'deckElements records each seat\'s deck element identity (the union of getCard(n).factions '
      + 'over the decklist), computed in createGame before the shuffle, constructed only — but '
      + 'legalActions still offers all seven, which is why all 19 saved games still replay and '
      + 'why nothing legal became illegal. That matters because off-element resources are '
      + 'genuinely useful: Reap the Due is mono-light but scales off DARK affinity, so a '
      + 'mono-light deck running it must still be able to take dark resources or the card is '
      + 'blank. Both menus lead with your deck\'s elements and keep the rest behind a "more '
      + 'elements…" expander, through one shared helper so they cannot drift. ⚠ THE HAZARD, and '
      + 'the reason one of the guards above exists: the prismite menu auto-fires when exactly one '
      + 'option remains, and an ACTIVE prismite offers seven exchanges and no other action — so a '
      + 'naive filter would have left a mono-element deck with exactly one entry and silently '
      + 'spent the prismite with no menu and no way back. The auto-fire decision counts the LEGAL '
      + 'ACTIONS, before any filtering. OPEN FOR THE OWNER: is a constructed deck\'s element '
      + 'identity PUBLIC at game start? deckElements is not redacted in server/view.ts, so today '
      + 'both seats can read both entries. No UI behaviour depends on the answer — each seat '
      + 'reads only its own — and if it should be private it is one line in viewFor(). ⚠ `els` on '
      + 'a saved game is a red herring: it is the draft trio and is written for every mode.',
  },
  // ── GETD, 2026-08-22 (the round-16 playtest, filed before that deploy) ──
  {
    id: 64, room: 'GETD', date: '2026-08-22',
    report: "Biotoxicity didn't give me the choice of what kinds of tokens I wanted even though "
      + 'I had Cosmic Conspirator',
    status: 'fixed',
    guards: [
      '26-metal-a.test.ts::Biotoxicity asks once per token in the batch',
      '26-metal-a.test.ts::Cosmic Conspirator: a created Robot may become a Fireball',
      '87-replacement-layer.test.ts::a replaced token creation fires no spawned',
    ],
    note: 'R104, and it was TWO defects. (1) The spell-token half was completely dead: the old '
      + 'implementation was a `spawned` trigger, and E.createSpellToken fires no dispatchable '
      + 'event at all, so Biotoxicity\'s three Poisons went past it in silence. A replacement is '
      + 'CONSULTED at the creation call, so it needs no event — the seam is the call. (2) The '
      + 'Robot half asked TOO LATE: it really created the Robot, fired a `spawned`, asked, then '
      + 'erased it. `replaceTokenCreation` runs before anything exists, which is what "you would '
      + 'create" means, and it is asked once per token in the batch. The choice is raised through '
      + 'E.askInResolution — the same `partChoose` seam E.glimpse uses — which suspends and '
      + 'replays the part; outside a resolving part there is nowhere to ask, so the card declines '
      + 'and SAYS SO rather than defaulting in silence (the glimpse precedent).',
  },
  {
    id: 65, room: 'GETD', date: '2026-08-22',
    report: 'There\'s still no way to see the X value for Volatile Toxicity on the stack. All '
      + 'spells with X should be clear what X is when they\'re cast',
    status: 'fixed',
    guards: ['50-ui-inspect.test.ts::Volatile Toxicity: the X read off its cost RECEIPT reaches the stack',
      '50-ui-inspect.test.ts::a sacrifice cost whose clause names no stat wears no X'],
    note: 'Report 43 fixed X-on-stack for the mana X and the event X, and the guess that this was '
      + 'a third kind (R64\'s variable `costPaid.x`) was WRONG in an instructive way: Volatile '
      + 'Toxicity\'s cost is a FIXED `sacrificeUnit` of one, so `finishVariableCost` never runs '
      + 'and `costPaid.x` is never written. Its X lives in the cost RECEIPT — the effect reads '
      + '`costPaid.sacrificed.defense` — and `stackItemX` only ever looked at `costPaid.x`, so the '
      + 'number was invisible on the stack tag, in the focus viewer and in the ability rows alike. '
      + 'ui/inspect.ts now reads the receipt when the printed clause names the stat. Structural '
      + 'Collapse is the only other card in the pool that does this.',
  },
  {
    id: 66, room: 'GETD', date: '2026-08-22',
    report: 'The UI is reminding me I have unused tokens at EVERY chance it has. It should only '
      + 'warn right before moving to Regroup ("You\'re about to move to Regroup which will remove '
      + 'your Spell Tokens. Are you sure?")',
    status: 'fixed',
    guards: ['77-playtest-round17.test.ts::[66] passEndsBattlePhase agrees with the engine',
      '77-playtest-round17.test.ts::[66] the pass confirm is wired to the end-of-battle question'],
    note: 'The C5 guard fired on EVERY pass while you held a castable token. The warning was '
      + 'right; only its trigger point was wrong, and the owner supplied the replacement copy. '
      + 'The judgement "would this pass end the battle?" is now a pure predicate in the new '
      + 'ui/battle.ts, derived from the engine\'s own chain (passPriority -> advanceBattleStep -> '
      + 'endBattleRound -> startRegroup) and asserted against it at every priority window of a '
      + 'real battle. ONE DELIBERATE DEVIATION, documented at the function: it does not require '
      + 'the literally-closing pass, because E.openPriority always opens on the initiative '
      + 'player, so gating on that would mean the initiative player is never warned at all. Cost '
      + 'is at most one extra confirm per battle instead of one per window. Known gap that cannot '
      + 'be closed client-side: if the round-2 attacker DECLINES, doDeclareAttack calls '
      + 'endBattleRound with no priority window, so a defender holding tokens gets no pass to '
      + 'warn on.',
  },
  {
    id: 67, room: 'GETD', date: '2026-08-22',
    report: "What happened to Rashi's Poison tokens? She just wanted to bring them with her "
      + 'attackers but they somehow went onto the stack, without any targets',
    status: 'fixed',
    guards: ['78-round17-core.test.ts::declareBlocks takes spellTokens',
      '78-round17-core.test.ts::legalActions offers the counterattack-with-token shape',
      '78-round17-core.test.ts::spell tokens still travel only with units',
      '77-playtest-round17.test.ts::[67] sendableTokens lists exactly the tokens a counterattack '
      + 'will accept',
      '77-playtest-round17.test.ts::[67] the counterattack ride dialogue respects',
      '77-playtest-round17.test.ts::[67] the Confirm button holds the block declaration',
      '75-ui-reachability.test.ts::the affordance for every offered shape is really in ui/main.ts'],
    note: 'R87. GETD action 92 is a `declareBlocks` with `send: [25, 6, 19]` — a COUNTERATTACK — '
      + 'and `declareBlocks` had no `spellTokens` field, while `declareAttack` did. The initial '
      + 'diagnosis was half right and the correction matters: the LEGALITY was already there — '
      + "doDeclareBlocks's `send` loop has always accepted a spellToken and always enforced "
      + '"tokens travel only with units". What was missing was any way to FIND THAT OUT: no named '
      + 'field for the client to fill, and legalActions never once offered a `send` containing a '
      + 'token. So the three Poison 1s stayed home and were fired into a region everything had '
      + 'just left, each logging "there is no legal target for that — it does nothing". That is '
      + 'the "went onto the stack without any targets" the owner saw. Both halves shipped: the '
      + 'client now interposes the same ride dialogue id 69 built for attacks, and '
      + '75-ui-reachability.test.ts gained a `declareBlocks:spellTokens` facet so the shape can '
      + 'never go quietly unreachable again — which is exactly how R79 lost a whole round. Sources: lofavreel — "spell '
      + 'tokens can move into other regions on attack/counter-attack step. But they always need a '
      + 'unit to take them with them"; _passer — "In order to attack opponent Region, you must '
      + 'send atleast 1 of your unit". Old action shapes replay unchanged; 19/19 saved games '
      + 'still FAITHFUL. The client half is the sibling of id 69 and reuses its bar and chips.',
  },
  {
    id: 68, room: 'GETD', date: '2026-08-22',
    report: 'I hit pass all, but then it stopped passing all. Why?',
    status: 'fixed',
    guards: ['77-playtest-round17.test.ts::[68] Pass-all stays armed',
      '77-playtest-round17.test.ts::[68] the other three releases still release'],
    note: 'Not the round-16 `sentFor` latch, which is innocent — it never disarms the chip, it '
      + 'only stops a second send for one state. The culprit was one clause in the release list: '
      + 'pass-all released whenever `castableTokens(legal) > 0`, which is true at nearly every '
      + 'window of nearly every battle, so the chip performed exactly ONE pass and switched '
      + 'itself off. That is the report, verbatim. `git log -S` shows round 16 carried the clause '
      + 'across into autoPassPlan unchanged from pre-round-16 main.ts, so it was neither newly '
      + 'caused nor already fixed. The four release conditions are now one named, tested '
      + 'predicate (ui/battle.ts passAllRelease), and the token clause asks the sharper question '
      + 'from id 66 — release only on the pass that actually reaches Regroup.',
  },
  {
    id: 69, room: 'GETD', date: '2026-08-22',
    report: "It's very easy to attack without bringing any spell tokens into the new region. Make "
      + 'it a choice AFTER declaring attackers: "select the spell tokens you wish to bring, or '
      + 'Bring none"',
    status: 'fixed',
    guards: ['77-playtest-round17.test.ts::[69] ridableTokens lists exactly the tokens',
      '77-playtest-round17.test.ts::[69] the ride-along dialogue is interposed only when a choice '
      + 'is being silently defaulted',
      '77-playtest-round17.test.ts::[69] the Attack! button holds the declaration'],
    note: 'Confirmed by the log before anything was written: of the eleven attacks declared in '
      + 'GETD, exactly ONE carried a spell token (action 47) — every other declareAttack has '
      + '`spellTokens: []`. The engine action already accepted the list, so this was purely a '
      + 'client interaction: the affordance existed (click your tokens while building the '
      + 'formation) and was being defaulted away in silence. Attack! now holds the declaration '
      + 'and interposes a chip row with an explicit "Bring none" — and "Bring none" is '
      + 'deliberately NOT bound to Enter, because Enter is exactly how the token-less attack got '
      + 'sent ten times. Interposed only when a choice is actually being defaulted, so a '
      + 'token-less player never sees it. Sibling of id 67, whose counterattack half needs the '
      + 'engine field; the bar, chips and buttons are reusable for it as-is.',
  },
  {
    id: 70, room: 'GETD', date: '2026-08-22',
    report: 'Graxxlid is lighting up like I can activate its ability despite there being no legal '
      + 'targets on the stack',
    status: 'fixed',
    guards: ['16-earth-a.test.ts::Graxxlid (report #70): a stack item that does NOT target me',
      '16-earth-a.test.ts::Graxxlid: a Virus being applied to me IS an effect targeting me'],
    note: 'Graxxlid printed "negate target effect TARGETING ME" but its spec was a bare '
      + "`what: 'stackEffect'`, so every stack item was a candidate and the ability was offered "
      + 'whenever the stack was non-empty; the "does not target me" check happened at resolution, '
      + 'as an info line. Fixed with an R64 `restrict`, so no legal target means the activation is '
      + 'never offered and `activatableUnits` stops glowing — no UI change was needed, which is '
      + 'the point: the halo is a pure read of legalActions. Source: RAQ "[Solved] Target '
      + 'requirements to put effect on stack" — "In order to play a card, you MUST be able to '
      + 'select the valid targets for the effect." The resolution-time check was KEPT, because a '
      + 'restriction is asked at cast and never re-asked (R5/R56) and a redirect can move targets '
      + 'afterwards. R88. Inverse of id 35. Widened the card on the way: Caleb ruled a Virus is a '
      + 'targeted effect and IS fully interactible ("Yep! They\'re fully interactible"), and a '
      + 'virus stack item carries a `hostId` rather than target refs, so Graxxlid could never '
      + 'answer one before.',
  },
  {
    id: 71, room: 'GETD', date: '2026-08-22',
    report: "Rashi's grafted effect resolved even though its only legal target was gone. An "
      + 'official ruling says a grafted effect with a target becomes vulnerable to requiring a '
      + 'target to resolve',
    status: 'fixed',
    guards: ['78-round17-core.test.ts::a graft composite that loses its ONLY target fizzles whole',
      '78-round17-core.test.ts::one surviving target carries the untargeted grafts through',
      '78-round17-core.test.ts::an item that declares NO target anywhere never fizzles',
      '78-round17-core.test.ts::a required target with no legal candidate at cast still fizzles'],
    note: 'R86. The owner was right and the ruling is exact — RAQ "[Solved] When does effect '
      + 'fizzles?": "If effect loses ALL of its targets and wants to resolve", and the '
      + 'load-bearing detail is the parenthesis in the Bellowing Boulder example, "(yielding no '
      + 'card draw from 2nd and 3rd graft)" — the UNTARGETED parts of a composite die with it. '
      + "The engine's partAlive returned true for any part with no target spec, so a composite "
      + 'containing one could never fizzle however dead its targets were. Reproduced from the '
      + 'game itself: the Spewing Mushroom composite had five parts, only one targeted, and its '
      + 'single declared target had just died to a Poison 8 — it paid out four Poisons and a buff '
      + 'anyway. Blast radius was ZERO: not one existing assertion had to be rewritten. One '
      + 'narrowing was needed and the replay is what found it — keying the gate on "did any part '
      + 'declare a TargetRef" passed every test but made spell tokens cast into an emptied region '
      + 'stop fizzling, so the gate asks whether a part declared a target SPEC, not whether it '
      + 'holds a live ref. Separate and still open: `allOrNothing` is a declared-but-unread flag '
      + 'that three cards hand-roll; it asks a per-PART question where R86 asks a per-ITEM one.',
  },
  {
    id: 72, room: 'GETD', date: '2026-08-22',
    report: 'Phytochemical Protection is entirely non functional. Needs to work like the text says',
    status: 'fixed',
    guards: ['24-wood-b.test.ts::prevented damage is NOT dealt',
      '24-wood-b.test.ts::Poisonous does not bypass it',
      '24-wood-b.test.ts::{Deadly} cannot kill through it',
      '80-round17-permissions.test.ts::R98: a REPLACED hit still counts as dealt'],
    note: 'R98. The card-ledger entry predicted this report a day before it was filed, and the '
      + 'three seams it named were all real: there was no "damage would be dealt to a UNIT" hook '
      + 'of any kind (both existing replacement hooks are damage-to-a-PLAYER), nowhere on Entity '
      + 'to keep an until-regroup shield, and no running per-unit total to feed "+1/+1 counter '
      + 'for each damage prevented". THE HEADLINE FINDING: prevention is NOT the same layer as '
      + 'replacement and the two must never share one. Caleb 2024-10-24 says replacing damage '
      + 'does not unmake it ({Lethal} still kills through a Blightsea Polyp); the Phytochemical '
      + 'RAQ says prevention DOES unmake it — "if there is not damage being dealt, then no '
      + 'counters are placed … Jollyglop doesn\'t trigger". So a fully prevented hit fires no '
      + 'damage event, lays no Poisonous counters, gets no {Deadly} kill, no {Resonant} rider and '
      + 'no {Blessed} gain. Counters are deferred to a settle step because addCounters runs '
      + 'checkDeaths, which would resolve a death mid-batch and break R80 simultaneity. '
      + 'SURVIVING GAP, pinned by its own test: the counters cap at LETHAL, not at the whole hit '
      + '— R7 auto-assignment gives each blocker just enough to kill it and drops the rest, while '
      + 'the RAQ says all the damage must be assigned to the shielded unit ("potentially putting '
      + 'a lot of +/+ counters"). Changing that moves every overkill number in the engine, so it '
      + 'wants its own ruling. Bonus: fixing this widened Oorblak\'s player hook too — `info` now '
      + 'carries attrs and pure, and the return is `boolean | number`.',
  },
  {
    id: 73, room: 'GETD', date: '2026-08-22',
    report: "Inverted isn't working on my Malformed Monstrosity. -7/-7 should become +7/+7, "
      + 'making it a 17/16',
    status: 'fixed',
    guards: ['79-round17-layers.test.ts::Malformed Monstrosity — a 10/9 at -7/-7 inverts to 17/16',
      '79-round17-layers.test.ts::worked example — a 1/4 Tough Balanced Inverted is a -6/0',
      '79-round17-layers.test.ts::R93 layer 5: a base REWRITE is the thing inverted FROM',
      '79-round17-layers.test.ts::R93 layer 5: {Inverted} is shared down the COLUMN'],
    note: 'R93. {Inverted} was stat layer 5 and effStats literally ended with the comment '
      + '"// layer 5 (Inverted), 6 (Unaware) go here". The rule is that {Inverted} negates the '
      + 'NET stat change from base, and Caleb worked it out himself in #rules-questions: "1/4 '
      + 'tough balanced is 8/8 — Tough is +0/+4, Balanced is +7/0 … To become a -6/0", then '
      + '"If we compare 8/8 to 1/4, it\'s +7/+4 — which also works to invert to a -6/0". So '
      + 'layer 5 is 2*base - current, and it reproduces the owner\'s number exactly: a 10/9 at '
      + '-7/-7 is a 3/2, inverted to 17/16. Blast radius was ONE test — a Morphic Mentor case '
      + 'that used Reality Bender as a cheap Virus body and had encoded the bug in its '
      + 'assertion. Two things the research settled that were not obvious: COLUMN-SHARING of '
      + '{Inverted} is sourced verbatim ("So, all attributes are shared between the units in the '
      + 'same column? Including stuff like Inverted or Tough?" -> "Yes"), and a unit does NOT '
      + 'die part-way through the equation ("Not if it hits 0 mid calculation") — which the '
      + 'engine already had right, since effStats is atomic. Unparks Its Dark Bubb and Reality '
      + 'Bender with no card-file change at all. Layer 6 ({Unaware}) is deliberately untouched '
      + 'and 05-rulings.test.ts still pins its wrong answer on purpose. STILL OPEN: Caleb also '
      + 'said "Tough inverted balanced would be different", which would mean interleaving '
      + '{Inverted} among the layer-4 attrs in grant order rather than being a clean layer 5 — '
      + 'he also called that case "basically impossible to make happen", so the clean layer '
      + 'shipped and the nuance is recorded in R93.',
  },
  {
    id: 74, room: 'WEHH', date: '2026-08-22',
    report: "Dispatch Courier didn't give me the option to play a card with haste",
    status: 'fixed',
    guards: ['26-metal-a.test.ts::play a unit during the mana step as if it had',
      '26-metal-a.test.ts::a {Battle} unit stays a battle card even with the grant',
      '80-round17-permissions.test.ts::R97: every hand play legalActions offers in the haste step'],
    note: 'R97, and the card ledger predicted it like id 72. The rules half had to be settled '
      + 'first: the printed "mana step" IS this engine\'s R18 haste step (Caleb: "that symbol is '
      + 'haste, meaning you can play it during the mana step" / "There is no priority during the '
      + 'mana step, but you can play haste cards and resources as special actions"). What was '
      + 'missing was one seat-level play permission consulted at THREE gates that must agree, and '
      + 'the fatal one was the first: E.startHasteStep\'s canHaste SKIPS the step outright when no '
      + 'seat has a legal haste play, so the other two were never even asked and the card was '
      + 'invisible. THE RESEARCH CHANGED THE CARD: RAQ "[Solved] Dispatch Courier vs Battle '
      + 'Timing" says a {Battle} card does NOT become playable in the haste step even with the '
      + 'grant — "despite gaining haste they can still only be played during battle" — because, '
      + 'Caleb, "spells like Dreadweave or Hush Mush can\'t have a legal target in the Haste '
      + 'step". That refusal sits above every grantor. Design note: R95 OR-folds its permission '
      + 'but R97 SUMS, because two Couriers each printing "Each turn, you may play a unit" is two '
      + 'plays. The client needed NO change — the hand menu is built from legalActions, so the '
      + 'card simply appears. Does NOT unpark Writhing Host (its grantor sits in a BIN, which '
      + 'anchored() does not walk) or Slurpr (the mod-timing twin); the ledger claimed shared '
      + 'credit that did not exist.',
  },
{
    id: 75, room: 'WEHH', date: '2026-08-22',
    report: 'Replacement effects and triggered effects and static effects are being handled wrong '
      + 'by the system, still. The only cards that should ever produce effects that go onto the '
      + 'stack are cards that say "When" or "Whenever" or have a ":" activated ability. All cards '
      + 'that say "instead" or "as" or "if" shouldn\'t go onto the stack.',
    status: 'fixed',
    guards: [
      '88-replacement-conformance.test.ts::a card whose whole text is an untargeted replacement',
      '88-replacement-conformance.test.ts::a replacement that DOES name a target still uses the stack',
      '88-replacement-conformance.test.ts::the classifier finds the replacement clauses',
      '88-replacement-conformance.test.ts::every exemption is still needed',
    ],
    note: 'The owner restating id 60 as a RULE rather than a symptom, and it is the sharpest '
      + 'statement of it we have: the test for "does this use the stack" is the printed WORD. '
      + 'REFINED BY HIM on 2026-08-23, and the refinement is the load-bearing half — "cards that '
      + 'say instead, as or if AND DON\'T MENTION TARGETS" never go on the stack, because a '
      + 'target has to be CHOSEN and choosing is public and respondable. So R102 (Beyond, Codex '
      + 'Incarnate) is CORRECT and not an exception: it prints "target unit". '
      + 'FIXED BY R104, and the guard is a PERMANENT CONFORMANCE TEST rather than a sweep, for '
      + 'exactly the reason report #48 got one: this was reported three times (#46 as one card, '
      + 'then #60 and #75 as a class) and a one-card fix is what makes a class of bug recur. '
      + '88-replacement-conformance reads printed.json, classifies every replacement clause in '
      + 'the pool (11 cards, after four rounds of narrowing: 63 → 19 → 11 → 10, plus the one '
      + '"deals X as Y" card), and fails when a new card prints "would … instead" and is built as '
      + 'a trigger. Every exemption carries its reason and the list is asserted to be exactly '
      + 'right. It also asserts the OTHER direction, so nobody "fixes" R102 into the wrong shape.',
  },
  {
    id: 76, room: 'WEHH', date: '2026-08-22',
    report: 'Despite Deployment being entirely separate from the opponent, I can\'t take back some '
      + 'things and get "your opponent has already acted on top of that one — it cannot be taken '
      + 'back now". What they do doesn\'t matter during deployment, so I should always be able to',
    status: 'fixed',
    guards: [
      'server/test-undo-segment.ts::and it carries a PAYLOAD',
      'server/test-undo-segment.ts::is still undoable',
      'server/test-undo-segment.ts::whole position came through the rebuild untouched',
      'server/test-undo-segment.ts::and the reported error text is gone for good',
      'server/test-undo-segment.ts::the splice is refused',
      'server/test-undo-segment.ts::a fresh room opens inside the plan segment',
    ],
    note:
      'FIXED 2026-08-23, in two passes, and the second pass is the interesting one. '
      + 'Pass one narrowed the refusal to the id route only and left the rest to a '
      + 'reference-key measurement; the owner then said that was still too narrow — "in '
      + 'deployment and planning, you\'re \'alone\' in a world that no one else can see, so '
      + 'you should be perfectly allowed to undo everything, up to the beginning of that '
      + 'phase". '
      + 'Pass two found out why narrowing was not enough: the log is replayed VERBATIM, so a '
      + 'later action\'s raw `hostId: 4` names a number that ceases to exist once your action '
      + 'is spliced out. The measurement cannot wave that through — it refused four real '
      + 'games with the engine\'s own "no such unit". The renumbering is damage to be '
      + 'REPAIRED, not a false alarm to be silenced. So the undo now splices, RENUMBERS the '
      + 'surviving log, rebuilds, and uses the reference keys as PROOF the repair was right: '
      + 'if the world moved in any way other than that constant shift, a key differs and the '
      + 'whole undo rolls back. ⚠ It rewrites entity ids in the persisted log, deliberately — '
      + 'an id is the row number a choice was filed under, not the choice, and `seed + '
      + 'actions` still reproduces the game exactly. '
      + 'No refusal remains inside a hidden segment: the only actions that can name someone '
      + 'else\'s unit are mods, and the engine already refuses those across regions. '
      + '⚠ THIS WAS A RECURRENCE OF #37, and the reason is on the record: #37\'s two guards '
      + 'both drive the resource step, which allocates no id and draws no RNG, so the splice '
      + 'gate they were supposed to protect is never reached by either of them. #37 built the '
      + 'segments; it never touched the gate. The decision also lived inside main.ts\'s '
      + 'WebSocket handler — reachable only by playing a whole game over a socket — and is now '
      + '`undoForSeat(room, seat)` in rooms.ts, which is what the guards above drive.',
  },
  {
    id: 77, room: 'WEHH', date: '2026-08-22',
    report: 'Trying to declare illegal blocks entirely resets the board, which is really annoying. '
      + 'It should reset only the "affected" units and give a notice plus a "Reset blockers?" '
      + 'button, so a massive block does not have to be rebuilt for forgetting one thing',
    status: 'fixed',
    guards: [
      '86-ui-block-refusal.test.ts::one bad column does not cost you the other five',
      '86-ui-block-refusal.test.ts::what the verdict keeps is something the engine actually accepts',
      '86-ui-block-refusal.test.ts::a compulsory block is REQUIRED, not an offender',
      '86-ui-block-refusal.test.ts::widening the error did not widen the RULE',
      '86-ui-block-refusal.test.ts::and it did not narrow it either',
      '86-ui-block-refusal.test.ts::the plan is no longer wiped the moment the action is sent',
      '86-ui-block-refusal.test.ts::with a Reset blockers? button',
    ],
    note:
      'Two halves, and the second was the real cause. (a) `doDeclareBlocks` is split into '
      + '`checkBlocks` — the same legality run, verbatim and in the same order — and the '
      + 'mutation, so a refusal is available as a VALUE; ui/battle.ts then walks the plan '
      + 'against that oracle and returns which units offended, what survives, and R84\'s '
      + 'compulsory duty as `required` rather than as an offender. No block rule is restated '
      + 'client-side, so the surviving plan is legal by construction and the RULE did not '
      + 'change. (b) `declareBuiltBlocks` cleared the plan the moment it called `act()`, which '
      + 'is right in hotseat (the refusal is synchronous) and wrong over a socket, where the '
      + 'refusal lands after the wipe — i.e. in every network game, which is every game this '
      + 'report came from.',
  },
  {
    id: 78, room: 'EGCW', date: '2026-08-23',
    report: 'The cached zone (wrongly) says "not this turn"',
    status: 'fixed',
    guards: [
      '50-ui-inspect.test.ts::a permitted cached card blocked only by MANA does not blame the step',
      '50-ui-inspect.test.ts::and a battle card cached during deployment DOES blame the step',
      '50-ui-inspect.test.ts::a cache entry with no permission at all blames permission, not the step',
    ],
    note:
      'A LABEL bug — enforcement was correct and no legal play was refused. Reconstructed '
      + 'from the replay: turn 2, deployment, Gatekeeper of Souls cached with '
      + 'playableUntilTurn=2, so `cachePermission` correctly returned `glimpse`; its timing '
      + 'is `deploy` and the phase WAS deployment. The only thing missing was mana — 2 open '
      + 'against a cost of 4 — and `pushCachedPlays` correctly omitted the action. '
      + 'Both render sites computed "permitted" from `cachePermission` and "playable now" '
      + 'from `legalActions`, then blamed the entire gap on TIMING without ever checking '
      + 'whether the timing already matched. `cacheBlockReason` in ui/inspect.ts now asks the '
      + 'same clauses in the same order as `pushCachedPlays`, the discipline report #77 '
      + 'established: the UI must not restate a rule, it must ask the same question. '
      + '⚠ The timing predicate is NOT a constant — each caller passes its own (haste, battle '
      + 'priority, deployment) — so the gate reconstructs the dispatcher including the gates '
      + 'inside legalBattleActions. Without that, every "it is not your window" case would '
      + 'have been mislabelled "no legal target": the same class of bug in a new place.',
  },
  {
    id: 79, room: 'EGCW', date: '2026-08-23',
    report: 'The column that I blocked had 2 power, so I should have taken 2 damage to my unit '
      + 'and gotten 2 +1/+1 counters here',
    status: 'fixed',
    guards: [
      "05-rulings.test.ts::R114: {Deadly}'s 1 is a pass-along floor, not a cap on what is dealt",
      '24-wood-b.test.ts::Phytochemical Protection: a 2-power {Deadly} column into a shielded 7/3 pays 2 counters',
      '24-wood-b.test.ts::Phytochemical Protection: the whole hit is prevented, not just the lethal part',
    ],
    note:
      'Same root cause as #84 — see that entry for the one-line fix. This half came from the '
      + '{Deadly} branch specifically: `if (deadly && recvCap > 0) poolNeed = 1` was applied as '
      + 'a CEILING on what is dealt, so a 2-power Deadly column marked 1 damage and R98 paid '
      + 'out 1 counter. {Deadly}\'s 1 is the minimum share that must be paid before {Piercing} '
      + 'may carry the rest away — a FLOOR, never a cap. The RAQ it was drawn from ("at least 1 '
      + 'dmg to Awoken, rest of the damage can go to Bubb") never said the rest disappears. '
      + '⚠ FORESEEN AND RECORDED: ledger #72 closed with "SURVIVING GAP, pinned by its own '
      + 'test: the counters cap at LETHAL, not at the whole hit … wants its own ruling". Its '
      + 'guard could not catch this because the guard was written to pin the WRONG answer on '
      + 'purpose — 24-wood-b\'s test was titled "⚠ OPEN — the counters cap at LETHAL" and '
      + 'asserted `counters === 1`. #84 is the ruling it was waiting for; that test is now '
      + 'replaced rather than amended, because its whole premise was false.',
  },
  {
    id: 80, room: 'EGCW', date: '2026-08-23',
    report: 'Given the option to play Soul Siphon during Deployment; Battle Spells (and Battle-symbol '
      + 'activated abilities) should be illegal outside Battle',
    status: 'by-design',
    note:
      'THE AUTHOR WITHDREW THIS HIMSELF: "It was offering me to GRAFT the ability from hand, '
      + 'which is legal." Confirmed from the replay rather than taken on trust. At the reported '
      + 'moment (turn 7 deployment, between actions 228 and 229) the ONLY action the engine ever '
      + 'offered on Soul Siphon was `{type:\'graft\', from:\'hand\', index:0, hostId:75}` onto the '
      + 'Glararr he had just played; no `playCard` was offered in that window at any point, and '
      + '`apply()` refuses the cast outright with "battle cards can only be played during '
      + 'battle". Soul Siphon is `timing:\'battle\'` with both a spellEffect and a graftEffect, so '
      + 'grafting it from hand during deployment is legal. Basis: R37 — applying a mod is not '
      + 'playing a card. '
      + 'The enforcement audit was run anyway and came back clean: card-level timing is correct '
      + 'BY CONSTRUCTION (`CardBehavior` has no `timing` key, so the `card()` spread cannot '
      + 'override the printed value). All 137 battle-timed cards and both Battle-symbol '
      + 'activated abilities (Grox, Cadaverous Cultivator) were driven into a deployment window '
      + 'with 20 of every resource: 0 offered, 0 accepted. All 6 Ambush cards likewise. The '
      + 'converse is also clean — 355 of 358 deploy/haste cards are offered, and the 3 that are '
      + 'not (Delver of Mysteries, Resurrect, Covenant of the Damned) are bin-targeting spells '
      + 'refused by R64\'s empty-candidate rule; stock the bin and all 3 appear. '
      + '⚠ ONE REAL FINDING SURVIVES, filed as a separate UI item (not a playtest report id): the hand\'s `.card.playable` outline is a '
      + 'single undifferentiated glow that OR-folds playCard/augment/graft/prophesy/'
      + 'recycleForResource, so a battle spell that can only be GRAFTED looks exactly like a '
      + 'castable card. The disambiguation exists only after a click. That is what made this '
      + 'look like a bug to the person who designed the game.',
  },
  {
    id: 81, room: 'EGCW', date: '2026-08-23',
    report: 'Modal cards (with text like [lose *or* gain]) need to have their modes chosen on cast, '
      + 'not on resolution',
    status: 'fixed',
    guards: [
      '97-mode-conformance.test.ts::R57: Burgeon names its half before the stack, and the opponent can read it there',
      '97-mode-conformance.test.ts::R57: a card printing a modal bracket declares EffectDef.modes',
      '97-mode-conformance.test.ts::decision is ever raised mid-resolution',
      '97-mode-conformance.test.ts::R57: Siphon Life says whether it is a burn or a heal before the response window',
      '50-ui-inspect.test.ts::a declared mode is readable off the stack, so a responder is not blind',
    ],
    note:
      'Six caster-facing modes moved to the R57 cast-time seam — Burgeon, Wither and Bloom, '
      + 'Floral Singularity, Transmutide Enigma, Spirit of Nature, Siphon Life. `EffectPart.mode` '
      + 'rides on the PART (not the item) for the same reason `costPaid` does: a composite can '
      + 'carry two modal parts and the part is what the suspension carries (R85). '
      + 'THE HARM, REPRODUCED: Burgeon sat on the stack with its half unknown, the opponent spent '
      + 'a card responding, the response resolved, and only THEN was the caster asked — with the '
      + 'option labels recomputed off the post-response board. That is free information the '
      + 'opponent paid a card for and could not price. '
      + '⚠ PARTIAL RE-REPORT OF #7 (Burgeon, MNWK, marked fixed 2026-08-19), and the reason is '
      + 'exactly the shape this ledger exists to catch: #7 was diagnosed as a SILENCE bug, and '
      + 'both its guards assert that a choice IS offered and that nothing resolves silently. '
      + 'Neither asserts WHEN. Moving the mode to cast time would have left both green; so would '
      + 'moving it back. The fix even hard-coded the resolution-time reading into the card '
      + 'comment, miscategorising a caster\'s own mode as an R6 payment. '
      + 'NOT moved, each verified: Void Memory (the DISCARDING player\'s own pick, R67 carve-out), '
      + 'Retribution Thing (not modal at all — "[lost or gained]" is one quantity), R6 ransoms, '
      + 'replacement-effect modes, R1 amounts read at resolution. '
      + 'Two direct-run paths the diagnosis missed were caught in implementation: `runSpellCopy` '
      + '(a copy inherits the original\'s declared half) and `playInline` (an inline play never '
      + 'reaches the stack and has no response window, so asking there is correct, not a relapse). '
      + 'The three `inEndOfTurn` auto-picks on these cards were deleted — their justification was '
      + 'already stale, which is the thread that led to the 21-card end-of-turn sweep (see 99-endofturn.test.ts).',
  },
  {
    id: 82, room: 'EGCW', date: '2026-08-23',
    report: 'The judge responds using Markdown, but there is no Markdown renderer, so the text just '
      + 'looks weird',
    status: 'fixed',
    guards: [
      '95-ui-markdown.test.ts::#82: INVARIANT — every tag emitted is on the whitelist, and none has an attribute',
      '95-ui-markdown.test.ts::#82: the XSS corpus produces no script, no event handler, no href',
      '95-ui-markdown.test.ts::#82: a real logged judge answer renders as structure, not as asterisks',
      '95-ui-markdown.test.ts::#82: an icon token inside **bold** reaches the output as an icon inside',
    ],
    note:
      'The rules bot asks for Markdown by design (its system prompt ends "use clean markdown") '
      + 'and the client escaped it and drew it raw. The bot\'s own web page renders it with '
      + 'marked+DOMPurify from a CDN; the game client did neither, which is also wrong for a LAN '
      + 'deploy. New dependency-free `ui/markdown.ts`: the `inline` hook is the ONLY place raw '
      + 'text enters the output, so escaping is structural rather than remembered, and the '
      + 'emitted tag set is closed with ZERO attributes ever produced. '
      + 'LINK SYNTAX IS DELIBERATELY ABSENT: of 62 real logged answers, links appear in 0% — and '
      + 'links are precisely where a Markdown renderer becomes an XSS surface (javascript: '
      + 'hrefs). Omitting them removes the attack class instead of filtering it. '
      + 'The same edit fixed a second, unreported defect at the same line: the judge box used '
      + '`esc()` rather than `iconizeText()`, so the icon tokens the bot deliberately leaves in '
      + 'place ([Switch1], {Battle}, [4bb]) rendered as literal brackets. '
      + 'Scope checked, not assumed: all 764 generated rulings are plain prose, so the '
      + 'inspector\'s ruling rows need no renderer. '
      + '⚠ `engine/ui/bundle.js` is a committed build artifact and was NOT rebuilt — doing so '
      + 'mid-round would have baked in another agent\'s in-flight engine state. This fix does not '
      + 'reach a browser until `npm --prefix engine run build:ui` runs on a settled tree.',
  },
  {
    id: 83, room: 'EGCW', date: '2026-08-23',
    report: "Life Plant's units were made in my region, despite it currently being in Rashi's region. "
      + 'Anything made by anything needs to spawn in that region (then can return during regroup)',
    status: 'fixed',
    guards: [
      '98-spawn-region.test.ts::R115: report #83 — Life Plant attacking in the enemy region creates its 1/1s THERE, not at home',
      '98-spawn-region.test.ts::R115: the stranded 1/1s walk home at regroup — the second half of the ruling',
      "98-spawn-region.test.ts::R115 inverts R28: Tidelurker's mid-attack 2/2 stays in the enemy region and CANNOT block the counterattack",
      '98-spawn-region.test.ts::R115 conformance: no card effect reaches for homeRegion() — the source scan',
      '98-spawn-region.test.ts::R115 negative control: a deploy-timing creator still lands at home, because home IS ctx.region then',
    ],
    note:
      'NOT A CODE BUG — a RULES REVERSAL, and the engine was doing this deliberately. R28 and R52 '
      + 'both ruled that a created unit arrives in its CONTROLLER\'S HOME region, and '
      + '44-hybrids-ld-a carried a named, green test asserting exactly the behaviour reported here. '
      + 'The owner confirmed the reversal with its consequence put to him explicitly: a token '
      + 'minted mid-attack is STRANDED in the enemy region, in no column, and cannot block the '
      + 'counterattack; it walks home at regroup. That is a real power cut to Tidelurker, Life '
      + 'Plant, Legion of the Depths and Pack Leader, and it is intended. R28 WITHDRAWN, R52 '
      + 'WITHDRAWN (its unfinished-migration list cancelled — those cards were the ones already '
      + 'right), R33 ABSORBED as the general rule. Now R115. '
      + 'The spell-vs-ability split the owner observed was a very good approximation but not the '
      + 'structure: all four resolution paths already resolve `StackItem.region` to "where the '
      + 'source is", and `spawnUnit` takes region as a required argument and writes it through. '
      + 'The bug was 26 CARD SITES discarding `ctx.region` for `g.homeRegion(ctx.controller)`. '
      + 'They skew to abilities because a unit can walk into the enemy region, while a '
      + 'deploy-timing spell has home === ctx.region and the override is a silent no-op — but two '
      + 'battle-timing SPELLS (Galactic Germination, Arcane Echo) were broken too. '
      + 'The three shared helpers (`makeOneOne`, `makeRobot`, `create1s`) each read '
      + '`region ?? g.homeRegion(seat)`; that `??` is the mechanism that let four cards inherit '
      + 'the wrong answer with no line of code saying so, so `region` is now REQUIRED and the '
      + 'compiler catches the next one.',
  },
  {
    id: 84, room: 'EGCW', date: '2026-08-23',
    report: 'Damage is a little bugged. Vroot should have had Rashi gain 9. ALL damage is dealt to '
      + 'units, even if it surpasses its defense. The only exception is Piercing, which deals '
      + 'excess to the controller',
    status: 'fixed',
    guards: [
      '05-rulings.test.ts::R114: without Piercing the excess is not lost, it lands on the unit',
      '05-rulings.test.ts::R114: {Piercing} is still the exception — excess goes to the controller, not the unit',
      "38-light-a.test.ts::Vroot: a blocked column pays out its whole power, not the blocker",
      '82-attr-interactions.test.ts::combat and effect damage agree on how much was dealt',
      '100-elective-assign.test.ts::R120 (a): the ATTACKER is asked, and ALL 4 onto the front 1/1 leaves the back one untouched',
      '100-elective-assign.test.ts::R120 (b): the FIRST option is the default split, and one click reproduces the pre-R120 numbers exactly',
    ],
    note:
      'One line: `assignColumnDamage` used `poolNeed` — LETHAL NEED — as a CAP on damage dealt '
      + '(`const a = Math.min(remaining, poolNeed)`), and the leftover was returned to callers '
      + 'that discarded it unless the column had {Piercing}. The clamped number is then what the '
      + 'whole pool reads: the `damage` event\'s `n`, {Blessed} gain, {Poisonous} counters, '
      + '{Resonant}, and R98 prevention payout. Nine cards read that amount directly (Vroot, '
      + 'Mirage Scuttler, Molten Tormentor, Lithoghul, Restitution, Mirrorback Ambusher, Decay '
      + 'Distributor, Jollyglop, Phytochemical Protection). '
      + 'Verified against the real game: at EGCW action 251 a 9-power column blocked by a 2/2 '
      + 'paid Vroot 2 instead of 9. `dealEffectDamageAll` was NOT affected — it already dealt the '
      + 'full amount, so combat and effect damage had silently disagreed for months. That '
      + 'invariant is now a test rather than a coincidence. '
      + '⚠ THE RULING IS WIDER THAN THE FIX. Asked who soaks the leftover with two or more '
      + 'blockers, the owner ruled that assignment is ELECTIVE: "It is legal to do ALL the damage '
      + 'to the front unit and none to the back one, even if there is enough to kill them both. '
      + 'The only rule is that the front unit must be assigned lethal damage before assigning any '
      + 'to the back unit." The engine now auto-assigns ONE legal split (shares front-to-back, '
      + 'leftover on the back-most living unit). '
      + '2026-08-24: the deferred player-elective mode SHIPPED as R120 — when a strike has ≥2 '
      + 'living victims and more pool than the front unit\'s lethal share, the dealing side is '
      + 'asked (both directions), with the pre-R120 auto-split as the one-click first option; '
      + 'trivial combats and {Piercing} strikes keep the silent path. 100-elective-assign.test.ts '
      + 'is the fence.',
  },
  {
    id: 85, room: 'EGCW', date: '2026-08-23',
    report: 'Soul Siphon (and cards like it) should have a way of showing, while in your hand, what '
      + 'the X value is for each player',
    status: 'fixed',
    guards: [
      '96-x-preview.test.ts::#85: Soul Siphon previews a row PER PLAYER, and the row is the size of the unit it makes',
      '96-x-preview.test.ts::#85: ROUND TRIP — the rows compute identically off viewFor(state, seat), for both seats',
      '96-x-preview.test.ts::#85: CENSUS — every card reading a battle counter previews it or is exempted by name',
    ],
    note:
      'The pattern already existed and Soul Siphon was simply never wired into it: '
      + '`CardBehavior.xPreview` is a UI-only pure query the client already renders as an '
      + '"X = N right now" badge, and only 6 of 494 cards defined it. '
      + 'A structural gap had to be closed first: `xPreview` returns ONE number keyed on the hand '
      + 'owner\'s seat, but Soul Siphon\'s X reads the DECLARED TARGET player\'s life lost, so it '
      + 'has one value per player — exactly what the report asks for. New `xPreviewRows` returns '
      + 'labelled rows; 8 cards wired. An "X right now" section was added to the inspector, which '
      + 'showed no X at all, because "while in your hand" means the panel a player actually reads '
      + 'a card in. '
      + 'Showing BOTH players is safe by construction, not by judgement: every battle counter is '
      + 'public, and counters can only be bumped during battle while the hidden simultaneous '
      + 'segments are only plan/haste/deploy (`segmentKey()` returns null for battle), so nothing '
      + 'can accumulate unseen. The census guard is the part that matters long-term — a card '
      + 'reading `g.battleCounter(...)` must preview it or be exempted by name, so the next Soul '
      + 'Siphon cannot ship unwired. '
      + '⚠ DEFERRED by decision, each to its own entry rather than silently dropped: flag-style '
      + 'hidden state (Suspend\'s life-lock — arguably the worst memory burden in the set, since '
      + 'the card erases itself and nothing on the board records it — and Abyssal Evocation\'s '
      + 'bin-play permission), and ordinal countdowns (Seabed Shellcaster, Origon, Mischievous '
      + 'Reclaimer). Also left alone deliberately: `hasteManaSpent`/`hastePlaysUsed` DO accumulate '
      + 'inside the hidden haste segment and are not frozen by viewFor — harmless only because no '
      + 'UI reads them.',
  },
  {
    id: 86, room: 'EGCW', date: '2026-08-23',
    report: "Mirage Walker triggered in Rashi's Deployment despite her playing MIRAGE WALKER during "
      + 'that Deployment',
    status: 'fixed',
    guards: [
      '14-water-a.test.ts::Mirage Walker #86: acting suppresses, idling triggers',
      '14-water-a.test.ts::Mirage Walker #86: the OPPONENT acting during deployment does not suppress the trigger',
      '14-water-a.test.ts::Mirage Walker #86: activating an ability during deployment counts as acting',
      '14-water-a.test.ts::Mirage Walker #86: the stamp survives a JSON save/load mid-deployment',
    ],
    note:
      'FIXED exactly as diagnosed: the truth is stamped in the REDUCER now — per-seat '
      + '`GameState.deployActed`, zeroed by startDeployment, set at one choke point in '
      + 'apply.ts\'s dispatch for any deployment action except doneDeploying/decide (the owner\'s '
      + 'ruling: "YOU did something during deployment other than just hitting Done", mods and '
      + 'ability activations included). Mirage Walker\'s whole bookkeeping trigger is deleted; '
      + 'its end-of-turn when() is a pure read. The replacement test is parameterised over the '
      + 'full seat × deployPlayer matrix and was red 6/9 on the old code — including both '
      + 'misfire directions and the serialization cases. Root cause, kept for the record: '
      + 'Mirage Walker\'s bookkeeping `when()` reads `g.s.deployPlayer === self.controller`, but '
      + '`deployPlayer` is NOT the acting seat — deployment is simultaneous and it is a derived '
      + 'initiative-ordered marker (its own comment says "derived sequential marker"). The '
      + 'predicate reduces to "is my controller the initiative seat?" and never asks who acted. '
      + 'It misfires BOTH ways, confirmed over the full seat x deployPlayer matrix: the '
      + 'non-initiative seat\'s own actions are never counted (the reported case — Rashi was '
      + 'non-initiative on turn 8), and the OPPONENT applying a mod in your region sets the flag '
      + 'and suppresses your trigger though you did nothing. '
      + 'Mirage Walker is the ONLY card in the pool that reads `deployPlayer` (verified by grep '
      + 'over src/cards/), so the class is narrow — the real class is not "phase-begin triggers" '
      + 'but "entity-local when() bookkeeping with a wrong window predicate". The parent '
      + 'hypothesis that permanents generally misfire for the phase they entered was CHECKED AND '
      + 'REFUTED: `fireEvent` snapshots entities at the instant the event fires, so a late '
      + 'arrival has already missed it. '
      + '⚠ WHY THE EXISTING GUARD WAS BLIND, and it is a repo-wide hazard: 14-water-a\'s test '
      + 'reads `const p = h.state.deployPlayer!` and drives THAT seat — always the initiative '
      + 'seat, the one seat the buggy predicate happens to serve correctly. It is green with the '
      + 'bug live. `h.state.deployPlayer` is used 763 times across 65 test files as "the acting '
      + 'seat", so ANY seat-asymmetric deployment bug is invisible to the whole suite. The '
      + 'replacement test is parameterised over seat x deployPlayer and was confirmed red 4/4 '
      + 'before the fix. RULING taken (owner): "the idea is that YOU did something during '
      + 'deployment other than just hitting Done" — any deployment action counts, mods and '
      + 'ability activations included, so the fix stamps every non-done action in the reducer '
      + 'rather than whitelisting events.',
  },
  {
    id: 87, room: 'XVUR', date: '2026-08-23',
    report: 'Worldbender is non functional. In live draft: instead of looking at the pack you draw '
      + '2 for turn + 1 for Worldbender, no life loss. In constructed and cube: instead of drawing '
      + '4 and recycling 2, you draw 2 for turn + 1 for Worldbender and lose 3 life',
    status: 'fixed',
    guards: [
      '28-metal-c.test.ts::Worldbender in a live draft: the pack is never offered, the hand gains 3, and life is untouched',
      '28-metal-c.test.ts::Worldbender in constructed: no draw-4-put-2-back',
    ],
    note:
      'Built as `CardBehavior.replaceCardStep`, consulted by E.startDraftStep and the constructed '
      + 'draw — the card REPLACES the turn\'s card acquisition rather than adding to it, per the '
      + 'spec this report supplied: draft = never open the pack (it passes untouched), draw 1 on '
      + 'top of startTurn\'s 2, no life loss; constructed = no draw-4-put-2-back, draw 3, lose 3 '
      + 'life AFTER the draw so a lethal 3 still leaves the cards drawn. The two questions the '
      + 'report left open were settled in code and comment: CUBE has no GameMode, so it rides the '
      + 'constructed branch the day it exists; SHARED mode has no card step to replace, so the '
      + 'hook returns false there. Its card-ledger entry was deleted in the same change. '
      + 'THE WIDER LESSON stays recorded: the card was never invisible — it had an accurate '
      + 'ledger entry AND a `{todo:true}` test, neither of which can fail, so the suite stayed '
      + 'green for as long as the card stayed dead. Playing it is what surfaced it.',
  },
  {
    id: 88, room: 'XVUR', date: '2026-08-23',
    report: "Flux Resonator isn't working with my Robot tokens.",
    status: 'fixed',
    guards: [
      '27-metal-b.test.ts::Flux Resonator: an allied Robot spawns with one more counter (report #88)',
      '27-metal-b.test.ts::Flux Resonator: a Robot 2 enters as a 3/3, not a 4/4',
      '27-metal-b.test.ts::Flux Resonator: two allied Resonators give a spawn X plus TWO',
      '27-metal-b.test.ts::Flux Resonator: an ENEMY Resonator adds nothing',
      '27-metal-b.test.ts::Flux Resonator: a token that spawns with NO counters gets none',
    ],
    note:
      'FIXED: spawn counters now go through the R104 amount layer at the single site where '
      + 'spawnUnit sets them, exactly as addCounters does. The Robot token prints "I spawn with X +1/+1 '
      + 'counters on me", and Caleb has ruled the Resonator applies to that placement twice over '
      + '(2025-03-21: tokens created under it "enter play with a +1/+1 counter" — "Yep"; '
      + '2025-05-30: "it\'s just X+1, so it happens to double a 1/1 but a 2/2 robot would spawn '
      + 'as a 3/3"). The engine\'s E.addCounters consults the R104 amount layer, but '
      + 'E.spawnUnit sets spawn counters DIRECTLY (`u.counters = opts.counters`) and never asks '
      + 'it — so every "create a Robot X" in the pool ignores an allied Flux Resonator. '
      + 'CARD-TODO #25 tracks it.',
  },
  {
    id: 89, room: 'XVUR', date: '2026-08-23',
    report: 'Aberrant Statweaver shouldn\'t have entered the bin. It\'s Unstable. So unless I\'m '
      + 'misunderstanding what an "active zone" is, I think they should be erased.',
    status: 'fixed',
    guards: [
      '17-earth-b.test.ts::Aberrant Statweaver: printed {Unstable} — it dies into the ERASED pile',
      '17-earth-b.test.ts::Oorblak: printed {Unstable} — erased on death while UNMODDED',
      '17-earth-b.test.ts::printed {Unstable} census',
    ],
    note:
      'The owner was right, and the gap was a whole CLASS with two cards in it: {Unstable} '
      + 'printed on the TYPE LINE was carried by nothing. The extractor parsed the type-line '
      + 'markers into attrs/virus/burst and dropped {Unstable} (deliberately not an Attr — it is '
      + 'a bin replacement, not a combat attribute), so E.isUnstable unioned mods, the R96 stamp '
      + 'and modded copies, and a printed-Unstable card fell through to the bin. Now: '
      + '`Printed.unstable` (extractor emits it off the {Unstable} marker; Statweaver and Oorblak '
      + 'are the whole diff), and isUnstable reads it off the FACE as the fourth way in. A census '
      + 'test pins flag⇔marker over the whole pool so the two cannot drift apart again. '
      + 'Death triggers still fire — Unstable replaces the BIN, not the death (Caleb 2025-03-13). '
      + '⚠ Scope note: this covers the leave-play path (destroy, R65 public erased pile). '
      + 'Whether a printed-Unstable card DISCARDED from hand is also erased is unsourced and '
      + 'deliberately unchanged.',
  },
  {
    id: 90, room: 'XVUR', date: '2026-08-23',
    report: 'Hooba bot made 2 robots I think',
    status: 'by-design',
    note:
      'SOLVED by the owner himself (2026-08-24): "Hooba bot actually wasn\'t a bug. There was '
      + 'an Automaton of Abundance in play." That is R104\'s batch replacement doing its printed '
      + 'job — Hooba-Bot\'s trigger creates a Robot 2 in the BATTLE region, and an Automaton '
      + 'that came along to the battle (the hook is region-scoped, R12) adds "an additional '
      + 'copy of each unique token you created", so the one-token batch yields two Robot 2s. '
      + 'Pinned as a '
      + 'test now (27-metal-b.test.ts::"Hooba-Bot + Automaton of Abundance: the reported two '
      + 'robots, by design"), beside the per-trigger pin written while diagnosing '
      + '(27-metal-b.test.ts::"Hooba-Bot: one attack trigger makes exactly ONE Robot (report '
      + '#90)"). The first hypothesis recorded here — attack in one round, block in the other, '
      + 'two triggers as printed — was plausible but wrong; XVUR could not be replayed for '
      + 'forensics (the Worldbender fix changed the constructed draw phase, so the log diverges '
      + 'at action 72, long before action 238), which is why the real cause had to come from the '
      + 'owner\'s memory of the board.',
  },
  {
    id: 91, room: 'ANBB', date: '2026-08-24',
    report: 'Beyond, Codex Incarnate has a typo in its text',
    status: 'fixed',
    guards: [
      '122-cardtext-markup.test.ts::R134: {g} renders the keyword it marks',
      '122-cardtext-markup.test.ts::R134: no card in the pool renders a stray marker word',
      '122-cardtext-markup.test.ts::R134: an unclosed {i} reminder does not italicise the rules text after it',
    ],
    note:
      'NOT a typo in the DATA \u2014 the transcription matches the card art word for word, which '
      + 'is checkable because we hold the image. It was the RENDERER, and it was never one card. '
      + '{g} marks the ONE keyword after it (the printed cards colour that word); the formatter '
      + 'had no case for it, so it fell through the "unknown {token} bares its word" branch and '
      + 'emitted a literal letter \u2014 NINE cards read "ginverted", "gdeadly", "gflying", '
      + '"gpiercing", and two more read "punstable" from {p}. The owner named the one card he '
      + 'happened to be looking at. Both markers are handled GENERICALLY now, because handling '
      + 'them one letter at a time is what produced the bug. Pulling the thread found two more: '
      + 'the pool writes reminders as {i}(\u2026) and almost never closes them, so the <i> ran to '
      + 'the end of the text box \u2014 invisible on the ~69 cards whose reminder is last (which '
      + 'is why it survived) but SEVEN print real rules text after a reminder and had it silently '
      + 'italicised as flavour; and five cards printed a literal "{i1}" nested inside a modal '
      + 'bracket the icon pass returned verbatim. WHY NOTHING CAUGHT IT: iconizeText lived in '
      + 'ui/main.ts, which runs DOM code on import, so no test could reach it \u2014 the same shape '
      + 'as BL-24\'s optionPingId and the undo decision that lived in a socket handler. Lifted to '
      + 'ui/cardtext.ts, which is what made all three testable. Suspect any rendering decision '
      + 'that only exists inside the client entry point.',
  },
  {
    id: 92, room: 'ANBB', date: '2026-08-24',
    report: 'Prismites are behaving wrong. You told me they shouldn\'t trigger the creation of a '
      + 'shard, but that\'s not true. It literally says on them that you make a resource *then '
      + 'activate it*. And when you activate your 3rd (or more) resource in a color, you get a '
      + 'Shard. So using a Prismite should do the same.',
    status: 'fixed',
    guards: [
      '21-fixes.test.ts::R132: spending a Prismite into your 3rd element copy DOES grant the shard',
      '21-fixes.test.ts::R132: a Prismite spent into your SECOND copy pays nothing',
      '21-fixes.test.ts::R132: the ANBB position',
    ],
    note:
      'The owner was right and R116 is REVERSED (R132). Printed: "Erase me: Create a '
      + 'non-prismite resource, THEN ACTIVATE IT. Do this only during the mana step. (This does '
      + 'not use one of your activations for turn.)" The p.18 affinity bonus is owed, so '
      + 'doExchangePrismite calls maybeGrantShard. R116 never quoted that line \u2014 it reasoned '
      + 'from the ENGINE\'S MODEL (a mutation of an already-activated resource) and reached for a '
      + 'fetchland analogy to justify what the model already did. Same failure as R125 (a '
      + 'StaticMod typed over Entity became "Rotspore only affects units") and R128 ("a unit has '
      + 'no parts to negate" became "a unit is not an effect"). The engine was already '
      + 'contradicting itself, which is the tell: the exchange fires a resourceActivated event, so '
      + 'every listener has always seen it as an activation \u2014 only the shard check was carved '
      + 'out. Caleb\'s fetchland line survives untouched: it is about the ACTIVATION ALLOWANCE, '
      + 'charged in doActivateResource, not here. You get the Shard, not a second activation. The '
      + 'ANBB board is the argument and is pinned as a two-seat comparison: Ben reached three dark '
      + 'through prismites and was paid nothing while Rashi\'s third fire came from a plain '
      + 'activation and paid. The R116 test is inverted in place rather than deleted, carrying the '
      + 'history of both flips \u2014 it has now turned over twice.',
  },
  {
    id: 93, room: 'ANBB', date: '2026-08-24',
    report: 'I\'m pretty sure we\'re doing death and trashing wrong for Unstable units. '
      + 'Dropslime wouldn\'t make sense otherwise. But here, it died and I didn\'t get its '
      + 'trigger or the other one',
    status: 'fixed',
    guards: [
      '42-dark-b.test.ts::playtest #93: Dropslime fires from HAND',
      '42-dark-b.test.ts::ANBB: an Unstable death and an unmodded death on the SAME damage step',
      '42-dark-b.test.ts::Muck Rummager sees an Unstable death',
      '43-dark-c.test.ts::Blightwalker dying while {Unstable} fires its own',
      '43-dark-c.test.ts::the Rector pays, and finds nothing',
      '43-dark-c.test.ts::gives the Distiller nothing to cache',
      '35-rot-debt-trash.test.ts::a modded unit dying is binned, TRASHED, and only then erased',
      '62-death-facts.test.ts::an Unstable death says BIN, like a token',
    ],
    note:
      'The owner was right, and R137 REVERSES the old behaviour. ANBB replays FAITHFUL, so this '
      + 'one had exact evidence: Dropslime demonstrates BOTH halves by itself. Discarded from '
      + 'hand (unmodded) it trashed and its trigger paid out 2 damage; later spawned, grafted by '
      + 'Plague Ritual, {Unstable}, it blocked, took lethal and was ERASED \u2014 no trash, no '
      + 'trigger, no counter \u2014 while Thoughtripper died UNMODDED on the SAME damage step, '
      + 'binned, trashed and fired correctly. (The owner recalled the pair as two Thoughtripper '
      + 'deaths; Thoughtripper died once. The card that died twice, once each way, is Dropslime.) '
      + '\u26a0 THE RULING DIVERGES FROM TWO SOURCES and that is recorded, not buried: Unstable\'s '
      + 'printed reminder says "(If they would enter a bin, erase them instead.)" and Caleb '
      + '2025-04-08 said "Unstable units still die, they just get erased instead of ending up in '
      + 'the bin" \u2014 both argue for the OLD behaviour. The owner overruled them, as R106 did '
      + 'over {Unaware}. The argument that won: the engine ALREADY treats a dying TOKEN as '
      + 'entering the bin, trashing, then being swept to the erased pile (Caleb on tokens: '
      + '"technically it does enter your hand and then gets erased immediately"), so two '
      + 'disposals that end in the same erased pile behaved differently for no reason a player '
      + 'could see. Now E.destroy has ONE destination. '
      + 'WIDER THAN THE REPORT: 14 cards read trashing. Six lose their OWN trigger this way '
      + '(Afflicting Anima, Blightwalker, Dropslime, Maw of Despair, Nothyr, Thoughtripper); the '
      + 'other eight WATCH someone else\'s trash (Cerebrox, Cthyrian Culler, Cthyrian Rector, '
      + 'Muck Rummager, Murkdrop Distiller, Murkstalker, Splort, Unrelenting Horror) and had been '
      + 'silently UNDER-triggering on every modded-unit death in every game ever played \u2014 '
      + 'invisible because you cannot see a trigger that does not happen. '
      + 'Decided along the way: NONTOKEN MODS trash too, because a recalled or cached carrier\'s '
      + 'mods already trash (R70), so a death skipping it would make one mod card behave two ways '
      + 'depending on how its host left play \u2014 the exact shape being removed. Token mods keep '
      + 'R69\'s carve-out. Pull Under needed a `keepBinned` seam: it hand-rolled its own toBin '
      + 'precisely BECAUSE destroy erased without trashing, so under R137 it double-trashed \u2014 '
      + 'caught by its own existing "exactly one trash" assertion, which is the suite working. '
      + 'R51\'s ARGUMENT died here too (it justified fireOwnTrashTrigger\'s `mods: []` with "a '
      + 'modded unit that dies never reaches a bin"); the answer survives on a new derivation and '
      + 'the prose is repaired \u2014 R133\'s lesson recurring within 24 hours. '
      + 'Spells stay out of scope: a virused spell leaving the STACK is erased and not trashed, '
      + 'because nothing from the stack is ever trashed (R40), not because of Unstable.',
  },
  {
    id: 94, room: 'SMVJ', date: '2026-08-24',
    report: 'We need a "max speed" that the gamestate can resolve/put things onto the stack. When '
      + 'someone has auto pass on and has nothing left to do, it\'s impossible to keep up with '
      + 'what\'s going on currently. Things should go onto the stack and then resolve at a max '
      + 'speed of 1 thing per second, I think.',
    status: 'live',
    note:
      'PACING, not correctness. With auto-yield on and nothing to respond to, the whole stack '
      + 'resolves in one frame and the log scrolls past faster than a human can read, so a player '
      + 'cannot tell WHY the board changed. The owner proposes a ceiling of ~1 item/second. '
      + 'Presentation-only: the engine is pure and must NOT learn about wall-clock time — the '
      + 'throttle belongs in the client\'s render/animation layer, replaying the event list it '
      + 'already receives. Carried as CT-28.',
  },
  {
    id: 95, room: 'SMVJ', date: '2026-08-24',
    report: 'Hush Mush\'s ability to go to the opponent isn\'t a trigger. It just happens as part '
      + 'of the spell.',
    status: 'fixed',
    guards: [
      '23-wood-a.test.ts::R143 #95: Hush Mush ENTERS under the negated',
      '23-wood-a.test.ts::R143 #96: the CASTER',
      '23-wood-a.test.ts::TWO Hush Mushes in one battle keep separate answers',
      '23-wood-a.test.ts::whose target has already left the stack fizzles',
    ],
    note:
      'CONFIRMED by reading the card. Printed: "Negate target effect. Its controller gains '
      + 'control of me." The handover is part of the SPELL\'s resolution, not a separate ability. '
      + 'The engine implements it as a `triggered` ability on the body\'s own `spawned` event '
      + '(batch-wood-a.ts, HUSH_KEY handoff through battleCounters), so the body spawns under the '
      + 'CASTER first and changes hands afterwards. That extra intermediate state is observable, '
      + 'which is exactly what report #96 saw. R107 (owner != controller on spawnUnit) is the '
      + 'primitive that makes the direct version possible — the body should ENTER under the '
      + 'negated effect\'s controller, with no handover step at all. Carried as CT-29.',
  },
  {
    id: 96, room: 'SMVJ', date: '2026-08-24',
    report: 'I shouldn\'t be getting a Flourishing Flora trigger here. Hush Mush should enter as '
      + 'Rashi\'s unit',
    status: 'fixed',
    guards: [
      '23-wood-a.test.ts::R143 #95: Hush Mush ENTERS under the negated',
      '23-wood-a.test.ts::R143 #96: the CASTER',
      '23-wood-a.test.ts::TWO Hush Mushes in one battle keep separate answers',
      '23-wood-a.test.ts::whose target has already left the stack fizzles',
    ],
    note:
      'The OBSERVABLE HALF of #95, and the reason that one is not cosmetic. Flourishing Flora is '
      + '"[Augment] Whenever another ally spawns, put a +1/+1 counter on me." Because Hush Mush '
      + 'spawns under the caster and only then hands over, it is briefly the caster\'s ally, so '
      + 'the caster\'s ally-spawn watchers fire on a unit that should never have been theirs. The '
      + 'owner got a free counter he correctly refused. WIDER: this hits every "whenever an ally '
      + 'spawns" watcher, not just Flourishing Flora — the bug is the intermediate control state, '
      + 'and any card observing spawns can see it. Fixing #95 fixes this. Carried as CT-30.',
  },
  {
    id: 97, room: 'SMVJ', date: '2026-08-24',
    report: 'Dormant resources can misleadingly look like they\'re active. Maybe have them not '
      + 'show up (or something) during battle/deployment so players don\'t think they\'re active. '
      + 'During planning they should show normally tho',
    status: 'live',
    note:
      'Client presentation. A dormant resource is not spendable until it activates, but it is '
      + 'drawn similarly enough to an active one to be misread mid-battle, when a player is '
      + 'counting available mana under time pressure. The owner\'s own proposal is phase-scoped: '
      + 'de-emphasise or hide dormant resources during battle/deployment, show them normally in '
      + 'planning (which is when you act on them). Carried as CT-31.',
  },
  {
    id: 98, room: 'SMVJ', date: '2026-08-24',
    report: 'Rashi\'s start of combat (doing all her Wraith triggers) doesn\'t need to take away '
      + 'from what I\'m doing in Deployment',
    status: 'live',
    note:
      'Concurrency/flow. Deployment is SIMULTANEOUS (both players act, moves revealed when both '
      + 'are done — R-deployment), so one player resolving a pile of start-of-combat triggers '
      + 'should not seize the other player\'s screen or block their input. Related to #101, which '
      + 'is the rules-side proposal for the same pile of Wraith triggers. Carried as CT-32.',
  },
  {
    id: 99, room: 'SMVJ', date: '2026-08-24',
    report: 'Tokens should have their X value in their text box modified to say the actual number, '
      + 'rather than X. So a Poison 5 would say "Put 5 -1/-1 counters on target unit"',
    status: 'live',
    note:
      'A token created with X=5 still prints the GENERIC text with a literal "X", so the player '
      + 'has to remember what it was made for. The number is known at creation. NOT the same class '
      + 'as the markup bugs (R134/R141/R142): those are a formatter failing to consume a token, '
      + 'this is a live VALUE that should be substituted into the printed text for that instance. '
      + 'Needs a decision on where the substitution lives — on the token entity at creation, or in '
      + 'the text box reading the entity\'s stored X. Carried as CT-33.',
  },
  {
    id: 100, room: 'SMVJ', date: '2026-08-24',
    report: 'The damage distribution UI is terrible and confusing. Better would to have a ticker '
      + 'counter thing on each unit that you click up/down and they always are forced to sum to '
      + 'the amount of damage you have.',
    status: 'live',
    note:
      'The UI for R120, the ELECTIVE combat damage split (built because "never decide for the '
      + 'player"). The mechanic is right; the affordance is not. The owner names the fix exactly: '
      + 'a per-unit up/down stepper, constrained to sum to the damage available. NOTE the shape is '
      + 'the one R139/BL-25 just built for counter removal (stepper + max + "All", clamped, does '
      + 'not auto-submit) — reuse that lifted, tested logic in ui/inspect.ts rather than writing a '
      + 'second stepper. Carried as CT-34.',
  },
  {
    id: 101, room: 'SMVJ', date: '2026-08-24',
    report: 'Deployment should use the stack. All Wraith triggers should go onto the stack '
      + 'simultaneously and be allowed to target the same unit, even exceeding its defense (the '
      + 'final triggers would just fizzle).',
    status: 'live',
    note:
      '⚠ A RULES CHANGE, not a bug, and the largest thing in this batch — it needs the owner to '
      + 'confirm scope before any code moves. Two claims: (a) deployment-phase triggers use the '
      + 'STACK like everything else, and (b) several may target the SAME unit even when the total '
      + 'exceeds what that unit can absorb, with the surplus fizzling on resolution rather than '
      + 'being prevented at targeting time. (b) is the load-bearing half: it says targeting must '
      + 'NOT pre-validate against a limit that later triggers might consume, which is the ordinary '
      + 'fizzle-on-resolution rule. Touches the deployment phase, the stack and every '
      + 'start-of-deployment trigger. Related to #98 (the same Wraith pile, seen as a flow '
      + 'complaint). Carried as CT-35.',
  },
  {
    id: 102, room: 'SMVJ', date: '2026-08-24',
    report: 'UI thing: All the text on cards still includes things that are only for the engine to '
      + 'see (like {i} or / or some other "markup" notes)',
    status: 'fixed',
    guards: [
      '122-cardtext-markup.test.ts::R142: the /[…] box drops the slash and the brackets',
      '122-cardtext-markup.test.ts::R142: a stat slash is NOT markup',
      '122-cardtext-markup.test.ts::R142: {i1} does not eat the space beside the word',
      '122-cardtext-markup.test.ts::R142: no card in the pool renders engine markup to a player',
      '122-cardtext-markup.test.ts::R142: the keyword family is NOT suppressed',
      '122-cardtext-markup.test.ts::R142: no printed card carries a hyphenation artifact',
    ],
    note:
      'CONFIRMED with exact evidence. The owner on what the markup is: "It\'s pure engine markup '
      + 'used by some system Caleb uses to format cards better. {i} makes the next word italic, '
      + '{g} puts it into gold colored text, etc. I\'m not sure what the / does, tho." So the rule '
      + 'is that NONE of it may reach a player. Census: the formatting family is {i} (80 uses), '
      + '{/n} (73), {g} (8), {i1} (6), {/i} (5), {p} (2); the ~30 CAPITALISED tokens ({Battle}, '
      + '{Virus}, {Haste} …) are keyword names and must keep showing. The "/" is now settled: it '
      + 'appears ONLY as "/[…]" directly after a [Switch1]/[Switch] marker, wrapping a cost '
      + '(Discharge) or a mode body (Wither and Bloom) — and it is NOT the "/" in X/X or +1/+1 '
      + 'stat notation, which must survive. Three live defects: "/[" prints literally on ~15 '
      + 'cards; consuming {i1} EATS THE ADJACENT SPACE (Wither and Bloom renders "each enemy '
      + 'orput a +1/+1"); and a {/n} nested in an unrecognised bracket never becomes a line break. '
      + 'Plus a data half: printed.json is GENERATED by scripts/extract-printed.mjs, and carries '
      + '49 cards with double spaces and 4 with layout hyphenation ("adja- cent", "oppo- nent"), '
      + 'which must be fixed in the EXTRACTOR because a hand edit to printed.json is wiped on the '
      + 'next regeneration. Linked Extinction\'s "Sacrifce" was left alone as the designer\'s '
      + 'data and the owner then corrected it AT SOURCE in the oracle file; the extractor still '
      + 'never rewrites a word, now pinned generally rather than per-card. Carried as CT-36.',
  },
];
