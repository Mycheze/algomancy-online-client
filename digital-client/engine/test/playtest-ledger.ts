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
    guards: ['23-wood-a.test.ts::target effect', '39-light-b.test.ts::Divine Intervention'],
    note: 'R60. The DI tests only aim at a SPELL, so they would survive a revert to '
      + "stackSpell; the real guard is Hush Mush's. A DI-against-a-trigger case would close it.",
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
    guards: ['36-cache-prophecy.test.ts::no banner'],
    note: 'Correct: Calming Force has no prophecy banner in the printed data or upstream oracle, '
      + 'and R42 refuses a banner-less card. SEPARATE LIVE HOLE, tracked at id 9.5 in spirit: its '
      + 'other line "I can\'t be played from your hand" is NOT enforced (batch-light-c.ts parks it, '
      + '40-light-c.test.ts has a permanently-green todo), so the card can just be played from hand.',
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
    status: 'live',
    note: 'The card is implemented correctly (28-metal-c.test.ts guards the mechanic). Round 7 '
      + 'called it NOT A BUG — trigger fired, report filed while it sat on the stack — but that '
      + 'claim rests only on a commit message and is not reproducible from the repo. Unresolved '
      + 'caveat: the listener is region-scoped (R12), so a Reclaimer at home does not see a death '
      + 'in the battle region, which would reproduce the symptom legitimately. Needs a test.',
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
    status: 'live',
    note: 'The transform is entirely unimplemented — the trigger\'s whole run() is an info line '
      + 'saying so, and "Beyond, Codex Incarnate" is not in printed.json at all. The reported '
      + 'symptom (cannot see what it becomes) is downstream of that. Needs the card in the pool, a '
      + 'transform layer, and a "Transforms into" inspector row fed like tokensCreatedBy. '
      + 'Guarded only by a {todo:true}, which cannot fail.',
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
    status: 'live',
    note: 'Correct diagnosis. Twelve cards print replacement wording; five are parked and six are '
      + 'implemented as triggers. Real consequences today: Containment Protocol and Nothyr can '
      + 'NEGATE them (a replacement never uses the stack); Automaton of Abundance fires per spawn '
      + 'so N identical tokens yield N copies instead of one per unique; Cosmic Conspirator really '
      + 'creates then erases, firing a spurious spawned event; Nullbringer fires a lifeGained for '
      + 'a gain that never happened. Five module-level mutable flags exist purely to paper over '
      + 'this. NOTE: Harbinger (id 28/62) is NOT in this class — it is continuous, not a '
      + 'replacement.',
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
    status: 'live',
    note: 'Constructed and shared both get all seven elements; only draft narrows (to its trio). '
      + 'IMPORTANT: this must be a PRESENTATION default, not a rules change — off-element '
      + 'resources are genuinely useful, e.g. Reap the Due is mono-light but scales off DARK '
      + 'affinity, so a mono-light deck running it must be able to take dark resources or the card '
      + 'is blank. Plan: engine stores deckElements additively, legalActions keeps offering all '
      + 'seven, the menu defaults to the deck\'s elements with an expander for the rest.',
  },
];
