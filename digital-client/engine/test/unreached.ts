/* R217 — THE UNREACHED LEDGER, EXTRACTED SO IT CAN BE READ WITHOUT PARSING.
 *
 * This literal used to live inside `84-card-semantics.test.ts`. It moved here
 * for one reason: **anything else that needs to know which cards are unreached
 * was forced to scrape the test file, and a scrape of it went blind.**
 *
 * The scenario-tester queue built its risk ranking by regexing `^  '([^']+)':`
 * out of the source and got **32 keys where the object has 37**. Five entries
 * — Worldbender, Nothyr, Proph, Skybreaker, Vengeance — are single-word card
 * names written as BARE JS IDENTIFIERS with no quotes, and the pattern
 * demanded a quote. Two independent scrapes agreed on 32, which is worth
 * noting on its own: they shared the assumption, not the answer, so their
 * agreement was not evidence of anything.
 *
 * The five it dropped were all `BOARD` entries — the precondition a human CAN
 * build and a fixture cannot — i.e. exactly the slice the queue exists to
 * prioritise. That is the failure mode docs/13-assessment.md §5 is a list of,
 * and §7.2's answer applies verbatim: **derive, never enumerate.** Import this
 * object; do not read the file it used to live in.
 */

/**
 * Every gated promise no fixture in the library can reach, NAMED — which is
 * the form CARD-TODO #49 says it closes in ("the remainder are clauses no
 * fixture can reach, named individually rather than counted").
 *
 * 38 claims over 37 cards, down from 52 at the end of R180 and from 218 over
 * the whole gated heap when the ticket was filed. Each entry opens with WHAT
 * KIND of unreachable it is:
 *
 *   REAL   — the clause is not implemented. Cite a CARD-TODO id. (None yet:
 *            stages 3 and 4 found no broken card, and that null result is
 *            measured by the positive controls below, not assumed.)
 *   REGION — R12. The clause is scoped to the region its event fires in, and
 *            the card is standing in its home region while the battle is being
 *            fought in the other seat's. ⚠ R199 CLOSED FIVE OF THE SIX — see
 *            the block on the family below, and 170-battle-position-promises
 *            for the per-card assertions that keep them closed.
 *   EVENTLESS
 *          — the clause IS implemented and it really happens, but the code that
 *            does it emits no event of the right type, so nothing in the game —
 *            not this checker, not a listener, not a public zone — can see it.
 *            This is a REAL DEFECT in the card and differs from VOCAB in the
 *            direction that matters: VOCAB says our vocabulary is too narrow,
 *            EVENTLESS says the card is not speaking. It has its own opener
 *            rather than REAL's because REAL is contracted to cite a CARD-TODO
 *            id and only the ticket owner opens those; an EVENTLESS entry is a
 *            defect REPORTED to that owner and waiting for one.
 *   BOARD  — implemented, but the drill cannot build the precondition.
 *   CHOICE — implemented, but it is behind a decision `progressAction` answers
 *            the other way (it takes option 0, which is "pay" / "decline" /
 *            "no" depending on the card).
 *   VOCAB  — the card really does the thing and the engine really emits an
 *            event for it, but no event in `EVIDENCE[kind]` names that event.
 *            ⚠ The fix is NOT to widen EVIDENCE: "create a Shard" evidenced by
 *            `resourceActivated` would let a card promising "create a 2/2
 *            unit" pass by making a resource instead.
 *   EXTRACT— the phrase `claims.ts` matched is not a promise at all — it is the
 *            card's own trigger clause, or a zone name. These are the ones the
 *            extractor should eventually stop counting; until it does, they are
 *            honest members of the denominator.
 */
