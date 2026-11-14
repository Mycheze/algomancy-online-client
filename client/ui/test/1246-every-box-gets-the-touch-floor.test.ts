/* 1246 — EVERY BOX OVER THE PAGE HAS FINGER-SIZED BUTTONS ON A TOUCH SCREEN
 * (BL-10, 2026-11-14; docs/23-ui-inventory/04 §L.11: "`html.touch .overlay
 * button {min-height:36px}` covers the on-board help/judge boxes but NOT the
 * same help box off-board (`.helpscrim`), nor `.learnscrim`, `.lessonscrim`,
 * `.crscrim` — touch targets shrink depending on which shell drew them").
 *
 * The touch piece (styles/shared/37-touch.css) floored a button at 36px only
 * inside the board's `.overlay`. Every other box drawn over the page — the
 * rules reader off the board, the lesson box (its "▁ hide" was ~22px tall),
 * the rules review's sheet, Propose a fix, the report form, the reveals, the
 * challenge run, every ui-sheet — kept its desktop size under a finger.
 *
 * §0 non-vacuity: the scrims are found, the floor rule is found, the
 *    specificity reader tells cases apart
 * §1 the census: every modal scrim the stylesheet defines (1209's detector —
 *    fixed, inset 0, takes the pointer) has a floor rule for its buttons
 * §2 the floor never shrinks a button: any rule that makes a button taller
 *    than the floor either outranks it or is a class the floor leaves out
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStyles } from './read-styles.ts';

const CSS = readStyles().replace(/\/\*[\s\S]*?\*\//g, '');
const FLOOR_PX = 36;

/** the classes that cover the window and take the pointer (1209's detector) */
function scrimClasses(css: string): string[] {
  const out = new Set<string>();
  for (const m of css.matchAll(/(?:^|\n)\.([a-z][\w-]*) \{([^}]*)\}/g)) {
    const body = m[2]!;
    if (/position: fixed/.test(body) && /\binset: 0\b/.test(body) && !/pointer-events: none/.test(body)) out.add(m[1]!);
  }
  return [...out].sort();
}
const SCRIMS = scrimClasses(CSS);

/** split a selector list on its top-level commas (not those inside :where(…)) */
function splitList(head: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of head) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

/** every rule as [selector, body]; an @media's prelude is cut off its first rule */
const RULES: [string, string][] = [];
for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const head = m[1]!.replace(/^[\s\S]*@media[^{]*$/, '').trim();
  for (const sel of splitList(head)) RULES.push([sel, m[2]!]);
}

/** [ids, classes + attributes + pseudo-classes, elements]; :where() counts nothing,
 * :not()/:is() count their argument (one compound each here) */
function specificity(sel: string): [number, number, number] {
  let s = sel.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '');
  s = s.replace(/:not\(\s*\)/g, '');
  s = s.replace(/::?[\w-]+\(([^()]*)\)/g, (_, inner) => ` ${inner} `);
  s = s.replace(/::[\w-]+/g, ' x ');
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const cls = (s.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) ?? []).length;
  const els = (s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|:[\w-]+/g, ' ').match(/(?:^|[\s>+~])([a-z][\w-]*)/gi) ?? []).length;
  return [ids, cls, els];
}
const cmp = (a: number[], b: number[]) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;

/** the floor rules: html.touch .<scrim> button…, min-height ≥ the floor */
const FLOORS = RULES.filter(([sel, body]) => {
  const px = /min-height: (\d+)px/.exec(body);
  return /^html\.touch \.[\w-]+ button\b/.test(sel) && px && Number(px[1]) >= FLOOR_PX;
});
const flooredScrim = (sel: string) => /^html\.touch \.([\w-]+) button\b/.exec(sel)![1]!;
/** the floors this test is about: a scrim's (the bars' and menus' are 329's) */
const SCRIM_FLOORS = FLOORS.filter(([sel]) => SCRIMS.includes(flooredScrim(sel)));
/** the classes a floor rule leaves alone, from its :not(:where(…)) */
const exempt = (sel: string) => new Set([...(/:not\(:where\(([^)]*)\)\)/.exec(sel)?.[1] ?? '').matchAll(/\.([\w-]+)/g)].map(m => m[1]!));

test('§0 non-vacuity: the scrims and the floor are found, specificity tells cases apart', () => {
  for (const c of ['overlay', 'helpscrim', 'lessonscrim', 'reportscrim', 'revealscrim', 'chscrim', 'ui-sheet']) {
    assert.ok(SCRIMS.includes(c), `.${c} is read as a modal scrim`);
  }
  assert.ok(SCRIM_FLOORS.length >= SCRIMS.length, `only ${SCRIM_FLOORS.length} scrim floor rules`);
  assert.deepEqual(specificity('html.touch .overlay button'), [0, 2, 2]);
  assert.deepEqual(specificity('html.touch .overlay button:not(:where(.a, .b))'), [0, 2, 2]);
  assert.deepEqual(specificity('.learnsheet .learngo .learngobtn'), [0, 3, 0]);
  assert.deepEqual(specificity('#app.board.v2 > .toolbar > button'), [1, 3, 1]);
  assert.deepEqual(specificity('.x:not(.y)'), [0, 2, 0]);
});

test('§1 every box over the page floors its buttons on a touch screen', () => {
  const floored = new Set(SCRIM_FLOORS.map(([sel]) => flooredScrim(sel)));
  const missing = SCRIMS.filter(c => !floored.has(c));
  assert.deepEqual(missing, [], `no html.touch .<scrim> button { min-height: ${FLOOR_PX}px } for: ${missing.map(c => '.' + c).join(' ')}`);
});

test('§2 the floor never shrinks a button that is already bigger', () => {
  const bigger = RULES.filter(([sel, body]) => {
    const m = /min-height: (?:(\d+)px|var\(--icon-button-min-h\))/.exec(body);
    if (!m || (m[1] && Number(m[1]) <= FLOOR_PX)) return false;
    // a button, or a class written onto one
    return /(?:^|[\s>])button\b|btn\b|\.ui-icon-button\b|\.ui-button\b/.test(sel) && !sel.startsWith('html.touch .');
  });
  assert.ok(bigger.some(([s]) => s.includes('ui-icon-button')), 'the icon button\'s 48px is in the census');
  const beaten: string[] = [];
  for (const [sel] of bigger) {
    const subject = sel.split(/[\s>+~]+/).pop()!;
    const classes = [...subject.matchAll(/\.([\w-]+)/g)].map(m => m[1]!);
    for (const [floor] of SCRIM_FLOORS) {
      if (classes.some(c => exempt(floor).has(c))) continue;
      if (cmp(specificity(sel), specificity(floor)) <= 0) beaten.push(`${sel}  <  ${floor}`);
    }
  }
  assert.deepEqual(beaten, [], 'a floor rule outranks a rule that makes the button bigger');
});
