/**
 * THE RAQ REGISTER — every rulings thread in the Discord export, read against
 * the engine.
 *
 * The bot has always ingested these threads (bot/pipeline/build_rulings.py);
 * nothing checked the ENGINE against them. Until 2026-10-09 a thread was read
 * only when a bug led someone to it, and 37 of the 52 RAQ threads were cited
 * nowhere in client/. The owner asked "did we process each of those examples
 * and turn them into tests?" — this file is the answer, one entry per thread.
 *
 * ── HOW AN ENTRY IS FILLED ─────────────────────────────────────────────────
 * Read the WHOLE thread, its images included (most worked examples are
 * screenshots). `calebgannon` is the designer and the final word; `_passer`
 * writes most [Solved] summaries and they are reliable; everyone else is a
 * player reasoning aloud. Then list every concrete CLAIM the thread makes —
 * each worked example is a claim — and for each one either:
 *   - `covered`: name the test that fails if the engine disagrees (a guard is
 *     `file.test.ts::unique substring of a test title`, as in every ledger);
 *   - `broken`: the engine disagrees today — open a CT ticket and name it;
 *   - `outdated`: a later ruling (R-number, or a later thread) replaced it;
 *   - `untestable`: say why (a card not in the pool, a mechanic Caleb is
 *     still workshopping, a question with no answer in the thread).
 *
 * The index this is checked against is ledgers/raq-threads.snapshot.jsonl
 * (`npm run raq:index` after every bot/pipeline/export_rulings.sh); the
 * checker is engine/test/386-raq-register.test.ts.
 */

export type ClaimStatus = 'covered' | 'broken' | 'outdated' | 'untestable';

export interface RaqClaim {
  /** the claim in one plain sentence, in the game's terms */
  claim: string;
  /** who said it, and the words: `calebgannon: "…"` / `_passer (write-up image 2): "…"` */
  source: string;
  status: ClaimStatus;
  /** `covered`: the tests that fail if the engine disagrees */
  guards?: string[];
  /** `broken`: the CT ticket (card-todo.ts id) that tracks it */
  ticket?: number;
  /** required for `outdated` (what replaced it) and `untestable` (why) */
  note?: string;
}

export interface RaqEntry {
  /** the Discord thread id — the key the snapshot uses */
  id: string;
  /** the thread title, as exported (a hint only; the id is the key) */
  title: string;
  /**
   * `unreviewed`: nobody has read it against the engine yet.
   * `reviewed`: read in full; `claims` lists everything it settles.
   * `skipped`: nothing to check — an empty thread, an open [TODO]/[Asked]
   *   question with no answer, or a duplicate of another thread (`note` says which).
   */
  status: 'unreviewed' | 'reviewed' | 'skipped';
  claims?: RaqClaim[];
  /** required for `skipped`; anything else worth knowing */
  note?: string;
}

