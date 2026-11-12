/**
 * 1233 — THE TIME CODE PAGE WRITES A WHOLE DISCORD MESSAGE.
 *
 * The owner, 2026-11-12 (#steward): "a place where you just type the whole
 * message in an input box, then have a little timecode widget above that you
 * can directly insert into your message (or still just copy individually if
 * you want), then copy the whole message and paste it into Discord in one go.
 * The time/date selector is also hard to use since it doesn't have a little
 * popup calendar/clock … typing it removes focus … difficult to tell if you're
 * typing in AM or PM … mild color coding (gold ish hue for AM times, darkish
 * hue for PM)".
 *
 *   §1  ⭐ Insert puts the chosen time's code where the caret is in the
 *       message, spaced off the words beside it, and the caret goes on after it
 *   §2  ⭐ Copy message copies the whole message, codes and all; with nothing
 *       written it is greyed out
 *   §3  ⭐ typing in the message does not repaint the page (the caret stays),
 *       and a menu that repaints it gets the focus back
 *   §4  ⭐ the date comes off a month calendar, the time off hour and minute
 *       menus and AM | PM — none of it typed; a day keeps the time, AM | PM
 *       moves it twelve hours, noon is PM and midnight AM
 *   §5  ⭐ the clock, and every clock time the page shows, is tinted by its
 *       half of the day (the class the gold and dusk colours hang on)
 *   §6  the reading under the message shows each code as its words, and
 *       what the player typed as text, never as markup
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insertStamp, stampCalendarHtml, stampMessageHtml, stampParts, stampSet } from '../pages/league.ts';
import { readStyles } from './read-styles.ts';

const TZ = 'America/New_York';
// Sun 8 Nov 2026, 19:30 in New York (EST, UTC−5) = Mon 9 Nov 00:30 UTC
const UNIX = Date.parse('2026-11-09T00:30:00Z') / 1000;

type El = {
  id: string; value: string; disabled: boolean; hidden: boolean; innerHTML: string;
  selectionStart: number; selectionEnd: number;
  onchange?: () => void; oninput?: () => void; onclick?: () => void; onkeyup?: () => void; onselect?: () => void; onblur?: () => void;
  focus: () => void; select: () => void; setSelectionRange: (a: number, b: number) => void;
};

let fresh = 0;
async function rig() {
  const store = new Map<string, string>([['algoToken', 'tok']]);
  const g = globalThis as Record<string, unknown>;
  g['localStorage'] = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, String(v)), removeItem: (k: string) => store.delete(k) };
  g['location'] = { search: '', href: 'http://x/', origin: 'https://algomancy.online' };
  g['history'] = { replaceState() {} };
  g['innerWidth'] = 1200;
  const copied: string[] = [];
  const els = new Map<string, El>();
  const doc = {
    activeElement: null as El | null,
    getElementById: (id: string) => el(id),
    createElement: () => ({ style: {} }), addEventListener() {},
    querySelector: (q: string) => { const m = /data-btn="([^"]+)"/.exec(q); return m ? el(`btn:${m[1]}`) : null; },
    execCommand: () => false,
  };
  function el(id: string): El {
    if (!els.has(id)) {
      const e: El = {
        id, value: '', disabled: false, hidden: false, innerHTML: '', selectionStart: 0, selectionEnd: 0,
        focus: () => { doc.activeElement = e; }, select() {},
        setSelectionRange: (a, b) => { e.selectionStart = a; e.selectionEnd = b; },
      };
      els.set(id, e);
    }
    return els.get(id)!;
  }
  g['document'] = doc;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: {
    writeText: (t: string) => (copied.push(t), Promise.resolve()),
  } } });
  g['fetch'] = async () => ({ status: 200, json: async () => ({ ok: true, signedIn: true, season: null, others: [], seasons: [],
    organizer: false, minHours: 4, contact: null, availability: { tz: TZ, grid: '0'.repeat(168) } }) });
  const lg = await import(`../league.ts?c1233=${++fresh}`) as typeof import('../league.ts');
  // a repaint replaces the page's elements, so whatever had the focus loses it — as in a browser
  let html = '';
  const app = { get innerHTML() { return html; }, set innerHTML(v: string) { html = v; doc.activeElement = null; }, classList: { remove() {} } };
  lg.initLeague({ app: app as unknown as HTMLElement, rerender: () => {} });
  lg.handleButton({ dataset: { btn: 'lg-open' } } as unknown as HTMLElement);
  await settle();
  lg.handleButton({ dataset: { btn: 'lg-section', v: 'stamp' } } as unknown as HTMLElement);
  /** a browser repaint: every field takes the value its new HTML carries */
  const sync = (): void => {
    const box = /<textarea id="lg-stamp-msg"[^>]*>([^<]*)<\/textarea>/.exec(app.innerHTML)?.[1] ?? '';
    el('lg-stamp-msg').value = box.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  };
  sync();
  const press = (dataset: Record<string, string>): void => { lg.handleButton({ dataset } as unknown as HTMLElement); sync(); };
  /** type into the message: the value changes, the caret moves to `caret` (default: the end), input fires */
  const type = (text: string, caret = text.length): void => {
    const b = el('lg-stamp-msg');
    b.value = text; b.selectionStart = b.selectionEnd = caret;
    b.oninput?.();
  };
  const menu = (id: 'lg-stamp-hour' | 'lg-stamp-min', n: number): void => {
    const f = el(id);
    f.focus();
    f.value = String(n);
    f.onchange?.();
    sync();
  };
  const pick = (wall: string): void => {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(wall)!;
    const h = Number(m[2]);
    press({ btn: 'lg-stamp-cal' });
    press({ btn: 'lg-stamp-day', day: m[1]! });
    press({ btn: 'lg-stamp-ampm', v: h >= 12 ? 'pm' : 'am' });
    menu('lg-stamp-hour', h % 12 || 12);
    menu('lg-stamp-min', Number(m[3]));
  };
  return { lg, app, copied, el, doc, press, type, menu, pick };
}
const settle = (): Promise<void> => new Promise(r => setTimeout(r, 15));
const code = (html: string, st: string): string => new RegExp(`id="lg-stamp-${st}"[^>]*value="&lt;t:(\\d+):${st}&gt;"`).exec(html)?.[1] ?? '';

