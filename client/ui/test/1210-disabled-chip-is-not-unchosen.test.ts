/* 1210 · AN ELEMENT CHIP YOU CANNOT CLICK DOES NOT LOOK LIKE ONE YOU HAVE NOT CHOSEN
 * (BL-10, the visual polish pass, 2026-11-10; docs/23-ui-inventory/05 §18.25:
 * "`.elchip` unselected (opacity .55) and disabled (opacity .4) are
 * near-identical").
 *
 * The element chips draw "not chosen" by dimming (.elchip, opacity .55). The
 * one place they are also disabled is the draft lobby once you lock in
 * (pages/lobby.ts pickOneHtml / rankHtml, test 971 §3): every chip but your
 * choice is frozen. With only button:disabled's opacity .4 against .55, the
 * frozen chips looked like the live ones. A disabled, unchosen chip now also
 * goes grey and its border dashed — a difference that does not rest on a
 * shade of opacity, or on colour — and a chosen one stays as it was, because
 * it is showing your pick.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStyles } from './read-styles.ts';
import { lobbyHtml, type LobbyView } from '../pages/lobby.ts';

const css = readStyles().replace(/\/\*[\s\S]*?\*\//g, '');

/** every top-level (not @media) rule as [selectors, body], in cascade order */
function rules(text: string): [string[], string][] {
  const out: [string[], string][] = [];
  let depth = 0, start = 0, open = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') { if (depth === 0) open = i; depth++; }
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        const prelude = text.slice(start, open).trim();
        if (!prelude.startsWith('@')) out.push([prelude.split(',').map(s => s.trim().replace(/\s+/g, ' ')), text.slice(open + 1, i)]);
        start = i + 1;
      }
    }
  }
  return out;
}
const all = rules(css);
const decl = (body: string, prop: string): string | null =>
  body.match(new RegExp(`(?:^|[;\\s{])${prop}\\s*:\\s*([^;]+)`))?.[1]?.trim() ?? null;
const ruleFor = (sel: string): string => {
  const r = all.filter(([s]) => s.includes(sel));   // the exact selector, in any list
  assert.ok(r.length, `a rule for ${sel}`);
  return r.map(([, b]) => b).join(';');
};

test('1210 §1 a disabled, unchosen element chip is grey and dashed, and dimmer than an unchosen one', () => {
  const unchosen = Number(decl(ruleFor('.elchip'), 'opacity'));
  const frozen = ruleFor('.elchip:disabled:not(.on)');
  assert.ok(unchosen > 0 && unchosen < 1, `an unchosen chip is dimmed (got ${unchosen})`);
  assert.ok(Number(decl(frozen, 'opacity')) <= unchosen - 0.15, 'the frozen chip is clearly dimmer, not .15 or less apart');
  assert.match(decl(frozen, 'filter') ?? '', /grayscale\(\s*(1|100%)\s*\)/, 'the frozen chip loses its colour');
  assert.equal(decl(frozen, 'border-style'), 'dashed', 'and says so without colour: a dashed border');
});

test('1210 §2 nothing later in the cascade puts the colour or the solid border back on an element chip', () => {
  const at = all.findIndex(([s]) => s.includes('.elchip:disabled:not(.on)'));
  const undo = all.slice(at + 1).filter(([s, b]) =>
    s.some(x => /\.elchip(?![-\w])/.test(x)) && (decl(b, 'filter') !== null || decl(b, 'border-style') !== null || /(?:^|[;\s])border\s*:/.test(b)));
  assert.deepEqual(undo.map(([s]) => s.join(', ')), []);
});

test('1210 §3 a chosen chip is never caught by it: locked in, your pick keeps its full look', () => {
  // the rule names :not(.on), and .elchip.on still sets full opacity
  assert.equal(decl(ruleFor('.elchip.on'), 'opacity'), '1');
  const view: LobbyView = {
    lobby: { method: 'pick-one', methods: [{ id: 'pick-one', label: 'One each', blurb: 'each names one' }], locked: [true, false], mine: {} },
    seat: 0, names: ['Ann', 'Bo'], peers: [true, true], room: 'QXZZ', link: 'http://x/?room=QXZZ&seat=1',
    friends: '', pick: 'fire', ready: true, ranking: [], chrome: { signedIn: true, alerts: 0 },
  };
  const chips = [...lobbyHtml(view).matchAll(/<button class="elchip ([^"]*)"[^>]*>/g)];
  assert.ok(chips.length >= 7, 'the lobby draws every element');
  const frozen = chips.filter(m => /disabled/.test(m[0]) && !/\bon\b/.test(m[1] ?? ''));
  const pick = chips.filter(m => /\bon\b/.test(m[1] ?? ''));
  assert.equal(pick.length, 1, 'your pick');
  assert.ok(/disabled/.test(pick[0]![0]), 'it is frozen too, and keeps its look because of :not(.on)');
  assert.equal(frozen.length, chips.length - 1, 'every other element is frozen, and drawn as frozen');
});
