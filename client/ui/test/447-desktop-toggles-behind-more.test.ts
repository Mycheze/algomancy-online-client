/* Report #205 (HPTR, owner, 2026-10-10): "We really should hide many of the
 * top right settings toggles in a deeper settings menu. The stuff that usually
 * doesn't need to be touched during a game can just be hidden."
 *
 * A touch screen and a narrow window already had that menu ("⋯ more", 2026-09-27).
 * A computer showed every toggle in the rail, because the owner had asked then
 * for "the same, normal view for computers". Now, on a computer, the TOGGLES
 * wait behind "more". Everything else on the computer's rail stays the same:
 * the words, rules and the judge, which are tools you use mid-game rather
 * than settings.
 *
 * main.ts runs DOM code on import and the ui-driver applies no stylesheet, so
 * this reads the two halves that decide it: the markup (which buttons are
 * toggles) and the cascade (what a computer hides). It was checked in headless
 * Chrome at 1440px when written: six toggles hidden, "more" shown, opening it
 * adds them after "more".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
const MAIN = read('../main.ts');
const CSS = read('../style.css');

const side = MAIN.slice(MAIN.indexOf('<div class="sidebtns'), MAIN.indexOf('${NET ? scn.panelHtml'));
const groupAt = side.indexOf('<div class="setgroup');
const group = side.slice(groupAt, side.indexOf('</div>', groupAt)); // the group holds no div of its own
/** each control inside the group: its data-btn / data-chip and its class list */
const controls = [...group.matchAll(/<button\b([^>]*)>/g)].map(m => ({
  key: /data-(?:btn|chip)="(\w+)"/.exec(m[1] ?? '')?.[1] ?? '?',
  cls: /class="([^"]*)"/.exec(m[1] ?? '')?.[1] ?? '',
}));

/** the rules at the stylesheet's top level: not under html.touch, not inside @media */
const topLevel = (): string => {
  let out = '', depth = 0, inMedia = false;
  for (const line of CSS.split('\n')) {
    if (depth === 0 && line.startsWith('@media')) inMedia = true;
    if (!inMedia && !line.startsWith('html.touch')) out += line + '\n';
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    if (depth === 0) inMedia = false;
  }
  return out;
};
const orderOf = (css: string, sel: string): number => {
  const m = new RegExp(`^${sel.replace(/[.[\]"=]/g, c => `\\${c}`)} \\{[^}]*order: (\\d+);`, 'm').exec(css);
  assert.ok(m, `no order for ${sel}`);
  return Number(m[1]);
};

test('on a computer every toggle in the rail waits behind more', () => {
  const desk = topLevel();
  assert.match(desk, /^\.sidebtns:not\(\.moreopen\) \.setgroup > \.aptoggle \{ display: none; \}/m,
    'a computer hides the group\'s toggles until "more" is open');
  const toggles = ['fullcontrol', 'autopasstoggle', 'bluffhastetoggle', 'motiontoggle', 'layouttoggle', 'soundtoggle'];
  for (const k of toggles) {
    const c = controls.find(x => x.key === k);
    assert.ok(c, `${k} is in the group`);
    assert.ok(c.cls.split(/\s+/).some(w => w === 'aptoggle' || w.startsWith('aptoggle')),
      `${k} carries .aptoggle, so the rule catches it`);
  }
  // a new toggle added to the group without .aptoggle would sit in the rail
  // again: everything in the group is a toggle, or one of the two tools
  for (const c of controls) {
    assert.ok(toggles.includes(c.key) || ['helpopen', 'judgeopen'].includes(c.key), `${c.key} is accounted for`);
  }
  // and "more" itself is shown on a computer
  assert.doesNotMatch(desk, /^\.setbtn[^{]*\{[^}]*display: none/m, 'the "more" button is not hidden on a computer');
});

test('on a computer rules and the judge stay on the rail and opening more moves nothing', () => {
  const desk = topLevel();
  for (const k of ['helpopen', 'judgeopen']) {
    const c = controls.find(x => x.key === k);
    assert.ok(c && !/\baptoggle\b/.test(c.cls), `${k} is a tool, not a toggle — it stays out`);
  }
  // the toggles open AFTER "more", so the buttons before it keep their places
  const more = orderOf(desk, '.setbtn');
  for (const k of ['tablemenu', 'helpopen', 'judgeopen', 'reportopen', 'undo', 'restart']) {
    assert.ok(orderOf(desk, `.sidebtns [data-btn="${k}"]`) < more, `${k} sits before "more"`);
  }
  for (const k of ['autopasstoggle', 'bluffhastetoggle', 'motiontoggle', 'layouttoggle', 'soundtoggle']) {
    assert.ok(orderOf(desk, `.sidebtns [data-btn="${k}"]`) > more, `${k} opens after "more"`);
  }
  assert.ok(orderOf(desk, '.sidebtns [data-chip="fullcontrol"]') > more, 'the full-control readout opens after "more"');
});
