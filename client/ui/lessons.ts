/* R297 — LEARN TO PLAY: THE LESSONS.
 *
 * The order a game reaches each idea (the owner's outline, revised after the
 * first playtest — viruses moved behind augmenting, the stack given its own
 * page, a nudge on the second planning phase):
 *
 *   1   Anatomy of a card, and the two card types     the start of the game
 *   2   Planning: resources, affinity, recycling, Shards
 *   3   Deployment and regions                        the first deployment
 *   3b  Attributes                                    the first unit with one
 *   ↺   Planning again (a compact nudge)              turn 2's planning
 *   4   Combat                                        the first battle moment
 *   5   Battle spells and the stack
 *   6   Augmenting
 *   6b  Viruses                                       only after augmenting
 *   7   Grafting
 *   8   Haste
 *   🏁  How it went, other formats, where next
 *
 * WRITING RULES, from the playtest:
 *   · every page shows something — a real card, a flow, a formation, a stack —
 *     picked from the learner's own element wherever the pool allows
 *   · the opponent is "your opponent"; the lessons never talk about the bot
 *   · rulebook quotes are tucked away (lessonlayer draws them collapsed)
 *   · no ruling numbers, no implementation talk (286's rule for player text)
 *   · where the Manual and this client differ, say what the client does:
 *     deployment is simultaneous and hidden here
 *
 * Triggers read only the learner's view and legal list (lessonflow.ts).
 */
import { allRows, rowFor, type CardRow } from './cardindex.ts';
import { GLOSSARY } from './glossary.ts';
import { TUTORIAL } from './tutorial.ts';
import {
  canAugment, canDo, canPlay, hand, myUnits, theirUnits,
  type FigCard, type Figure, type Lesson, type LessonCtx,
} from './lessonflow.ts';
import { figCardHtml } from './lessonlayer.ts';
import {
  isAugmentCard, isBattleCard, isGraftCard, isHasteCard, isLearnElement, isVirus, learnerPool,
  type LearnElement,
} from './lessondeck.ts';

// ── what the words depend on ──────────────────────────────────────────

const PIP: Record<LearnElement, string> = { fire: 'r', water: 'b', earth: 'e', wood: 'g', metal: 'm' };
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** the learner's element, off their deck identity (fire when no game is up) */
function element(c: LessonCtx): LearnElement {
  const el = c.state.deckElements?.[c.seat]?.[0] ?? hand(c).find(r => r.factions.length)?.factions[0];
  return isLearnElement(el) ? el : 'fire';
}
const El = (c: LessonCtx): string => cap(element(c));
const resource = (c: LessonCtx): string => `${El(c)} Resource`;

const pool = (c: LessonCtx): CardRow[] => learnerPool(element(c));
const cheapest = (rows: CardRow[]): CardRow[] =>
  [...rows].sort((a, b) => a.mana + a.pipCount - (b.mana + b.pipCount) || a.name.localeCompare(b.name));

/** a card the learner is holding (or has in play) matching `pred`, else the
 * cheapest in their element's pool, else the cheapest Simple card anywhere */
function example(c: LessonCtx, pred: (r: CardRow) => boolean): string | null {
  const held = hand(c).find(pred) ?? myUnits(c).map(u => rowFor(u.card)).find((r): r is CardRow => !!r && pred(r));
  if (held) return held.name;
  const fromPool = cheapest(pool(c).filter(pred))[0];
  if (fromPool) return fromPool.name;
  return cheapest(allRows().filter(r => r.cls === 'card' && r.playable && r.complexityLc === 'simple' && pred(r)))[0]?.name ?? null;
}

const deployUnit = (r: CardRow): boolean => r.kind === 'unit' && r.timing === 'deploy' && !r.virus;
const deploySpell = (r: CardRow): boolean => r.kind === 'spell' && r.timing === 'deploy' && !r.virus;

/** the calibrated anatomy card for each element: a unit whose anchors below
 * were checked against its scan (the type line sits higher on a card with a
 * two-line text box than on one with a single line) */
const ANATOMY: Record<LearnElement, { card: string; typeY: number }> = {
  fire: { card: 'Static Courier', typeY: 83.5 },
  water: { card: 'Bloated Manablub', typeY: 87 },
  earth: { card: 'Lithoghul', typeY: 83.5 },
  wood: { card: 'Guardian of the Grotto', typeY: 83.5 },
  metal: { card: 'Refuse Reclaimer', typeY: 83.5 },
};

const reminder = (attr: string): string =>
  GLOSSARY.find(g => g.term.toLowerCase() === attr.toLowerCase())?.text ?? '';

const clean = (t: string): string => t.replace(/\{\/n\}/g, '').replace(/\s*\{i\}\([^)]*\)\.?/g, '').replace(/\s+/g, ' ').trim();

/** what a card's [Augment] gives a host: its type-line attributes and its paragraph */
function augmentText(r: CardRow): string {
  const parts: string[] = [];
  if (r.augmentAttrs.length) parts.push(`gains ${r.augmentAttrs.map(a => `**${a}**`).join(', ')}`);
  const m = /\[Augment\]\s*([^\n]*)/i.exec(r.text);
  if (m?.[1]) parts.push(clean(m[1]));
  return parts.join('; ');
}

/** a card's graft split: the cause before the symbol, the effect from it on */
function graftParts(r: CardRow): { cause: string; effect: string } | null {
  const m = /^(.*?)(\[Switch1?\])\s*(.*)$/is.exec(clean(r.text));
  return m ? { cause: m[1]!.trim().replace(/,$/, ''), effect: `${m[2]} ${m[3]!.trim()}` } : null;
}

/** A turn's phases as a strip, one lit. */
function turnStrip(lit: string): Figure {
  const phases = ['Planning', 'Haste', 'Battle', 'Regroup', 'Deploy'];
  return { kind: 'html', html: `<div class="lturn">${phases.map(p => `<span class="${p === lit ? 'on' : ''}">${p}</span>`).join('<i>▸</i>')}</div>` };
}

