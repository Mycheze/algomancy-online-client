/* Report #205 (HPTR, owner, 2026-10-10): "We really should hide many of the
 * top right settings toggles in a deeper settings menu. The stuff that usually
 * doesn't need to be touched during a game can just be hidden."
 *
 * A touch screen and a narrow window already had that menu ("⋯ more", 2026-09-27).
 * A computer showed every toggle in the rail, because the owner had asked then
 * for "the same, normal view for computers". From #205, on a computer, the
 * TOGGLES waited behind "more"; rules and the judge, tools you use mid-game
 * rather than settings, stayed on the rail.
 *
 * Board round 8 (owner, 2026-10-27) made the regions board's rail a 50px
 * toolbar of icons (main.ts toolbarHtml). The rule carries over unchanged and
 * is now the same on every device: the toggles are a popover behind ⋯, rules
 * (?) and the judge (⚖) are icons on the strip. This reads the two halves that
 * decide it — the markup (which controls are toggles, and where they sit) and
 * the cascade (the popover hidden until open, with no width or device that
 * shows it shut). It was checked in headless Chrome at 1344, 1024 (touch),
 * 800 and 1280x500: ⋯ opens the six toggles to the strip's left, each one
 * hit-testable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
const MAIN = read('../main.ts');
const CSS = read('../style.css');

const bar = /function toolbarHtml[\s\S]*?\n}/.exec(MAIN)?.[0] ?? '';
const groupAt = bar.indexOf('<div class="setgroup');
const group = bar.slice(groupAt, bar.indexOf('</div>', groupAt)); // the group holds no div of its own
/** each control inside the group: its data-btn / data-chip and its class list */
const controls = [...group.matchAll(/<button\b([^>]*)>/g)].map(m => ({
  key: /data-(?:btn|chip)="(\w+)"/.exec(m[1] ?? '')?.[1] ?? '?',
  cls: /class="([^"]*)"/.exec(m[1] ?? '')?.[1] ?? '',
}));
const TOGGLES = ['fullcontrol', 'autopasstoggle', 'bluffhastetoggle', 'motiontoggle', 'layouttoggle', 'soundtoggle'];

test('every toggle waits behind more, and only toggles do', () => {
  assert.ok(groupAt > 0, 'the toolbar has a setgroup');
  for (const k of TOGGLES) {
    const c = controls.find(x => x.key === k);
    assert.ok(c, `${k} is in the group`);
    assert.ok(c.cls.split(/\s+/).some(w => w === 'aptoggle' || w.startsWith('aptoggle$')), `${k} carries .aptoggle`);
  }
  // a new control added to the group must be a toggle — the tools stay out
  for (const c of controls) assert.ok(TOGGLES.includes(c.key), `${c.key} is accounted for`);
  for (const k of ['helpopen', 'judgeopen']) {
    assert.ok(!group.includes(`data-btn="${k}"`) && bar.includes(`data-btn="${k}"`), `${k} is a tool on the strip, not behind more`);
  }
});

test('the group is a popover, shut unless "more" is open — on every width and device', () => {
  assert.match(bar, /<div class="setgroup tbpop\$\{settingsOpen \? ' open' : ''\}">/, 'open follows settingsOpen');
  assert.match(CSS, /^#app\.board\.v2 > \.toolbar \.setgroup\.tbpop \{ display: none;/m);
  assert.match(CSS, /^#app\.board\.v2 > \.toolbar \.setgroup\.tbpop\.open \{ display: flex; \}/m);
  // nothing that would show it shut: no html.touch or @media rule on the
  // toolbar's group sets a display other than none
  for (const m of CSS.matchAll(/^.*\.toolbar[^{]*\.setgroup[^{]*\{[^}]*display: (\w+)/gm)) {
    if (m[1] !== 'none') assert.match(m[0], /\.open\b/, `a rule shows the group while shut: ${m[0]}`);
  }
  // "more" is the strip's last control, so the popover opens up from the foot
  // and moves nothing on the strip
  assert.ok(bar.indexOf('data-btn="settingsmenu"') > bar.indexOf('data-btn="helpopen"'), 'more sits below the tools');
  assert.match(CSS, /\.setgroup\.tbpop \{ display: none; bottom: 0;/, 'anchored to the strip\'s foot');
});
