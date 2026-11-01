/**
 * 754 — THE DISCORD TIME CODE ON THE LEAGUE PAGE.
 *
 * The owner, 2026-11-01: "A 'Discord timestamp generator' like hammertime.xyz
 * on the League page … setting a time in your time zone, then copying the
 * actual code and additional 'format code' (the final :F or :D)".
 *
 *   §1  ⭐ a wall time typed in the viewer's zone becomes the right UNIX
 *       second (New York, the week after the US left daylight saving)
 *   §2  ⭐ one row per Discord style t T d D f F R, each with its code and a
 *       preview in the viewer's zone; R reads as relative
 *   §3  ⭐ Copy puts that row's code on the clipboard — and where the
 *       clipboard is refused (an installed iOS web app), selects the field
 *       and copies it; signed out, the block is there too
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const TZ = 'America/New_York';
let fresh = 0;
async function rig(opts: { signedIn?: boolean; clipboard?: 'ok' | 'refuse' } = {}) {
  const store = new Map<string, string>(opts.signedIn === false ? [] : [['algoToken', 'tok']]);
  const g = globalThis as Record<string, unknown>;
  g['localStorage'] = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, String(v)), removeItem: (k: string) => store.delete(k) };
  g['location'] = { search: '', href: 'http://x/', origin: 'https://algomancy.online' };
  g['history'] = { replaceState() {} };
  g['innerWidth'] = 1200;
  const copied: string[] = [];
  const selected: string[] = [];
  const fields = new Map<string, { value: string; onchange?: () => void; select: () => void; setSelectionRange: () => void }>();
  const field = (id: string) => {
    if (!fields.has(id)) {
      const f = { value: '', select: () => { selected.push(f.value); }, setSelectionRange() {} } as { value: string; onchange?: () => void; select: () => void; setSelectionRange: () => void };
      fields.set(id, f);
    }
    return fields.get(id)!;
  };
  g['document'] = {
    getElementById: (id: string) => (id.startsWith('lg-stamp') ? field(id) : null),
    createElement: () => ({ style: {} }), addEventListener() {}, querySelector: () => null,
    execCommand: (c: string) => { if (c === 'copy' && selected.length) copied.push(selected[selected.length - 1]!); return true; },
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: {
    writeText: (t: string) => (opts.clipboard === 'refuse' ? Promise.reject(new Error('NotAllowed')) : (copied.push(t), Promise.resolve())),
  } } });
  g['fetch'] = async () => ({ status: 200, json: async () => ({ ok: true, signedIn: opts.signedIn !== false, season: null, others: [], seasons: [],
    organizer: false, minHours: 4, contact: null, availability: opts.signedIn === false ? null : { tz: TZ, grid: '0'.repeat(168) } }) });
  const lg = await import(`../league.ts?c754=${++fresh}`) as typeof import('../league.ts');
  const app = { innerHTML: '', classList: { remove() {} } };
  lg.initLeague({ app: app as unknown as HTMLElement, rerender: () => {} });
  lg.handleButton({ dataset: { btn: 'lg-open' } } as unknown as HTMLElement);
  await settle();
  // the page drew the field: give it the value its HTML carries, as a browser would
  const v = /id="lg-stamp-at"[^>]*value="([^"]*)"/.exec(app.innerHTML)?.[1];
  if (v) field('lg-stamp-at').value = v;
  return { lg, app, copied, selected, field };
}
const settle = (): Promise<void> => new Promise(r => setTimeout(r, 15));
const press = (lg: typeof import('../league.ts'), dataset: Record<string, string>): boolean =>
  lg.handleButton({ dataset } as unknown as HTMLElement);
/** pick a time the way the player does: type it, then the field's change fires */
function setTime(r: Awaited<ReturnType<typeof rig>>, wall: string): void {
  const f = r.field('lg-stamp-at');
  f.value = wall;
  f.onchange?.();
}

// Sun 8 Nov 2026, 19:30 in New York (EST, UTC−5) = Mon 9 Nov 00:30 UTC
const UNIX = Date.parse('2026-11-09T00:30:00Z') / 1000;

test('754 §1 ⭐ a time in your zone is the right UNIX second', async () => {
  const r = await rig();
  assert.match(r.app.innerHTML, /Discord time code/, 'the block is on the page');
  assert.match(r.app.innerHTML, /America\/New_York time/, 'the zone is named');
  setTime(r, '2026-11-08T19:30');
  assert.match(r.app.innerHTML, new RegExp(`value="&lt;t:${UNIX}:F&gt;"`), '⭐ 19:30 New York is 00:30 UTC the next day');
  setTime(r, '2026-11-08T19:37');
  assert.match(r.app.innerHTML, new RegExp(`&lt;t:${UNIX + 7 * 60}:t&gt;`), 'to the minute, not rounded to the quarter hour');
});

test('754 §2 ⭐ one row per style, each with its code and a preview', async () => {
  const r = await rig();
  setTime(r, '2026-11-08T19:30');
  for (const st of ['t', 'T', 'd', 'D', 'f', 'F', 'R']) {
    assert.match(r.app.innerHTML, new RegExp(`id="lg-stamp-${st}"[^>]*value="&lt;t:${UNIX}:${st}&gt;"`), `⭐ the ${st} row carries <t:${UNIX}:${st}>`);
  }
  assert.equal(r.lg.discordCode(UNIX, 'D'), `<t:${UNIX}:D>`);
  const ms = UNIX * 1000;
  assert.match(r.lg.stampPreview(ms, 't', TZ), /7:30/, 't is the time in the viewer’s zone');
  assert.match(r.lg.stampPreview(ms, 'F', TZ), /Sunday.*8.*2026/, 'F is the long date in the viewer’s zone (still Sunday there)');
  assert.match(r.lg.stampPreview(ms, 'R', TZ, ms - 3 * 3_600_000), /in 3 hours/, '⭐ R is relative');
  assert.match(r.lg.stampPreview(ms, 'R', TZ, ms + 2 * 86_400_000), /2 days ago/);
});

test('754 §3 ⭐ Copy copies the code — through the clipboard, or by selecting where it is refused', async () => {
  const r = await rig();
  setTime(r, '2026-11-08T19:30');
  press(r.lg, { btn: 'lg-stamp-copy', style: 'F' });
  await settle();
  assert.deepEqual(r.copied, [`<t:${UNIX}:F>`], '⭐ the F code is on the clipboard');
  assert.match(r.app.innerHTML, new RegExp(`Copied &lt;t:${UNIX}:F&gt;`), 'and the page says so');

  const t = await rig({ clipboard: 'refuse' });
  setTime(t, '2026-11-08T19:30');
  t.field('lg-stamp-D').value = `<t:${UNIX}:D>`;   // the row's field, as the page drew it
  press(t.lg, { btn: 'lg-stamp-copy', style: 'D' });
  await settle();
  assert.deepEqual(t.copied, [`<t:${UNIX}:D>`], '⭐ refused clipboard: the field is selected and copied');

  const anon = await rig({ signedIn: false });
  assert.match(anon.app.innerHTML, /Discord time code/, 'signed out, the block is there too');
});