/** The stack as a pile of cards, bottom first, with what has resolved beside it. */
function stackPile(pile: FigCard[], resolved: FigCard[] = []): Figure {
  const cards = pile.map((fc, k) => figCardHtml(fc).replace('<span class="lfigcard', `<span style="--k:${k}" class="lfigcard`)).join('');
  return {
    kind: 'html', html: `<div class="lstack">
      <div><div class="lstackpile" style="--n:${Math.max(0, pile.length - 1)}">${cards}</div><div class="lstacklabel">${pile.length ? 'the stack — the top resolves first' : 'the stack is empty'}</div></div>
      ${resolved.length ? `<div class="lresolved"><div class="lres">${resolved.map(figCardHtml).join('')}</div><div class="lstacklabel">resolved</div></div>` : ''}
    </div>`,
  };
}

/** The two regions, side by side. */
function regions(mine: string, theirs: string, between = ''): Figure {
  return {
    kind: 'html', html: `<div class="lregions">
      <div class="lregion mine"><h5>your region</h5>${mine}</div>
      ${between ? `<div class="lwall">${between}</div>` : ''}
      <div class="lregion theirs"><h5>your opponent's region</h5>${theirs}</div>
    </div>`,
  };
}
const cardRow = (cards: FigCard[]): string => `<div class="lfigcards">${cards.map(figCardHtml).join('')}</div>`;
const token = (stats: string): Exclude<FigCard, string> => ({ name: 'Unit Token', badge: stats });

// ── predicates ────────────────────────────────────────────────────────

const inPlanning = (c: LessonCtx): boolean => c.state.phase === 'planning' && !c.state.hasteDone && canDo(c, 'donePlanning');
const inDeploy = (c: LessonCtx): boolean => c.state.phase === 'deploy' && canDo(c, 'doneDeploying');
const inBattle = (c: LessonCtx): boolean => c.state.phase === 'battle';

// ── the lessons ───────────────────────────────────────────────────────