test('1233 §1 ⭐ Insert puts the time where the caret is, and the caret goes on after it', async () => {
  const r = await rig();
  assert.match(r.app.innerHTML, /<textarea id="lg-stamp-msg"/, '⭐ there is a message box on the time code page');
  assert.match(r.app.innerHTML, /data-btn="lg-stamp-insert" data-style="F"/, 'each style has an Insert');
  assert.match(r.app.innerHTML, /data-btn="lg-stamp-copy" data-style="F"/, 'and still its own Copy');
  r.pick('2026-11-08T19:30');
  r.type('Can we play at  tonight?', 'Can we play at '.length);
  r.press({ btn: 'lg-stamp-insert', style: 't' });
  const box = r.el('lg-stamp-msg');
  assert.equal(box.value, `Can we play at <t:${UNIX}:t> tonight?`, '⭐ the code went in at the caret, not at the end');
  assert.equal(box.selectionStart, `Can we play at <t:${UNIX}:t>`.length, 'the caret is just after it');
  assert.equal(r.doc.activeElement?.id, 'lg-stamp-msg', 'and the message has the focus, to go on typing');

  // nowhere clicked yet in an empty box: at the end; next to a word: spaced off it
  assert.deepEqual(insertStamp('Ready at', 8, 8, '<t:1:t>'), { text: 'Ready at <t:1:t>', caret: 16 });
  assert.deepEqual(insertStamp('at!', 2, 2, '<t:1:t>'), { text: 'at <t:1:t>!', caret: 10 }, 'punctuation after it needs no space');
  assert.deepEqual(insertStamp('a XX b', 2, 4, '<t:1:t>'), { text: 'a <t:1:t> b', caret: 9 }, 'a selection is replaced');
});

test('1233 §2 ⭐ Copy message copies the whole message; with nothing written it is greyed out', async () => {
  const r = await rig();
  assert.match(r.app.innerHTML, /data-btn="lg-stamp-msgcopy" class="primary" disabled/, 'nothing written: greyed out');
  r.pick('2026-11-08T19:30');
  r.type('GG? ');
  assert.equal(r.el('btn:lg-stamp-msgcopy').disabled, false, 'typing wakes the button without a repaint');
  r.press({ btn: 'lg-stamp-insert', style: 'F' });
  r.press({ btn: 'lg-stamp-msgcopy' });
  await settle();
  assert.deepEqual(r.copied, [`GG? <t:${UNIX}:F>`], '⭐ the whole message is on the clipboard');
  assert.match(r.app.innerHTML, /Copied your message/);
  r.press({ btn: 'lg-stamp-msgclear' });
  assert.equal(r.el('lg-stamp-msg').value, '', 'Clear empties it');
});

test('1233 §3 ⭐ typing does not repaint, and a menu that repaints keeps the focus', async () => {
  const r = await rig();
  const before = r.app.innerHTML;
  r.type('hello <t:0:R>');
  assert.equal(r.app.innerHTML, before, '⭐ typing in the message leaves the page alone (a repaint steals the caret)');
  assert.match(r.el('lg-stamp-readtext').innerHTML, /hello <span class="lgstampchip">/, 'the reading is kept up by hand');
  r.menu('lg-stamp-min', 37);
  assert.notEqual(r.app.innerHTML, before, 'a menu repaints');
  assert.equal(r.doc.activeElement?.id, 'lg-stamp-min', '⭐ and the menu has the focus again after it');
  assert.match(r.app.innerHTML, /hello &lt;t:0:R&gt;<\/textarea>/, 'the message survives the repaint');
});

