/**
 * A printed stat or cost a rule quotes beside a card's name, checked against
 * the card pool (check.mjs `card-stat-mismatch`). The fast path edits a card's
 * numbers and lands on a green gate, so a quote that restates them must fail
 * the gate when they change.
 *
 * Only shapes that claim the PRINTED values are read, because examples also
 * describe modified ones ("is now 8/6", "a 3/4 Piercing Deathglow Strider"):
 *   <Name> (2/1)  <Name> (printed 2/1)  <Name> (a 2/1, Swift)  <Name> (Vulnerable, 3/8)
 *   a 2/1 <Name>                        not after is/as/becomes/now/into/still/remains/leaves it/makes it
 *   <Name>, a 2/1   <Name>, a {Haste} 7/2   <Name> prints 2/1
 *   <Name> costs 2  <Name> (cost 2)  <Name> (rr, cost 4)  <Name> (cost orb 6)
 *   <Name>, cost 4  <Name> (main cost 4, Ambush 3)
 * A signed number (+1/+1, -2/-2) is a modifier, never a stat; a quoted string
 * ("cost 2 or less") is card text, never a claim. `costs N more/less` is a change.
 */

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** an unsigned stat pair: the number may not follow a sign, a word or a slash */
const PT = String.raw`(?<![+\-−\w/])(\d+|X)\/(\d+|X)(?![\w/])`;
const NUM = String.raw`(\d+|X)\b`;
/** the words after which "a 3/3 <Name>" describes a state, not the card */
const STATE = String.raw`(?:is|as|becomes?|now|still|remains|leaves it|leaving it|makes it|making it)`;

/**
 * `cards`: [{name, power, toughness, mana, cost, ambush?}] — the printed values.
 * Returns `scan(text)` → [{name, what, said, printed, ok}], one per value a
 * claim states (`what` is `stats`, `cost`, `pips` or `ambush`).
 */
export function statQuoteScanner(cards) {
  const by = new Map(cards.map((c) => [c.name, c]));
  if (!by.size) return () => [];
  const names = [...by.keys()].sort((a, b) => b.length - a.length).map(esc).join('|');
  const N = String.raw`\b(${names})\b`;
  const shapes = [
    { what: 'stats', re: new RegExp(String.raw`${N} \((?:printed |an? )?(?:[A-Z][a-z]+, )?${PT}(?=[),; ]|$)`, 'g'), name: 1, p: 2, t: 3 },
    { what: 'stats', re: new RegExp(String.raw`(?<!\b${STATE} )\b[Aa]n? ${PT} ${N}(?! token\b)`, 'g'), name: 3, p: 1, t: 2 },
    { what: 'stats', re: new RegExp(String.raw`${N}, an? (?:\{[A-Z][a-z]+\} )?${PT}`, 'g'), name: 1, p: 2, t: 3 },
    { what: 'stats', re: new RegExp(String.raw`${N} prints ${PT}`, 'g'), name: 1, p: 2, t: 3 },
    { what: 'cost', re: new RegExp(String.raw`${N} costs ${NUM}(?! (?:more|less|fewer|extra)\b)`, 'g'), name: 1, mana: 2 },
    { what: 'cost', re: new RegExp(String.raw`${N}(?: \(|, )(?:([a-z]+), )?(?:main )?cost(?: orb)? ${NUM}(?:, Ambush (\d+))?`, 'g'), name: 1, pips: 2, mana: 3, ambush: 4 },
  ];
  const sortPips = (s) => [...String(s ?? '')].sort().join('');
  return (text) => {
    const out = [];
    if (typeof text !== 'string' || !text) return out;
    for (const sh of shapes) {
      for (const m of text.matchAll(sh.re)) {
        const c = by.get(m[sh.name]);
        if (!c) continue;
        const claim = (what, said, printed) => out.push({ name: c.name, what, said: String(said), printed: String(printed), ok: String(said) === String(printed), at: m.index });
        if (sh.what === 'stats') {
          claim('stats', `${m[sh.p]}/${m[sh.t]}`, `${c.power}/${c.toughness}`);
          continue;
        }
        claim('cost', m[sh.mana], c.mana);
        if (sh.pips && m[sh.pips]) claim('pips', sortPips(m[sh.pips]), sortPips(c.cost));
        if (sh.ambush && m[sh.ambush]) claim('ambush', m[sh.ambush], c.ambush ? c.ambush.mana : 'none');
      }
    }
    return out;
  };
}