export const LESSONS: readonly Lesson[] = [
  {
    id: 'welcome', n: '1', title: 'Anatomy of an Algomancy card',
    when: () => true,
    pages: [
      {
        title: 'Welcome to Algomancy',
        body: `*This tutorial is a first version. If anything is confusing, wrong or missing, please tell us with the **📝 Report** button — feedback is very welcome.*

This is a real game. You will learn it as it happens: a lesson like this one opens the first time something matters. Hide it (**▁ hide**, or Escape) to look at the board, and the 📘 pill brings it back.

Every turn has the same four phases (planning, which ends with a short haste step, then battle, regroup and deployment), and both players go through them together.`,
        callout: '**How to win:** both players start at 30 life. Bring your opponent\'s life to 0.',
        quotes: [{ text: 'Each player begins with 30 life. Eliminate all of your opponents by bringing their life to 0.', source: 'Manual, p. 6' }],
        figure: { kind: 'cards', cards: ['Turn Structure'], caption: 'The turn, at a glance. Hover the card for a closer look.' },
      },
      {
        title: 'Reading a card',
        body: c => `Hover each part below to see where it is on the card.

- {{part:name|Card name}} — along the top.
- {{part:cost|Mana cost}} — the number in the circle: how many resources you must expend to play it.
- {{part:affinity|Affinity}} — the element icons beside the cost ([${PIP[element(c)]}] is ${element(c)}). You must have that many resources of that element among your resources to play it. They are not paid; they only have to be there.
- {{part:stats|Stats}} — a unit's *power* / *defense*: the damage it deals, and the damage it can take in one battle.
- {{part:type|Type line}} — what the card is (unit or spell, and its kinds), and its **attributes** in bold and gold.
- {{part:text|Text box}} — what it does. [Augment] and [Switch] mark text that can be moved onto other cards; we'll learn about those later.
- {{part:set|Set symbol}} — its colour shows complexity. Gold means complex; every card in your deck today is a simple one.
- **Timing** — an icon at the end of the top bar. No icon means deployment only; {Battle} can only be played in battle; {Haste} can also be played in the haste step; {Virus} can also be augmented during battle.`,
        quotes: [
          { text: 'MANA COST: This many resources must be paid in order to be played.', source: 'Manual, p. 12' },
          { text: 'AFFINITY: Resource types needed to be present among your resources to be able to play the card.', source: 'Manual, p. 12' },
          { text: 'Indicates the expansion and its color denotes the complexity of the card (gold = complex).', source: 'Manual, p. 12 (set symbol)' },
        ],
        figure: c => {
          const a = ANATOMY[element(c)];
          const y = a.typeY;
          return {
            kind: 'anatomy', card: a.card,
            parts: { name: [36, 7.5], cost: [7, 7.5], affinity: [12, 7.5], stats: [88, 7.5], type: [25, y], set: [91, y], text: [50, y + 6.5] },
          };
        },
      },
      {
        title: 'The two card types',
        body: `- **Units** stay in play until something removes them, and fight in battle.
- **Spells** do something once, then go to your bin.
- **Spell units** are both: a spell that becomes a unit when it resolves.`,
        quotes: [
          { text: 'Units are permanents, meaning when played, they will stay in play until removed.', source: 'Manual, p. 13' },
          { text: 'Spells provide one-time effects and are used to interact, create or modify certain aspects of the game.', source: 'Manual, p. 13' },
        ],
        figure: c => {
          const u = example(c, deployUnit), s = example(c, deploySpell);
          return { kind: 'cards', cards: [...(u ? [{ name: u, label: 'a unit' }] : []), ...(s ? [{ name: s, label: 'a spell' }] : [])], caption: 'Both of these are played in deployment.' };
        },
      },
    ],
  },

  {
    id: 'planning', n: '2', title: 'Planning: resources and affinity',
    when: inPlanning,
    pages: [
      {
        title: 'Resources are your mana',
        body: `You pay for cards with **resources**. Each one can be *expended* (turned sideways) once a turn for 1 mana, and they all refresh at the start of the next turn.

You start with two **Prismites** (the P cards by your life total). They (like all resources when you first make them) are *dormant* — face down — and a dormant resource gives nothing.`,
        quotes: [
          { text: 'All resources have the ability to be expended for 1 mana once per turn in order to pay for the mana cost of cards and abilities.', source: 'Manual, p. 14' },
          { text: 'Dormant resources provide no affinity or mana. You may activate up to two resources each turn during the resource step, flipping them over permanently.', source: 'Dormant Resource card' },
        ],
        figure: { kind: 'cards', cards: [{ name: 'Dormant Resource', label: 'dormant: face down, gives nothing' }, { name: 'Prismite', label: 'an active Prismite: 1 mana' }] },
      },
      {
        title: 'Activate two a turn',
        body: `You may activate up to two resources each turn. In the first few turns, you'll almost certainly want to make two per turn. Click a dormant resource to activate it. It stays face up for the rest of the game.`,
        callout: c => `The Prismites you start with can be **exchanged** for an activated resource of any colour. They can be expended for mana on their own, but until you exchange them, they won't add to your affinity count. Click an active Prismite to exchange it for ${element(c)}.`,
        quotes: [
          { text: 'All resources spawn dormant (come into play face down). Players may activate a maximum of two resources per turn by turning them face up.', source: 'Manual, p. 18' },
          { text: 'Active Prismites may be exchanged for other resources, meaning players essentially get to pick their two starting resources for free.', source: 'Manual, p. 18' },
        ],
        figure: c => ({
          kind: 'flow',
          steps: [
            { name: 'Dormant Resource', label: 'a dormant Prismite' },
            { name: 'Prismite', label: 'activate it' },
            { name: resource(c), label: `exchange it for ${element(c)}` },
          ],
        }),
      },
      {
        title: 'Affinity',
        body: c => {
          const el = element(c), p = PIP[el];
          return `Your **affinity** for an element is how many of your active resources are that element. A card showing [${p}][${p}] needs two ${el} resources among yours. Affinity is not spent — it only has to be there — and Prismites and Shards give mana but no affinity.`;
        },
        quotes: [{ text: 'Affinity: To have the ability to play a card, a player must meet the affinity requirement of the card they wish to play.', source: 'Manual, p. 13' }],
        figure: c => {
          const el = element(c);
          const units = pool(c).filter(r => r.timing === 'deploy' && r.kind === 'unit');
          const pair = [2, 1, 3]
            .map(m => [cheapest(units.filter(r => r.mana === m && r.pipCount === 1))[0], cheapest(units.filter(r => r.mana === m && r.pipCount === 2))[0]] as const)
            .find(([a, b]) => a && b);
          const figs: Figure[] = [
            { kind: 'cards', cards: [{ name: resource(c), label: `${el}: 1 mana, 1 affinity` }, { name: 'Shard Resource', label: 'a Shard: 1 mana, no affinity' }], caption: `Two resources: 2 mana, but only one ${el} affinity.` },
          ];
          if (pair) {
            figs.push({
              kind: 'cards', cards: [
                { name: pair[0]!.name, label: 'playable — needs 1 affinity' },
                { name: pair[1]!.name, dim: true, label: 'not yet — needs 2 affinity' },
              ], caption: 'The same mana cost — but with those resources, only one of them can be played.',
            });
          }
          return figs;
        },
      },
      {
        title: 'Recycling: turning cards into resources',
        body: c => `Most cards need affinity, and affinity comes from **elemental resources**. To make one, click a card in your hand and **Recycle** it for an element — the card goes under your deck and a dormant ${El(c)} resource appears. You may recycle as many cards as you like, but you can still only activate two resources a turn.

Every card you recycle is a card you will not play, so choose one you need least.`,
        callout: 'If your deck runs out of cards, all your recycled cards are shuffled together to become your deck. The order you recycle cards in is irrelevant — they\'ll all be mixed together before you see any of them.',
        quotes: [{ text: 'During this step, any resource can be created from outside the game by recycling a card from hand (putting it on the bottom of the deck).', source: 'Manual, p. 18' }],
        figure: c => {
          const card = example(c, r => r.kind === 'unit');
          return { kind: 'flow', steps: [...(card ? [{ name: card, label: 'a card from your hand' }] : []), { name: 'Dormant Resource', label: `a dormant ${element(c)} resource` }, { name: resource(c), label: 'activated' }] };
        },
      },
      {
        title: 'Shards',
        body: c => `When you activate an elemental resource and it gives you **three or more affinity** for its element, you get a free **Shard** as well. A Shard is 1 mana with no affinity. It arrives **dormant**, like every new resource: activating it later uses one of your two activations for that turn.

**Your turn:** play your planning phase. You can activate (by clicking) Prismites, recycle cards for ${element(c)} (don't forget to activate them) and even try exchanging a Prismite for a ${El(c)} resource. Everything is done by clicking and choosing from a menu. During planning, you can also use \`Ctrl + Z\` to undo things if you make a mistake. When you're done, press **done planning** or hit \`Enter\`.`,
        callout: 'This means that you are rewarded for making more resources of the same colour, since each recycled card can generate 2 resources, rather than just 1.',
        quotes: [{ text: 'The elemental resources can provide free Shards when they are activated if the player has at least three affinity towards that resource. Shards are a resource that adds no affinity, but can still be expended for mana like all other resources.', source: 'Manual, p. 18' }],
        figure: c => {
          const R = resource(c);
          return {
            kind: 'frames', play: 'loop', frames: [
              { figure: { kind: 'cards', cards: [R, R] }, caption: `Two ${element(c)} resources: 2 affinity.` },
              { figure: { kind: 'cards', cards: [R, R, { name: 'Dormant Resource', label: 'recycled: dormant' }] }, caption: 'Recycle a card for a third…' },
              { figure: { kind: 'cards', cards: [R, R, { name: R, label: 'activated' }] }, caption: '…activate it: that is 3 affinity…' },
              { figure: { kind: 'cards', cards: [R, R, R, { name: 'Dormant Resource', label: 'the free Shard — dormant' }] }, caption: '…and a free Shard appears — **dormant**, like every new resource.' },
              { figure: { kind: 'cards', cards: [R, R, R, { name: 'Shard Resource', label: 'activated on a later turn' }] }, caption: 'Activate it like any other resource. It uses one of your two activations, and gives 1 mana.' },
            ],
          };
        },
      },
    ],
  },

  {
    id: 'deploy', n: '3', title: 'Deployment and regions',
    when: inDeploy,
    pages: [
      {
        title: 'Every player has their own region',
        body: `The board is two **regions**: your opponent's at the top, yours below. A region is a completely separate place. Nothing in one can see, reach or affect anything in the other.

This is the most unusual idea in Algomancy, so read the box below twice — and step through the picture.`,
        callout: `Every card has the hidden text **"in this region"** on it. So a card that says *Delete target unit* actually says *Delete target unit* **in this region**.

If you're not actively in combat with an opponent, they **do not exist**. You can't target them or any of their units, and they can't do anything to you.`,
        quotes: [
          { text: 'All gameplay in Algomancy takes place inside of regions, with one region for each player. Each region is a location that is completely isolated from the other regions. This means there is zero information or interaction between regions.', source: 'Manual, p. 19' },
          { text: 'For example "Delete target unit" means "Delete target unit in this region".', source: 'Manual, p. 19' },
        ],
        figure: c => {
          const u = example(c, deployUnit);
          const mine = cardRow(u ? [u, u] : []) + '<div class="lspelltext">Delete target unit <b>in this region</b></div>';
          const theirs = cardRow([token('2/2'), token('1/1')]);
          return {
            kind: 'frames', play: 'step', frames: [
              { figure: regions(mine, theirs, '🚫 no way across'), caption: 'Outside battle, your spell can only find units in **your** region. Your opponent\'s units are not there — for you, they do not exist.' },
              { figure: regions(cardRow(u ? [u] : []), cardRow([token('2/2'), token('1/1'), ...(u ? [{ name: u, label: 'your attacker' }] : [])])), caption: 'In battle, attacking moves your units **into** your opponent\'s region. Now they are in the same place: they can fight, and be targeted.' },
            ],
          };
        },
      },
      {
        title: 'Deploying',
        body: c => {
          const ex = example(c, deployUnit);
          return `**Deployment** is where you build your forces: play units and spells, activate abilities, and apply mods. Any card can be played now except {Battle} cards.

In this client both players deploy at the same time, each alone in their own region. You will not see what your opponent did until you both finish — then their moves are revealed.

**Your turn:** cards you can afford glow. Click one to play it${ex ? ` — [[${ex}]] is a good start` : ''}. When you are finished, press **done deploying**.`;
        },
        quotes: [
          { text: 'Any card can be played during this phase, with the exception of battle cards, which can only be played in the battle phase.', source: 'Manual, p. 26' },
          { text: 'This means that created spell tokens or any stat changes made during the deployment phase will persist until the following combat.', source: 'Manual, p. 26' },
        ],
        figure: c => {
          const held = hand(c).filter(deployUnit).slice(0, 2).map(r => r.name);
          return held.length ? { kind: 'cards', cards: held, caption: 'In your hand right now.' } : turnStrip('Deploy');
        },
        highlight: ['.phasetrack'],
      },
    ],
  },

  {
    id: 'attributes', n: '3b', title: 'Attributes',
    when: c => myUnits(c).some(u => (rowFor(u.card)?.attrs.length ?? 0) > 0),
    optional: true,
    pages: [
      {
        title: 'The bold gold words on the type line',
        body: c => {
          const unit = myUnits(c).map(u => rowFor(u.card)).find((r): r is CardRow => !!r && r.attrs.length > 0)
            ?? rowFor(example(c, r => r.kind === 'unit' && r.attrs.length > 0) ?? '');
          const lines = (unit?.attrs ?? []).map(a => `- **${a}** — ${reminder(a) || 'see its reminder on the card.'}`).join('\n');
          return `${unit ? `[[${unit.name}]]` : 'This unit'} has ${unit && unit.attrs.length > 1 ? 'attributes' : 'an attribute'}:

${lines}

**Attributes** are the bold gold words on a card's type line. They change how a unit attacks, blocks or takes damage. Most cards print a short reminder of what their attributes do.`;
        },
        callout: '**Hover any card** — in your hand, on the board, anywhere — to read its text and reminders. **Right-click it** for everything: every attribute explained, the tokens it makes, and its rulings.',
        quotes: [{ text: 'Describes the qualities of the card, including some combat modifiers, denoted in bold yellow or purple.', source: 'Manual, p. 12 (types and attributes)' }],
        figure: c => {
          const unit = myUnits(c).find(u => (rowFor(u.card)?.attrs.length ?? 0) > 0)?.card ?? example(c, r => r.kind === 'unit' && r.attrs.length > 0);
          return unit ? { kind: 'cards', cards: [unit] } : null;
        },
      },
    ],
  },

  {
    id: 'planning-again', n: '', title: 'Planning again',
    compact: true,
    optional: true,   // a nudge must never hold a lesson back
    when: c => c.state.turn >= 2 && inPlanning(c),
    pages: [
      {
        title: 'A new turn',
        body: 'You\'re in planning again now! You can always see what to do in the **yellow box above your hand**, and quickly tell which part of the turn you\'re in up at the **top of the screen**.',
        highlight: ['.actionbar', '.phasetrack'],
      },
    ],
  },

  {
    id: 'combat', n: '4', title: 'Combat with units',
    // any battle moment the learner is asked to act in — not only a declaration:
    // a learner with no units never declares (the empty block is automatic), and
    // this lesson holds back every one after it
    when: c => inBattle(c) && c.legal.length > 0,
    pages: [
      {
        title: 'The shape of a battle',
        body: `Battle has two halves. First the **initiative** player (⭐ at the top) attacks into the other region (or declines to attack at all), and the defender blocks — and may also *send* units to counterattack. Then those sent units attack back in the second half. Each side attacks once a turn, and the initiative passes every turn.

Units attack **players**, not other units.`,
        callout: 'Remember, since Algomancy works based on regions, if you do not enter your opponent\'s region and they also don\'t enter yours, neither of you can interact with each other\'s units or life total. **The battle phase is the heart of all interaction in a game.**',
        quotes: [
          { text: 'Units attack players directly. They do not attack individual units unless directed by a spell', source: 'Manual, p. 20' },
          { text: 'The NIT declare their blocking formations while also having the opportunity to send attacking units for a counter-attack.', source: 'Manual, p. 20' },
        ],
        figure: { kind: 'cards', cards: ['1v1 Turn Structure'], caption: 'The battle, step by step. Hover it to read.' },
      },
      {
        title: 'Formations and columns',
        body: `Attackers stand in a **formation**: as many columns as you like, each with a front unit and at most one behind it. A column deals damage equal to the **total power** of its units.

To attack, click your units into columns and rows, then confirm.`,
        quotes: [
          { text: 'Formations have a front and back row but can scale infinitely in width.', source: 'Manual, p. 22' },
          { text: 'Each column of attacking and defending units in a formation deals damage equal to the combined power of each unit within that column.', source: 'Manual, p. 23' },
        ],
        figure: c => {
          const units = cheapest(pool(c).filter(r => deployUnit(r) && r.power > 0));
          if (units.length < 4) return null;
          const [a, b, d, e] = units as [CardRow, CardRow, CardRow, CardRow];
          return {
            kind: 'formation', attacker: 'yours', theirs: [[], [], []], yours: [[a.name], [b.name, d.name], [e.name]],
            notes: [`${a.power} damage`, `${b.power} + ${d.power} = ${b.power + d.power} damage`, `${e.power} damage`],
            caption: 'You attack with three columns. The middle one is two units deep, so it hits with both of them.',
          };
        },
      },
      {
        title: 'Blocking',
        body: `To block, put one of your units in front of an attacking column. **One blocker blocks the whole column**: it deals no damage to you. The column and its blockers damage each other instead — front unit first, then any excess to the unit behind. Excess never reaches you.

Unblocked columns hit you for their full power. Use **next step** to watch one play out.`,
        quotes: [
          { text: 'Once a defending unit has been placed in front of an attacking column, that entire column is considered blocked. Blocked units do not deal combat damage to you.', source: 'Manual, p. 23' },
          { text: 'Excess damage beyond the health of the back row unit does not carry over to the player.', source: 'Manual, p. 23' },
        ],
        figure: c => {
          const units = cheapest(pool(c).filter(r => deployUnit(r) && r.power >= 1));
          const small = units.find(r => r.toughness >= 2) ?? units[0];
          const big = [...units].sort((a, b) => b.power - a.power || b.toughness - a.toughness)[0];
          if (!big || !small || big.name === small.name) return null;
          const theirs = [[token('1/1')], [token('2/2')], [token('3/3')]];
          const smallDies = small.toughness <= 1, bigDies = big.toughness <= 3;
          return {
            kind: 'frames', play: 'step', frames: [
              { figure: { kind: 'formation', attacker: 'theirs', theirs, yours: [[], [], []] }, caption: 'Your opponent attacks you with three columns: a 1/1, a 2/2 and a 3/3.' },
              { figure: { kind: 'formation', attacker: 'theirs', theirs, yours: [[small.name], [], [big.name]] }, caption: `You block the 1/1 with [[${small.name}]] (${small.power}/${small.toughness}) and the 3/3 with [[${big.name}]] (${big.power}/${big.toughness}). The 2/2 is left unblocked.` },
              {
                figure: {
                  kind: 'formation', attacker: 'theirs',
                  theirs: [[{ ...token('1/1'), cross: small.power >= 1 }], [token('2/2')], [{ ...token('3/3'), cross: big.power >= 3 }]],
                  yours: [[{ name: small.name, cross: smallDies }], [], [{ name: big.name, cross: bigDies }]],
                  notes: ['they damage each other', '2 damage to you', 'they damage each other'],
                },
                caption: 'Damage: each blocked column and its blocker damage each other at the same time (✕ marks what died). Only the unblocked 2/2 reaches you.',
              },
            ],
          };
        },
      },
      {
        title: 'Regroup',
        body: `After battle comes **regroup**, and nobody acts: every unit goes home, damage on units is healed, temporary changes wear off, spell tokens are erased, and formations break up. A unit only dies if it took its defense in damage *during* the battle.`,
        quotes: [{ text: 'All units and players return to their regions / All damage on units is removed / All temporary stat changes are removed / All Spell Tokens are erased / All units leave formation', source: 'Manual, p. 26' }],
        figure: c => {
          const u = example(c, r => deployUnit(r) && r.toughness >= 2);
          return u ? { kind: 'flow', steps: [{ name: u, badge: '1 damage', label: 'after the battle' }, { name: u, label: 'regroup: healed, home, out of formation' }] } : turnStrip('Regroup');
        },
      },
    ],
  },

  {
    id: 'battle-spells', n: '5', title: 'Battle spells and the stack',
    when: c => c.state.turn >= 3 && inBattle(c) && canPlay(c, isBattleCard),
    optional: true,
    pages: [
      {
        title: 'Cards you can play in battle',
        body: c => {
          const ex = example(c, isBattleCard);
          return `${ex ? `[[${ex}]]` : 'A card'} has the {Battle} icon: it can **only** be played in battle — which makes it the one way to surprise your opponent mid-fight.

Battle is the only interactive phase. Every card played, ability activated or trigger that happens goes on the **stack** instead of resolving at once, so the other player can respond.`;
        },
        quotes: [
          { text: 'Battle cards can only be played while in battle with another player.', source: 'Manual, p. 13' },
          { text: 'Whenever a card gets played or an ability is activated or triggered, it is added to the stack as an "effect". This means it does not resolve immediately, giving other players in the region a chance to respond.', source: 'Manual, p. 28' },
        ],
        figure: c => { const ex = example(c, isBattleCard); return ex ? { kind: 'cards', cards: [ex] } : null; },
      },
      {
        title: 'The stack: last in, first out',
        body: `Cards on the stack pile up, and **the top one resolves first**. So a response always happens before the thing it responds to.

Between the steps of a battle there are **priority windows**. The initiative player may act first, then the other. When both **pass** in a row, the top of the stack resolves, and both get priority again. When both pass with the stack empty, the battle moves on. **Pass** (space) is how you say "nothing from me".

Step through the rulebook's own example.`,
        quotes: [
          { text: 'Interaction between players during the battle phase uses the stack, which abides by the concept of "First in, last out".', source: 'Manual, p. 28' },
          { text: 'When all players pass priority, the effect on the top of the stack (which was played last) will resolve immediately. Then all players gain priority in order again.', source: 'Manual, p. 30' },
        ],
        figure: {
          kind: 'frames', play: 'step', frames: [
            { figure: stackPile(['Flame of History']), caption: 'Player A plays [[Flame of History]]. It goes on the stack, and player B has a chance to respond.' },
            { figure: stackPile(['Flame of History', 'Boon of Protection']), caption: 'Player B responds with [[Boon of Protection]], putting it on top.' },
            { figure: stackPile(['Flame of History', 'Boon of Protection', 'Arc Lightning']), caption: 'Player A responds to that with [[Arc Lightning]] — on top again.' },
            { figure: stackPile(['Flame of History', 'Boon of Protection'], ['Arc Lightning']), caption: 'Both players pass. **Arc Lightning resolves first**, because it was on top.' },
            { figure: stackPile(['Flame of History', 'Boon of Protection', 'Null Drone'], ['Arc Lightning']), caption: 'New cards can be added while a stack is resolving: player A plays [[Null Drone]], targeting Boon of Protection.' },
            { figure: stackPile(['Flame of History'], ['Arc Lightning', 'Null Drone', { name: 'Boon of Protection', cross: true }]), caption: 'Both pass. Null Drone resolves and negates Boon of Protection.' },
            { figure: stackPile([], ['Arc Lightning', 'Null Drone', 'Flame of History']), caption: 'Both pass. Flame of History finally resolves. If both pass again with the stack empty, the battle moves on.' },
          ],
        },
      },
    ],
  },

  {
    id: 'augment', n: '6', title: 'Augmenting',
    when: c => c.state.turn >= 4 && inDeploy(c) && canAugment(c, r => isAugmentCard(r) && !r.virus && !isGraftCard(r)),
    optional: true,
    pages: [
      {
        title: 'Moving text onto a unit',
        body: c => {
          const ex = example(c, r => isAugmentCard(r) && !isGraftCard(r) && !r.virus);
          return `Text after the [Augment] symbol can be **added to another card**. ${ex ? `[[${ex}]] has it.` : ''} In deployment, pay the augmenting card's full cost (and meet its affinity), pick one of your units, and that unit gains the text. The augment card is tucked **under** the unit as a **mod**, with its text box showing — so you can always read what was added.

A unit can take any number of augments. Step through to see a heavily augmented one.`;
        },
        quotes: [
          { text: 'The Augment mechanic allows players to take all of the text in the paragraph following the augment symbol and add it onto other cards.', source: 'Manual, p. 32' },
          { text: 'Place the augment card beneath the targeted card, with the textbox visible beneath it to demonstrate the additional line of text.', source: 'Manual, p. 32' },
        ],
        figure: c => {
          const augs = cheapest(pool(c).filter(r => isAugmentCard(r) && !isGraftCard(r) && !r.virus && !!augmentText(r)));
          const hostOk = (r: CardRow): boolean => deployUnit(r) && r.power + r.toughness >= 3;
          const host = cheapest(pool(c).filter(r => hostOk(r) && !isAugmentCard(r) && !isGraftCard(r)))[0]
            ?? cheapest(pool(c).filter(r => hostOk(r) && !augs.slice(0, 4).some(m => m.name === r.name)))[0];
          if (!host || augs.length < 2) return null;
          const reads = (mods: CardRow[]): string => [
            `**${host.name}**, ${host.power}/${host.toughness}${clean(host.text) ? `: ${clean(host.text)}` : ''}`,
            ...mods.map(m => `[Augment] ${augmentText(m)} *(from [[${m.name}]])*`),
          ].join('\n\n');
          const mods = augs.filter(r => r.name !== host.name);
          const one = mods.slice(0, 1), many = mods.slice(0, 4);
          return {
            kind: 'frames', play: 'step', frames: [
              { figure: { kind: 'modded', host: host.name, mods: one.map(r => r.name), reads: reads(one) }, caption: 'One augment: the mod sits under the unit, its text box showing.' },
              { figure: { kind: 'modded', host: host.name, mods: many.map(r => r.name), reads: reads(many) }, caption: `A heavily augmented unit: ${many.length} mods, and every one of their abilities.` },
            ],
          };
        },
      },
      {
        title: 'From your hand — or your bin',
        body: `Augments can come from **your hand or your bin**, so a spent card can come back as a mod. Open your bin (the pile on the right of your region): cards there that glow can be applied right now.

The price: a modded unit is **Unstable**. When it dies, it and all its mods are erased — so a card is usually only modded once. If it goes back to your hand instead, the mods go to your bin.`,
        quotes: [
          { text: 'Augments can be applied from either the hand or from the bin.', source: 'Manual, p. 32' },
          { text: 'As long as a card is modded, it has the unstable attribute, meaning when it dies or is erased, it and all of its mods are erased with it.', source: 'Manual, p. 35' },
        ],
        figure: c => {
          const aug = cheapest(pool(c).filter(r => isAugmentCard(r) && !r.virus && !isGraftCard(r) && !!augmentText(r)))[0];
          const host = aug && cheapest(pool(c).filter(r => deployUnit(r) && r.name !== aug.name && r.power + r.toughness >= 3))[0];
          if (!aug || !host) return null;
          return {
            kind: 'frames', play: 'step', frames: [
              { figure: { kind: 'cards', cards: [{ name: aug.name, label: 'in your bin — already played, or died' }, { name: host.name, label: 'your unit in play' }] }, caption: `[[${aug.name}]] is in your bin.` },
              { figure: { kind: 'modded', host: host.name, mods: [aug.name], reads: `**${host.name}** gains:\n\n[Augment] ${augmentText(aug)}` }, caption: 'In deployment, apply it from the bin: the spent card comes back as a mod under your unit.' },
            ],
          };
        },
      },
    ],
  },

  {
    id: 'viruses', n: '6b', title: 'Viruses',
    after: 'augment',
    when: c => c.state.turn >= 3 && inBattle(c) && (canAugment(c, isVirus) || canPlay(c, isVirus)),
    optional: true,
    pages: [
      {
        title: 'Mods you can use in battle',
        body: `[[Malformed Monstrosity]] is a **virus** {Virus}. In deployment it works like any other card: play it, or augment with it. But a virus can *also* be augmented straight from your hand **during battle**, onto any unit in the region — **including your opponent's** (as long as it's currently in your region). When it goes onto their unit, their unit gains the text.

During battle, a virus can **only** be used this way, as a mod: it can't be played as a unit then. And a virus in your bin can't be used in battle at all.`,
        callout: 'Look at [[Malformed Monstrosity]]: a huge 10/9 — but its augment says *I gain -7/-7*. Played as a unit, it shrinks itself to an ordinary **3/2**. Augmented onto an enemy during battle, it gives *them* -7/-7: a **kill spell**. One card, two uses.',
        quotes: [
          { text: 'Viruses have the extra ability to mod units directly from your hand during combat in addition to being playable and augmentable normally during the deployment phase.', source: 'Manual, p. 34' },
          { text: 'Since they can be augmented during combat, viruses also are able to augment onto opposing units.', source: 'Manual, p. 34' },
        ],
        figure: {
          kind: 'frames', play: 'step', frames: [
            { figure: { kind: 'cards', cards: [{ name: 'Malformed Monstrosity', label: 'printed 10/9 — with "I gain -7/-7"' }] }, caption: 'The card: 10/9, and an augment that says **I gain -7/-7**.' },
            { figure: { kind: 'cards', cards: [{ name: 'Malformed Monstrosity', badge: '3/2', label: 'played as a unit: 10/9 − 7/7' }] }, caption: 'Played as a unit in deployment, its own augment applies to itself: a **3/2**.' },
            { figure: { kind: 'modded', host: 'Unit Token', mods: ['Malformed Monstrosity'], reads: '**Your opponent\'s 4/4** gains:\n\n[Augment] I gain -7/-7.\n\nIt is now -3/-3 — and it dies.' }, caption: 'Or, in battle, augmented onto your opponent\'s 4/4: it gets -7/-7 and **dies**.' },
          ],
        },
      },
    ],
  },

  {
    id: 'graft', n: '7', title: 'Graft effects and grafting',
    when: c => c.state.turn >= 5 && inDeploy(c) && canDo(c, 'graft'),
    optional: true,
    pages: [
      {
        title: 'Cause and effect',
        body: c => {
          const ex = example(c, r => isGraftCard(r) && r.timing === 'deploy');
          return `Some text has the graft symbol [Switch] in it: a **cause** ("when I attack", "when I die"…) and an **effect** after the symbol. ${ex ? `[[${ex}]] has one.` : ''}

**Grafting** puts one card's effect onto another card's cause. The result reads *cause → effect 1 AND effect 2*, and happens as one ability: it resolves top to bottom, and one negate stops all of it. Both cards need the graft symbol.`;
        },
        quotes: [
          { text: 'When something is grafted onto another card, it is adding additional effects onto the cause of the topmost card.', source: 'Manual, p. 33' },
          { text: 'The resulting ability is treated as a single ability, so it will all resolve at once, from top to bottom, and the entire effect can be negated by a single spell.', source: 'Manual, p. 33' },
        ],
        figure: c => {
          const grafts = cheapest(pool(c).filter(r => isGraftCard(r) && r.timing === 'deploy' && !!graftParts(r)));
          const host = grafts.find(r => graftParts(r)!.cause) ?? rowFor('Oracle of the Flame');
          const mod = grafts.find(r => r.name !== host?.name) ?? rowFor('Accelerated Germination');
          const hp = host && graftParts(host), mp = mod && graftParts(mod);
          if (!host || !mod || !hp || !mp) return null;
          return {
            kind: 'modded', host: host.name, mods: [mod.name],
            reads: `**${hp.cause || 'When this happens'}** — ${hp.effect} **AND** ${mp.effect}`,
            caption: `[[${mod.name}]] grafted onto [[${host.name}]]: one cause, two effects.`,
          };
        },
      },
      {
        title: 'Applying a graft',
        body: `A graft is applied just like an augment: in deployment, from your hand or your bin, paying the card's cost and meeting its affinity. You choose where the new effect goes under the original, but the ones already there keep their order.

[Switch1] — the graft symbol with a 1 — is **bounded**: that effect happens only once each turn. A bounded cause limits everything grafted onto it.`,
        quotes: [
          { text: 'Applying a graft follows the same cost and timing setup as augments (play from hand or bin during deployment, pay the card\'s cost and meet affinity requirements in order to do so), with the additional requirement that both cards must have the graft symbol in order to be able to apply a graft.', source: 'Manual, p. 33' },
        ],
        figure: c => {
          const b = example(c, r => isGraftCard(r) && /\[Switch1\]/i.test(r.text));
          const u = example(c, r => isGraftCard(r) && /\[Switch\]/i.test(r.text));
          const cards = [...(u ? [{ name: u, label: '[Switch] — every time' }] : []), ...(b ? [{ name: b, label: '[Switch1] — once a turn' }] : [])];
          return cards.length ? { kind: 'cards', cards } : null;
        },
      },
    ],
  },

  {
    id: 'haste', n: '8', title: 'Haste',
    when: c => c.state.turn >= 5 && c.state.phase === 'planning' && !!c.state.hasteDone && canPlay(c, isHasteCard),
    optional: true,
    pages: [
      {
        title: 'The haste step',
        body: c => {
          const ex = example(c, isHasteCard);
          return `Right after resources comes the short **haste step**, where only {Haste} cards can be played. ${ex ? `[[${ex}]] is one.` : ''} It is how a unit gets into play *before* this turn's battle instead of after it.

A haste card keeps its normal timing too, so you can also hold it for deployment. The step ends when both players are done — which is usually at once, and the client moves on for you when you hold no haste card.`;
        },
        quotes: [
          { text: 'After the resource step is the very short haste step, where players can only play haste cards', source: 'Manual, p. 18' },
          { text: 'Haste cards may be played in the planning step in addition to their normal timing.', source: 'Player Icons card' },
        ],
        figure: c => {
          const ex = example(c, isHasteCard);
          const figs: Figure[] = [turnStrip('Haste')];
          if (ex) figs.push({ kind: 'cards', cards: [ex] });
          return figs;
        },
        highlight: ['.phasetrack'],
      },
    ],
  },
];