export const RAQ: RaqEntry[] = [
  { id: "1353847640214999170", title: "[Solved] Reconfigure vs Despawn", status: 'unreviewed' },
  { id: "1353848722974445658", title: "[Solved] Reconfigure vs Once per Turn Abilities", status: 'unreviewed' },
  { id: "1353854163154632887", title: "[Considered] 2nd combat damage by removing Swift.", status: 'unreviewed' },
  { id: "1353856176558706769", title: "[Solved] Reconfigure onto Perpetual Construct.", status: 'unreviewed' },
  { id: "1353859961855148103", title: "[Solved] Amphivore / Lost Guardian. Bounded Grafts and Ralph explained.", status: 'unreviewed' },
  { id: "1353862592661164152", title: "[Solved] Bloomcaster vs Mycelial Mentor and Spell Units.", status: 'unreviewed' },
  { id: "1353864175910387742", title: "[Solved] Download. What is a token (and what is not).", status: 'unreviewed' },
  { id: "1353888077625561108", title: "[Solved] Excessive Combat Damage & interaction with Piercing, Deadly and Phytochemical Protection.", status: 'unreviewed' },
  { id: "1353895783266516992", title: "[Solved] Dead Unit Effect on Stack", status: 'unreviewed' },
  { id: "1353899470156206152", title: "[Solved] Meteor Shower. How it works.", status: 'unreviewed' },
  { id: "1353900204163731546", title: "[TODO]", status: 'unreviewed' },
  { id: "1353980184042143835", title: "[Solved] Increasing Spells Cost vs Triggers checking \"where X is spells cost\"", status: 'unreviewed' },
  { id: "1353986897902567424", title: "[Considered] Temporal Rift vs NIT sending counter-attack.", status: 'unreviewed' },
  { id: "1354013430805434389", title: "[Solved] When does effect fizzles?", status: 'unreviewed' },
  { id: "1354148437355925554", title: "[Solved] Poisonous vs \"Whenever I am dealt damage\" vs Phytochemical Protection", status: 'unreviewed' },
  { id: "1355103348378042515", title: "[Solved] Crevice Lurker explained", status: 'unreviewed' },
  { id: "1355115946032889914", title: "[Solved] Graft 101. All you need to know about Grafts.", status: 'unreviewed' },
  { id: "1355466429788328066", title: "[Solved] Valid targets becomes invalid.", status: 'unreviewed' },
  { id: "1355613076506017894", title: "[Solved] Earthbound Replicator. No, it's not infinity", status: 'unreviewed' },
  { id: "1355633589890584636", title: "[Solved] Nectar Ridge vs Sandstone Defender & Wisp Weaver. (Very rare Animated Spark)", status: 'unreviewed' },
  { id: "1355685844467581081", title: "[Asked] Suppression Field & Formless vs Gaining Attributes/Abilities + Joining formation", status: 'unreviewed' },
  { id: "1355689559609839787", title: "[Solved] Recall Spell Token / Token unit. Token Unit dying.", status: 'unreviewed' },
  { id: "1355845893219287132", title: "[Solved] Monke & Transmogrifant vs  Suppression Field & Formless.", status: 'unreviewed' },
  { id: "1356667460211966060", title: "\"After Combat\" (Regarding Lost Guardian)", status: 'unreviewed' },
  { id: "1357483405276614856", title: "[Solved] Does \"Tides of the cosmos\" ignore timing of cards?", status: 'unreviewed' },
  { id: "1357965714807586897", title: "[Solved] Timestamps vs Static Abilities", status: 'unreviewed' },
  { id: "1358299200953126963", title: "Mana question", status: 'unreviewed' },
  { id: "1358495859804864865", title: "After combat effects & player death", status: 'unreviewed' },
  { id: "1359629594512068770", title: "[Solved] Spells with cost X vs Stasis Sentry", status: 'unreviewed' },
  { id: "1362832912579559664", title: "[Solved] Tough + \"Double defense until regroup\"", status: 'unreviewed' },
  { id: "1362838395298119912", title: "[Solved] Resonant, Combat Damage, Conduit and Powerful", status: 'unreviewed' },
  { id: "1363298910528864318", title: "[Solved] Swift/Normal/Sluggish. Opportunity windows & Gaining-Losing Attributes /Joining mid combat", status: 'unreviewed' },
  { id: "1364890301147250798", title: "[Solved] Are counters cumulative or distinct?", status: 'unreviewed' },
  { id: "1365594171867664445", title: "[Solved] Piercing, side block and combat damage from defending formation.", status: 'unreviewed' },
  { id: "1366446116274442291", title: "[Solved] Trigger-like Attributes vs Crevice Lurker & Containment Protocol", status: 'unreviewed' },
  { id: "1366447016653361192", title: "[Solved] What is blocked? <Bubby don't hurt me>", status: 'unreviewed' },
  { id: "1368892615101251584", title: "[Asked] Vulnerable & Excess (from Electric or Piercing)", status: 'unreviewed' },
  { id: "1372451771632320512", title: "[Solved] Vulnerable + Piercing / Electric", status: 'unreviewed' },
  { id: "1372468222158180424", title: "[Solved & Expanding?] Borrower of Forms - The weird interactions", status: 'unreviewed' },
  { id: "1379132904931594372", title: "[Solved] Maelstrom Charger - all you need to know.", status: 'unreviewed' },
  { id: "1380147621544591411", title: "That is something where NIT has an", status: 'unreviewed' },
  { id: "1396955380000755795", title: "[Solved] Tides of Cosmos - all you need to know.", status: 'unreviewed' },
  { id: "1397188292239163454", title: "[Solved] Oorblak vs Piercing.", status: 'unreviewed' },
  { id: "1397189214352703590", title: "[Solved] Xenopod Progenitor - When enemy negates vs when you pay?", status: 'unreviewed' },
  { id: "1397256636921417748", title: "[Solved] Envoy of Lightning vs Twin Flame.", status: 'unreviewed' },
  { id: "1402292180499955884", title: "[Solved] Squish/Fight/Battle vs Source of damage & Interactions", status: 'unreviewed' },
  { id: "1410252965276684418", title: "[Solved] Target requirements to put effect on stack.", status: 'unreviewed' },
  { id: "1449475896510648320", title: "[Solved] Life lost in battle vs Gaining life", status: 'unreviewed' },
  { id: "1451507918171013252", title: "hi first play through and got couple of", status: 'unreviewed' },
  { id: "1454169054402314362", title: "Another set of questions, this time on", status: 'unreviewed' },
  { id: "1460212274936414381", title: "[Solved] [Cost] vs Trigger. What is first?", status: 'unreviewed' },
  { id: "1460213341011050536", title: "[Solved] Thieving with 2 units in column?", status: 'unreviewed' },
  { id: "1460216519731577027", title: "[Solved] Alluring AND Evasive column", status: 'unreviewed' },
  { id: "1461450216874967235", title: "[Solved] Spell Units played when you can \"play a unit from hand\" (Hooba-Pon, Insidious Invitation)", status: 'unreviewed' },
  { id: "1461462542663549021", title: "[Solved] Oorblak vs Piercing", status: 'unreviewed' },
  { id: "1464899726796390433", title: "@Caleb Gannon, what about Courier and", status: 'unreviewed' },
  { id: "1465292396664193171", title: "[Solved] Dispatch Courier vs Battle Timing", status: 'unreviewed' },
];
