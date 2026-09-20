/* playtest-ledger-closed.ts — the closed entries of playtest-ledger.ts, split out on 2026-09-03.
 *
 * They are DATA THAT STILL RUNS: every entry's proof is a regression guard
 * the suite executes, so nothing here is archived, only moved. The file you
 * open to add work is playtest-ledger.ts, which is now the open entries and the type.
 * An entry closes by moving from there to here; nothing else about it changes.
 */
import type { LedgerEntry } from './playtest-ledger.ts';

export const CLOSED: LedgerEntry[] = [
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
    guards: ['48-playtest-hotfix.test.ts::Mohruung has a live targeted trigger',
      '48-playtest-hotfix.test.ts::a spell aimed at Mohruung actually creates the Crystal 2',
      '17-earth-b.test.ts::Mohruung'],
  },
  {
    id: 2, room: 'MNWK', date: '2026-08-19',
    report: "I can't mod Brough from my bin to a unit for some reason",
    status: 'fixed',
    guards: ['48-playtest-hotfix.test.ts::every card printing a text-box [Augment] marker',
      '48-playtest-hotfix.test.ts::merely mentions [Augment] in reminder text'],
  },
  {
    id: 3, room: 'MNWK', date: '2026-08-19',
    report: "Tranquility isn't making spells more expensive",
    status: 'fixed',
    guards: ['49-playtest-round6.test.ts::R59: Tranquility taxes spells [1] more during battle',
      '49-playtest-round6.test.ts::R59: Tranquility is recognised as an augment'],
  },
  {
    id: 4, room: 'MNWK', date: '2026-08-19',
    report: "Flight doesn't make me pick two targets when casting it. It just has me pick an ally",
    status: 'fixed',
    guards: ['49-playtest-round6.test.ts::R58: Fight takes both units as CAST-time targets',
      '68-target-conformance.test.ts::a card printing N targets declares N cast-time target slots'],
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
    guards: ['23-wood-a.test.ts::"target effect" reaches a TRIGGERED ability',
      '39-light-b.test.ts::Divine Intervention: may change the targets of an effect on the stack',
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
    guards: ['23-wood-a.test.ts::Burgeon: doubles the chosen stat of target unit until regroup',
      '23-wood-a.test.ts::Burgeon: doubling a 0 says so instead of resolving into silence',
      '65-effect-conformance.test.ts::silence'],
  },
  {
    id: 8, room: 'MNWK', date: '2026-08-19',
    report: 'I was able to Prophecy Air Plant without having any Wood resources. I just wanted to '
      + 'click the card to see what would happen and it just immediately went to the Cache zone',
    status: 'fixed',
    guards: ['36-cache-prophecy.test.ts::with less than the banner mana the prophecy is refused',
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
      '75-ui-reachability.test.ts::R84: the client names the compulsory block'],
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
    guards: ['26-metal-a.test.ts::Eldritch Dreamtender: the sacrifice is paid on the way to the stack',
      '32-cast-costs.test.ts::Immolate: the sacrifice is chosen and paid AT CAST'],
  },
  {
    id: 12, room: 'BRDM', date: '2026-08-20',
    report: 'Body Swap puts into the log that the units get -X/+X for the swap. It\'s supposed to '
      + 'just be a pure swap of numbers',
    status: 'fixed',
    guards: ['53-playtest-round7.test.ts::Body Swap exchanges bases, and says so in the log',
      '59-base-stats.test.ts::the text box says "is base 3/3", not a +0/+0 projection'],
  },
  {
    id: 13, room: 'BRDM', date: '2026-08-20',
    report: 'Formless is broken — it should have set Manablub to a 4/4. Stats need to be able to '
      + 'be set without using + or -',
    status: 'fixed',
    guards: ['53-playtest-round7.test.ts::Formless SETS the base',
      '59-base-stats.test.ts::Statweaver REPLACES the base'],
  },
  {
    id: 14, room: 'BRDM', date: '2026-08-20',
    report: "Necromorph doesn't have me select two targets on cast",
    status: 'fixed',
    guards: ['43-dark-c.test.ts::Necromorph',
      '68-target-conformance.test.ts::a card printing N targets declares N cast-time target slots'],
  },
  {
    id: 15, room: 'BRDM', date: '2026-08-20',
    report: "Why didn't Refuse Reclaimer get a counter from my Oracle dying?",
    status: 'by-design',
    guards: ['28-metal-c.test.ts::a death in the battle region it attacked into',
      '28-metal-c.test.ts::a death in a region it is not in',
      '148-pending-trigger-visibility.test.ts::a pending trigger is ON THE STACK the instant another ally dies',
      '148-pending-trigger-visibility.test.ts::the pending trigger is visible to its own controller',
      '148-pending-trigger-visibility.test.ts::the stack strip draws it, and the row names the unit it came from'],
    note: '⚠⚠ THE CAUSE BELOW IS WRONG, AND WAS WRONG FROM THE DAY IT WAS WRITTEN. Corrected '
      + '2026-08-25 by replaying the game. REGION SCOPING WAS NEVER INVOLVED: at the moment of '
      + 'this report both units were in REGION 1, in the SAME formation, both the reporter\'s. '
      + 'BRDM replays 262/262 clean on the engine it was played on (322d536~1; at HEAD it '
      + 'diverges at action 34 and cannot reach the moment at all — CARD-TODO #51), and the '
      + 'sequence is: a177 the Reclaimer\'s trigger resolves, counters 0 -> 1 · a179 Oracle of '
      + 'Foretelling dies -> bin · a179 the Reclaimer\'s trigger FIRES AGAIN · **a180 the report '
      + 'is filed, with the trigger ON THE STACK** · a184 it resolves, counters 1 -> 2. '
      + 'The full report text (trimmed in the row above) ends "It should have activated again" — '
      + 'and it had. He was looking at a board that could not tell him so. THE OWNER CONFIRMED '
      + 'THE CORRECTION, 2026-08-25: "It must have been a UI issue then." '
      + 'Why it is not live: the stack was not on the table when he filed. The stack window '
      + 'landed in 08575eb on 2026-08-21, THE DAY AFTER — there was no way to see a pending '
      + 'trigger because there was nowhere to see the stack. '
      + '⚠ HOW THIS ENTRY WENT WRONG, because it is the most instructive part: somebody '
      + 'reconstructed a scenario that WOULD explain the complaint, verified the engine handles '
      + 'THAT correctly, and closed it. The story is coherent, the rule it cites is real, the '
      + 'quote is genuine, and the two guards below genuinely test it — they just test a '
      + 'different game than the one he played. A 2026-08-25 audit of all 295 guard references '
      + 'read this entry and CLEARED it, because nothing short of the replay could show the gap. '
      + 'The R173 guards found four blind entries by reading; this one needed forensics. '
      + 'The region guards are KEPT — R12 is real and worth pinning — and the visibility guards '
      + 'the report was actually about are added beside them. Red-checked both ways, and the '
      + 'asymmetry is the whole point: disabling the card\'s trigger reddens BOTH sets, but '
      + 'redacting triggered items from the served stack in server/view.ts reddens ONLY the new '
      + 'ones while 28-metal-c stays 30/30 green. That is precisely the hole the original close '
      + 'left open. '
      + 'THE ORIGINAL (WRONG) NOTE FOLLOWS, kept so nobody re-derives it: '
      + 'R12 — REGION SCOPING, and the caveat this entry carried since round 7 turns out to be '
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
    guards: ['55-ui-formation.test.ts::dropIntoRow: the row you click is the row you get',
      '55-ui-formation.test.ts::the block builder offers BOTH rows',
      '55-ui-formation.test.ts::the second blocker stays behind the first',
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
    guards: ['53-playtest-round7.test.ts::a seat with a decision pending against the OTHER seat',
      '50-ui-inspect.test.ts::waiting',
      '146-report-guards.test.ts::#18 a seat with nothing legal is never handed a Pass button',
      '146-report-guards.test.ts::#18 …and that empty list is what the server really publishes'],
    note: 'GUARDS WIDENED 2026-08-25 (R173). Both original guards are RULES-LAYER asserts for a '
      + 'PRESENTATION-LAYER bug: one checks legalActions is empty, the other checks waitingNote\'s '
      + 'wording. The fix is neither — it is the branch in ui/main.ts::promptHtml that returns '
      + 'the "Waiting for X…" bar when the legal list is empty. Disable that branch and the '
      + 'client falls through to the priority bar with a live Pass button again, exactly as '
      + 'reported, while 53-playtest-round7 (40/40), 50-ui-inspect (99/99) and '
      + '70-playtest-round15 (30/30) all stay green. Nothing in the repo had ever driven the UI '
      + 'with an empty legal list. '
      + 'The reported state is real and common, not exotic: a random-play sweep found '
      + 'priority === X with decision.seat === other(X) in 6 of 400 seeds. '
      + '⚠ The first attempt at this fixture did NOT discriminate — its board left priority with '
      + 'the ASKING seat, so the bar refused the Pass button for an unrelated reason and the '
      + 'test would have passed against the bug. Rebuilt around a genuine priority window for '
      + 'the viewing seat.',
  },
  {
    id: 19, room: 'BRDM', date: '2026-08-20',
    report: 'When a column becomes empty during combat, the columns to the right should '
      + 'immediately collapse and fill the gap',
    status: 'by-design',
    guards: ['64-formation-collapse.test.ts::a middle column emptied before blocks collapses',
      '64-formation-collapse.test.ts::after blocks are declared, an emptied column stays as a HOLE'],
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
    guards: ['40-light-c.test.ts::{Pure} blocks a Flying column, and only it can',
      '40-light-c.test.ts::{Pure} blocks an Evasive column alone'],
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
    guards: ['23-wood-a.test.ts::Hush Mush: negates target effect'],
  },

  // ── ZQPC, 2026-08-20 ────────────────────────────────────────────────────
  {
    id: 24, room: 'ZQPC', date: '2026-08-20',
    report: "Scholar of the Void doesn't say what the Beyond card it can transform into does",
    status: 'fixed',
    guards: ['43-dark-c.test.ts::R101 — discard your hand and transform into Beyond',
      // ⚠ REPOINTED 2026-08-25. This used to cite
      // "R101 — a transformed Scholar is a TOKEN", which R157 §10 OVERRULED:
      // the owner ruled that a back face is not a token and that the card turns
      // back over in every zone but play. The test was correctly inverted, and
      // a guard pinning a test's TITLE then reads as a regression in a file the
      // ruling never touched. Second time today (CT-14 was the first) — see
      // CARD-TODO #42 on whether guards should cite titles at all.
      '43-dark-c.test.ts::R157 §10 — a transformed Scholar TURNS BACK OVER on death and bins as itself',
      '43-dark-c.test.ts::R101 — the transform is the SAME unit: same id',
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
    guards: ['132-token-separation.test.ts::the formation zone holds units and only units',
      '132-token-separation.test.ts::the spell tokens get their own container',
      '132-token-separation.test.ts::that container sits beside the bin',
      '132-token-separation.test.ts::an invader',
      '70-playtest-round15.test.ts::floor still fits two cards abreast'],
    note: 'The strip existed but was a fixed 118px against 108px for two cards — one per row by '
      + 'arithmetic. Now fluid with a cap. Reported twice; the follow-up was id 61. '
      + '⚠ 2026-08-25: for three rounds this entry was closed against the two [61] CSS guards '
      + 'and nothing else. Both read ui/style.css only — they measure the strip\'s flex '
      + 'arithmetic, so they answer "does the box wrap two cards abreast", never "is there a '
      + 'box at all". Deleting the separation entirely (putting the tokens straight back among '
      + 'the units) left both of them green; verified by mutation. 132-token-separation drives '
      + 'the real client and reads the markup it produces, and four of its five tests go red on '
      + 'that same mutation.',
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
    guards: ['58-playtest-round9.test.ts::R65: erased cards are kept in a public pile',
      '50-ui-inspect.test.ts::erased',
      '70-playtest-round15.test.ts::board menu offers BOTH erased piles'],
  },
  {
    id: 32, room: 'PEMC', date: '2026-08-21',
    report: "Download didn't have me target anything",
    status: 'fixed',
    guards: ['58-playtest-round9.test.ts::Download',
      '68-target-conformance.test.ts::a card printing "target" at all declares a target somewhere'],
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
    guards: ['50-ui-inspect.test.ts::Primordial Coalescence',
      '65-effect-conformance.test.ts::every token an effect creates is declared in EffectDef.creates'],
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
    guards: ['35-rot-debt-trash.test.ts::a TOKEN dying enters the bin, IS trashed, and is then erased',
      '37-attrs-wight.test.ts::Unstable'],
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
    guards: ['61-negation.test.ts::a mass negate empties the stack of its victims AT ONCE'],
  },
  {
    id: 42, room: 'UZRG', date: '2026-08-21',
    report: "Necromantic Rebuke didn't properly negate my effect",
    status: 'fixed',
    guards: ['42-dark-b.test.ts::Necromantic Rebuke: stopping at X = 0 is offered WITH a warning'],
    note: 'Behaviour was correct as printed — X=0 makes the ransom trivially met. Owner ruled '
      + '(R74) that this warrants a warning, not a prohibition; the warning is what was added.',
  },
  {
    id: 43, room: 'UZRG', date: '2026-08-21',
    report: "It's not possible to see the X value for an effect while it's on the stack",
    status: 'fixed',
    guards: ['50-ui-inspect.test.ts::stackItemX keeps the two X',
      '50-ui-inspect.test.ts::the stack card', '50-ui-inspect.test.ts::a spent part',
      '50-ui-inspect.test.ts::Necromantic Rebuke carries its paid X onto the real stack',
      '56-ui-flash.test.ts::a flashed item still knows its X',
      '146-report-guards.test.ts::#43 a cast X reaches the REAL stack wearing its number'],
    note: 'GUARDS WIDENED 2026-08-25 (R173) after an audit found the first three are all pure '
      + 'tests of ui/inspect.ts over the SAME hand-built xItem fixture. That is not wrong — '
      + 'ui/inspect.ts is the right home for the judgement and those are the right tests for it '
      + '— but this report is about a whole chain, and no cited guard drove any of it. '
      + '⚠ The audit OVERSTATED it: two uncited real-engine guards already reached the cast-X '
      + 'production path (56-ui-flash\'s real Floral Singularity at X=3, and 50-ui-inspect\'s '
      + 'Necromantic Rebuke on a real state.stack). Both are cited now. '
      + 'The hop genuinely nobody covered is the LAST one: what a RESPONDER is handed. The new '
      + 'guard reads viewFor(state, responder).stack rather than state.stack, which is what '
      + 'makes it bite — a plausible "the opponent\'s X is theirs" redaction in server/view.ts '
      + 'blanks the responder\'s screen exactly as reported while every previously cited guard '
      + 'stays green. Measured: 50-ui-inspect 99/99 green under that mutation, new guard red.',
  },

  // ── XCYX / VEAV, 2026-08-22 (rounds 14-15) ──────────────────────────────
  {
    id: 44, room: 'XCYX', date: '2026-08-22',
    report: 'Throwing Boulder was allowed to be activated without having adjacent allies, and '
      + 'sacrificing him should have been a cost to even put the ability on the stack',
    status: 'fixed',
    guards: ['18-earth-c.test.ts::R77: Throwing Boulder with an adjacent ally',
      '18-earth-c.test.ts::R77: with NO adjacent ally',
      '18-earth-c.test.ts::R77: an ALLY is required',
      '18-earth-c.test.ts::R77: out of formation'],
    note: 'R77: a printed precondition is a GATE checked before anything is paid; a self-sacrifice '
      + 'is a COST. Ordering is load-bearing — the gate is checked first so the cost cannot '
      + 'invalidate its own condition.',
  },
  {
    id: 45, room: 'VEAV', date: '2026-08-22',
    report: "Awoken Tomb's trigger, while on the stack, doesn't say what X is equal to",
    status: 'fixed',
    guards: ["50-ui-inspect.test.ts::a triggered ability's X is the amount its event carried",
      "146-report-guards.test.ts::#45 Awoken Tomb's trigger says what X is while it is ON the stack"],
    note: 'GUARD WIDENED 2026-08-25 (R173). The cited test builds the StackItem BY HAND with the '
      + 'event already attached and asserts the pure ui/inspect.ts::stackItemX reads it — so it '
      + 'never asks the engine for an item, and the reported failure is upstream of it. '
      + '⚠ The obvious proof of that is WRONG and was tried: deleting `event: ev` from '
      + 'E.queueTrigger reddens 08-cards2 and 69-damage-batch, because EffectCtx.event is read '
      + 'off the same field — the event\'s EXISTENCE is guarded by the effect tests. The '
      + 'genuinely unguarded thing is narrower and worth more: that the item a RESPONDER is '
      + 'handed still carries its x and its event. Isolated by a mutation that drops `event` '
      + 'from the StackItem while stashing it so EffectCtx still gets it — 50-ui-inspect 99/99, '
      + '08-cards2 14/14 and 69-damage-batch 10/10 all stay green, and only the new guard reddens.',
  },
  {
    id: 46, room: 'VEAV', date: '2026-08-22',
    report: 'The "I get -2/-2" isn\'t a trigger that should go on the stack. It\'s a static effect',
    status: 'fixed',
    guards: ['18-earth-c.test.ts::Tenebrous Bulborb: played normally',
      '18-earth-c.test.ts::Tenebrous Bulborb: augmenting a host gives THE HOST -2/-2',
      '18-earth-c.test.ts::Tenebrous Bulborb: two of them on one host stack to -4/-4',
      '142-static-conformance.test.ts::a card printing a standing statement of fact declares a CONTINUOUS layer',
      '142-static-conformance.test.ts::a card whose whole printed text is continuous declares NOTHING that reaches the stack',
      '142-static-conformance.test.ts::the classifier accounts for every sentence in the pool',
      '142-static-conformance.test.ts::every exemption is still needed'],
    note: 'THE CLASS GUARD NOW EXISTS — R168 / CARD-TODO #48, 2026-08-25, '
      + '142-static-conformance.test.ts. This note used to open "⚠ THE CLASS GUARD FOR THIS '
      + 'REPORT DOES NOT EXIST" and it was right at the time, for a reason worth keeping: the '
      + 'sweep #75 cites, 88-replacement-conformance, is a REPLACEMENT sweep — it classifies '
      + 'cards printing "would … instead". Tenebrous Bulborb prints "[Augment] I gain -2/-2", '
      + 'which contains neither word, so that sweep can never fail on this card however the '
      + '-2/-2 is built. An agent asked to back-fill 88 onto this entry REFUSED on exactly '
      + 'those grounds, and the refusal is what filed CARD-TODO #48. '
      + 'The replacement was built in 88\'s shape and derived from printed.json: 45 of 494 '
      + 'cards print a continuous-shaped clause, 36 of them print nothing else, and each must '
      + 'declare a CONTINUOUS layer rather than something that reaches the stack. '
      + '⚠ IT FOUND A LIVE ONE ON ITS FIRST RUN: Aetherflux Golem printed "[Augment] I gain '
      + '+2/+2" — this report\'s sentence, sign flipped — and was implemented as a triggered '
      + 'ability adding two +1/+1 counters, while the two cards printing the identical sentence '
      + '(Bulborb, Malformed Monstrosity) were statics. So the class was still live in the pool '
      + 'while this entry and #75 both sat at "fixed". That is the whole argument for auditing '
      + 'guards rather than statuses. Red-checked by planting THIS REPORT\'S ORIGINAL BUG back '
      + 'onto Bulborb — the sweep reddens, which is precisely what 88 structurally could not do.',
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
    guards: ['18-earth-c.test.ts::Squish',
      '68-target-conformance.test.ts::a card printing N targets declares N cast-time target slots'],
    note: 'The owner asked for a sweep; the answer was a permanent conformance test instead, '
      + 'because a one-time sweep is what makes a class of bug recur.',
  },
  {
    id: 49, room: 'VEAV', date: '2026-08-22',
    report: 'Channel Through caused Restitution to make 2 triggers, but it should have made one',
    status: 'fixed',
    guards: ['69-damage-batch.test.ts::two hits on one unit in a batch are ONE damage event'],
    note: 'R80: one effect resolution is ONE batch of damage.',
  },
  {
    id: 50, room: 'VEAV', date: '2026-08-22',
    report: 'I only made 2 units from my Channel Through, but it dealt 12 damage total, so I '
      + 'should have made 12 units',
    status: 'fixed',
    guards: ['69-damage-batch.test.ts::every event in a batch carries the WHOLE batch as'],
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
      '56-ui-flash.test.ts::three beats',
      '146-report-guards.test.ts::#53 a real combat batch reaches the client PACED, not all in one frame',
      '146-report-guards.test.ts::#53 …and the held lines are a curtain, not an edit'],
    note: 'Not a correctness bug. ui/flash.ts already was a beat queue but was fed only by '
      + 'stackFlash; it now stages combat sub-steps too, and auto-passes are delayed. '
      + 'GUARDS WIDENED 2026-08-25 (R173). Both original guards call combatStages() on '
      + 'HAND-WRITTEN event arrays: they prove the stager can stage, and cannot fail if the '
      + 'client stops FEEDING it — which is the reported symptom. Cutting absorbBeats(events) to '
      + 'absorbBeats([]) in applyUpdate leaves 56-ui-flash 37/37, 128-ui-pace 18/18 and '
      + '70-playtest-round15 30/30 all green; only the new guards redden. '
      + '⚠ The uncited guard an audit proposed instead — 56-ui-flash::the beats a real '
      + 'end-of-combat produces — does NOT cover this: it drives a real engine but still ends at '
      + 'combatStages(events) and never involves the client. It covers the stager\'s INPUT, not '
      + 'the feeding. Both halves were needed and both were built. '
      + 'Construction note: the new tests pass a NON-EMPTY legal list on purpose — R150\'s '
      + 'holdable() holds an update the player cannot act on, and a held update never reaches '
      + 'absorbBeats at all, so an empty list makes the result depend on how many updates ran '
      + 'earlier in the same process.',
  },
  {
    id: 54, room: 'UFAB', date: '2026-08-22',
    report: 'Tiderunner Initiate should never have entered the Invader\'s zone. It gets played '
      + 'directly into the formation, not as a trigger that happens when it enters',
    status: 'fixed',
    guards: ['73-play-into-formation.test.ts::R29 THE REPORT: Tiderunner is never in the invader',
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
    guards: ['14-water-a.test.ts::Bripp', '68-target-conformance.test.ts::any target',
      '68-target-conformance.test.ts::every target kind a card declares is named by its printed text'],
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
    guards: ['14-water-a.test.ts::Lurking Slimebeast: [Battle] Ambush'],
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
      '70-playtest-round15.test.ts::is never painted as yours to spend',
      '70-playtest-round15.test.ts::the pass it painted really does go out',
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
    guards: ['70-playtest-round15.test.ts::floor still fits two cards abreast',
      '70-playtest-round15.test.ts::.zone still wraps'],
    note: 'Follow-up to id 25, fixed with it. These two are CSS-arithmetic guards and this is '
      + 'the report they are ABOUT — "their box can expand and they can be grouped '
      + 'horizontally" is a question about flex, and the other end of the wire (that the '
      + 'markup exists to be styled) is id 25\'s 132-token-separation.',
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
      '50-ui-inspect.test.ts::a sacrifice cost whose clause names no stat wears no X',
      "50-ui-inspect.test.ts::Structural Collapse's bar is the same snapshot"],
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
      // ⚠ REPOINTED 2026-08-26. The old citation was
      // '[66] the pass confirm is wired to the end-of-battle question', an
      // assert.match over the TEXT of ui/main.ts. R194 replaced it with a
      // DRIVEN test and renamed it, which broke this citation in a file the
      // change never touched — CARD-TODO #42's complaint, hit for the fourth
      // time. Measured: switching promptHtml's `if (ui.confirmPass !== null)`
      // branch off so the confirm bar STOPS RENDERING ENTIRELY leaves all four
      // old text assertions GREEN and reddens only the driven one.
      '77-playtest-round17.test.ts::[66] the Pass button asks before the pass that reaches Regroup',
      '165-token-loss-warning.test.ts::a round-2 attacker who declines no longer erases',
      '165-token-loss-warning.test.ts::a battle both players decline opens no priority window at all'],
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
      + 'warn on. '
      + '✔ CLOSED 2026-08-26 (R194). Both halves of the downgrade are answered. The gap is '
      + 'shut ENGINE-side, as CARD-TODO #55 argued it had to be: E.startRegroup now emits one '
      + 'erased event per seat naming that seat\'s own doomed tokens, before the erase loop, '
      + 'silent when nothing is lost (a line in every regroup forever would be this very '
      + 'report\'s complaint moved into the log). '
      + '⚠ THE OTHER ROUTE WAS MEASURED AND REFUSED: opening the window doDeclareAttack skips is '
      + 'NOT timing-neutral. 47,247 empty declareAttacks across 4,841 saved games are followed '
      + 'immediately by declareAttack (23,629) or doneDeploying (22,704) and never by a pass — '
      + 'the whole corpus holds only 579 passPriority actions. Every one of those declines would '
      + 'replay into "you do not have priority". Orchestrator re-counted this independently and '
      + 'got the same 47,247. A warning is not worth a rules change. '
      + '⚠ AND THE REACHABLE CASE IS WIDER THAN THIS ENTRY OR CT-55 SAID: a battle whose ROUND 1 '
      + 'is also declined opens ZERO priority windows in the entire battle phase, so the defender '
      + 'could never be warned by any mechanism at all. Both shapes are pinned. '
      + 'The second guard is replaced rather than kept — see the citation note above. '
      + '⚠ DOWNGRADED fixed -> partial on 2026-08-25 by a guard audit, and the reason is this '
      + 'entry\'s own last sentence: a report whose note admits a reachable case it does not '
      + 'cover is not fixed, and calling it fixed is how the case stops being tracked. The gap '
      + 'is CARD-TODO #55. "Cannot be closed client-side" is true and is not the same as '
      + 'cannot be closed — the missing warning is missing because the ENGINE takes a path with '
      + 'no window on it, which is an engine-side ticket, not an impossibility. '
      + '⚠ Second finding from the same audit: the second guard here is an assert.match over '
      + 'the TEXT of ui/main.ts. It pins how the code is spelled, not what the player sees, and '
      + 'would stay green if the confirm bar stopped rendering entirely. Same family as the '
      + 'layout-coupled tests that broke on a pure refactor in round 23.',
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
      '142-static-conformance.test.ts::a card printing a standing statement of fact declares a CONTINUOUS layer',
      '142-static-conformance.test.ts::a card whose whole printed text is continuous declares NOTHING that reaches the stack',
      '142-static-conformance.test.ts::every behaviour key in the pool is classified',
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
      + 'right. It also asserts the OTHER direction, so nobody "fixes" R102 into the wrong shape. '
      + 'THE STATIC THIRD OF THIS REPORT GOT ITS OWN SWEEP ON 2026-08-25 (R168, CARD-TODO '
      + '#48): this report names THREE mechanisms — "replacement effects and triggered effects '
      + 'and static effects" — and until then only the replacement one had a class guard. '
      + '142-static-conformance.test.ts is the static half, and it found Aetherflux Golem live '
      + 'in the pool on its first run. See #46.',
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
      '86-ui-block-refusal.test.ts::a sent block declaration leaves the plan standing on the board',
      '86-ui-block-refusal.test.ts::drops it only when an authoritative state says the declaration landed',
      '86-ui-block-refusal.test.ts::never reaches the wire at all',
      '86-ui-block-refusal.test.ts::the post-send verdict branch is still there',
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
      + '⚠ ONE REAL FINDING SURVIVES. It is CARD-TODO #54 as of 2026-08-25; this note used to say '
      + '"filed as a separate UI item" and a guard audit found NO SUCH ITEM — not in backlog.ts, '
      + 'not in card-todo.ts. It existed only inside this sentence, which is the precise way a '
      + 'real defect stops being work. The finding: the hand\'s `.card.playable` outline is a '
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
      + '⚠ TWO OF THOSE FIVE WERE WRONG, and both were the same error — reading a printed bracket '
      + 'as something other than the owner\'s own declaration. R157 §21 (2026-08-25) moved '
      + 'Retribution Thing; R284 (2026-09-01) moved Void Memory, which had been worse than late: '
      + 'it asked the WRONG PLAYER, so each victim picked the half while looking at their own hand '
      + 'and the card never missed. The line is kept as written because it is what this round '
      + 'concluded; the correction is the lesson. "Verified" here meant "the reasoning was '
      + 'restated", and a bracket needs a RULE, not a reading — R284 is that rule. '
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
      + '⚠ `ui/bundle.js` is a committed build artifact and was NOT rebuilt — doing so '
      + 'mid-round would have baked in another agent\'s in-flight engine state. This fix does not '
      + 'reach a browser until `npm --prefix ui run build` runs on a settled tree.',
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
      '125-active-zone.test.ts::Aberrant Statweaver negated off the stack is ERASED, not binned',
      '125-active-zone.test.ts::a printed-Unstable card DISCARDED FROM HAND bins and TRASHES',
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
      + '⚠ Scope note (2026-08-23): this covered the leave-play path only (destroy, R65 public '
      + 'erased pile), and the reporter\'s own "unless I\'m misunderstanding what an ACTIVE ZONE '
      + 'is" was left standing, because nothing sourced said which zones were active. '
      + 'CLOSED BY R145 (2026-08-25), in both directions. The owner supplied the missing '
      + 'definition — "in play and the stack are active zones" — so (a) the STACK was a second '
      + 'gap of the same shape and Statweaver negated off it binned; that is fixed via '
      + 'E.itemIsUnstable, and (b) the open question here is ANSWERED, in the direction of NO: '
      + 'the hand is not an active zone, so a printed-Unstable card discarded from hand is '
      + 'binned and TRASHED like any other card, and so is one milled from the deck or binned '
      + 'from the cache. Both directions are pinned in 125-active-zone.test.ts. See '
      + 'docs/digital-rules.md § R145.',
  },
  {
    id: 90, room: 'XVUR', date: '2026-08-23',
    report: 'Hooba bot made 2 robots I think',
    status: 'by-design',
    guards: ['27-metal-b.test.ts::Hooba-Bot + Automaton of Abundance: the reported two robots, by design',
      '27-metal-b.test.ts::Hooba-Bot: one attack trigger makes exactly ONE Robot'],
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
    status: 'fixed',
    guards: [
      '128-ui-pace.test.ts::a BURST of updates surfaces ONE per PACE_MS, on an injected clock',
      '128-ui-pace.test.ts::a DRIP is throttled too — the queue emptying is not a reset',
      '128-ui-pace.test.ts::skip flushes the whole queue to the live state in ONE step',
      '128-ui-pace.test.ts::a decision of MINE is never held',
    ],
    note:
      'PACING, not correctness. With auto-yield on and nothing to respond to, the whole stack '
      + 'resolves in one frame and the log scrolls past faster than a human can read, so a player '
      + 'cannot tell WHY the board changed. The owner proposes a ceiling of ~1 item/second. '
      + 'Presentation-only: the engine is pure and must NOT learn about wall-clock time — the '
      + 'throttle belongs in the client\'s render/animation layer, replaying the event list it '
      + 'already receives. Carried as CT-28.'
      + ' FIXED by R150 (2026-08-25): ui/pace.ts, a 1/sec ceiling with the clock injected and '
      + 'PACE_MS as the one named knob. The ENGINE never learns about wall-clock time — a delay '
      + 'in the reducer would make replay-room.ts and the whole suite time-dependent. Skip chip '
      + 'and S key, and an un-holdable arrival FLUSHES the backlog ahead of itself, so the '
      + 'client is never behind the server when it is your turn to act.',
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
      + 'negated effect\'s controller, with no handover step at all. Carried as CT-29. '
      + '\u26a0 REPLAY: SMVJ no longer replays cleanly from action 121 (209 of 375 actions '
      + 'rejected) and that is THIS FIX working, not a regression \u2014 bisected to R143. The '
      + 'log holds an answer to a trigger-ordering question (Flourishing Flora\'s trigger vs '
      + 'the handover) that no longer exists, so everything after it shifts. Same shape as '
      + 'ANBB after R137. R144 added ZERO further drift (209 before and after both halves).',
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
    status: 'fixed',
    guards: [
      '127-token-x-and-dormant.test.ts::dormant resources are muted in battle and deployment, normal in planning',
      '127-token-x-and-dormant.test.ts::only DORMANT is muted — an expended resource is not',
      '127-token-x-and-dormant.test.ts::the spendable/dormant split is the ENGINE',
    ],
    note:
      'Client presentation. A dormant resource is not spendable until it activates, but it is '
      + 'drawn similarly enough to an active one to be misread mid-battle, when a player is '
      + 'counting available mana under time pressure. The owner\'s own proposal is phase-scoped: '
      + 'de-emphasise or hide dormant resources during battle/deployment, show them normally in '
      + 'planning (which is when you act on them). Carried as CT-31.'
      + ' FIXED by R151 (2026-08-25): ui/resources.ts::resourceRow is a DOM-free view model '
      + 'carrying a discrete `emphasis` per resource, so the muting is asserted rather than '
      + 'being an untestable CSS colour. spendable/active are READ FROM the engine (E.openMana, '
      + 'E.affinity) rather than re-derived in the UI, so a rules change cannot desync them — '
      + 'R132 moved exactly this surface a day earlier.',
  },
  {
    id: 98, room: 'SMVJ', date: '2026-08-24',
    report: 'Rashi\'s start of combat (doing all her Wraith triggers) doesn\'t need to take away '
      + 'from what I\'m doing in Deployment',
    status: 'fixed',
    guards: [
      'server/test-concurrency.ts::seat 0 is still offered actions while seat 1 is mid-question — the whole of #98',
      'server/test-concurrency.ts::deploy action is DEFERRED, not refused',
      'server/test-concurrency.ts::seat 1 is mid-question in the authoritative state',
    ],
    note:
      'Concurrency/flow. Deployment is SIMULTANEOUS (both players act, moves revealed when both '
      + 'are done — R-deployment), so one player resolving a pile of start-of-combat triggers '
      + 'should not seize the other player\'s screen or block their input. Related to #101, which '
      + 'is the rules-side proposal for the same pile of Wraith triggers. Carried as CT-32.'
      + ' FIXED by R150 (2026-08-25), and the diagnosis is the part worth keeping: this was NOT '
      + 'the presentation layer. apply.ts refuses every non-decide action from EITHER seat while '
      + 'a decision is pending, and legalActions hands the non-owning seat an empty list, so the '
      + '"Waiting for X…" bar was drawing an empty legal list faithfully — un-gating the UI '
      + 'alone would have produced a screen full of refusals. Only reachable since R144 put '
      + 'start-of-deployment triggers on the stack. Fixed in the server (legalForSeat + a '
      + 'deferral queue) because the engine gate is right in battle; that leaves hotseat still '
      + 'freezing, carried as CT-44.',
  },
  {
    id: 99, room: 'SMVJ', date: '2026-08-24',
    report: 'Tokens should have their X value in their text box modified to say the actual number, '
      + 'rather than X. So a Poison 5 would say "Put 5 -1/-1 counters on target unit"',
    status: 'fixed',
    guards: [
      '127-token-x-and-dormant.test.ts::a Poison created with X=5 says',
      '127-token-x-and-dormant.test.ts::sweep: EVERY token card with an X placeholder renders a number',
      '127-token-x-and-dormant.test.ts::a Robot reads its X off its COUNTERS',
      '127-token-x-and-dormant.test.ts::are STAT notation and never substituted',
    ],
    note:
      'A token created with X=5 still prints the GENERIC text with a literal "X", so the player '
      + 'has to remember what it was made for. The number is known at creation. NOT the same class '
      + 'as the markup bugs (R134/R141/R142): those are a formatter failing to consume a token, '
      + 'this is a live VALUE that should be substituted into the printed text for that instance. '
      + 'Needs a decision on where the substitution lives — on the token entity at creation, or in '
      + 'the text box reading the entity\'s stored X. Carried as CT-33.'
      + ' FIXED by R151 (2026-08-25). The decision the note asked for went to RENDER TIME, and '
      + 'Robot is why: "if the number of counters changes, so does the X value", so a Robot 3 '
      + 'that gains a counter IS a Robot 4 and an X stamped at creation starts lying at once. X '
      + 'is read from Entity.x for a spell token and from live counters for a unit token. '
      + 'Reminder text is carved out (Robot would read "so does the 3 value"). Censused first '
      + 'per R141: the pool spells it X, X/X, +X/+X, -X/-X and [x] (a cost PIP) — only bare X '
      + 'moves, and 4 of the 6 token cards carry one.',
  },
  {
    id: 100, room: 'SMVJ', date: '2026-08-24',
    report: 'The damage distribution UI is terrible and confusing. Better would to have a ticker '
      + 'counter thing on each unit that you click up/down and they always are forced to sum to '
      + 'the amount of damage you have.',
    status: 'fixed',
    guards: [
      '126-assign-split.test.ts::the total is forced',
      '126-assign-split.test.ts::the ticker clamps to what THIS victim can take',
      '126-assign-split.test.ts::jumps to everything-left and does NOT submit',
      '126-assign-split.test.ts::NEGATIVE CONTROL',
    ],
    note:
      'The UI for R120, the ELECTIVE combat damage split (built because "never decide for the '
      + 'player"). The mechanic is right; the affordance is not. The owner names the fix exactly: '
      + 'a per-unit up/down stepper, constrained to sum to the damage available. NOTE the shape is '
      + 'the one R139/BL-25 just built for counter removal (stepper + max + "All", clamped, does '
      + 'not auto-submit) — reuse that lifted, tested logic in ui/inspect.ts rather than writing a '
      + 'second stepper. Carried as CT-34.'
      + ' FIXED by R149 (2026-08-25) — but the report\'s premise was wrong in a way worth '
      + 'keeping: E.electionWalk asks ONE victim at a time, front to back, each decision a '
      + 'single scalar with the last living victim auto-filled. No decision carries N victims, '
      + 'so the sum is forced upstream of any client and an over-allocation was never '
      + 'representable. What was missing was the ARITHMETIC — a flat wall of "1 to X / 2 to X" '
      + 'with no running total and no sign another question was coming. Built on the SHARED '
      + 'quantityStepper factored out of BL-25\'s counterStepper, not a second one.',
  },
  {
    id: 101, room: 'SMVJ', date: '2026-08-24',
    report: 'Deployment should use the stack. All Wraith triggers should go onto the stack '
      + 'simultaneously and be allowed to target the same unit, even exceeding its defense (the '
      + 'final triggers would just fizzle).',
    status: 'fixed',
    guards: [
      '37-attrs-wight.test.ts::R144(a): every start-of-deployment trigger is on the stack before any of them resolves',
      '37-attrs-wight.test.ts::R144(b): three Wraith triggers may all aim at one 1/1, and the surplus fizzles',
      '37-attrs-wight.test.ts::does not pre-validate against a limit an earlier trigger will consume',
      '37-attrs-wight.test.ts::a subject is not a target',
      '37-attrs-wight.test.ts::R12 — a shared deployment stack does not let a Wraith reach across regions',
      '67-resolving-and-stack-viruses.test.ts::a NESTED resolution that suspends does not strand the outer marker',
    ],
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
  {
    id: 103, room: 'GYSR', date: '2026-08-25',
    report: 'Cached cards (from glimpse or prophecy) that can be played should show up on the '
      + 'RIGHT side of the hand area — it feels like they are in your hand (which they should), '
      + 'is clearly different from cards in hand (on the left), and they are harder to forget. '
      + 'They should stay in the cache area too; this is just an easier way to see and play them',
    status: 'fixed',
    guards: [
      '155-hand-affordances.test.ts::a playable cached card is drawn at the right of the hand AND left in the cache row',
      '155-hand-affordances.test.ts::clicking the copy beside the hand plays the cached card',
      '155-hand-affordances.test.ts::a cached card that is NOT playable now stays in the cache row and out of the hand',
    ],
    note:
      'FIXED SAME DAY by R183 (CT-63), and additively exactly as asked — regionCacheHtml and the '
      + 'cache dialog are untouched, and only the cards that are PLAYABLE RIGHT NOW appear beside '
      + 'the hand. The group carries the EXPIRY chip rather than the price, because the loss he '
      + 'described ("harder to just forget about") is a glimpse stamp dying silently at end of '
      + 'turn. Both surfaces route through the one handleCacheClick, so they can never come to '
      + 'play different cards. '
      + '⚠ AND IT TURNED UP WHY THIS WAS PROBABLY REPORTED. The cache row\'s THUMBS carry no '
      + 'click handler at all — the click is caught one level up by the panel, which opens the '
      + 'dialog. So reaching a cached card was a two-click path whose first click looked like it '
      + 'should have been the last, which reads as "easy to forget" from the inside. Filed as '
      + 'CT-64, with the trade-off named rather than assumed: making a thumb play directly costs '
      + 'the one-click route to INSPECTING a cached card, and the cache is public under R41 '
      + 'precisely so both players can look. '
      + 'ORIGINALLY: arrived mid-session on 2026-08-25 (12:15 UTC), while round 26 was running — the round '
      + 'had opened by confirming issues.jsonl was byte-identical to the 103-row snapshot, and '
      + 'it stopped being so three hours later. Caught only because the end-of-round replay '
      + 'check re-runs `md5sum issues.jsonl` on the server rather than trusting the opening '
      + 'check. Refresh the snapshot at the END of a round as well as the start. '
      + '⚠ GYSR WAS STILL LIVE when this was ledgered (game file and server clock both read '
      + '12:20 UTC), so the log is not final and must not be used for forensics yet — a '
      + 'truncated copy does not error, it reassures. '
      + 'The owner calls it a UX improvement idea rather than a bug, and it is explicitly '
      + 'ADDITIVE ("they should also be in the cache area as they are now"), so it is not a '
      + 'defect in the cache UI — it is a second, closer surface for the same cards. Carried as '
      + 'CT-63. It belongs with BL-16/BL-21 (the deployment-reveal readability items) rather '
      + 'than with the card work, and nothing in it outranks card-todo.',
  },
  {
    id: 104, room: 'GYSR', date: '2026-08-25',
    report: 'Glimpse is supposed to REVEAL the cards, but opponents cannot see them right now',
    status: 'fixed',
    guards: ['217-reveal-rows.test.ts::§5a the OPPONENT glimpse becomes a surface; your own does not',
      '217-reveal-rows.test.ts::§5f a MOMENT: non-modal, self-expiring, and gone on a resync',
      '159-glimpse-reveal-visibility.test.ts::the Glimpse 5 reveal is public to the opponent',
      '159-glimpse-reveal-visibility.test.ts::its reveal is inside the hidden deployment segment, and escapes it',
      '159-glimpse-reveal-visibility.test.ts::the Glimpse 1 reveal is public to the opponent'],
    note:
      '✔ CLOSED 2026-08-29 (round 30, CT-78). The DELIVERY was never broken — see below, it was '
      + 'measured in a real browser — and the complaint was still right: the glimpser got N card '
      + 'SCANS in a modal and the opponent got one line of prose in an 80-line log. Both were "the '
      + 'reveal" and only one looked like one. The non-glimpsing seat now gets a card-sized surface '
      + 'of its own. ⚠ It is a MOMENT, not state: E.glimpse writes no structured record, so a '
      + 'reconnect during the seconds it is up still leaves only the log line — a named residual, '
      + 'not a closed one. THE ORIGINAL INVESTIGATION, which is why this took two rounds: '
      + '⚠⚠ THE REPORTED MOMENT IS NOT BROKEN, AND THAT WAS ESTABLISHED BY LOOKING RATHER THAN BY '
      + 'READING (2026-08-26, R188). GYSR replays 306/306 FAITHFUL. Its three glimpses are at '
      + 'actions [54], [107] and [136] — all Maw of Despair / Grox, all glimpse 2, all '
      + 'phase=battle with segmentKey null before and after. The report\'s "action 110" is [107], '
      + 'and at [107] the SEAT-1 payload carries `glimpsed` with '
      + 'data.cards = ["Muck Rummager","Palewing"], UNREDACTED. A truncated GYSR was then '
      + 'restored into a real server and opened in HEADLESS CHROME AS SEAT 1: the opponent\'s log '
      + 'gained "Ben glimpses 2: Muck Rummager, Palewing" with both names as inspectable '
      + '.logcard spans, and the public cache panel appeared. A fresh reload re-links both, so '
      + 'the resync path is not lossy either. '
      + 'THE ONE PLACE A REVEAL GENUINELY IS INVISIBLE is a glimpse inside a HIDDEN SIMULTANEOUS '
      + 'SEGMENT, where rooms.ts parks the opponent\'s copy in heldEvents until the barrier. '
      + 'Proven end to end with Oracle of Foretelling (timing: deploy, so ALWAYS inside the '
      + 'segment): mid-segment the opponent\'s visible log is empty; at the barrier they get the '
      + 'whole line at once. Glook, Lilbot, Visionary Construct, Maw of Despair and Seer of Empty '
      + 'Spaces reach the same state; the other four printed-reveal cards are {Battle} and are '
      + 'never held. '
      + '⚠ THAT IS A RULES QUESTION AND WAS DELIBERATELY NOT ANSWERED IN CODE — see CT-77. '
      + '⚠ WHAT THE OWNER PROBABLY MEANT IS PRESENTATIONAL AND IS STILL OPEN (CT-78): the '
      + 'glimpser gets N full card SCANS in a decision modal; the opponent gets one line of prose '
      + 'in an 80-line log. Both are "the reveal" and only one looks like one. That is why this '
      + 'sits `partial` and not `by-design`. '
      + 'SUPERSEDED TRIAGE, kept because it was wrong in an instructive way — every candidate '
      + 'below was checked and only the segment one survived, for a card family the note never '
      + 'named: '
      + 'The printed reminder on every Glimpse card says REVEAL — "Reveal the top five cards of '
      + 'the deck and cache one" — and the engine agrees with itself in a comment: glimpse() '
      + 'says "The reveal is genuinely public — the cache is public information (R41)" and emits '
      + 'a `glimpsed` event carrying `cards: revealed`. '
      + '⚠ SO THE CAUSE IS NOT OBVIOUS AND MUST NOT BE GUESSED. server/view.ts::redactEvent '
      + 'touches only `recycle`, and visibleToSeat hides only `privateTo` events, so nothing in '
      + 'the redaction layer removes it. Candidate causes, all unverified: the glimpse happening '
      + 'inside a HIDDEN SIMULTANEOUS SEGMENT, where heldEvents holds the opponent\'s copy until '
      + 'the barrier (his "right now" may be exactly that); or the client not rendering the names '
      + 'in the opponent\'s log. GYSR is finished (last written 12:50 UTC, clock 14:15) so it '
      + 'REPLAYS and the moment can be reconstructed — do that rather than reason from the code. '
      + 'Carried as CT-71. '
      + '⚠ UPDATE 2026-08-28 (round 29): THE RULES HALF IS NOW ANSWERED AND SHIPPED. The owner '
      + 'ruled that a reveal inside a hidden simultaneous step is public IMMEDIATELY (R222), and '
      + 'R235 implemented it — the hold is per-event now, and the `glimpsed` event escapes it '
      + 'while everything else in the same action stays held. So the one case that WAS genuinely '
      + 'invisible is no longer invisible. ⚠ AND THE FIX THIS NOTE IMPLIES WOULD HAVE BEEN WRONG: '
      + '`heldEvents` is not the only thing withholding the reveal — mid-segment, main.ts sends '
      + 'the actor\'s events only to the actor, and the hold governs only the resync channel and '
      + 'the barrier flush. A rooms.ts-only exemption would have delivered the reveal ONLY on '
      + 'reconnect and dropped it from the barrier too, i.e. revealed-late would have become '
      + 'revealed-never. THIS ENTRY STAYS `partial` because CT-78 stays open: the reveal reaches '
      + 'the opponent and always did, and what is still missing is that it does not READ as a '
      + 'reveal.',
  },
  {
    id: 105, room: 'GYSR', date: '2026-08-25',
    report: 'All triggers from death (and after combat) should go onto the stack VISUALLY at the '
      + 'same time. The Geode\'s trigger did, but not visually',
    status: 'fixed',
    guards: ['160-simultaneous-trigger-beats.test.ts::R189 THE REPORT: a trigger sweep puts every trigger on the strip in ONE frame',
      '160-simultaneous-trigger-beats.test.ts::R189 a play and the triggers it caused are TWO beats, and the second is three cards at once',
      '160-simultaneous-trigger-beats.test.ts::a second batch queues behind the first',
      '160-simultaneous-trigger-beats.test.ts::R189 flashBatches cuts a real batch where the RULES cut it'],
    note:
      '✔ FIXED 2026-08-26 (R189) in ui/flash.ts alone — no engine change, so nothing resolves at '
      + 'a different time. queueFlashes stamped EVERY item of an arriving batch STAGGER_MS after '
      + 'the one before it, unconditionally, so a death sweep (several triggers queued together '
      + 'and drained back to back) was one thing drawn as several. It now spaces GROUPS, cut '
      + 'where the rules cut them: a trigger leaves the queue by stackPushed or stackFlash, so '
      + 'everything queued before the drain is simultaneous and anything queued after it has '
      + 'started is the next generation. POSITIVE EVIDENCE ONLY — a flash is grouped only when '
      + 'its own `triggered` marker is in the same batch, so plays, units and activations are '
      + 'never grouped and a marker-less batch behaves exactly as before. That gate is '
      + 'load-bearing, not decoration: removing it reddens three existing docs/11 guards in '
      + '56-ui-flash, whose synthetic helper builds markerless triggered items. '
      + '⚠ THE REPORTED ACTION NUMBER IS WRONG AND SO WAS THIS NOTE\'S PREMISE. Action 140 is a '
      + 'passPriority that ends the battle round and contains no triggered and no stackFlash at '
      + 'all; the moment is [135] (died/triggered x3 — Maw of Despair, Sacrifice Dude, Geode). '
      + 'AND HIS OWN CASE HAS NO PACING FIX: each of those three stopped on a DECISION of his, so '
      + 'the three flashes arrived in three separate server round-trips with his answers in '
      + 'between, and no honest pacing rule merges three round-trips. R189 deliberately gives '
      + 'those three a beat each and says so. The general form IS real and the corpus supplied '
      + 'it one game over — SMVJ [141], four death triggers in ONE action and ONE update, drawn '
      + '280ms apart. SMVJ [94] is the control in the other direction: a genuine cascade that '
      + 'must stay sequential. '
      + '⚠ This note used to end "Carried as CT-71" — it is CT-72; CT-71 is report #104. '
      + 'ORIGINAL TRIAGE, still correct as far as it went: '
      + 'Note the precision of the complaint: the trigger DID reach the stack — he says so — and '
      + 'the objection is that the SCREEN staged them one after another. So this is the pacing '
      + 'layer (ui/flash.ts beats, R150\'s holdable), not the rules layer, and the fix must not '
      + 'change when anything actually resolves. '
      + 'Same family as report #53 ("damage and all effects happened instantly"), whose guards '
      + 'R173 had to widen because they proved the stager could stage without proving the client '
      + 'fed it. Carried as CT-71.',
  },
  {
    id: 106, room: 'GYSR', date: '2026-08-25',
    report: 'The reminder text for Glimpsing is wrong — it does not mention that the other cards '
      + 'not chosen are recycled',
    status: 'fixed',
    guards: ['161-glimpse-reminders.test.ts::the Glimpse glossary reminder names the recycle, and the full rule survives beside it',
      // ⚠ cited by its STATIC tail: the title is a template literal (`${name}'s inspector
      // panel …`), so no static substring carries the card name — the same trap that makes
      // server/suite.test.ts titles uncitable.
      '161-glimpse-reminders.test.ts::s inspector panel offers the corrected Glimpse reminder',
      '161-glimpse-reminders.test.ts::the Recycle reminder no longer denies what the Glimpse one now says'],
    note:
      '⚠⚠ THE ORIGINAL TRIAGE OF THIS REPORT WAS WRONG IN EVERY PARTICULAR, AND IT WAS WRONG THE '
      + 'SAME WAY REPORT #15 WAS: a coherent story, a real mechanism and a genuine owner quote, '
      + 'pointed at the wrong artifact. This note used to say "CONFIRMED against printed.json … '
      + 'and stops", and that claim was never checked. IT IS FALSE. Verified 2026-08-26 against '
      + 'BOTH printed.json and AlgomancyCards-OracleText.json: Oracle of Foretelling, Premonition, '
      + 'Celestial Purge and Dematerialize ALL end their reminder with "Recycle the rest." '
      + 'Foretell is Glimpse **1** — one card revealed, one cached, no "rest" — and correctly says '
      + 'nothing, which is R45\'s own N=1 reading. So there was no upstream data error, no message '
      + 'to Caleb needed for this, and R45\'s doc comment was never a misquote (it quotes those '
      + 'four exactly; a ✔ RE-VERIFIED note now records the check so a third triage does not '
      + 'repeat it). '
      + 'THE REAL DEFECT WAS IN THIS REPO, in ui/glossary.ts. The card inspector prints a reminder '
      + 'row for every keyword a card mentions (ui/main.ts::glossaryHits), and THAT row is "the '
      + 'reminder text for Glimpsing" the owner actually read. It still described R45 AS IT READ '
      + 'BEFORE THE 2026-08-19 CORRECTION — "cache them", all N, recycle never mentioned. On those '
      + 'four cards the panel CONTRADICTED ITSELF: printed box said "cache one … Recycle the '
      + 'rest", reminder underneath said the opposite. Fixed as R190, reworded off E.glimpse '
      + 'rather than off prose. '
      + 'A SECOND DEFECT IN THE SAME PANEL, found and fixed with it: the `Recycle` row (which '
      + 'fires on all four of these cards, because their text says the word) read "the card is '
      + 'gone for the rest of the game" — the one thing recycling never does. doRecycle calls '
      + 'e.recycleToBottom on the line before it pushes the dormant resource. '
      + 'GENERALISE: this is the SECOND time a report about REMINDER TEXT was routed to the '
      + 'printed data when the glossary was the culprit. Nothing ties a glossary entry to the '
      + 'ruling it paraphrases, so an R-number correction can land in engine.ts, apply.ts, '
      + 'digital-rules.md and a test and leave ui/glossary.ts describing the superseded rule '
      + 'indefinitely — R45\'s correction did exactly that for seven days. That is CT-76.',
  },
  // ── round 29 (2026-08-28): nine reports the repo had never seen ─────────
  // The snapshot was 107 lines and the server had 116. 70-playtest-ledger
  // named #107 the moment the snapshot was refreshed, which is the whole
  // point of it — before R173 the count was hardcoded and eleven reports
  // arrived without a single test noticing.
  {
    id: 107, room: 'SBCM', date: '2026-08-27',
    report:
      'Spawning something in formation does now work, but I should be able to click WHERE '
      + 'rather than using a button in the top bar. Clicking on the battlefield is better UX',
    status: 'fixed',
    guards: [
      '215-formation-click.test.ts::§3a the battlefield is no longer inert — the drop targets are really on screen',
      '215-formation-click.test.ts::§3b clicking a spot on the line sends the decision, keyed by OPTION INDEX',
      '215-formation-click.test.ts::§3c the click really places the unit where the spot said it would',
      '215-formation-click.test.ts::§3d the BLOCKING question draws on the blocking half, at the right column',
    ],
    note:
      '✔ FIXED 2026-08-29 (round 30), in two halves a round apart. Note the first four words of '
      + 'the report: the RULES half of BL-24 was already fixed and he says so, so this was purely '
      + 'the placement AFFORDANCE and was never routed to the engine. Round 29 gave every '
      + '`formationSlot` option a display-only `spot` — without it the client held label prose and '
      + 'nothing else and could not draw a drop target even in principle. Round 30 drew them: '
      + '`ui/fslot.ts` maps a spot to a place on the battle panel and `battleHtml` paints a '
      + '`data-act="fslot"` target there. ⚠ The top-bar buttons still answer the same question and '
      + 'the answer is still the option INDEX — CT-94\'s `closed` has the two traps (the compacted '
      + 'blocking grid, and deriving whose grid it is without `Decision.seat`).',
  },
  {
    id: 108, room: 'SBCM', date: '2026-08-27',
    report:
      'Borrower of Forms should also copy/borrow the card ART of the thing it is copying. Just '
      + 'the little note at the bottom (and the green power/defense) is great to mark it as a '
      + 'copy',
    status: 'fixed',
    guards: [
      '198-copy-art.test.ts::R229 §1: a Borrower of Forms is DRAWN as the card it borrowed',
      '198-copy-art.test.ts::R229 §3: an Ancient One keeps its OWN art — a projection is not an identity',
    ],
    note:
      '✔ FIXED 2026-08-28 (round 29) as R229. The board, the focus rail and the right-click '
      + 'menu now all read the PROJECTED face. The cause was that main.ts fed `Entity.card` to '
      + '`art()`, while R118 deliberately never rewrites `Entity.card` — the borrowed face lives '
      + 'in `E.nameOf`, which the card TEXT already used. That is precisely why the name updated '
      + 'and the art did not. The class is Borrower of Forms and Apex Prime, derived twice '
      + '(copy-primitive call sites AND printed text) with both passes agreeing; the other 9 '
      + 'cards that say "copy" make token, spell or trigger copies, which are new entities and '
      + 'were already right. ⚠ YOUR SECOND SENTENCE TURNED OUT TO BE WRONG, and it is worth '
      + 'knowing why. You wrote that the bottom note and the green power/defense are "great to '
      + 'mark it as a copy" — they are, until the art follows the face. Borrower prints 2/2 and '
      + 'Sporebloom Siren IS 2/2, so the green plate never renders and the copy became '
      + 'indistinguishable on the board. There is now a ⧉ chip naming the cardboard whenever the '
      + 'face differs from the card. It is one line and it comes out in one line if you do not '
      + 'like it.',
  },
  {
    id: 109, room: 'SBCM', date: '2026-08-27',
    report:
      'We should probably have a Bluff Haste toggle that stops in your haste step as if you did '
      + 'have a thing with haste, but choose not to play it',
    status: 'fixed',
    guards: ['200-haste-step-is-unconditional.test.ts::R228 §5: a bluff is a real move — you may sit in the step holding nothing',
      '200-haste-step-is-unconditional.test.ts::R228 §1: seat 1 is served the same view whatever seat 0 is holding'],
    note:
      '✔ FIXED 2026-08-28 (round 29) as R228 — and you got it as a RULING rather than a toggle, '
      + 'which is better than what you asked for. Offered the choice, you picked "always offer '
      + 'the step + Bluff Haste" over "open the step exactly when you can act", so the haste step '
      + 'is now UNCONDITIONAL. `canHaste` is deleted outright. THAT MEANS THERE IS NOTHING TO '
      + 'TOGGLE: an always-open step IS a permanent bluff. You sit in it every turn whether you '
      + 'hold a haste card or not, so stopping there says nothing about your hand. ⚠ AND THE '
      + 'THING THAT MADE THIS THE RIGHT ANSWER WAS NOT OBVIOUS FROM YOUR REPORT OR OUR TICKET — '
      + 'BOTH HAD IT BACKWARDS. We thought fixing the step would CREATE a tell. It already was '
      + 'one: the server serves `hasteDone` live and public by design, and the client paints it '
      + '`ready ✓` versus `…`, so your opponent could already read whether you had finished the '
      + 'step while your hand stayed hidden. Always-open REMOVES that channel rather than '
      + 'sharpening it. A physical table has no such array; the client invented it as an '
      + 'optimisation. ⚠ TWO KNOCK-ON EFFECTS WORTH KNOWING, because you will notice both: the '
      + 'haste step now opens EVERY turn, so there is one more window to pass through — and the '
      + 'Practice demo button on the home screen had gone dead as a side effect (a blank page), '
      + 'which was caught and fixed in the same round.',
  },
  {
    id: 110, room: 'SBCM', date: '2026-08-27',
    report:
      'It is weirdly difficult to get the hover to work on units and show their text. I often '
      + 'have to move my mouse several times to get it to show up',
    status: 'fixed',
    guards: [
      '199-hover-scroll.test.ts::R230 §1: the focus rail scrolling does NOT hide the tip — this is #110',
      '199-hover-scroll.test.ts::R230 §5: test/ui-driver.ts really cancels a cleared timeout',
    ],
    note:
      '✔ FIXED 2026-08-28 (round 29) as R230, and you were more precise than the triage. The '
      + 'client was hiding your tooltip because IT scrolled: the window scroll listener could not '
      + 'tell your scroll from its own, and `scrollFocusToBottom` scrolls the preview from inside '
      + 'the same mouseover handler that had just armed the 550ms timer. Measured at 3ms apart. '
      + 'It now hides only if the scroll could have MOVED the card you are pointing at. ⚠ IT IS '
      + 'GEOMETRIC, NOT UNIVERSAL, which is why it felt random to you and read as "never works" '
      + 'to us. Measured in a real browser: 1280x720 → 0 of 4 units, 1400x900 → 2 of 4, 1600x1200 '
      + '→ 4 of 4, i.e. at a big enough window it does not happen at all. It fires exactly when '
      + 'the focus rail\'s content overflows the rail. After the fix: 4 of 4 at every size. ⚠ AND '
      + 'YOUR WORKAROUND WAS THE DIAGNOSIS: moving the mouse WITHIN a card does nothing (no new '
      + 'mouseover), but LEAVING AND COMING BACK works — which is what you were doing when you '
      + 'said you had to move the mouse several times. ⚠ THIS BUG PASSED IN THE TEST DRIVER AND '
      + 'FAILED IN EVERY BROWSER, the second instance of the CT-75 family. The driver no-opped '
      + 'clearTimeout, so the cancelled timer looked fine. That half is fixed; the rest of the '
      + 'driver\'s blindness is CT-105.',
  },
  {
    id: 111, room: 'FTUW', date: '2026-08-27',
    report:
      'Hooba Lin should not have made a token here since it does not have a formation',
    status: 'fixed',
    guards: ['108-formation-class.test.ts::R225 Hooba-Lin: killed under its own attack trigger',
      '108-formation-class.test.ts::R225 Hooba-Lin: alive but out of the formation (R172)',
      '108-formation-class.test.ts::R225 conformance: EVERY card call site of placeInFormation names its source ENTITY',
      '108-formation-class.test.ts::R225 the primitive itself: placeInFormation given a sourceId that is in NO formation refuses'],
    note:
      '✔ FIXED 2026-08-28 (round 29) as R225, and he was right about a class rather than a '
      + 'card. THE CAUSE: `E.placeInFormation` was never told WHICH ENTITY "my" refers to. '
      + '`opts.source` was a display STRING, and the slots came from '
      + '`formationSlots(ctx.controller)` — the SEAT\'s grid. So a source that was dead, or alive '
      + 'but no longer in a line, still placed into whatever column the seat happened to have. In '
      + 'his game the source was already IN THE BIN and spliced out of the line: FTUW replays ✓ '
      + 'FAITHFUL 240/240 and the log reads, in order, Hooba-Lin attacks → trigger to the stack → '
      + 'Fireball kills Hooba-Lin → "the formation closes up: 1 empty column(s) removed" → '
      + '"Hooba-Lin: Unit Token joins the formation (column 1, behind Awoken Tomb)". The engine '
      + 'already had the correct reading three files away — the COUNTING family reads the source '
      + '(`columnOf(self.id)`), the PLACING family read the seat. That asymmetry was the bug. '
      + 'FOUR CARDS WERE WRONG, IN TWO GRADES, and he only saw one of them: Hooba-Lin and '
      + 'Hooba-Bot had no guard at all (dead source); and under R172 mid-battle control theft ALL '
      + 'FOUR placed, because Hooba-God and Hooba-Pon guarded on IN PLAY, which is the wrong '
      + 'predicate — Pon would also have CHARGED him for the play. Hooba-Nan, Rousing Spirit and '
      + 'Riftwalker were already right. ⚠ THE RULES POSITION IS CONSISTENCY, NOT AN EXCEPTION: R1 '
      + 'makes "if I am still in formation" look like the only recheck mechanism, but R27 already '
      + 'rules this exact phrase for COUNTS ("a unit that wasn\'t attacking gets X = 0 → no '
      + 'token"). "In my formation" is a referent computed at resolution. Hooba-Nan\'s printed '
      + 'recheck turns out to be redundant reminder text, which is the evidence R27 was always '
      + 'the right reading. Two runtime conformance scans now derive the class, so a fifth card '
      + 'inherits the guard or reddens the suite. ORCHESTRATOR VERIFIED BY BREAKING: neutering '
      + 'Hooba-Lin\'s guard reddens both grade tests AND the conformance scan — the third being '
      + 'the proof the scan computes membership rather than listing it.',
  },
  {
    id: 112, room: 'DWYV', date: '2026-08-27',
    report:
      'Technically functional, but when there are multiple cards with the same name in the '
      + 'yard, only 1 card shows up in the selector — it looks like there is just 1 card in my '
      + 'bin despite there being two identical cards',
    status: 'fixed',
    guards: ['42-dark-b.test.ts::the bin menu says how many copies one row stands for'],
    note:
      '✔ ALREADY FIXED WHEN HE FILED IT — verified 2026-08-28, and the round\'s own suspicion '
      + 'about it was WRONG. This entry was triaged with a warning that commit 71b532d had '
      + 'probably fixed a DIFFERENT surface than the one he hit, which would have made it the '
      + 'same near-miss pattern as #15, #104 and #106. It did not. 71b532d hit the CORRECT '
      + 'surface. THE EVIDENCE: DWYV replays faithfully and is stamped at 7864bb8 — the commit '
      + 'IMMEDIATELY BEFORE the fix. His action 6 is the `eraseBin` variable-cost menu in the '
      + 'live decision bar, which is exactly what engine.ts:6763 + main.ts:2720 now count. Every '
      + 'picker in the client was swept: the UI has ZERO card-list dedupe anywhere, and '
      + '`eraseBin` is the single name-keyed collapse in the whole pipeline — so the class is '
      + 'closed at one site, computed rather than assumed. ⚠ THE COLLAPSE ITSELF IS CORRECT AND '
      + 'MUST STAY: R124/R131 make two identical bin copies FUNGIBLE, so picking either is the '
      + 'same pick. He was right that it LOOKS wrong and wrong that it IS wrong — the fix was to '
      + 'say how many copies a row stands for, not to split the row. THREE RESIDUALS noted and '
      + 'deliberately not fixed here: the second pick still shows no chip, bin-target `#2` labels '
      + 'never reach the screen, and `count` is unenforced.',
  },
  {
    id: 113, room: 'DFGG', date: '2026-08-27',
    report:
      'UX idea: when drafting, or choosing which 2 to put on the bottom in constructed, slide '
      + 'the hand along the bottom of the screen out of view — you can already see your hand in '
      + 'the draft/recycle area, so it is duplicated, and moving it off screen would let you '
      + 'survey the battlefield at the same time',
    status: 'fixed',
    guards: [
      '216-menu-scoping.test.ts::§4a the duplication the report describes is real, and measured',
      '216-menu-scoping.test.ts::§4b TUCKED, NOT UNMOUNTED — the flight anchor survives',
      '216-menu-scoping.test.ts::§4c the dock comes back the moment the choice ends',
    ],
    note:
      '✔ FIXED 2026-08-29 (round 30) via BL-32, having been triaged as a backlog item first. '
      + 'The dock is CLIPPED to a strip while a draft pack or the bottom-two choice is open, and '
      + '`:hover` gives it back. ⚠ Read CT-99\'s `closed` before touching it: `ui/anim.ts` drops '
      + 'any card flight whose endpoint does not measure width AND height > 0, so a dock clipped '
      + 'to ZERO is as damaging as one that is unmounted. THE ORIGINAL TRIAGE, kept because it is '
      + 'still the right reading of what he filed: not a bug — tracked as BL-32, 2026-08-28. The owner '
      + 'filed this through the bug button but called it an "UX improvement idea" in the report '
      + 'itself, so it is a QoL item, and the backlog is where QoL items live. `wontfix` here '
      + 'means "not being done as a bug report", not "declined": BL-32 carries his verbatim '
      + 'words, the measurement and the traps. THE DUPLICATION IS REAL AND WAS MEASURED rather '
      + 'than taken on trust: a draft state renders 16 `draftcard` elements and the SAME 12 hand '
      + 'cards again in `.handdock`. ⚠ TWO TRAPS RECORDED IN BL-32 so whoever picks it up does '
      + 'not lose an afternoon: `$app.innerHTML` is replaced wholesale on every paint, so a CSS '
      + 'transition can never run (an instant hide is small, a real slide is not); and '
      + '`data-animzone="hand:N"` exists only on the dock in net mode, so unmounting it BREAKS '
      + 'CARD FLIGHTS. Tuck it, do not delete it.',
  },
  {
    id: 114, room: 'FHDY', date: '2026-08-27',
    report:
      'Why did my Nectar Oracle die there? It should have been an inverted and tough 1/3. I do '
      + 'not think that tough works like that',
    status: 'by-design',
    note:
      'RETRACTED BY THE OWNER TWENTY-NINE MINUTES LATER, in #115 — that is the citation, and it '
      + 'is the strongest kind there is: the reporter withdrew it himself and stated the rule '
      + 'while doing so. Kept in the ledger rather than deleted, because the retraction is the '
      + 'ruling and a ledger that silently drops a report loses the reasoning that settled it. ✔ '
      + 'INDEPENDENTLY CONFIRMED 2026-08-28 by replay, so this is not resting on his word alone. '
      + 'FHDY replays ✓ FAITHFUL 264/264. The death is at actions 111-119, NOT the 121 in the '
      + 'report: [113] Rampart Guardian makes the Oracle {Tough}, stats [1,6], damage 0; [115] '
      + 'Seismomancy deals 3, which is less than 6, and it SURVIVES; [119] his own Reality Bender '
      + 'makes it {Inverted} and t = 2·3 − 6 = 0. ⚠ TWO THINGS HE WOULD WANT TO KNOW. (1) The 3 '
      + 'damage was never load-bearing — an UNDAMAGED Oracle given Tough then Inverted reads '
      + '[1,0] and dies on settle just the same. (2) It was HIS OWN Reality Bender that killed '
      + 'his own unit, after the OPPONENT\'s Rampart Guardian made it Tough. See #115 for the law '
      + 'as measured, which is narrower than the words he used.',
  },
  {
    id: 115, room: 'FHDY', date: '2026-08-27',
    report:
      'Ignore that last comment about tough. That is actually how tough works. So tough + '
      + 'inverted always kills the unit, since +0/+X is just -0/-X where X is its exact defense',
    status: 'by-design',
    guards: ['79-round17-layers.test.ts::the special case his wording misses — a SHRUNK unit survives',
      '79-round17-layers.test.ts::the column wipe — {Inverted} on the front unit, {Tough} on the BACK, and both die'],
    note:
      'NOT A BUG, AND MORE USEFUL THAN MOST BUGS — recorded as R226. This is the owner retracting '
      + '#114 and stating a rule while he does it, which makes it an interaction the rules '
      + 'authority has explicitly ruled on. The engine already agreed with him; what was missing '
      + 'was anything that could see it regress. Seven tests now pin it (79-round17-layers, seeds '
      + '7907-7914). ⚠ HIS WORDING IS RIGHT IN ITS DERIVATION AND TOO STRONG IN ITS QUANTIFIER, so '
      + 'the tests encode the measured law rather than the sentence. With Δ = the net layer-3 '
      + 'defense change, final defense = −2Δ; the base cancels entirely. Δ ≥ 0 dies, which is every '
      + 'ordinary board and is why "always" felt true. Δ < 0 SURVIVES at 2|Δ|: a base 1/3 with a '
      + '−1/−1 counter is a 2/2. THE THING HE COULD NOT SEE FROM THE GAME: a column shares power, '
      + 'so {Inverted} on the front unit and {Tough} on the BACK kills BOTH — a two-card column '
      + 'wipe where neither card touches the unit that dies, and the back unit does not even OWN '
      + '{Inverted}. VERIFIED BY BREAKING, TWICE, BY DIFFERENT HANDS: implementing his literal '
      + 'wording (Tough && Inverted → t = 0) reddens EXACTLY ONE test, the survival case, and '
      + 'nothing else.',
  },

  // ── YFUE, 2026-08-28 ────────────────────────────────────────────────────
  {
    id: 116, room: 'YFUE', date: '2026-08-28',
    report:
      "opponents should see the same lightly-flashing thing on the stack that indicates when a "
      + "player is choosing targets for a trigger (here, the Alluring trigger) — show me that Rashi "
      + "is choosing that",
    status: 'fixed',
    guards: [
      'server/test-pending-ask.ts::THE LEAK: the stub introduces no value this seat did not already hold',
      'server/test-pending-ask.ts::none of the asker-only values reaches the watcher',
      'server/test-pending-ask.ts::THE LEAK: the card name never reaches the other seat',
      'server/test-pending-ask.ts::no stub is published while the opponent half of the world is served frozen',
      '50-ui-inspect.test.ts::R247: the pause bar names the effect an opponent is answering, off the server stub',
    ],
    note:
      'ROUND 31. RULED AND FIXED 2026-08-29 as R247. The indicator '
      + 'exists for the seat DOING the choosing; the opponent sees a stack that simply sits there. '
      + 'Same family as #105 (simultaneous trigger beats) — the client tells you what you are doing '
      + 'and not what is being done to you. '
      + '⚠ MEASURED AGAINST A REAL {Alluring} TRIGGER, AND MOST OF THIS IS NOT FIXABLE IN THE '
      + 'CLIENT AT ALL: at the moment the question is open the opponent view holds decision null, '
      + 'stack empty, resolving null, legal empty. server/view.ts nulls the decision before it ever '
      + 'arrives, and an {Alluring} target is chosen while the trigger is being PUT ON the stack, '
      + 'so there is no stack item to flash on either screen. What shipped: the waiting bar now '
      + 'breathes, which is the "lightly flashing" ask and the difference between waiting and hung. '
      + 'What is still owed: a REDACTED DECISION STUB in server/view.ts so the bar can name the '
      + 'effect. Ruled as R247 — that a choice is pending is public, what is being chosen is not — '
      + 'and a stub that leaks the option list or the candidate targets would be worse than none. '
      + 'SHIPPED as SeatView.pendingAsk: TWO fields, the seat and an optional source that is an '
      + 'EntityId — NOT a card name — so it is a value the receiving seat already holds and the '
      + 'stub carries nothing new BY CONSTRUCTION rather than by redaction. Three derived gates: '
      + 'sourceId is set for triggered and activated items only, so a hand-cast card can never be '
      + 'named; the id is looked up in the entities AS THAT SEAT RECEIVES THEM; and the same '
      + 'frozenOpp gate R144 uses for the stack. The decision KIND is deliberately not published, '
      + 'because it narrows what is about to happen. '
      + '⚠ THE PLAN SAID "REUSE state.decision AS A REDACTED STUB" AND THAT WOULD HAVE BROKEN THE '
      + 'CLIENT: main.ts gates the waiting bar on !s.decision and renders the decision bar '
      + 'unconditionally beneath it, and hotseat has no redaction at all. It is an additive field, '
      + 'on the packInfo precedent. The guard is written as a LEAK TEST — every primitive leaf of '
      + 'the watcher view walked against the rest of that same seat view, plus the residue of the '
      + 'asker view minus the public set — not as a feature test.',
  },
  {
    id: 117, room: 'YFUE', date: '2026-08-28',
    report: 'it would be nice to have some kind of indicator when a unit is "allured", like a badge',
    status: 'fixed',
    guards: [
      '225-stack-readout.test.ts::§2a a lured unit wears a badge, and an unlured one does not',
      '225-stack-readout.test.ts::§2b the badge marks exactly the units the ENGINE would refuse to attack with',
      '225-stack-readout.test.ts::§2c the must-block half is only claimed for the round that lured it',
    ],
    note:
      'ROUND 31, unread until 2026-08-29. Allured is a state a unit is in with nothing on the unit '
      + 'that says so. Carried with #116 — both are "the board does not show a state the rules care '
      + 'about". FIXED 2026-08-29: the badge reads Entity.allured, which IS the rule — apply.ts '
      + 'refuses an attack on the bare presence of the field — and the guard asserts the badge marks '
      + 'exactly the units the ENGINE would refuse to attack with, rather than restating the rule in '
      + 'the test. The must-block half is claimed only while allured.round matches the battle round.',
  },
  {
    id: 118, room: 'YFUE', date: '2026-08-28',
    report:
      'the reminders in the Rules page and under units are too verbose and include R references, '
      + 'which are not known outside this digital client. The reminder text should match the exact '
      + 'reminder text provided by the game — Piercing is edited, for example',
    status: 'fixed',
    guards: [
      '227-reminder-text.test.ts::R248: no string a renderer can reach off a glossary row carries an R-number',
      '227-reminder-text.test.ts::R248: no module that imports the glossary touches its citation field',
      '227-reminder-text.test.ts::R248: rendering every card in the pool leaks no R-number',
      '177-glossary-conformance.test.ts::R248: a row the pool prints a reminder for SHOWS that reminder, verbatim',
      '177-glossary-conformance.test.ts::R248: every authored sentence survives onto the exported row',
      '236-browser-glossary-reach.test.ts::CT-129: an attribute a card grants from its text box gets a reminder row',
      '236-browser-glossary-reach.test.ts::CT-130: every glossary row is reachable somewhere in the card browser',
    ],
    note:
      'ROUND 31. RULED AND FIXED 2026-08-29 as R248. ⚠ NOT ABOUT PRINTED DATA — #106 established that '
      + 'the Glimpse version of this defect lived in ui/glossary.ts, which writes its own prose. '
      + 'Check there before touching printed.json. The R-references are the sharp half: they are '
      + 'internal ruling ids leaking onto a player-facing surface. '
      + '⚠ AND THE SURFACE THIS ENTRY NAMED WAS THE WRONG ONE. cardpanel.ts DOES render the '
      + 'citation field, but that is the CARD BROWSER pinned panel — not "the Rules page" and not '
      + '"under units". Both surfaces the report names are drawn by main.ts glossRow, which renders '
      + 'only the term and the text and never touched the field at all. The R-numbers the owner '
      + 'actually read were TYPED INTO THE {Haste} ROW OWN PROSE: "The step ALWAYS happens (R224)" '
      + 'and "unless you have turned on bluff haste (R236)". Fixing only the field would have '
      + 'closed the report with the exact quoted string still on screen — which is why the guard '
      + 'sweeps every string on every row and every rendered card, not one field. '
      + 'The verbosity half is resolved by SPLITTING the row rather than editing it: where the pool '
      + 'prints a reminder the player now reads that sentence verbatim, and the authored '
      + 'generalisation moves to a rule field that the rules surfaces keep. Derived from '
      + 'printed.json, so a new card with a reminder retires the edited row for free. The ten '
      + 'attributes with NO printed reminder anywhere still show their full authored rule, which is '
      + 'the only statement of those rules the repo has. '
      + 'VERIFIED BY BREAKING BY THE ORCHESTRATOR against the HISTORICAL strings: putting "(R224)" '
      + 'back into the Haste prose reddens the sweep by name, and restoring the citation render on '
      + 'the panel reddens two more. '
      + '⚠ REOPENED AS PARTIAL, ROUND 32. The verbosity and R-number halves ARE fixed and the '
      + 'guards above hold them. What is NOT done is the rest of the same owner message: his Q7 '
      + 'answer went on to say "Not all cards are done properly anyway" and gave two examples — '
      + 'Brough showing an [Augment] Everything is balanced clause with no {Balanced} rules text '
      + 'attached, and "Rot cards also do not have rules text yet". Round 31 built R248 and R252 '
      + 'from the FIRST paragraph of that answer and left both of these on the floor; nothing in '
      + 'any ledger captured them until the round-32 audit went looking. They are CT-129 (the card '
      + 'browser attaches glossary rows off the TYPE LINE only, so twelve cards that grant an '
      + 'attribute from their text box show no rules text for it — and 141 term pairs and ten '
      + 'whole glossary rows are never drawn in the browser at all) and CT-130 (the {Rot} row is '
      + 'shown by the in-game inspector on 15 of 15 cards and by the browser on 0 of 15). '
      + 'This is the repo signature failure in its usual shape: part of a complaint fixed, marked '
      + 'closed, and the rest of the same sentence lost. '
      + '✅ BOTH RECOVERED HALVES CLOSED THE SAME DAY as R257 — one line in cardpanel.ts '
      + 'glossaryFor, unioning the text scan onto the type-line filter. Brough now shows its '
      + '{Balanced} row, {Rot} went from 0 of 16 browser rows to 16 of 16, and the number of '
      + 'glossary rows unreachable anywhere in the card browser went from TEN to ZERO. The status '
      + 'returns to fixed with CT-129 and CT-130 closed alongside CT-111. '
      + '⚠ FOOTNOTE FOR WHOEVER READS THIS NEXT: marking this partial is what exposed R260 — the '
      + 'cross-ledger guard folded partial in with live, so the only way to stay green was to call '
      + 'the whole report fixed and lose the open half, which is how these two got lost in the '
      + 'first place. The guard was fixed before the work was done, and then convicted the '
      + 'orchestrator for leaving this row partial after both halves closed.',
  },
  {
    id: 119, room: 'YFUE', date: '2026-08-28',
    report:
      'I should be able to use Cosmic Reversal on my unit before the effect of the Eminence unit '
      + 'triggers',
    status: 'fixed',
    guards: [
      '229-cosmic-and-control.test.ts::R250: it recalls the CASTER own attacking spell unit — the room YFUE case',
      '229-cosmic-and-control.test.ts::R250: Cosmic Reversal is offered with an EMPTY stack — there is no spell-effect requirement',
      '229-cosmic-and-control.test.ts::R250: a trigger fired OUTSIDE the damage step reaches the stack and IS respondable',
      '239-damage-triggers-after-combat.test.ts::R261: the other seat holds priority over a combat-damage trigger and can actually respond to it',
      '239-damage-triggers-after-combat.test.ts::R261: a combat-damage trigger is announced INSIDE the damage step and pushed to the stack AFTER it',
      '239-damage-triggers-after-combat.test.ts::R261 + R295 THE SWEEP: over every unit in the pool that triggers on combat damage, nothing resolves inside a SUB-STEP',
    ],
    note:
      'ROUND 33, CLOSED 2026-08-30 AS R261 — SHE WAS RIGHT, AND IT TOOK OVERRULING PART OF R3. '
      + 'The round-31 note below said this could not be built without reopening R3/R117/R157 §5, '
      + 'and put it to the owner instead of guessing. He answered round-32 Q1: "The ruling is '
      + 'correct, but WHERE the trigger goes is wrong ... all triggers that are caused by damage '
      + 'get moved to After combat, along with anything that triggers then", with an official RAQ '
      + 'showing damage triggers and after-combat triggers interleaved on ONE stack, each player '
      + 'ordering their own, initiative seat first. So the window she wanted DOES exist — just '
      + 'after combat rather than mid-damage-step. R3 survives narrowed: no priority window '
      + 'between damage SUB-STEPS is still true; only the reading that a TRIGGER resolves inside '
      + 'the damage step is gone. '
      + '⚠ THE R3 GUARD THAT USED TO BE ON THIS ROW IS DELIBERATELY NOT LISTED ANY MORE. It read '
      + '"the SAME trigger fired by COMBAT DAMAGE resolves with no priority window" and it '
      + 'predicted its own death in a comment — "if this test ever goes red because a window '
      + 'appeared, R3 has been overruled." It has. '
      + 'ROUND 31 (kept, because it is the reasoning that produced the question): PARTIAL — what '
      + 'she wanted to DO works; the WINDOW she wanted does not exist and collides with R3. Filed '
      + 'as a priority-window question, not a card bug. '
      + '⚠ THE REPORT OWN DIAGNOSIS WAS WRONG, AND SO WAS MINE. There is NO castability restriction '
      + 'on Cosmic Reversal and there never was: replaying YFUE through legalActions, seat 1 is '
      + 'offered the card at indices 188, 191, 193, 195, 199, 217, 219, 221, 224, 226 and 245 — '
      + 'every one with an EMPTY stack. Nothing was removed, because nothing was there. What she '
      + 'actually wanted to do — bounce the in-play spell unit — was impossible because the CARD '
      + 'never looked at the board (report #121), and that is fixed under R250. '
      + '⚠ WHAT ACTUALLY GATED THE MOMENT IS BIGGER AND IS NOT BUILT. Eminence of the Barrens fired '
      + 'inside the COMBAT DAMAGE STEP. At [197]/[198] the state is priority null, stack empty, '
      + 'legalActions(seat 1) empty — she was never offered a window at all, rather than refused a '
      + 'spell. processTriggerQueue leaves battleMode false while battle.damageStep is set, so such '
      + 'a trigger takes the immediate resolve branch and never reaches the stack. THAT IS R3, the '
      + 'owner own ruling of 2026-07-16: "no priority window between damage sub-steps". '
      + 'The owner Q1 answer ("all triggers are respondable") is TRUE everywhere the game hands out '
      + 'priority — pinned on the same trigger of the same card — and FALSE inside the damage step. '
      + 'Giving her that window means overruling R3, which reopens R3/R117/R157 §5. Put back to the '
      + 'owner rather than built.',
  },
  {
    id: 120, room: 'YFUE', date: '2026-08-28',
    report:
      'the UI bug about "once" effects showing the wrong icon once expended has now flip-flopped. '
      + '[Switch1] and [once] are DIFFERENT effects despite being functionally similar. The game '
      + 'should use the one actually relevant to the unit to show expended / used once-per-turn '
      + 'effects',
    status: 'fixed',
    guards: [
      '228-spent-marker.test.ts::R249: a spent bounded GRAFT ability wears the [Switch1] its own card prints',
      '228-spent-marker.test.ts::R249: a spent [once] ability wears [Once] — the same code, the other card',
      '228-spent-marker.test.ts::R249: every card in the pool with a bounded ability gets the marker it prints',
      '228-spent-marker.test.ts::R249: no card prints both markers, and none has two bounded abilities',
    ],
    note:
      'ROUND 31. RULED AND FIXED 2026-08-29 as R249, WHICH OVERTURNS ONE CLAUSE OF R135. '
      + '⚠ A RE-REPORT: an earlier fix swapped which of the two was '
      + 'wrong rather than making the icon follow the unit. This is the shape #46/#60/#75 had — a '
      + 'one-case fix for a two-case class — so the guard must derive which marker a unit carries '
      + 'from the card, not hardcode either. '
      + 'THE OWNER IS RIGHT AND R135 WAS WRONG HERE, for two reasons neither he nor this entry had. '
      + '(1) R135 rule — "a line never repeats what its own TAG already says" — is about the '
      + 'augment and graft lines, whose tags are ICONS. The note line tag is the words "spent", '
      + 'with no symbol, so there was never a duplicate to remove: the argument was borrowed from '
      + 'two lines this one is not shaped like. (2) The markers are not two spellings of one thing '
      + '— [Switch1] is the bounded GRAFT marker and its clause TRANSFERS when grafted, [once] '
      + 'transfers nothing. R135 two other clauses stand untouched. '
      + '⚠ AND THE FIX COULD NOT BE WHAT THIS ENTRY ASKED FOR. cardtext.ts own header says printed '
      + 'prose and abilities[] do not line up 1:1 and that guessing a mapping makes the box '
      + 'confidently wrong — there is no per-ability clause to read. It works because the POOL has '
      + 'no card with two bounded abilities and none printing both markers, so the guard is those '
      + 'invariants rather than a mapping. Derived: 88 bounded cards, 64 print [Switch1], 22 print '
      + '[once], 0 print both; 113 bounded graft donors all print [Switch1]. Four emit sites, not '
      + 'the three the plan named. [Once] survives as the fallback for the two prose-budget cards, '
      + 'which is R135 answer kept exactly where its argument still holds.',
  },
  {
    id: 121, room: 'YFUE', date: '2026-08-28',
    report:
      'just checking: does Cosmic Reversal correctly return all Spell Units *that are in play*? '
      + 'There was not one here, but that was the intention — and the log did not make it seem like '
      + 'it looks at the board for spell units',
    status: 'fixed',
    guards: [
      '229-cosmic-and-control.test.ts::R250: Cosmic Reversal recalls a spell unit in play to its controller hand',
      '229-cosmic-and-control.test.ts::R250 whole pool: every printed Spell Unit is recalled off the board',
      '229-cosmic-and-control.test.ts::R250: an ordinary unit in the same region is left alone',
      '229-cosmic-and-control.test.ts::R250 + R243: the board half is scoped to the region, like every other all',
      '229-cosmic-and-control.test.ts::R250: the log names both halves of the sweep, whether or not it found anything',
    ],
    note:
      'ROUND 31. RULED AND FIXED 2026-08-29 as R250. Answerable now, and TWO findings are possible: whether the '
      + 'card is right (printed: "Recall all other spell effects and spell units"), and separately '
      + 'that the LOG gave the owner no way to tell — a correct engine that cannot be audited from '
      + 'its own log is half of report #125. BOTH TURNED OUT TO BE REAL and both are fixed. '
      + 'The owner ruling: "It returns all spell effects on the stack (anything currently on the '
      + 'stack with type spell goes to the owners hand) and recalls all spell units from the board." '
      + 'The card now sweeps the board too, deriving the set from the live registry rather than '
      + 'naming any of the 14 printed Spell Units — in play a spell unit is an ordinary unit '
      + 'entity, which is exactly why the old stack-kind filter could never see one. The log now '
      + 'names what BOTH halves considered, found or not. '
      + '⚠ R243 SCOPES IT, and that is the ruling rather than a gap: the board half is the region, '
      + 'so an attacker spell unit left at home is out of reach of a {Battle} spell.',
  },

  // ── VYTV, 2026-08-28 ────────────────────────────────────────────────────
  {
    id: 122, room: 'VYTV', date: '2026-08-28',
    report: 'I am getting random "errors" in the top about not being in the haste step',
    status: 'fixed',
    guards: [
      '223-client-legality.test.ts::[122] one automatic doneHaste per unanswered send, however many states arrive',
      '223-client-legality.test.ts::[122] the latch comes down when the SERVER says the answer landed',
      '223-client-legality.test.ts::[122] a refusal of an action the CLIENT chose to send is not the player refusal',
      '223-client-legality.test.ts::[122] a refusal that follows a real click is still the player refusal',
    ],
    note:
      'ROUND 31. FIXED as R245 (b)/(c). The strings are apply.ts "not the haste step" / "not your '
      + 'haste step". The client generated the refused action ITSELF: main.ts runAutoPass sends '
      + 'doneHaste, and the hasteAutoAt latch documented there prevents a LOOP but not the first '
      + 'refusal. So the owner is shown an engine error for an action he never took. '
      + '⚠ BOTH GUESSES IN THIS ENTRY ORIGINAL NOTE WERE WRONG, and the agent said so. '
      + '(1) THE FIRST SEND IS LEGAL BY CONSTRUCTION — autoHasteDone reads the authoritative state '
      + 'and its two guards ARE doDoneHaste two need() clauses, so "stop planning against a closed '
      + 'step" describes a state the client never sees. The defect is the SECOND send: the haste '
      + 'step is a hidden simultaneous segment, so the server pushes this seat an update for every '
      + 'action the OPPONENT takes, each with a fresh actionCount, while this seat own doneHaste is '
      + 'still on the wire or parked by arrivalVerdict as deferred. An actionCount STAMP cannot '
      + 'express "my intent is unanswered", because an unanswered intent is exactly what has not '
      + 'moved it. The queue drains, the first lands, the rest come back "you already finished the '
      + 'haste step" and then "not the haste step" — plural and seemingly random because they '
      + 'arrive when the OPPONENT finishes. The latch is now an outstanding-intent flag lowered '
      + 'only by a server state showing the answer landed. '
      + '(2) IT DOES NOT SHARE A ROOT CAUSE WITH #123. Same feature area, different mechanisms; no '
      + 'path was found by which Pass-all produces these errors.',
  },
  {
    id: 123, room: 'VYTV', date: '2026-08-28',
    report: "Pass All still isn't working right",
    status: 'fixed',
    guards: [
      '230-pass-modes.test.ts::[123] an item that was on the stack when the chip was armed is never a change',
      '230-pass-modes.test.ts::[123] pass through stack finishes when the stack it was armed on has resolved',
      '230-pass-modes.test.ts::[123] pass all does not hand priority back for a new item or a new option',
      '230-pass-modes.test.ts::[123] pass all ends at the phase it was armed in, and the phase is read off the arm',
      '230-pass-modes.test.ts::[123] pass all still stops on the one pass that would erase castable spell tokens',
      '223-client-legality.test.ts::[123] a stack item that replaces another at the same height is still new',
      '223-client-legality.test.ts::[123] an option that is not an activated ability releases the chip too',
      '223-client-legality.test.ts::[123] the option set is derived by exclusion, and the exclusions are the three named',
      '223-client-legality.test.ts::[123] a state this seat is not being asked to pass never releases the chip',
    ],
    note:
      'ROUND 31. ⚠ PARTIAL, AND DELIBERATELY NOT CLOSED — see the end of this note. #68 was closed by moving the whole '
      + 'release list into ui/battle.ts passAllRelease. "Still" is the tell this repo has learned to '
      + 'read (#46 → #60 → #75). '
      + '⚠ BUT THE REPORTED BEHAVIOUR TURNED OUT TO BE THE DESIGN. VYTV was replayed and the real '
      + 'release function evaluated at every one of its pass windows: around action 56, where this '
      + 'report was filed, the chip came off because Rashi put two items on the stack — which is '
      + 'exactly what the button promises ("keep passing until the battle ends or something new is '
      + 'played"). So this was NOT fixed as reported, and saying otherwise would be the false '
      + 'closure this repo keeps catching. '
      + 'TWO REAL DERIVATION FAILURES WERE FOUND AND FIXED IN THE SAME CODE, both measured on that '
      + 'game: activationKeys was EMPTY at all 107 pass windows — a release clause that could not '
      + 'have fired on the reported behaviour at all, the #37/#46 shape — while six spell tokens '
      + 'and a castable card appeared out of resolutions and moved nothing; and the stack clause '
      + 'compared HEIGHTS, so a batch that resolved the top and pushed a new item at the same '
      + 'height was invisible, which happened three times for seat 0 in that game. '
      + '⚠ DERIVING THE RELEASE SET MAKES THE CHIP NOTICE MORE, NOT LESS. If the complaint is that '
      + 'it stops too often, the answer is a NARROWER PROMISE and only the owner can name it: '
      + 'should a TRIGGER count as "something new is played", and should the chip keep passing once '
      + 'the player has said "I am done acting this battle"? '
      + 'ANSWERED ON THE Q6 SHEET 2026-08-29 and RULED AS R251: three promises, not one — Pass (one '
      + 'resolution), Pass through stack (pass on everything on the stack NOW, priority back if '
      + 'something changes) and Pass all (no priority until the next phase). '
      + '⚠ AND THE LOAD-BEARING DEFECT WAS NOT IN passAllRelease AT ALL — it was the R245 RE-TAKE in '
      + 'main.ts, which re-snapshotted at every declined window, so "new" meant "new since the last '
      + 'window I passed": a running diff with no fixed scope. Nothing could ever FINISH, which is '
      + 'exactly why the chip could only stop at the end of the battle and why the owner middle '
      + 'option was inexpressible. Removing the re-take is what creates a scope; the new done '
      + 'release is that scope running out. Pass all is then a thin promise on the same seam. '
      + 'The old chip became PASS THROUGH STACK, not Pass all. '
      + '⚠ The tokens release is KEPT in Pass all deliberately: passEndsBattlePhase is true only of '
      + 'a pass that LEAVES the phase, so it fires at the terminus Pass all aims for, not before it '
      + '— dropping it would re-open report #66 (irreversible R11 token loss with no undo).',
  },

  // ── DSVQ, 2026-08-29 ────────────────────────────────────────────────────
  {
    id: 124, room: 'DSVQ', date: '2026-08-29',
    report:
      'The Everywhere needs work. "Naming a card" cannot just show a full list of every card in the '
      + 'game — better is the cards in play, with a search box or the Scryfall-like filters to '
      + 'search all cards. And it needs to say somewhere on the unit what the last named card is',
    status: 'fixed',
    guards: [
      '226-log-and-naming.test.ts::§2a a 400-option naming menu is not 400 card scans',
      '226-log-and-naming.test.ts::§2b the default is what is standing on the board',
      '226-log-and-naming.test.ts::§2c every option the engine offered is still takeable',
      '226-log-and-naming.test.ts::§2d the whole-pool toggle widens the shopfront without touching the menu',
      '226-log-and-naming.test.ts::§2e a unit that has named a card says which one',
    ],
    note:
      'ROUND 31. FIXED 2026-08-29, client-side only. Printed: "[Augment] During [Haste] name a card. My last '
      + 'named card loses all abilities." So the second half is not polish — the card names a thing '
      + 'and then nothing on the board records what it named. ui/cardsearch.ts already is the '
      + 'search the owner is asking for; reuse it rather than writing a second one. '
      + '⚠ AND THE CARD WAS NOT WRONG. batch-light-a.ts offering the whole pool is CORRECT — you '
      + 'may name any card. The bug was the CLIENT rendering 490 card scans into a prompt bar, so '
      + 'no engine file was touched. The filtered menu is triggered by the SHAPE of the question '
      + '(more than 14 card-valued options), not by card name or decision kind, so every future '
      + 'name-a-card effect gets it for free. It defaults to what is standing on the board, has a '
      + 'whole-pool toggle, and — per BL-18 — keeps every option takeable in an expander. The '
      + 'second half shipped too: a unit wearing Entity.named says what it named, and "released a '
      + 'naming" is distinguished from "never named".',
  },
  {
    id: 125, room: 'DSVQ', date: '2026-08-29',
    report:
      'in general the game log is too detailed. It says things that almost seem more like the game '
      + 'is clarifying things to itself rather than being useful to the players. The whole game log '
      + 'should be rethought to be more user friendly and readable',
    status: 'fixed',
    guards: [
      '226-log-and-naming.test.ts::§1a nothing is deleted — the story view is a strict subset of everything',
      '226-log-and-naming.test.ts::§1b the substantive lines of a real game all survive the curtain',
      '226-log-and-naming.test.ts::§1c the curtain fails open — a line the client cannot classify is always shown',
      '226-log-and-naming.test.ts::§1d the curtain says how much it is holding, and lifts on one click',
    ],
    note:
      'ROUND 31. PARTIAL ON PURPOSE — the toggle is built, the vocabulary cut is the owner call (Q3). '
      + '⚠ THE DETAIL IS LOAD-BEARING somewhere else: replay-room.ts '
      + 'forensics and several ledger entries were settled by reading exactly these lines. So the '
      + 'move is a default view for players with the forensic detail kept behind a toggle, not a '
      + 'deletion. #121 is the counter-example that says the log is also not detailed ENOUGH where a '
      + 'player wants to audit a card — readable is not the same as shorter. '
      + 'SHIPPED: a Story (default) / Everything toggle, h.log untouched, per-browser preference, a '
      + 'count of what is folded, and FAIL-OPEN on any line the client cannot classify — which is '
      + 'the whole backlog a networked client gets on join. The curtain is a per-EventType table, '
      + 'and the criterion is the owner own words: ECHOES (stackPushed / resolved / targeted / '
      + 'attacked / blocked, which spend three lines on one ability) and step markers that are '
      + 'byte-identical every turn. '
      + '⚠ DELIBERATELY NOT CURTAINED: resourceActivated (19% of all lines), recycle (14%), draw '
      + 'and phase. Measured over three fuzzed games (3750 lines) those are 60% of the VOLUME — but '
      + 'they are not the game clarifying itself to itself, each records a distinct thing a player '
      + 'did. Cutting them is a vocabulary decision no agent should make alone, and it is Q3 on the '
      + 'round-31 sheet — ANSWERED THERE 2026-08-29: "The toggle is fine, I think." So the '
      + 'curtain as built IS the answer to this report, and the 60% of volume in '
      + 'resourceActivated / recycle / draw / phase stays visible on purpose. CT-118 closed with it.',
  },
  {
    id: 126, room: 'DSVQ', date: '2026-08-29',
    report:
      'there needs to be an "auto stack triggers" button to press when the order does not matter. '
      + 'There should also be a more visual stack chooser rather than the extended buttons — '
      + 'clicking cards (MTGO style) would be better UX',
    status: 'fixed',
    guards: [
      '225-stack-readout.test.ts::§3a the ordering bar offers auto-stack, and it sends the order the game listed',
      '225-stack-readout.test.ts::§3b auto-stack is opt-in — nothing goes out until it is clicked',
      '225-stack-readout.test.ts::§3c the ordering options are drawn as the cards they came from',
    ],
    note:
      'ROUND 31. FIXED 2026-08-29. Two asks in one report and the first is the cheaper: '
      + 'ordering N triggers costs N decisions that usually do not matter. Related to BL-18 (full '
      + 'control) in the opposite direction — this is a shortcut the client should offer, BL-18 is '
      + 'about suppressing the ones it takes without asking. Held to that: auto-stack is opt-in PER '
      + 'DECISION, never a preference and never armed, latched by ui.orderAutoFor so a repaint '
      + 'cannot re-fire it. The ordering options now render as the CARDS they came from, derived '
      + 'from the same triggerQueue filter the engine builds and answers with (R245), and are '
      + 'refused unless lengths and labels still match — so a stale paint falls back to labels '
      + 'rather than pinning a click to the wrong trigger.',
  },
  {
    id: 127, room: 'DSVQ', date: '2026-08-29',
    report:
      'why is Rashi able to attack like this? She did not do counterattackers (just Thoughtripper) '
      + 'but is able to attack with all her things',
    status: 'fixed',
    guards: [
      '223-client-legality.test.ts::[127] the attack affordance names exactly the units the engine would take',
      '223-client-legality.test.ts::[127] a unit the engine would refuse is not ringed and does not pick up on a click',
      '223-client-legality.test.ts::[127] the block step is the same question, asked of the defender',
      '223-client-legality.test.ts::[127] the region a formation leaves from has one derivation, not three',
    ],
    note:
      'ROUND 31. FIXED as R245 (a). ⚠ READ WITH #128, WHICH THE OWNER FILED 37 SECONDS LATER: '
      + 'the ENGINE half is retracted (it did not let her), the UI half stands — the client offered '
      + 'attacks it then refused. Same class as #122: the client model of what is legal and the '
      + 'engine disagree, and the player is the one who finds out. Room DSVQ replays 174/174 '
      + 'FAITHFUL, which is itself the evidence the engine was right. '
      + 'CONFIRMED EXACTLY FROM THE LOG: DSVQ action 84 sent only entity 4, so round two '
      + 'attackerPool is [4] — but canClick asked only step === declare && controller === attacker, '
      + 'so her whole army lit up. "Attack all" also silently omitted the {Alluring} clause. '
      + 'ui/battle.ts formationCandidates is now the single derivation, mirroring validFormation '
      + 'and checkBlocks, and the ring, the unit click and Attack all all read it.',
  },
  {
    id: 128, room: 'DSVQ', date: '2026-08-29',
    report:
      'disregard the last report as an engine bug, it is just a UI bug. She seemed to be able to '
      + 'attack with the other things, but it did not let her',
    status: 'wontfix',
    note:
      'NOT A REPORT OF ITS OWN — this is the owner narrowing #127 from an engine bug to a UI bug, '
      + 'and the surviving half is carried there. Recorded rather than merged so the snapshot row '
      + 'has an entry (the round-17 rule) and so the reclassification is not lost. Same shape as '
      + '#114/#115, where the retraction turned out to be worth more than the report.',
  },
  {
    id: 129, room: 'DSVQ', date: '2026-08-29',
    report:
      'when a mod goes onto a unit it becomes PART of that unit. Here it says Rashi trashed '
      + 'Malformed Monstrosity, which is doubly wrong: (1) trashing means it goes to the BIN, but '
      + 'the unit that died was Unstable so it did not go to the bin, and trashing and death are '
      + 'NOT the same; (2) the Monstrosity was a mod, not its own card, on a unit under the other '
      + 'player control. Trashing did not happen here',
    status: 'fixed',
    guards: [
      '224-mod-trash.test.ts::R244: a nontoken mod erased with its Unstable host is not trashed at all',
      '224-mod-trash.test.ts::R244: a mod trashed on a recall is trashed by the host controller, not by its owner',
      '224-mod-trash.test.ts::R244 whole pool: no nontoken mod is trashed by its host death, and the body always is',
      '224-mod-trash.test.ts::R137 GUARD: the BODY of an Unstable unit that dies is still trashed, mods or no mods',
    ],
    note:
      'ROUND 31. RULED AS R244 and fixed the same day. CONFIRMED IN THE REPLAY LOG: "Malformed Monstrosity '
      + 'augments The Everywhere (Ben) — it is now Unstable" then "Rashi trashes Malformed '
      + 'Monstrosity (from play)". engine.ts attributes a mod trash to m.owner; it must follow the '
      + 'HOST controller — this drives the per-battle trashed:<seat> counter and the card own '
      + 'when-I-am-trashed trigger, so Muck Rummager and Dropslime count for the wrong player. '
      + '⚠ THE OWNER FIRST HALF COLLIDES WITH R137 and the boundary was settled with him on '
      + '2026-08-29: R137 STANDS FOR THE BODY (an Unstable unit that dies is still trashed — that '
      + 'is what closed #93 and it overruled the printed reminder and Caleb on purpose); what '
      + 'changes is that a MOD erased with its host never had a presence of its own and is not '
      + 'trashed. '
      + '⚠ THE FIX SITE THIS ENTRY FIRST NAMED WAS A NO-OP. The death loop it pointed at only runs '
      + 'under keepBinned (Pull Under), which always passes binTo, so attribution and destination '
      + 'were already identical there. The attribution half bites in afterDespawn — the RECALL and '
      + 'CACHE routes — which the plan never mentioned. '
      + '⚠ AND R137 IS NOT LEFT WHOLLY UNTOUCHED AFTER ALL: R244 overrules its "The mods ride with '
      + 'it" section, which R137 had itself flagged as reasoning rather than a log and stated so it '
      + 'could be overruled cleanly. R137 is amended in place with a pointer; its BODY ruling and '
      + 'report #93 stand. '
      + 'Blast radius, derived from printed.json over 492 cards: 203 cards can become a nontoken '
      + 'mod; 200 of 200 lose their trashed event on host death and 200 of 200 change attribution '
      + 'on recall. The most visible table change is that four self-trashing graftable cards '
      + '(Afflicting Anima, Blightwalker, Dropslime, Maw of Despair) stop firing when their host is '
      + 'erased. VERIFIED BY BREAKING TWICE BY THE ORCHESTRATOR: restoring m.owner reddens tests 5, '
      + '6, 7, 8 and 10 by name; making the body skip its trash reddens 1, 2, 4 and 9 AND report #93 '
      + 'own guard in 35-rot-debt-trash, which is the boundary holding.',
  },
  {
    id: 130, room: 'DSVQ', date: '2026-08-29',
    report:
      'Retribution Thing did not show its X value (not in hand nor on the stack). All cards with an '
      + 'X in them need to show their X value when on the stack',
    status: 'fixed',
    guards: [
      '225-stack-readout.test.ts::§1a Retribution Thing wears its X on the stack, and it is the number it will deal',
      '225-stack-readout.test.ts::§1b the declared mode narrows the forecast to the half that was chosen',
      '225-stack-readout.test.ts::§1c a paid X still wins — the forecast never doubles it',
      '225-stack-readout.test.ts::§1d CENSUS — every card that can forecast an X forecasts it ON THE STACK too',
      '225-stack-readout.test.ts::§1e INVENTORY — every printed X is paid, worn by a token, forecast, or listed here',
    ],
    note:
      'ROUND 31. RULED AND FIXED 2026-08-29 as R246. ⚠ NOT COVERED BY #85 EVEN THOUGH IT LOOKS IDENTICAL. #85 '
      + 'was Soul Siphon, a PAID X, previewed in hand by 96-x-preview.test.ts. Retribution Thing '
      + 'prints "I deal X damage to target unit, where X is the life you have lost or gained in this '
      + 'battle" — a DERIVED X, computed from game state, with no cast-time choice to preview. '
      + 'Different family, and the owner quantifier ("all cards with an X") is the class: derive it '
      + 'from printed text, do not enumerate. '
      + 'CONFIRMED: inspect.ts stackItemX reports the X an item COMMITTED (a paid cast X, a variable '
      + 'cost, a trigger event n). Retribution Thing commits none — X is read off the battle ledger '
      + 'at resolution — so stackItemX correctly had nothing to say and the card wore no mark. '
      + '⚠ THE SEAM THIS PLAN NAMED WAS THE WRONG ONE: previewNote is keyed on a live Entity and a '
      + 'stack item is not one. The right hook was xPreviewRows, which #85 had already added for '
      + 'the hand chip — so the fix REUSES the #85 machinery rather than growing a parallel one, '
      + 'parameterised by the item own region (one definition, R245). A committed X always wins, so '
      + 'a forecast can never double a paid one. '
      + 'The class is held by a CENSUS over the pool plus an INVENTORY of the 18 printed Xs that are '
      + 'neither paid nor forecast, each with its reason and a liveness test — so a new X card is '
      + 'caught rather than quietly uncovered.',
  },
  {
    id: 131, room: 'PUCG', date: '2026-08-29',
    report:
      "I've decided that the game log would be better to hide by default. Instead of always being "
      + 'on screen, it should be accessible by the "generic" right click menu. "View game log" will '
      + 'bring up a modal (which is easier to read anyway) that functions just the same as the '
      + 'current log.',
    status: 'fixed',
    guards: [
      '232-log-modal.test.ts::§1 the board no longer carries the log, and the rail is still a rail',
      '232-log-modal.test.ts::§2 the generic right-click menu opens it, and the menu decides that',
      '232-log-modal.test.ts::§3 every affordance the modal emits is a live one',
      '232-log-modal.test.ts::§4 the story toggle and its footer moved into the modal, both working',
      '232-log-modal.test.ts::§5 the rail did not become dead space, and the modal is still painted',
    ],
    note:
      'ROUND 32. RULED AND FIXED 2026-08-29 as R253. ⚠ THIS DOES NOT RETRACT ROUND 31 WORK. Report #125 asked for a '
      + 'less detailed log; Q3 of docs/questions-round31.md scoped that as a Story/Everything '
      + 'toggle and the owner ratified it ("The toggle is fine, I think"). This report moves the '
      + 'SURFACE and keeps the filter — hide the panel, put the same content behind a "View game '
      + 'log" item on the generic right-click menu, in a modal. Keep the curtain, move the '
      + 'surface. ⚠ THE EXAMPLE THIS ROW FIRST GAVE WAS WRONG: the R150 skip chip is NOT in or '
      + 'beside the log panel — it is in the left column topbar and the log is in the right rail, '
      + 'sharing no ancestor below #app. CT-123 was independent and was fixed separately as R258. '
      + 'The real class was THIRTEEN and all thirteen were carried, the Story/Everything toggle '
      + 'included. See CT-124 for the two brief premises the work disproved, and for the latent '
      + 'browser crash it uncovered on the way. ⚠ ONE COST, NOW ON THE QUESTION SHEET AS Q7: the '
      + 'log was the client fallback surface for announcements with none of their own, and CT-55 '
      + 'token-loss warning — which the owner asked to be put IN FRONT OF the player who lost them '
      + '— is now behind a click. Tracked as CT-134.',
  },
  {
    id: 132, room: 'PUCG', date: '2026-08-29',
    report:
      "When casting a bunch of burst spells, it's very hard to tell how many you have left and of "
      + 'which sizes they are.',
    status: 'fixed',
    guards: [
      '233-burst-count-and-size.test.ts::§1a every burst name you hold gets its own row, named, counted',
      '233-burst-count-and-size.test.ts::§1b a group of one name at different sizes prints every size — the report verbatim',
      '233-burst-count-and-size.test.ts::§2b every buried card wears its X where the overlap cannot reach it',
      '233-burst-count-and-size.test.ts::§2c the depth chip counts the run, so you can see how many are left',
    ],
    note:
      'ROUND 32. RULED AND FIXED 2026-08-29 as R254. THE SIZE IS X, not mana or power/defense — '
      + 'all burst tokens print mana 0 and 3/3 identically, and X is carried per entity. '
      + 'apply.ts:1006 groups the cast chain on the card NAME and ignores t.x, so Fireball 1, 1, 3 '
      + 'and 7 fire as one uninterruptible chain of four differently-sized spells. That is the '
      + 'report exactly. Two independent defects: the strip was an unsorted filter in entity-id '
      + 'order under one aggregate count over three mixed names, and on the stack the X rode at '
      + 'the RIGHT end of .stacktag — the end the next card covers — so from six deep every buried '
      + 'X was hidden behind the 30.4px sliver. Both fixed, reusing one tally rather than growing '
      + 'two mechanisms. See CT-125 for the false premise this round corrected (the spell-token '
      + 'KIND is four cards, not the three that are burst).',
  },
  {
    id: 133, room: 'PUCG', date: '2026-08-29',
    report:
      'When an effect is targeting a player, the arrow covers up their life total, making it '
      + 'impossible to read.',
    status: 'fixed',
    guards: [
      '234-arrowhead-clears-text.test.ts::[R255] every measured endpoint has an arrowhead that clears its text',
      '234-arrowhead-clears-text.test.ts::[R255] the head stops just short of the label, never far from the thing it points at',
      '234-arrowhead-clears-text.test.ts::[R255] the fixtures are the bug: at the old inset the head sits on their text',
      '234-arrowhead-clears-text.test.ts::[R255] an endpoint with nothing legible in the middle is not moved at all',
      '234-arrowhead-clears-text.test.ts::[R255] arrowGeometry keeps aiming at the exact centre, and reports its own inset',
    ],
    note:
      'ROUND 32. RULED AND FIXED 2026-08-29 as R255, entirely inside anim.ts. Measured over CDP '
      + 'against the real style.css and a real demo board: the head band sits 7-17px back from '
      + 'the destination exact centre, and the life pill is 52x24 whose only content is the heart '
      + 'and the number, centred — at 30 life the head covers a digit from 8 of 8 approach '
      + 'directions. '
      + '⚠ THE PLAYER IS ONE OF FIVE OCCLUDING ENDPOINTS, and a fix that nudged only the player '
      + 'arrow would have been the one-card fix this repo keeps filing twice. The rule that '
      + 'generalises: THE ARROW OCCLUDES WHATEVER TEXT A TARGET ELEMENT CENTRES. Corner-placed '
      + 'numbers are 30-46px out and safe. '
      + '⚠ AND TWO ENDPOINTS THE STYLESHEET READING GOT WRONG, both corrected by the browser: a '
      + 'stack item only occludes when its ART IS MISSING (where the scan has loaded, .stackface '
      + 'is painted over and there is nothing legible — a CSS-only reading would have backed every '
      + 'stack arrow off on an 82px tile whose neighbours overlap it by 39px), and the seat-1 BIN '
      + 'zone IS an occluder at 96x95.4 although the taller seat-0 region clears. That is why the '
      + 'fix hit-tests rather than reads CSS. '
      + 'The AIM never moves — the endpoint is still the exact centre, which is the owner own ZQPC '
      + 'decision. Only where the head STOPS moves. See CT-126.',
  },
  {
    id: 134, room: 'PUCG', date: '2026-08-29',
    report: 'Boon of Protection was allowed to be played targeting an illegal target',
    status: 'fixed',
    guards: [
      '23-wood-a.test.ts::Boon of Protection: negates an effect aimed at something allied; an unallied one is not offered',
      '23-wood-a.test.ts::Boon of Protection: a Virus being applied to an allied unit IS an allied target',
      '68-target-conformance.test.ts::R256: a restrictive clause on a target noun is enforced at CAST',
      '68-target-conformance.test.ts::R256: the if-clause exemptions are exactly the cards that print one',
      '68-target-conformance.test.ts::R256: every printed occurrence of target is read, not skipped',
    ],
    note:
      'ROUND 32, FILED ON ARRIVAL. The only ENGINE item of the four. Printed: "Negate target '
      + 'effect that targets an allied effect, player or unit." — the restriction is on the '
      + 'TARGET OWN targets, which is the R64/R65 restriction seam. batch-wood-a.ts enforces it at '
      + 'RESOLUTION as a no-op instead, by deliberate comment. '
      + '⚠ TWO EVIDENCE CAVEATS. (a) Action 353 is AFTER the 15:43 server restart onto 704253f, so '
      + 'it is on the NEW engine and could be a regression from round 31 R244/R250 work — check. '
      + '(b) PUCG FORKED at that restart (replay-room reported 25 actions changed meaning), so '
      + 'anything before action 326 is evidence about a DIFFERENT BOARD. '
      + '✅ RULED AND FIXED THE SAME DAY as R256, and BOTH CAVEATS TURNED OUT TO BE MOOT — it is '
      + 'not a regression and it reproduces from a clean board. git log -S: the card and its '
      + 'misleading comment landed together on 2026-08-18; Minor Kraken gained its restrict in '
      + 'R64 on 08-21 and Graxxlid in R88 on 08-23; Boon of Protection was never revisited. The '
      + 'precedent its own comment cited had moved out from under it and nobody noticed for four '
      + 'rounds. The pool splits on GRAMMAR — a relative clause on the target noun is a targeting '
      + 'restriction, an if-clause on the verb is a conditional effect — and this was the single '
      + 'card on the wrong side of that line. See CT-127 for the Virus arm the fix would have '
      + 'broken, and for the break-test that convicts the pre-R64 and pre-R88 code.',
  },
  {
    id: 135, room: 'ERJZ', date: '2026-08-30',
    report:
      'a wrong room code shows "connecting to server" forever instead of saying the room does '
      + 'not exist',
    guards: [
      '254-join-nonexistent-room.test.ts::R274 §1 a code the server never minted is refused, and the refusal names it',
      '254-join-nonexistent-room.test.ts::R274 §2 a refused join reaches the connecting screen instead of Connecting forever',
      '254-join-nonexistent-room.test.ts::R274 §3 an error in the constructed waiting room lands too, where there is still no board',
    ],
    status: 'fixed',
    note:
      'ROUND 34, filed on arrival. Client/server: the join path never surfaces the not-found '
      + 'answer, so a typo in a room code is indistinguishable from a slow connect. ERJZ replays '
      + 'FAITHFULLY at HEAD (260/260 actions, 0 refused, deterministic), so this is reproducible '
      + 'by replay at the recorded action index. Routed to agent G.',
  },
  {
    id: 136, room: 'ERJZ', date: '2026-08-30',
    report:
      'Infernal Wispweaver turns off ALL abilities of wisps; only their sacrifice ability '
      + 'should be disabled',
    guards: [
      '249-suppression-scope.test.ts::§1 GUARD: a card that switches off a whole layer must print a whole-layer clause',
      '249-suppression-scope.test.ts::§2 a Wisp keeps an ability it was given — the weaver takes away one clause, not the layer',
      '249-suppression-scope.test.ts::§3 and the weaver still stops the sacrifice it does print',
    ],
    status: 'fixed',
    note:
      'ROUND 34, filed on arrival. ENGINE. batch-fire-a.ts:729 uses '
      + 'StaticMod.suppressAbilities, which switches off the whole ability layer. The comment '
      + 'above the card argues that is exact "because the Wisp has exactly ONE ability" — the '
      + 'owner report is that the premise was never true ("They can technically have other '
      + 'abilities"), and in a pool where Ancient One copies abilities and mods grant them it '
      + 'plainly is not. The shape of the available mechanism was promoted into a rule about the '
      + 'card. Only 4 pool cards use the flag; the other three pair it with suppressAttrs and may '
      + 'be legitimate. ERJZ replays FAITHFULLY at HEAD (260/260 actions, 0 refused, '
      + 'deterministic), so this is reproducible by replay at the recorded action index. Routed '
      + 'to agent A as R269.',
  },
  {
    id: 137, room: 'ERJZ', date: '2026-08-30',
    report:
      'the live view of an opponent attack or block is drawn in the opponent orientation, then '
      + 'flips when declared',
    guards: [
      '253-combat-orientation.test.ts::the live attack and the declared attack put the same units in the same halves',
      '253-combat-orientation.test.ts::the live attack view draws the vs line and both halves of every column',
      '253-combat-orientation.test.ts::a pending blocker sits in the same container a committed blocker sits in',
      '253-combat-orientation.test.ts::a live block column is marked pending without changing where it stands',
    ],
    status: 'fixed',
    note:
      'ROUND 34, filed on arrival. CLIENT. Declared attacks and blocks mirror correctly; the '
      + 'in-progress view does not, so the columns visibly switch around as the declaration '
      + 'lands. One derivation with two consumers is the shape ui/battle.ts already uses for '
      + 'formationCandidates. ERJZ replays FAITHFULLY at HEAD (260/260 actions, 0 refused, '
      + 'deterministic), so this is reproducible by replay at the recorded action index. Routed '
      + 'to agent F.',
  },
  {
    id: 138, room: 'ERJZ', date: '2026-08-30',
    report:
      'the Invaders area should sit in the attacking box, not off to the side, for tokens and '
      + 'units made during combat',
    guards: [
      '253-combat-orientation.test.ts::a token that rode in with the attack is drawn in the battle panel, not off to the side',
      '253-combat-orientation.test.ts::the invaders are drawn once, by the battle panel or the region panel and never both',
      '253-combat-orientation.test.ts::the invaders stand on the side of the line the seat that controls them is on',
      '253-combat-orientation.test.ts::while an attack is only being declared the region panel still draws the invaders',
    ],
    status: 'fixed',
    note:
      'ROUND 34, filed on arrival. CLIENT, layout. The owner accepts sending counter-attackers '
      + 'across but wants things CREATED during combat to appear where the battle is. ERJZ '
      + 'replays FAITHFULLY at HEAD (260/260 actions, 0 refused, deterministic), so this is '
      + 'reproducible by replay at the recorded action index. Routed to agent F with #137, same '
      + 'layout pass.',
  },
  {
    id: 139, room: 'ERJZ', date: '2026-08-30',
    report:
      'Infernal Wispweaver played as an augment grants its BODY text (+2/+1 and the '
      + 'no-sacrifice clause) as well as its [Augment] box',
    guards: [
      '248-augment-box-scope.test.ts::§1 GUARD: a continuous clause printed inside the [Augment] box is declared in augmentBox',
      '248-augment-box-scope.test.ts::§3 GUARD: a card that prints both halves radiates its body clause from play, never from a mod',
      '248-augment-box-scope.test.ts::§5 PIN: a card played normally still reads its own [Augment] box',
    ],
    status: 'fixed',
    note:
      'ROUND 34, filed on arrival. ENGINE, and a CLASS not a card. CardDef.statics is one field '
      + 'doing two jobs: engine.ts:1361 staticsFor gives an augment mod the face [holder.card] '
      + 'and then reads getCard(face).statics — the body array — because it is the only one there '
      + 'is. Abilities are already split correctly (engine.ts:9447 picks def.abilities vs '
      + 'def.augmentText); statics are not. Both sides of the seam are in the pool: Wispweaver '
      + 'prints its static in the BODY and must not radiate it as a mod, while Prickly Protector, '
      + 'Animated Spark and Sandstone Defender print theirs INSIDE the box and must keep '
      + 'radiating. So the split is by where the clause is printed, derivable from printed.json. '
      + 'OWNER RULED THE GENERAL CASE 2026-08-30: when a card is played as an augment, only its '
      + '[Augment] box text is live. '
      + '⚠ THE BRIEF WAS WRONG AND R268 AS BUILT CORRECTS IT: the rule is ASYMMETRIC, not a mirror. A card own [Augment] text is active when it is played NORMALLY too (Manual Q&A, digital-rules.md), so a unit in play radiates body PLUS box while an augment mod radiates box ONLY - a symmetric fix would have broken Prickly Protector, a 0/1 that grows when merely played. It was never one field either: E.anchored feeds SEVENTEEN channels (statics, projects, and the fifteen BEHAVIOR_CHANNELS) and every one had the same body/box collapse, sixteen of them latent with no card standing on them. Of the 181 cards printing a box, 45 declare a radiating channel, 44 print it inside the box and migrated with zero behaviour change, and exactly ONE - Infernal Wispweaver - did not. '
      + 'ERJZ replays FAITHFULLY at HEAD (260/260 actions, 0 refused, '
      + 'deterministic), so this is reproducible by replay at the recorded action index. Routed '
      + 'to agent A as R268.',
  },
  {
    id: 140, room: 'ERJZ', date: '2026-08-30',
    report:
      'an oversized graft icon renders on Spellbind while it is on the stack',
    guards: [
      '251-fizzle-label-and-mod-strips.test.ts::R271 §3 no game icon on the stack strip is drawn at its full size',
    ],
    status: 'fixed',
    note:
      'ROUND 34, filed on arrival. CLIENT. Spellbind is {Modular} and prints [Switch1]. ERJZ '
      + 'replays FAITHFULLY at HEAD (260/260 actions, 0 refused, deterministic), so this is '
      + 'reproducible by replay at the recorded action index. Routed to agent D with the rest of '
      + 'the stack-row family.',
  },
  {
    id: 141, room: 'ERJZ', date: '2026-08-30',
    report:
      'modded cards on the stack show no mod on hover, unlike modded units',
    guards: [
      '251-fizzle-label-and-mod-strips.test.ts::R271 §4a a modded stack item composes the same picture as a modded unit',
    ],
    status: 'fixed',
    note:
      'ROUND 34, filed on arrival. CLIENT. Same surface as #140 and #146: the stack row and the '
      + 'focus card do not render mods the way a unit does. ERJZ replays FAITHFULLY at HEAD '
      + '(260/260 actions, 0 refused, deterministic), so this is reproducible by replay at the '
      + 'recorded action index. Routed to agent D.',
  },
  {
    id: 142, room: 'QJEY', date: '2026-08-30',
    report:
      'the page scrolls back to the top on any state change and drops hover, including changes '
      + 'in hidden zones',
    guards: [
      '252-viewport-and-log.test.ts::R272 §2 a card image reserves its height, so a repaint cannot clamp the scroll',
      '252-viewport-and-log.test.ts::R272 §3a a repaint that leaves the hovered card where it was keeps the tip',
      '252-viewport-and-log.test.ts::R272 §3b a card that is gone from the new board takes its tip with it',
      '252-viewport-and-log.test.ts::R272 §4 an update this seat cannot see costs exactly one paint',
    ],
    status: 'fixed',
    note:
      'ROUND 34, filed on arrival. CLIENT, and the loudest player-experience item in the batch '
      + '— it fires on deck building and in game, and even when the opponent acts inside a zone '
      + 'this player cannot see. ui/main.ts already has snapshotViewport/restoreViewport from the '
      + 'readability split; the questions are which repaint paths bypass them and why a '
      + 'hidden-zone update repaints at all. QJEY FORKED at 2026-08-30T10:48:39Z (server restart '
      + 'onto 8f7219d6; 23 of 268 actions unreplayable, rebuilt from turn 7 deploy, divergence '
      + 'from action 14, six of the lost actions are augments). This report CANNOT be settled by '
      + 'replay — reproduce it directly. Routed to agent E.',
  },
  {
    id: 143, room: 'QJEY', date: '2026-08-30',
    report:
      'the {Unstable} reminder belongs on the attribute line, not appended at the foot of the '
      + 'card',
    guards: [
      '251-fizzle-label-and-mod-strips.test.ts::R271 §5a a printed-Unstable card wears it on the attribute line',
      '251-fizzle-label-and-mod-strips.test.ts::R271 §5c the sentence a player reads there is the POOLs, not ours',
      '251-fizzle-label-and-mod-strips.test.ts::R271 §5d the inspector really draws that row for a modded unit',
    ],
    status: 'fixed',
    note:
      'ROUND 34, filed on arrival. CLIENT, presentation of printed data — must be derived from '
      + 'the pool, not hand-typed. QJEY FORKED at 2026-08-30T10:48:39Z (server restart onto '
      + '8f7219d6; 23 of 268 actions unreplayable, rebuilt from turn 7 deploy, divergence from '
      + 'action 14, six of the lost actions are augments). This report CANNOT be settled by '
      + 'replay — reproduce it directly. Routed to agent D.',
  },
  {
    id: 144, room: 'QJEY', date: '2026-08-30',
    report:
      'a Prickly Protector died although it should have had an ally in region offsetting its '
      + '-1/-1 counter',
    guards: [
      '250-ally-count-and-absence.test.ts::Prickly Protector survives being declared as a counterattacker (R270, report 144)',
      '250-ally-count-and-absence.test.ts::a host wearing a donated Prickly Protector survives being sent out (R270)',
      '250-ally-count-and-absence.test.ts::a counterattacker sent out alone survives the send and dies on arrival (R270)',
      '250-ally-count-and-absence.test.ts::scope: a unit left at home still loses the ally that counterattacked away',
    ],
    status: 'fixed',
    note:
      'ROUND 34, filed on arrival. ENGINE. The owner hypothesis is that units stop seeing their '
      + 'allies while moving between regions, which should be instantaneous. Prickly Protector is '
      + 'a statics-only text-box augment whose amount is live: otherAllies = '
      + 'unitsOf(self.controller, self.region) minus itself. RULED OUT BEFORE DISPATCH: region '
      + 'scoping is not itself the defect — 32 pool cards print "ally" and 59 card-code sites '
      + 'scope by region, so it is a pool convention. Candidates are the reentrancy guard '
      + '(engine.ts:1362 makes staticsFor return [] when already inside a statics query, so a dp '
      + 'callback can read a different answer than the same call from outside), the host/mod '
      + 'identity under donation, and the order of the counter layer against the static layer at '
      + 'the death check. QJEY FORKED at 2026-08-30T10:48:39Z (server restart onto 8f7219d6; 23 '
      + 'of 268 actions unreplayable, rebuilt from turn 7 deploy, divergence from action 14, six '
      + 'of the lost actions are augments). This report CANNOT be settled by replay — reproduce '
      + 'it directly. Routed to agent C as R270.',
  },
  {
    id: 145, room: 'QJEY', date: '2026-08-30',
    report:
      'now that the game log is hidden by default, opening it should show the ENTIRE log '
      + 'without truncation',
    guards: [
      '252-viewport-and-log.test.ts::R272 §1a a log longer than the old 80-line window is shown WHOLE',
      '252-viewport-and-log.test.ts::R272 §1b lifting the window does not lift the story curtain with it',
      '252-viewport-and-log.test.ts::R272 §1c the pacing curtain still holds the tail it has not told yet',
    ],
    status: 'fixed',
    note:
      'ROUND 34, filed on arrival. CLIENT. The truncation was built for the inline panel and '
      + 'outlived it. QJEY FORKED at 2026-08-30T10:48:39Z (server restart onto 8f7219d6; 23 of '
      + '268 actions unreplayable, rebuilt from turn 7 deploy, divergence from action 14, six of '
      + 'the lost actions are augments). This report CANNOT be settled by replay — reproduce it '
      + 'directly. Routed to agent E with #142.',
  },
  {
    id: 146, room: 'QJEY', date: '2026-08-30',
    report:
      'the focus card window reserves a large empty strip to fit a mod badge; the card beneath '
      + 'should just peek out at the graft symbol',
    guards: [
      '251-fizzle-label-and-mod-strips.test.ts::R271 §4b [#146] the strip carries no badge, and its peek is one named number',
    ],
    status: 'fixed',
    note:
      'ROUND 34, filed on arrival. CLIENT. Third member of the mod-rendering family with #140 '
      + 'and #141. QJEY FORKED at 2026-08-30T10:48:39Z (server restart onto 8f7219d6; 23 of 268 '
      + 'actions unreplayable, rebuilt from turn 7 deploy, divergence from action 14, six of the '
      + 'lost actions are augments). This report CANNOT be settled by replay — reproduce it '
      + 'directly. Routed to agent D.',
  },
  {
    id: 147, room: 'ZSPG', date: '2026-08-30',
    report:
      'the pay-X-life prompt has no arrows and no way to type a number, and "that is enough" '
      + 'does not read as a button',
    guards: [
      '260-cost-ramp-and-bin-targets.test.ts::R280 §2 the pay-X-life bar carries R197s arrows and its typed box',
      '260-cost-ramp-and-bin-targets.test.ts::R280 §2b the dial goes DOWN as well as up, and never below what is already paid',
      '260-cost-ramp-and-bin-targets.test.ts::R280 §3 that is enough is a full button, and the plain declines stay quiet',
      '260-cost-ramp-and-bin-targets.test.ts::R280 §4 one confirm walks the ramp to the dialled X and then stops',
    ],
    status: 'fixed',
    note:
      'ROUND 35, filed on arrival. CLIENT. Two halves. The owner overshot the amount and had '
      + 'to cancel the whole play, so the X ramp needs the up/down arrows and typed entry the '
      + 'other X prompts have. And the confirm control needs to look like a button — full '
      + 'width, its own colour. ZSPG replays FAITHFULLY at HEAD (236/236 actions, 0 refused, '
      + 'deterministic, no fork) on engine e8aed524a8, the exact commit deployed, so this is '
      + 'reproducible by replay at the recorded action index. Routed to agent D.',
  },
  {
    id: 148, room: 'ZSPG', date: '2026-08-30',
    report:
      'The Everywhere does not show the card it named in its text box, in the side panel or '
      + 'on hover',
    guards: [
      '259-card-text-surface.test.ts::CT-163: the box of the card that named says WHICH card it named',
      '259-card-text-surface.test.ts::CT-163: with nothing named, the printed clause stands exactly as printed',
    ],
    status: 'fixed',
    note:
      'ROUND 35, filed on arrival. CLIENT. The Everywhere prints "[Augment] During [Haste] '
      + 'name a card. My last named card loses all abilities." The named card is chosen state '
      + 'the player cannot re-read anywhere. ZSPG replays FAITHFULLY at HEAD (236/236 actions, '
      + '0 refused, deterministic, no fork) on engine e8aed524a8, the exact commit deployed, so '
      + 'this is reproducible by replay at the recorded action index. Routed to agent C with '
      + '#153, which is the same fact one layer out.',
  },
  {
    id: 149, room: 'ZSPG', date: '2026-08-30',
    report:
      'the focus panel says the same thing three times when a unit has its abilities switched '
      + 'off',
    guards: [
      '259-card-text-surface.test.ts::CT-164: a switched-off unit states the suppression once, not three times',
      '259-card-text-surface.test.ts::CT-164: a projected ATTRIBUTE is on the attribute row, not restated as a line',
      '259-card-text-surface.test.ts::CT-164: the STAT arithmetic is not deduplicated — compact mode hides it',
    ],
    status: 'fixed',
    note:
      'ROUND 35, filed on arrival. CLIENT. A red banner names the suppressor, the text is '
      + 'struck through, AND a line underneath repeats that the abilities are switched off by '
      + 'the same card. The owner: "Just the banner and crossing out of the text is enough". '
      + 'ZSPG replays FAITHFULLY at HEAD (236/236 actions, 0 refused, deterministic, no fork) '
      + 'on engine e8aed524a8, the exact commit deployed, so this is reproducible by replay at '
      + 'the recorded action index. Routed to agent C.',
  },
  {
    id: 150, room: 'ZSPG', date: '2026-08-30',
    report:
      'a card with prophecy carries no explanation of what prophecy means',
    guards: [
      '259-card-text-surface.test.ts::CT-165: the printed prophecy banner is IN the box, on every card that prints one',
      '259-card-text-surface.test.ts::CT-165: a prophecy card reaches the {Prophecy} reminder in the in-game inspector',
      '259-card-text-surface.test.ts::CT-164 + CT-165: the browser panel does not state prophecy twice',
    ],
    status: 'fixed',
    note:
      'ROUND 35, filed on arrival. CLIENT. Prophecy has a rulings and reminder-text area on '
      + 'the card and nothing in it. Derive the sentence from the pool the way R267 did for '
      + '{Glimpse} rather than authoring one. ZSPG replays FAITHFULLY at HEAD (236/236 actions, '
      + '0 refused, deterministic, no fork) on engine e8aed524a8, the exact commit deployed, so '
      + 'this is reproducible by replay at the recorded action index. Routed to agent C.',
  },
  {
    id: 151, room: 'ZSPG', date: '2026-08-30',
    report:
      'the [Haste] marker on a prophecy says WHEN YOU MAY PROPHESY the card, not when you may '
      + 'play it',
    guards: [
      '257-prophecy-release-timing.test.ts::R277: a banner marked [Haste] may be prophesied during the haste step',
      '257-prophecy-release-timing.test.ts::R277: an UNMARKED banner is still deployment-only — the haste step refuses it',
      '257-prophecy-release-timing.test.ts::R277: the marker never widens the window outside the haste step',
    ],
    status: 'fixed',
    note:
      'ROUND 35, filed on arrival. ENGINE, and the other half of #152. The owner: "Divine '
      + 'Intervention can be Prophecied during the haste step. That is why it has that symbol." '
      + 'So [Haste] in a prophecy condition widens the PROPHESY window (R42 otherwise allows '
      + 'deployment only); it says nothing about the release. ZSPG replays FAITHFULLY at HEAD '
      + '(236/236 actions, 0 refused, deterministic, no fork) on engine e8aed524a8, the exact '
      + 'commit deployed, so this is reproducible by replay at the recorded action index. '
      + 'Routed to agent A as R277.',
  },
  {
    id: 152, room: 'ZSPG', date: '2026-08-30',
    report:
      'a fulfilled prophecy is gated to the prophecy [Haste] marker instead of the card '
      + 'printed timing, and it cost a game',
    guards: [
      '257-prophecy-release-timing.test.ts::R277: the marker does not move a fulfilled release out of battle and into the haste step',
      '257-prophecy-release-timing.test.ts::R277: a fulfilled prophecy on a battle card is offered at a BATTLE window',
      '257-prophecy-release-timing.test.ts::R277: Divine Intervention can be released from cache in the battle it was prophesied for',
    ],
    status: 'fixed',
    note:
      'ROUND 35, filed on arrival. ENGINE, GAME-BREAKING, and it violates a settled ruling '
      + 'while citing that ruling as its authority. engine.ts cachedTiming reads "if (via === '
      + 'prophecy && cc.prophecy?.release) return cc.prophecy.release;" with a comment saying a '
      + 'release marked [Haste] overrides the printed timing "(R42, Divine Intervention)". R42 '
      + 'says the opposite in so many words: "normal TIMING still applies, since it is played '
      + 'as if it were in your hand". Divine Intervention is timing: battle with prophecy { '
      + 'mana: 1, condition: "Your life is 5 or less [Haste]" }, so the override made a battle '
      + 'spell playable only in the haste step. THE OWNER LOST THIS GAME TO IT: log line 321 '
      + 'records the prophecy fulfilled ("it may now be played from cache for free") and grep '
      + 'for a release of Divine Intervention returns ZERO, while lines 494-497 are two '
      + 'Fireballs taking him 2 -> 1 -> 0. Its printed text is "You may change the targets of '
      + 'target effect." ZSPG replays FAITHFULLY at HEAD (236/236 actions, 0 refused, '
      + 'deterministic, no fork) on engine e8aed524a8, the exact commit deployed, so this is '
      + 'reproducible by replay at the recorded action index. Routed to agent A as R277.',
  },
  {
    id: 153, room: 'ZSPG', date: '2026-08-30',
    report:
      'whatever The Everywhere is modding must show the named card too',
    guards: [
      '259-card-text-surface.test.ts::CT-168: the host wearing it as an augment says the named card too',
    ],
    status: 'fixed',
    note:
      'ROUND 35, filed on arrival. CLIENT, and the generalisation of #148: the named card has '
      + 'to be readable on the HOST as well as on The Everywhere itself, because the host is '
      + 'where the loss of abilities is felt. ZSPG replays FAITHFULLY at HEAD (236/236 actions, '
      + '0 refused, deterministic, no fork) on engine e8aed524a8, the exact commit deployed, so '
      + 'this is reproducible by replay at the recorded action index. Routed to agent C.',
  },
  {
    id: 154, room: 'ZSPG', date: '2026-08-30',
    report:
      'a card being targeted in a bin should surface to the top of that bin so both players '
      + 'can see it',
    guards: [
      '260-cost-ramp-and-bin-targets.test.ts::R280 §6 a targeted bin card surfaces onto the region strip, on top',
      '260-cost-ramp-and-bin-targets.test.ts::R280 §6b the dialog marks it too, so one fact reaches both surfaces',
      '260-cost-ramp-and-bin-targets.test.ts::R280 §7b the opponent sees the target too, which is the half the report is really about',
    ],
    status: 'fixed',
    note:
      'ROUND 35, filed on arrival. CLIENT, UX. Today you have to click into the bin to find '
      + 'what an effect is aiming at. ⚠ THIS NOTE ORIGINALLY SAID THE OPPONENT CANNOT OPEN '
      + 'THE BIN AT ALL AND THAT IS FALSE - measured through the real viewFor and the real '
      + 'client, either seat can open either bin and no bin is redacted. The real fault is '
      + 'simpler and symmetric: one strip, three slots, for BOTH seats. ZSPG replays '
      + 'FAITHFULLY at HEAD (236/236 actions, 0 refused, deterministic, no fork) on engine '
      + 'e8aed524a8, the exact commit deployed, so this is reproducible by replay at the '
      + 'recorded action index. Routed to agent D.',
  },
  {
    id: 155, room: 'ZSPG', date: '2026-08-30',
    report:
      'Muck Rummager trigger did not fire on cards trashed during combat',
    guards: [
      '258-simultaneous-disposal-listeners.test.ts::R278: Muck Rummager hears an ally trashed in the same combat-damage batch it dies in',
      '258-simultaneous-disposal-listeners.test.ts::R278 the class: no disposal listener in the pool goes deaf by dying in the same batch',
      '258-simultaneous-disposal-listeners.test.ts::CONTROL: Muck Rummager hears an ally trashed by combat damage it survives',
    ],
    status: 'fixed',
    note:
      'ROUND 35, filed on arrival. Possibly ENGINE — the owner phrased it as a question '
      + '("Shouldn t Muck Rummager s trigger happened here? Her cards were trashed during '
      + 'combat, right?"), so the premise is to be MEASURED before anything is built; a report '
      + 'phrased as a question has been wrong here before. ZSPG replays FAITHFULLY at HEAD '
      + '(236/236 actions, 0 refused, deterministic, no fork) on engine e8aed524a8, the exact '
      + 'commit deployed, so this is reproducible by replay at the recorded action index. '
      + 'Routed to agent B as R278.',
  },
  {
    id: 156, room: 'DQVZ', date: '2026-08-30',
    report:
      'the "hand revealed" helper box dismisses itself, and it lists the cards as they were '
      + 'at the START of the reveal rather than the end',
    status: 'fixed',
    guards: [
      '268-seen-hand-aid-stays.test.ts::CT-174 crossing off the last card does not delete the aid',
      '268-seen-hand-aid-stays.test.ts::CT-174 the only way the aid comes off the screen is the player dismissing it',
      '268-seen-hand-aid-stays.test.ts::CT-174 across every state of the reported game, the aid is never taken away',
      '268-seen-hand-aid-stays.test.ts::CT-174 on the real client the strip collapses to its head',
      '173-look-at-a-hand.test.ts::the card they are MADE to discard is not in the list',
      '173-look-at-a-hand.test.ts::the recycled card goes, and the card they DRAW never appears',
      '173-look-at-a-hand.test.ts::the same rule on a spell that discards, and the list is FROZEN',
      '173-look-at-a-hand.test.ts::the other two shapes',
      '173-look-at-a-hand.test.ts::census: every look-at-a-hand site in the pool is drilled',
    ],
    note:
      'ROUND 36, filed on arrival. CLIENT, two halves. (a) the aid must stay until the player '
      + 'dismisses it — ui/inspect.ts already models per-card and whole-strip dismissals keyed '
      + 'to the snapshot, so something else is clearing it early. (b) the snapshot is taken '
      + 'before the effect finishes, so a card the opponent is being MADE to discard is still '
      + 'listed. ⚠ Bripp is the owner\'s own control on the other side: a card DRAWN inside the '
      + 'same moment must not appear either, so this is one question — when is the snapshot '
      + 'taken — with a test on each side of it. DQVZ replays faithfully at HEAD up to [184], '
      + 'where R284 (today, Void Memory) refuses a passPriority; the report is at [119], well '
      + 'inside the faithful stretch, so it is reproducible by replay. Routed to lane C.\n\n'
      + 'HALF (a) FIXED (CT-174). ⚠ THIS NOTE\'S OWN GUESS WAS WRONG: nothing was clearing '
      + 'the aid early. Measured across all 197 DQVZ actions, seenHandView(...).show goes true '
      + 'at [97] (Eldritch Dreamtender) and is still true at [119] and at every action to the '
      + 'end of the game. The engine clears seenHand only on a draft pack merge (constructed '
      + 'never reaches it); server/view.ts never mentions the field, so it rides every push; '
      + 'the key reads the SNAPSHOT\'s turn, not the live one; and there is no timeout. '
      + '`seenDrop` has one writer and two callers, both click handlers. The bug was what an '
      + 'ORDINARY CLICK DID: `show: cards.length > 0` meant that crossing off the LAST card - '
      + 'which the strip\'s own hint tells you to do as cards are played - deleted the whole '
      + 'aid, persistently (algoSeen:<room>) and with no affordance left to undo it. Now the '
      + 'explicit ✕ dismiss is the only path to hidden, and an emptied strip collapses to its '
      + 'head and offers ↺ show all N.\n\n'
      + 'HALF (b) FIXED (CT-174, engine lane). The snapshot was taken by E.revealHandTo at '
      + 'call time — one line above ctx.choose(dream) in batch-metal-a.ts — so DQVZ\'s list '
      + 'still held the Aberrant Statweaver Rashi was then made to trash. ⚠ THE OWNER\'S '
      + 'SECOND SENTENCE IS THE SPECIFICATION AND IT RULES OUT THE OBVIOUS FIX: "the hand when '
      + 'the moment ends" is wrong, because Bripp recycles a card and the owner then DRAWS, so '
      + 'that hand holds a card the looker never saw. The rule is WHAT YOU SAW, MINUS WHAT HAS '
      + 'SINCE LEFT — an intersection, never an addition — and both halves he named fall out '
      + 'of the one sentence. Done in the ENGINE, not at the five call sites: revealHandTo '
      + 'marks the snapshot `pending`, and E.settleSeenHands reconciles it ONCE from settle(), '
      + 'below the R154 decision guard (so it cannot finish while the effect is still asking '
      + 'which card to discard) and above the R261 damage hold (an Eldritch Dreamtender look '
      + 'is a combat-damage trigger). Multiset, not set: DQVZ\'s own hand holds the Statweaver '
      + 'twice, and being made to discard one must leave the other. Frozen after one pass — a '
      + 'list that kept following the hand would report every later discard and play, a live '
      + 'readout of a hidden zone and a worse bug than the reported one.',
  },
  {
    id: 157, room: 'HTEW', date: '2026-08-30',
    report:
      'a spell effect that lasts until regroup is not mentioned in the target unit\'s '
      + '"current text" box',
    status: 'fixed',
    guards: [
      '266-until-regroup-in-the-box.test.ts::CT-175 \u00a71 the until-regroup fields are read out of the R11 sweep',
      '266-until-regroup-in-the-box.test.ts::CT-175 \u00a72 every until-regroup field changes the box',
      '266-until-regroup-in-the-box.test.ts::CT-175 \u00a73 Phytochemical Protection says so on the unit it shielded',
      '266-until-regroup-in-the-box.test.ts::CT-175 \u00a75 the until-regroup line renders on the real client',
    ],
    note:
      'ROUND 36, filed on arrival. CLIENT, and a CLASS rather than a card. ui/cardtext.ts says '
      + 'so in its own header: "An until-regroup change with no card text behind it is not a '
      + 'line". Stats, tempAttrs, suppressed, granted and copies all have a representation; '
      + 'unstable, damageShield/shieldPending and allured have none. ⚠ DERIVE, DO NOT '
      + 'ENUMERATE — the definition of "until regroup" already exists in exactly one place, '
      + 'the R11 step-3 sweep in engine.ts, and whatever that block deletes is the list. HTEW '
      + 'replays FAITHFULLY at HEAD (206/206 actions, 0 refused, deterministic, no fork) on '
      + 'engine 5e78833e27, so this is reproducible by replay at the recorded action index. '
      + 'Routed to lane D.\n\n'
      + 'FIXED (CT-175). The spell was Phytochemical Protection ([132]/[133], resolved [135] '
      + 'onto Prickly Protector) - it sets `damageShield` and cardtext.ts read that field '
      + 'nowhere. The sweep found twelve until-regroup fields and exactly three holes: '
      + 'damageShield, shieldPending and allured. ⚠ this note was WRONG about `unstable`, '
      + 'which has been on the attribute row with origin "temp" since R271/#143. Fixed with a '
      + 'new "until" line origin in ui/cardtext.ts - a LINE and not a `state` note, because '
      + 'the owner was HOVERING and the hover tip renders compact, which drops the state row. '
      + 'The guard parses its field list out of the R11 sweep itself, so the next field added '
      + 'there arrives as a red test naming it. ⚠ HTEW no longer replays 206/206 at HEAD: it '
      + 'diverges at [148] on this round\'s Earthbound Replicator decision. [132]-[141] is '
      + 'still inside the faithful stretch.',
  },
  {
    id: 158, room: 'HTEW', date: '2026-08-30',
    report:
      'Overbloom did not produce a second copy when the triggered ability\'s requirements '
      + 'were met',
    status: 'fixed',
    guards: [
      '138-spell-copy.test.ts::a DEPLOY-timing spell is copied too',
      '138-spell-copy.test.ts::the deploy-timing copy may be RE-AIMED',
      '138-spell-copy.test.ts::a deploy-timing play names a REAL stack item',
      '138-spell-copy.test.ts::census: every spell that could ask the Replicator',
    ],
    note:
      'ROUND 36 (CT-176). The premise MEASURED and CONFIRMED: the owner was right. The play '
      + 'is [146]+[147], not [148] (which is the doneDeploying he clicked afterwards), and it '
      + 'happened during DEPLOYMENT. The Earthbound Replicator\'s trigger fired — the HTEW log '
      + 'carries "Trigger: Earthbound Replicator — the player copies their nonunit spell '
      + 'targeting me" right after the Overbloom cast — and then said "Overbloom already left '
      + 'the stack — no copy" about a stack Overbloom had never been on. Overbloom prints '
      + 'DEPLOY timing, and a deployment play is committed with commitItem(…, \'resolve\'): it '
      + 'resolves where it stands and never reaches the stack, so R178\'s item id named '
      + 'nothing. spellPlayed now also carries the item itself (`offStack`) for exactly those '
      + 'no-stack plays, E.playedItem is the one reader, and the Replicator asks it. Derived '
      + 'from printed.json: [Overbloom] is the ONLY nonunit spell in the pool that is both '
      + 'playable outside battle and able to target a unit, out of 19 non-battle nonunit '
      + 'spells — so this combination has never once worked since R164, and the census guard '
      + 'fires if a second such card is ever added.',
  },
  /* ── ROUND 37 (2026-09-05): the first live game on the deployed site ──
   * Room VNNW, draft, mycheze (seat 0, the owner's account) vs the owner's
   * own signed-out second tab (seat 1). All four filed through the new T6
   * form; VNNW replays FAITHFULLY at HEAD (222/222, 0 refused, no fork). The
   * intake itself broke on them first: the deploy box had moved that morning
   * and its journal started at zero, so `npm run reports` refused the fetch
   * as a SHRINK (159 → 4). It merges now (fetch-reports.mjs), which is why
   * these are #159–#162 and not #0–#3. Rows before the `by` stamp existed:
   * who filed them is known from the room file's `users`, not the row. */
  {
    id: 159, room: 'VNNW', date: '2026-09-05',
    report:
      'casting Soul Siphon, you cannot see which player lost how much life; on the stack it '
      + 'shows both players\' totals rather than the targeted one\'s',
    status: 'fixed',
    guards: [
      '295-soul-siphon-x-per-player.test.ts::§1 the target buttons carry each player',
      '295-soul-siphon-x-per-player.test.ts::§2 on the stack only the declared target',
      '295-soul-siphon-x-per-player.test.ts::§3 the control: a mode-narrowed card and a plain option are untouched',
    ],
    note:
      'ROUND 37, filed by mycheze (owner) from seat 0, ux/medium, action 122. CLIENT. #85 had '
      + 'already given the card one preview row per seat — on the HAND chip, where the number '
      + 'is not needed; the target question drew bare player names. Now a {player} option of a '
      + 'cast whose card previews per seat carries that seat\'s row on its button ("Player 2 · '
      + 'X = 7"), and once the target is declared the stack chip keeps only that seat\'s row — '
      + 'the same self-checking narrowing R57 modes already had. Derived from a `seat` the rows '
      + 'now carry (perSeatRows), never from the label.',
  },
  {
    id: 160, room: 'VNNW', date: '2026-09-05',
    report:
      'a prophesied card says "4 turns pass" but there is no way to see how many have passed '
      + 'or how close it is',
    status: 'fixed',
    guards: [
      '294-prophecy-meter.test.ts::§1 the engine meters a counting prophecy off the same delta the fulfilment test reads',
      '294-prophecy-meter.test.ts::§2 the cache dialog shows how far along it is, and drops the meter once fulfilled',
      '294-prophecy-meter.test.ts::§3 the control: a state condition still reads "not yet" with no meter',
    ],
    note:
      'ROUND 37, filed by mycheze (owner) from seat 0, ux/medium, action 131. CLIENT over a '
      + 'one-line engine query: R43 already stamped the turn a card was prophesied on and '
      + 'prophecyMet read the delta; nothing showed it. `E.prophecyProgress` reads the same '
      + 'delta (the counting rows of PROPHECY_RULES grew a `progress`), and the cache dialog '
      + 'wears "⏳ 1/4 turns" and "— 3 turns to go". A state condition has no meter and still '
      + 'says "not yet".',
  },
  {
    id: 161, room: 'VNNW', date: '2026-09-05',
    report:
      'choosing how much life to pay for Flesh Tithe is confusing: too many buttons, and a '
      + 'warning that X = 0 while the box says otherwise',
    status: 'fixed',
    guards: [
      '260-cost-ramp-and-bin-targets.test.ts::R280 §3 that is enough is a full button, and the plain declines stay quiet',
    ],
    note:
      'ROUND 37, filed by mycheze (owner) from seat 0, ux/medium, action 160. CLIENT, and the '
      + 'second report on this bar: #147 (R280) built the dial, and the bar kept drawing the raw '
      + 'engine pair it dials — "Pay 1 more life" and "That\'s enough — X = 0 ⚠ creates no unit" '
      + '— beside it: ELEVEN buttons, two saying X = 0 while the box said 11. MEASURED with the '
      + 'ui-driver before touching anything. On a ramp the raw pair is not drawn; the dial\'s '
      + 'confirm carries R64\'s own stop label (warning included, so ⚠ shows exactly when X is 0) '
      + 'and becomes "Pay N more life — X = N" once dialled up; quick picks at or below the '
      + 'floor go. Seven buttons.',
  },
  {
    id: 162, room: 'VNNW', date: '2026-09-05',
    report:
      'Prismatic Observer ("recall up to one cached card") could target an opponent\'s cached '
      + 'card during deployment, when the opponent does not exist',
    status: 'fixed',
    guards: [
      '293-cached-targets-are-regional.test.ts::R291 §1 in deployment a home region reaches only its own seat',
      '293-cached-targets-are-regional.test.ts::R291 §2 the report: Prismatic Observer sacrificed in deployment cannot reach the opponent',
      '293-cached-targets-are-regional.test.ts::R291 §3 the control: in battle the Observer reaches the opponent',
      '38-light-a.test.ts::Prismatic Observer: sacrifice to recall a cached card (either cache, in battle) and gain 3 life',
    ],
    note:
      'ROUND 37, filed from seat 1 (the owner\'s signed-out tab), bug/gamebreaking, action 178. '
      + 'ENGINE — R291. The premise MEASURED on the faithful replay: [176]/[177] offered the '
      + 'other seat\'s cached Hammer of Justice in deployment, and pushCachedCardTargets said '
      + 'why in its own comment ("not region-scoped: the cache is not in a region") — true of '
      + 'the zone, wrong about its owner. A player\'s cache is targetable exactly where that '
      + 'player is PRESENT (the presentSeats test "target player" already uses); alone in your '
      + 'deployment region (R12) that is your own cache only; in battle both. 38-light-a\'s '
      + '"either cache" test was doing exactly what the report describes and moved into a battle.',
  },
  {
    id: 163, room: '', date: '2026-09-14',
    report:
      'Feature request from the home page: the rulebook\'s "simpler" rules for newcomers — '
      + 'two colours, 5-card packs, silver (simple) cards only',
    status: 'fixed',
    guards: [
      '296-custom-draft-deal.test.ts::BL-43 §1b no deal and a deal left at the defaults deal the identical game in every mode',
      '296-custom-draft-deal.test.ts::BL-43 §2a pack size: packs of 5 at the deal',
      '296-custom-draft-deal.test.ts::BL-43 §2c two elements: the rulebook pair by default',
      '297-custom-rules-resolve.test.ts::BL-43 resolve §3 Simple cards only leaves out exactly the cards that are not simple',
      '297-custom-rules-resolve.test.ts::BL-43 resolve §7 the beginner preset clears the floor for every pair',
      '298-custom-rules-ui.test.ts::BL-43 ui §2 the Beginner preset sends two elements, simple cards and packs of 5',
    ],
    note:
      'The first report from outside, filed signed out the day algomancy.online went public. '
      + 'A feature: the rulebook Quick Start suggests two factions (Fire and Wood) and removing the '
      + 'gold-symbol cards; 5-card packs are not in the printed text we hold. The owner widened it to '
      + 'BL-43, Custom rules on a live draft lobby — pack size, element count, Simple cards only, '
      + 'bans, life, opening hand, draws and a card filter, with a Beginner preset (two elements, '
      + 'simple cards, packs of 5). Mutation-checked: dropping the deal from the restore turns three '
      + 'server/test-custom-rules.ts checks red; dropping the custom exit from foldSeat turns two.',
  },
  {
    id: 165, room: 'KAWJ', date: '2026-09-15',
    report:
      'Damage got combined here Adversary of the Deep. All combat damage happens as a single '
      + 'number — the {Sluggish} Adversary struck as a printed 2/2 because its own '
      + '"whenever a player loses life" trigger, fired by the normal sub-step, was held to '
      + 'after combat',
    status: 'fixed',
    guards: [
      '297-damage-substeps-are-steps.test.ts::R295 §1 the report: a {Sluggish} Adversary of the Deep grows on the normal step BEFORE it strikes',
      '297-damage-substeps-are-steps.test.ts::R295 §2 the boundary is a real priority window',
      '297-damage-substeps-are-steps.test.ts::R295 §3 the control: with no {Swift} and no {Sluggish} anywhere, R261 is untouched',
      '297-damage-substeps-are-steps.test.ts::R295 §4 damageSubs is fixed when the step opens',
      '239-damage-triggers-after-combat.test.ts::R295: in a SPLIT damage step a death trigger resolves at the boundary, not after combat',
      '21-fixes.test.ts::Flowstone Arcanite (R295): the Swift-step counters land at the boundary, in time to save the ally',
    ],
    note:
      'Filed medium; it was game-breaking. R295. R261 quoted the owner\'s condition — "if there '
      + 'are no units in combat with sluggish or [swift]" — and then implemented the sentence '
      + 'after it, so the trigger hold became unconditional. A split damage step is several '
      + 'steps: each sub-step\'s triggers stack and resolve, with priority, before the next '
      + 'deals damage. KAWJ should have been 6, then Adversary at 8/8 for 8 — the guard asserts '
      + 'that number. Mutation-checked: disabling the `struckNow && moreLater` handover turns '
      + 'six of 297\'s seven tests red — everything except §3, the unsplit control, which is '
      + 'exactly the half of R261 that did not change — and takes four of 239\'s with it.',
  },
  {
    id: 166, room: 'BTUX', date: '2026-09-15',
    report: 'My unit has Blessed and I should have gained life from it dealing damage!',
    status: 'fixed',
    guards: [
      '298-column-attrs-outside-combat.test.ts::R294 §1 the report: an ability fired by a unit in a {Blessed} column gains its controller life',
      '298-column-attrs-outside-combat.test.ts::R294 §1b the control: the same board with no {Blessed} in the column gains nothing',
      '298-column-attrs-outside-combat.test.ts::R294 §2 every source-side attribute rides the same line',
      '298-column-attrs-outside-combat.test.ts::R294 §3 outside battle there are no columns at all',
      '298-column-attrs-outside-combat.test.ts::R294 §5 Unstable and Burst are not in the attribute set',
    ],
    note:
      'R294. Soul Reaver\'s activated ability fired off Refuse Reclaimer, whose column-mate '
      + 'Flzzz prints {Blessed}; `dealEffectDamageAll` read the SOURCE with `ownAttrs` while '
      + 'reading the recipient\'s {Vulnerable} with `effAttrs` two lines below. Both sides read '
      + '`effAttrs` now. Narrow by construction: a column only exists in combat, so nothing '
      + 'outside battle changed. {Feeble} and {Alluring} stay `ownAttrs` on the owner\'s '
      + 'explicit call, and §4 reads apply.ts to keep them there. Mutation-checked: putting '
      + '`ownAttrs` back on the source turns §1 and §2 red while §1b stays green.',
  },
  {
    id: 167, room: 'BTUX', date: '2026-09-15',
    report: 'Formless didn\'t properly remove attributes from the column',
    status: 'fixed',
    guards: [
      '299-formless-column.test.ts::R293 §1 the report: Formless takes {Blessed} off the whole column, not just its target',
      '299-formless-column.test.ts::R293 §1b and therefore nobody gains life when the column connects',
      '299-formless-column.test.ts::R293 §1c the control: without Formless the same column DOES gain',
      '299-formless-column.test.ts::R293 §2 the base rewrite still hits the TARGET alone',
      '299-formless-column.test.ts::R293 §4 a unit that joins the column afterwards keeps its own attributes',
    ],
    note:
      'R293. The printed reminder says "(This removes attributes from its column.)" and the '
      + 'engine stamped the target only, so BTUX\'s attacking column kept the {Blessed} Flzzz '
      + 'was sharing in, dealt 17 and gained 17 life. Every unit in the target\'s column is '
      + 'stamped now; the base rewrite is still the target\'s alone. The stamp is per unit and '
      + 'until regroup (owner: "it wouldn\'t make sense for it to get them back"), so it '
      + 'outlives the column and a later arrival is untouched. Mutation-checked: stamping the '
      + 'target alone turns §1 and §1b red while §1c stays green. ⚠ THE MUTATION EARNED ITS '
      + 'KEEP — on the first pass §1b stayed GREEN under it, because the fixture stopped with '
      + 'the trigger resolved and no combat damage yet, so it was comparing a life total to '
      + 'itself. It drives to damage now and asserts a combatDamage event happened.',
  },
  {
    id: 168, room: '', date: '2026-09-17',
    report: 'From the home page (Debeli): "You can\'t recycle for the multicolored one you start with to decide later"',
    status: 'fixed',
    guards: [
      '308-recycle-for-prismite.test.ts::R299 every hand card offers a Prismite, then a Shard, after the elements',
      '308-recycle-for-prismite.test.ts::R299 a recycled Prismite behaves like a starting one',
      '308-recycle-for-prismite.test.ts::R299 a recycled Shard is mana only',
      '308-recycle-for-prismite.test.ts::R299 what stays illegal',
    ],
    note:
      'R299. Filed as ux, but it was an engine refusal: `doRecycle` accepted only an element of '
      + 'the game, so the Prismite could not be made from hand at all. The designer allows it '
      + '("Yep you can grab prismites", rules-questions 2025-05-09). legalActions offers it after '
      + 'the elements and the hand menu lists "Recycle → Prismite" below them, above "more '
      + 'elements…". Mutation-checked: refusing prismite in doRecycle turns the second guard red, '
      + 'dropping it from legalActions turns the first red; 75-ui-reachability pins the menu item. '
      + 'Same day, the owner: "it\'s also legal to make a shard as well … very very rare", so a '
      + 'Shard is offered too, last, and in the client only behind the expander (now in every '
      + 'game, "more…" when no element is hidden). Refusing it turns the Shard guard red.',
  },
];