// ── off the board, and the end of the game ────────────────────────────

/** a handful of real Simple cards from a draft trio, for the formats pictures */
function sampleCards(n: number, els: readonly string[] = ['fire', 'water', 'earth']): string[] {
  const rows = allRows().filter(r => r.cls === 'card' && r.playable && r.complexityLc === 'simple' && r.factions.length === 1 && els.includes(r.factions[0]!));
  const out: string[] = [];
  for (let i = 0; out.length < n && i < rows.length; i += 7) out.push(rows[i]!.name);
  return out;
}

export const FORMATS: Lesson = {
  id: 'formats', n: '9', title: 'Other ways to play',
  pages: [
    {
      title: 'Where your cards come from',
      body: `This game gave you a ready-made deck. Real games get their cards one of two ways, and the whole difference is **where your cards come from**:

- **Live draft** — you build your deck *while you play*, taking cards from packs that pass between you and your opponent. Nobody brings anything: the box is the deck. This is the format this client was built around.
- **Constructed** — you build a deck *before* the game and bring it. You know every card in it.

Everything else you learned — resources, deployment, regions, battle, mods — is exactly the same in both.`,
      figure: { kind: 'cards', cards: [{ name: 'x', back: true, label: 'live draft: one shared deck, and packs' }, { name: 'x', back: true, label: 'constructed: your own deck' }] },
    },
    {
      title: 'Live draft',
      body: `**Setting up.** Choose three elements; every card of those elements is shuffled into one shared deck. Each player gets a hand of 4, their first turn's 2 draws, and a face-down **pack of 10**.

**Every turn,** after drawing 2, comes the **draft step**: you lay your hand and your pack out together and keep *any* cards you like — as long as exactly 10 go back into the pack. Then you and your opponent **swap packs**. So each turn you see new cards, and every card you pass on is one your opponent might take.

After three turns the packs are put on the bottom of the deck and fresh packs of 10 are dealt.

**To play one:** *New live draft* on the home screen. For a gentle first draft, open *Custom rules* there: simple cards only, smaller packs.`,
      quotes: [
        { text: 'During the draft step of the live draft mode, players combine the cards in their hand with the cards in their pack. Then they are able to freely select which cards from the resulting pile they wish to keep in their hand and which cards should go back into the pack. Players must always leave exactly 10 cards in the pack at the end of this step, so they will exit the draft step with the same number of cards in hand that they began with.', source: 'Manual, p. 16' },
        { text: 'Additionally, after each cycle of N+1 turns, where N is the number of players, all of the existing packs are recycled (put on the bottom of the deck) and each player is dealt a new pack of 10 cards.', source: 'Manual, p. 16' },
      ],
      figure: () => {
        const cards = sampleCards(5);
        return {
          kind: 'frames', play: 'step', frames: [
            { figure: { kind: 'cards', cards: [{ name: 'x', back: true, label: 'your hand' }, { name: 'x', back: true, label: 'your pack of 10' }] }, caption: 'The draft step: your hand, and your pack.' },
            { figure: { kind: 'cards', cards }, caption: 'Spread them out together, face up (a few shown here), and choose freely.' },
            { figure: { kind: 'cards', cards: cards.map((n, i) => (i < 2 ? { name: n, label: 'keep' } : { name: n, dim: true, label: 'back in the pack' })) }, caption: 'Keep what you like — as long as exactly 10 go back in the pack.' },
            { figure: { kind: 'flow', steps: [{ name: 'x', back: true, label: 'your pack' }, { name: 'x', back: true, label: 'your opponent drafts from it next turn' }] }, caption: 'Swap packs with your opponent. Next turn, you draft from theirs.' },
          ],
        };
      },
    },
    {
      title: 'Constructed',
      body: `**Before the game** you build a deck of **at least 30 cards**, with **no more than 2 copies** of any card. Build and save decks from *My decks* on the home screen.

**Every turn,** instead of drawing 2 and drafting, you **draw 4, then put 2 of them on the bottom** of your deck. You always see more cards than you keep, so you choose what fits your plan this turn — and the two you put back are recycled, shuffled back in when your deck runs out.

**To play one:** pick a saved deck and press *New constructed game* on the home screen.`,
      quotes: [
        { text: 'Constructed: Players bring pre-constructed decks to the game. The standard format allows up to 2 copies of each card, with a minimum deck size of 30.', source: 'Manual, p. 6' },
        { text: 'During the draft step in constructed, players simply draw 2 cards from their own deck and recycle 2 cards from their hand instead of drafting from packs and passing them between players.', source: 'Manual, p. 16' },
      ],
      figure: () => {
        const drawn = sampleCards(4, ['wood']);
        return {
          kind: 'frames', play: 'step', frames: [
            { figure: { kind: 'cards', cards: [{ name: 'x', back: true, label: 'your own deck: 30+ cards, max 2 of each' }] }, caption: 'Your deck, built before the game.' },
            { figure: { kind: 'cards', cards: drawn }, caption: 'Each turn, draw 4.' },
            { figure: { kind: 'cards', cards: drawn.map((n, i) => (i < 2 ? { name: n, label: 'keep' } : { name: n, dim: true, label: 'to the bottom' })) }, caption: 'Keep 2, and put the other 2 on the bottom of your deck.' },
          ],
        };
      },
    },
  ],
};