test('1233 §4 ⭐ a calendar, an hour, a minute and AM | PM — nothing typed', async () => {
  const r = await rig();
  assert.doesNotMatch(r.app.innerHTML, /type="datetime-local" id="lg-stamp/, 'no typed date field');
  assert.match(r.app.innerHTML, /<select id="lg-stamp-hour" aria-label="Hour">/);
  assert.match(r.app.innerHTML, /<select id="lg-stamp-min" aria-label="Minute">/);
  assert.match(r.app.innerHTML, /data-btn="lg-stamp-ampm"[^>]*data-v="am"|data-v="am"[^>]*data-btn="lg-stamp-ampm"/);
  assert.doesNotMatch(r.app.innerHTML, /class="lgcal"/, 'the calendar starts shut');
  r.press({ btn: 'lg-stamp-cal' });
  assert.match(r.app.innerHTML, /class="lgcal"/, '⭐ the date button opens a calendar');
  r.press({ btn: 'lg-stamp-cal' });
  assert.doesNotMatch(r.app.innerHTML, /class="lgcal"/, 'and shuts it');

  r.pick('2026-11-08T19:30');
  assert.equal(code(r.app.innerHTML, 'F'), String(UNIX), '⭐ 7:30 PM New York on the 8th is 00:30 UTC the 9th');
  r.menu('lg-stamp-min', 37);
  assert.equal(code(r.app.innerHTML, 't'), String(UNIX + 37 * 60 - 30 * 60), 'to the minute, not the quarter hour');
  r.press({ btn: 'lg-stamp-ampm', v: 'am' });
  assert.equal(code(r.app.innerHTML, 't'), String(UNIX + 7 * 60 - 12 * 3600), '⭐ AM moves it twelve hours back');
  r.press({ btn: 'lg-stamp-cal' });
  r.press({ btn: 'lg-stamp-month', step: '1' });
  assert.match(r.app.innerHTML, /data-day="2026-12-01"/, 'the next month');
  r.press({ btn: 'lg-stamp-day', day: '2026-12-03' });
  assert.deepEqual(stampParts(Number(code(r.app.innerHTML, 't')) * 1000, TZ), { date: '2026-12-03', hour12: 7, minute: 37, pm: false },
    'a day keeps the time');
  assert.doesNotMatch(r.app.innerHTML, /class="lgcal"/, 'picking a day shuts the calendar');

  // the twelve o'clocks, and a day across a daylight-saving change
  const noon = stampSet(Date.parse('2026-11-08T17:00:00Z'), TZ, { hour12: 12, minute: 0, pm: true });
  assert.equal(new Date(noon).toISOString(), '2026-11-08T17:00:00.000Z', '12 PM is noon');
  assert.equal(new Date(stampSet(noon, TZ, { pm: false })).toISOString(), '2026-11-08T05:00:00.000Z', '12 AM is midnight');
  assert.equal(new Date(stampSet(noon, TZ, { date: '2026-10-30' })).toISOString(), '2026-10-30T16:00:00.000Z', 'noon in daylight time');
  const cal = stampCalendarHtml('2026-11', '2026-11-08', '2026-11-05');
  assert.match(cal, /data-day="2026-11-08" class="on" aria-pressed="true"/, 'the chosen day is marked');
  assert.match(cal, /data-day="2026-11-05" class="today"/, 'and today');
  assert.equal((cal.match(/data-btn="lg-stamp-day"/g) ?? []).length, 30, 'November has thirty days');
  assert.equal((/<div class="lgcaldays">(.*)/s.exec(cal)?.[1]!.match(/<span><\/span>/g) ?? []).length, 0, '1 Nov 2026 is a Sunday: no blanks before it');
});

test('1233 §5 ⭐ AM is tinted gold and PM dusk, on the clock and on every clock time', async () => {
  const r = await rig();
  r.pick('2026-11-08T19:30');
  assert.match(r.app.innerHTML, /class="lgstampclock pm"/, '⭐ an evening time: the clock is PM');
  assert.match(r.app.innerHTML, /<span class="lgstampchip pm">[^<]*7:30/, 'and its preview');
  r.press({ btn: 'lg-stamp-ampm', v: 'am' });
  assert.match(r.app.innerHTML, /class="lgstampclock am"/, '⭐ a morning time: AM');
  const css = readStyles();
  for (const rule of ['.lgstampclock.am', '.lgstampclock.pm', '.lgstampchip.am', '.lgstampchip.pm']) {
    assert.ok(css.includes(`${rule} {`), `${rule} has its colour`);
  }
  assert.match(stampMessageHtml(`<t:${UNIX}:t> / <t:${UNIX - 12 * 3600}:t> / <t:${UNIX}:D>`, TZ, 0),
    /^<span class="lgstampchip pm">.*<span class="lgstampchip am">.*<span class="lgstampchip">/, 'the reading tints the times, and only the times');
});

test('1233 §6 the reading shows the codes as words and what was typed as text', () => {
  const html = stampMessageHtml(`<b>hi</b> at <t:${UNIX}>\nok`, TZ, 0);
  assert.match(html, /^&lt;b&gt;hi&lt;\/b&gt; at <span class="lgstampchip pm">[^<]*7:30[^<]*<\/span><br>ok$/,
    'markup typed is shown as text; a bare code reads as Discord’s default (date and time); a new line is a new line');
});