export const UNREACHED: Record<string, string> = {
  // ── REGION (R12): the clause needs the card to be IN the battle's region ──
  //
  // ⚠ R199 CLOSED FIVE OF THE SIX. The family was never a property of the
  // cards and it was not, as the plan assumed, a missing attacking position
  // either: `progressAction` has always declared the fullest attack on offer,
  // so the card marches into the defender's region every game. What was missing
  // was a BEAT that waits for it — the `@battle` repeats all fired in the
  // DECLARE step, before attacks exist, with the card still at home. The
  // `inBattle` pin fires a beat only while the subject stands in the battle's
  // region, and the beats behind it aim at THAT region instead of at home.
  // Galerider Eel, Colony of the Interworld, Rider of the Tides, Xenopod
  // Progenitor and Boreal Wanderer all deliver now, each with a named
  // assertion in 170-battle-position-promises quoting its printed clause.
  'Bloated Manablub':
    'REGION — "each opponent loses 3 life" loops over `regions[ctx.region].presentSeats`, and the '
    + "trigger resolves in the drill's home region where no opponent is present, so the loop runs "
    + 'zero times. ⚠ It does this SILENTLY; its sibling Boreal Wanderer announces the same no-op. '
    + '⚠ THE LAST OF THE SIX, and R199 measured exactly why the `inBattle` pin does not reach it: '
    + 'this card is a 2/2 that the `counters` and `damage` beats leave dead before the declare '
    + 'step, and the drill\'s "keep the card on the table" respawn puts it back AT HOME, mid-battle '
    + 'and too late to join the attack. It never stands in a battle at all (`inBattleBeats` is '
    + 'empty for it), so both beats that make it leave play fire at home. The precondition it '
    + 'still lacks is a body that survives to the declare step, or a respawn that puts it into the '
    + 'battle region its seat is already present in.',

  // ── BOARD: implemented, precondition unbuildable by the drill ────────────
  'Fire Resource':
    'BOARD — "when I activate" needs a resource activated for mana through the real path, and '
    + '`fundSeat` hands the seat open resources in bulk instead, so the event never fires.',
  'Water Resource': 'BOARD — the same "when I activate" precondition as Fire Resource.',
  'Earth Resource': 'BOARD — the same "when I activate" precondition as Fire Resource.',
  'Nimbus Eel':
    'BOARD — "when you play a TOKEN spell". A spell token is cast from play, never played from '
    + 'hand, and the fixture library has nothing that casts one.',
  'Mirage Walker':
    'BOARD — "if you took no actions during deployment". The drill deploys, plays and fires '
    + 'fixtures every deployment, so the condition is false by construction.',
  'Seabed Shellcaster':
    'BOARD — "when the SECOND nontoken spell is played in this battle". press mode plays one spell '
    + 'and one unit, and both land in the same window rather than in one battle.',
  Proph:
    'BOARD — "when you play a card from anywhere other than your hand". Every press play is from '
    + 'hand; there is no bin- or cache-play fixture.',
  'Stalwart Sentinel': 'BOARD — the same play-from-elsewhere precondition as Proph.',
  Worldbender:
    'BOARD — "skip your draft step" only exists in a drafted game; the drill plays constructed.',
  'Prediction Prophet':
    'BOARD — "create a 5/5 unit IF YOU MATCHED THE PREDICTION". The trigger fires and resolves; '
    + 'the drill answers the prediction with the FLOOR of R197\'s numeric entry (0) and the life '
    + 'total moves.',
  'Sporebloom Siren':
    'BOARD — "delete all units with -1/-1 counters on them", resolved on a board where the units '
    + 'carrying the `counters` fixture\'s minus counters are already dead. It fires and announces '
    + 'the empty sweep.',
  'Stellarspore Harvester':
    'BOARD — "gain control of target unit IF IT HAS a -1/-1 counter on it" at the after-combat '
    + 'step. The minus counters the fixture places do not survive to that step on a unit that is '
    + 'still a legal target.',
  Nothyr:
    'BOARD — "negate up to one target NONSPELL effect". The bait the drill can put on the stack is '
    + 'a spell effect, so there is correctly nothing of that kind to aim at.',
  'Perpetual Construct':
    'BOARD — "whenever a mod is applied to ME". The `modApplied` fixture deliberately mods somebody '
    + 'else: modding the card under test makes it {Unstable} (R79), which turns its next death into '
    + 'an erase and takes it out of the game for every later beat.',
  'Earnest Defender':
    'BOARD — "whenever an ally becomes the target of an ENEMY SPELL". The `targeted` fixture is a '
    + "synthesised targeting, not an enemy's spell, and the bait scenario does not run under the "
    + 'augment host.',
  'Keeper of Tithes':
    'BOARD — "if X is not 0, where X is the number of EXPENDED resources you have". `fundSeat` '
    + 'refills the seat with OPEN resources at every window, so X is always 0. The trigger fires, '
    + 'resolves and says so.',
  'Debt Plant': 'BOARD — the same expended-resource count as Keeper of Tithes, and the same X = 0.',
  'Molten Riftbreaker':
    'BOARD — "when I despawn, negate all ALLIED SPELLS". Nothing of the seat\'s own is on the stack '
    + 'when the host leaves play, and the trigger announces the empty sweep.',
  Skybreaker:
    'BOARD — "Erase me: negate all SPELL EFFECTS", activated at a window where the stack holds no '
    + 'spell. The erase half of the same line IS observed.',
  'Void Mandible':
    'BOARD — "sacrifice me. If you do, negate that effect." The negate IS observed; the sacrifice '
    + 'is a MOD leaving play, which is not a `died` and not a `trashed`, so nothing in '
    + 'EVIDENCE.sacrifice can name it.',
  'Cthyrian Rector':
    'BOARD — same shape: the recall half is observed (`leftBin`), the self-sacrifice is a mod '
    + 'leaving play and emits neither `died` nor `trashed`.',
  'Pestilent Mycelion':
    'BOARD — "whenever one or more -1/-1 counters are put on a unit, each opponent loses 1 life". '
    + 'The trigger fires and resolves; the life loss is region-scoped to the opponents present.',
  'Automaton of Abundance':
    'BOARD — a REPLACEMENT ("if you would create one or more unit tokens, instead …"). It needs a '
    + 'token creation by the HOST\'s controller while the augment is on, which no beat provides.',
  'Skittering Blight':
    'BOARD — a REPLACEMENT on rot damage ("if rot would deal damage to you, instead put that many '
    + '+1/+1 counters on me"). Nothing in the library gives the seat rot and then lets it tick.',
  Vengeance:
    'BOARD — "cards your opponents play during battle gain [Sacrifice a unit]". It grants a COST to '
    + "somebody else's cards; the drill never has the opponent play a card while the augment is on.",

  // ── CHOICE: behind a decision answered the other way ────────────────────
  'Soul Tithe':
    'CHOICE — "the controller of target effect MAY PAY [one]. If they don\'t, negate that effect '
    + 'and draw a card." `progressAction` answers a payOrDecline with option 0, which is PAY, so '
    + 'the negate branch is never taken.',
  'Frosted Denial': 'CHOICE — the same payOrDecline, answered the same way.',
  'Necromantic Rebuke':
    'CHOICE — "negate up to one target effect UNLESS its controller erases X cards from their bin". '
    + 'The controller is offered the escape and takes it.',
  'Null Drone':
    'CHOICE — "negate target spell effect IF ITS COST is less than or equal to the greatest amount '
    + 'of life lost by a player in this battle". No life has been lost in the bait battle, so the '
    + 'threshold is 0 and no cost clears it.',
  'Scholar of the Void':
    'CHOICE — "you MAY discard your hand and transform me". The trigger fires and resolves; the '
    + 'offer is declined.',

  // ── EVENTLESS: it happens, and nothing in the game can see it happen ────
  'Hooba-Lan':
    'VOCAB — "create a Shard" makes a RESOURCE and emits `resourceActivated`. EVIDENCE.create is '
    + 'tokenCreated/spawned. ⚠ Widening it would let a card promising "create a 2/2 unit" pass by '
    + 'making a resource instead.',
  'Swirling Shardform': 'VOCAB — the same Shard/resource mismatch as Hooba-Lan.',
  'Cinder Scuttler':
    'VOCAB — the card recalls itself from the BIN into play. `recall` has no event type of its own '
    + '(EVIDENCE.recall is empty) and its state evidence is a HAND delta, which a bin→play recall '
    + 'never makes. `leftBin` is observed instead.',

  // ── EXTRACT: the matched phrase is not a promise ────────────────────────
  'Mycelial Mentor':
    'EXTRACT — the "create a" matched is inside the TRIGGER CLAUSE ("when you create a token"), not '
    + 'the promise. The actual promise — "target ally gains +3/+3" — is observed as `statChanged`.',
  'Lurking Dread':
    'EXTRACT — the word "cache" matched is a ZONE ("put me into play from your bin OR FROM CACHE"), '
    + 'not the verb. The clause itself is observed: the sacrifices, the trash and the spawn are all '
    + 'in the window.',
};

/** Every card the drill cannot reach a printed promise on. Keyed by CARD;
 *  the tally in 84-card-semantics counts CLAIMS, and several cards carry more
 *  than one — that unit switch has produced three wrong summaries. */
export const UNREACHED_CARDS: readonly string[] = Object.keys(UNREACHED);

/** The opener each entry declares, e.g. BOARD / CHOICE / VOCAB. */
export function unreachedOpener(card: string): string | null {
  const why = UNREACHED[card];
  return why ? (/^([A-Z]+)/.exec(why)?.[1] ?? null) : null;
}