/** Lesson 10 is the client's own interface guide (ui/tutorial.ts), not a copy of it. */
export const INTERFACE: Lesson = {
  id: 'interface', n: '10', title: 'Tips for this client',
  pages: TUTORIAL.filter(s => s.id !== 'home').map(s => ({
    title: s.title,
    body: `${s.blurb ? `${s.blurb}\n\n` : ''}${s.steps.map(st => `- ${st.label ? `**${st.label}.** ` : ''}${st.text}`).join('\n')}`,
  })),
};

export const END: Lesson = {
  id: 'end', n: '🏁', title: 'Game over',
  when: c => c.state.phase === 'gameover',
  anyOrder: true,
  pages: [
    {
      title: 'How it went',
      body: c => {
        const won = c.state.winner === c.seat;
        const mine = myUnits(c).length, theirs = theirUnits(c).length;
        return won
          ? '**You won!** You have now played every part of a turn.'
          : `**Your opponent won** this time — they had ${theirs} unit${theirs === 1 ? '' : 's'} to your ${mine}. Blocking their biggest columns early, and attacking back, both matter.

You can **rewind to the start of this turn** and try again, or start a new game.`;
      },
      figure: c => {
        const units = myUnits(c).slice(0, 5).map(u => u.card);
        return units.length ? { kind: 'cards', cards: units, caption: 'Your units at the end.' } : { kind: 'cards', cards: ['Turn Structure'], caption: 'Every part of a turn — you have played them all.' };
      },
    },
    ...FORMATS.pages,
    {
      title: 'Where next',
      body: `- **? rules** (right-hand panel) has the whole rules reference and the rulebook.
- **Right-click** any card for its details and rulings.
- **⚖ judge** answers rules questions, in a game or here.
- **Tips for this client** — the full interface guide — is on the Learn to play menu.

Ready for a person? Start a live draft from the home screen.`,
      figure: { kind: 'cards', cards: ['Player Icons Card', 'Player Keywords Card'], caption: 'The two reference cards from the box — hover to read them.' },
    },
  ],
};

/** every lesson a game can open, in order, ending with the end-of-game one */
export const GAME_LESSONS: readonly Lesson[] = [...LESSONS, END];
/** what the menu lists for re-reading (the compact nudge is not a lesson) */
export const ALL_LESSONS: readonly Lesson[] = [...LESSONS.filter(l => !l.compact), FORMATS, INTERFACE];
