/* PHOTOGRAPH EVERY NON-GAME PAGE of the client, deterministically, so a change
 * can be shown to have moved nothing visible (or exactly what it meant to).
 *
 * ── the commands ──────────────────────────────────────────────────────────
 *
 *   npm --prefix client/ui run build                       # the bundle under test
 *   node client/server/e2e/ui-fixture.ts --out <fx>         # once: the made-up world
 *   node client/server/e2e/ui-shots.mjs --fixture <fx> --out <before>
 *   …make the change, rebuild the bundle…
 *   node client/server/e2e/ui-shots.mjs --fixture <fx> --out <after>
 *   node client/server/e2e/ui-shots-compare.mjs <before> <after> [<report dir>] [--fuzz 3]
 *
 * Keep ONE fixture directory for a before/after pair: ids, room codes and
 * tokens are random per fixture build (ui-fixture.ts says why that does not
 * matter within one build). A missing fixture is built on the spot.
 *
 * Options:  --port 5182 (5182–5185 are this tool's)   --viewports desktop,tablet,phone
 *           --only <substring of page__state>          --pages N (screens per state, default 3)
 *           --chrome /usr/bin/google-chrome            --verbose
 *
 * Output: <out>/<page>__<state>__<viewport>.png (and …-p2.png, -p3.png for the
 * next screenfuls of a page taller than the window, scrolled, never resized),
 * plus <out>/manifest.json: every shot's url, steps, scroll size, the
 * overflow walk's findings, and whether the frame settled. A state marked
 * `noScroll` (the home screen) whose page scrolls at desktop or tablet is a
 * problem, and the run exits 1.
 *
 * ── what makes two runs byte-identical ─────────────────────────────────────
 *
 *   · the server: a fresh copy of the fixture's var/ per run, on a pinned clock
 *     (pinned-server.mjs), its room codes from a seeded generator, an hour after the fixture was seeded
 *   · the browser: a fresh profile per viewport, storage cleared before every
 *     state; Date frozen at that same instant and Math.random seeded (an
 *     init script, before any page script); every animation and transition
 *     off and the caret transparent (an injected stylesheet); colour profile
 *     forced to sRGB, GPU off, and one raster thread with no partial raster
 *     (without those, anti-aliased corners came out ±1 in ~10% of pictures)
 *   · each shot waits for the network to go quiet, fonts and images to load,
 *     and then captures until two frames in a row are identical
 *
 * The client's own Date is frozen, so its Date-driven pollers (the inbox
 * tick) never fall due again after the first paint: background repaints stop
 * by themselves. Nothing in client/ui is changed or hooked.
 *
 * Touch: the client sets html.touch at install time from
 * matchMedia('(pointer: coarse)') (ui/touch.ts installTouch) and on any touch
 * pointerdown. The tablet and phone viewports turn on CDP touch emulation and
 * emulate pointer/any-pointer: coarse, hover/any-hover: none BEFORE the page
 * loads, so the class is there from the first paint; their clicks are taps
 * (Input.dispatchTouchEvent), not mouse events.
 *
 * Kill hygiene: the server and Chrome are this script's children and are
 * killed by PID on exit and on Ctrl-C. Never pkill -f (CLAUDE.md).
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { SHOTS_NOW, buildFixture, copyFixtureVar, fixtureEnv } from './ui-fixture.ts';
import { NO_SCROLL_VIEWPORTS, overflowJs, pageScrolls, regionScrolls } from './ui-shots-overflow.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// ws is the server's own dependency, and CommonJS
const { WebSocket } = createRequire(join(HERE, '..', 'package.json'))('ws');

export const VIEWPORTS = {
  desktop: { w: 1440, h: 900, touch: false, mobile: false },
  tablet: { w: 1024, h: 768, touch: true, mobile: true },
  phone: { w: 390, h: 844, touch: true, mobile: true },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* every child this process starts, killed by PID when it exits — however it
 * exits: a thrown error must not leave a server on the port or a Chrome
 * holding its profile */
const children = new Set();
process.on('exit', () => { for (const c of children) { try { c.kill('SIGKILL'); } catch { /* gone */ } } });
const track = c => { children.add(c); c.once('exit', () => children.delete(c)); return c; };

// ── the server ──────────────────────────────────────────────────────────

export async function startServer(fixtureDir, port) {
  const runVar = mkdtempSync(join(tmpdir(), 'algo-ui-shots-var-'));
  copyFixtureVar(fixtureDir, runVar);
  const proc = track(spawn(process.execPath, [join(HERE, '..', 'main.ts')], {
    cwd: join(HERE, '..'),
    env: { ...process.env, ...fixtureEnv(runVar, SHOTS_NOW), PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
  let out = '';
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`server did not start\n${out}`)), 60_000);
    const on = d => { out += String(d); if (/Algomancy server on/.test(out)) { clearTimeout(t); res(); } };
    proc.stdout.on('data', on);
    proc.stderr.on('data', d => { out += String(d); });
    proc.on('exit', code => { clearTimeout(t); rej(new Error(`server exited ${code}\n${out}`)); });
  });
  proc.stdout.removeAllListeners('data');
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  proc.removeAllListeners('exit');
  return {
    base: `http://127.0.0.1:${port}`, pid: proc.pid, runVar,
    async stop() {
      if (proc.exitCode === null && proc.signalCode === null) {
        const done = new Promise(r => proc.once('exit', r));
        proc.kill();
        await Promise.race([done, sleep(5000)]);
      }
      rmSync(runVar, { recursive: true, force: true });
    },
  };
}

// ── Chrome over the DevTools protocol ──────────────────────────────────

const FROZEN_MS = Date.parse(SHOTS_NOW);

/** runs before any page script, in every document */
const INIT_JS = `(() => {
  const FIXED = ${FROZEN_MS};
  const Real = Date;
  class FrozenDate extends Real {
    constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); }
    static now() { return FIXED; }
  }
  window.Date = new Proxy(FrozenDate, { apply() { return new FrozenDate().toString(); } });
  let s = 0x2545f491;
  Math.random = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const CSS = '*,*::before,*::after{animation:none!important;transition:none!important;' +
    'caret-color:transparent!important;scroll-behavior:auto!important}';
  const add = () => {
    if (document.getElementById('__shots_css')) return;
    const st = document.createElement('style');
    st.id = '__shots_css'; st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  };
  if (document.documentElement) add();
  document.addEventListener('DOMContentLoaded', add);
})();`;

export async function launch(vpName, { chrome = '/usr/bin/google-chrome', verbose = false } = {}) {
  const vp = VIEWPORTS[vpName];
  const prof = mkdtempSync(join(tmpdir(), 'algo-ui-shots-prof-'));
  const cdpPort = 9400 + Math.floor(Math.random() * 500);
  const proc = track(spawn(chrome, [
    '--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${prof}`,
    '--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-gpu',
    '--force-color-profile=srgb', '--disable-extensions', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--mute-audio', '--hide-scrollbars',
    '--disable-features=Translate,MediaRouter,OptimizationHints',
    // raster determinism: the same frame must rasterize to the same bytes
    // whatever order its tiles were painted in (anti-aliased corners were
    // coming out ±1 between runs without these)
    '--num-raster-threads=1', '--disable-partial-raster', '--disable-checker-imaging',
    '--run-all-compositor-stages-before-draw', '--disable-threaded-animation', '--disable-threaded-scrolling',
    '--disable-gpu-rasterization', '--disable-zero-copy', '--disable-lcd-text', '--disable-font-subpixel-positioning',
    `--window-size=${vp.w},${vp.h}`, 'about:blank',
  ], { stdio: 'ignore' }));
  let target;
  for (let i = 0; i < 75 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find(t => t.type === 'page'); } catch { /* not up */ }
  }
  if (!target) { proc.kill(); throw new Error('chrome did not come up'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });

  let id = 0;
  let stubHtml = '';
  const pending = new Map();
  const inflight = new Map();   // requestId -> url
  let lastNet = Date.now();
  const errors = [];
  ws.on('message', d => {
    const m = JSON.parse(String(d));
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    switch (m.method) {
      case 'Network.requestWillBeSent':
        // http(s) only: the Rulebook tab's PDF viewer is a chrome-extension://
        // request that never reports finished
        if (/^https?:/.test(m.params.request.url)) { inflight.set(m.params.requestId, m.params.request.url); lastNet = Date.now(); }
        break;
      case 'Network.loadingFinished': case 'Network.loadingFailed':
        inflight.delete(m.params.requestId); lastNet = Date.now(); break;
      case 'Fetch.requestPaused': {
        // a stubbed URL (a state's `stub`): answer with the placeholder page
        const body = Buffer.from(stubHtml).toString('base64');
        send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200,
          responseHeaders: [{ name: 'content-type', value: 'text/html; charset=utf-8' }], body }).catch(() => {});
        break;
      }
      case 'Runtime.exceptionThrown':
        errors.push(m.params?.exceptionDetails?.exception?.description?.slice(0, 200) ?? 'exception'); break;
      case 'Runtime.consoleAPICalled':
        if (m.params.type === 'error') errors.push('console.error: ' + JSON.stringify(m.params.args?.map(a => a.value ?? a.description)).slice(0, 200));
        break;
      default:
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    const t = setTimeout(() => { pending.delete(i); rej(new Error(`CDP ${method} timed out`)); }, 60_000);
    pending.set(i, m => { clearTimeout(t); m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result); });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`eval: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}\n${expr.slice(0, 200)}`);
    return r.result?.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: INIT_JS });
  await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile });
  if (vp.touch) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setEmulatedMedia', {
    media: 'screen',
    features: vp.touch
      ? [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }, { name: 'hover', value: 'none' }, { name: 'any-hover', value: 'none' },
        { name: 'prefers-reduced-motion', value: 'reduce' }]
      : [{ name: 'pointer', value: 'fine' }, { name: 'any-pointer', value: 'fine' }, { name: 'hover', value: 'hover' }, { name: 'any-hover', value: 'hover' },
        { name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await send('Emulation.setTimezoneOverride', { timezoneId: 'Europe/London' });
  await send('Emulation.setLocaleOverride', { locale: 'en-GB' });

  const P = {
    vpName, vp, send, ev, errors,
    /** answer every request matching `patterns` with a plain placeholder page */
    async stub(patterns) {
      if (!patterns?.length) { await send('Fetch.disable'); return; }
      stubHtml = '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#2a2d33;color:#aaa;font:14px sans-serif;display:grid;place-items:center;height:100vh">stubbed by ui-shots: not photographed</body>';
      await send('Fetch.enable', { patterns: patterns.map(urlPattern => ({ urlPattern, requestStage: 'Request' })) });
    },
    log: (...a) => { if (verbose) console.log('   ', ...a); },
    /** quiet: nothing in flight (WebSockets are not requests here) for `ms` */
    async netIdle(ms = 350, max = 15_000) {
      const t0 = Date.now();
      while (Date.now() - t0 < max) {
        if (inflight.size === 0 && Date.now() - lastNet >= ms) return true;
        await sleep(50);
      }
      console.log('    (network never went quiet:', [...inflight.values()].slice(0, 3).join(' '), ')');
      return false;
    },
    async settled() {
      await P.netIdle();
      await ev(`(async () => {
        await document.fonts.ready;
        // only what is on screen: a loading="lazy" image below the fold is
        // never complete until it is scrolled to (each screenful settles again)
        const onScreen = i => { const r = i.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
        const imgs = [...document.images].filter(i => !i.complete && onScreen(i));
        await Promise.race([Promise.all(imgs.map(i => new Promise(r => { i.onload = i.onerror = r; }))), new Promise(r => setTimeout(r, 8000))]);
        // loaded is not decoded: a thumbnail rastered before its decode lands
        // comes out a level off at its edges, so decode every one on screen
        await Promise.race([Promise.all([...document.images].filter(i => i.complete && i.naturalWidth && onScreen(i)).map(i => i.decode().catch(() => {}))), new Promise(r => setTimeout(r, 5000))]);
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        return true;
      })()`);
      await P.netIdle(200);
    },
    async goto(url) {
      inflight.clear();   // a request the last document left open is not this one's
      await send('Page.navigate', { url });
      await sleep(250);
      await P.waitReady();
      await P.settled();
    },
    async waitReady(max = 15_000) {
      const t0 = Date.now();
      while (Date.now() - t0 < max) {
        try { if (await ev('document.readyState') === 'complete') return; } catch { /* navigating */ }
        await sleep(80);
      }
    },
    /** element centre, or null */
    async at(sel, text, nth = 0) {
      return ev(`(() => {
        const re = ${text ? `new RegExp(${JSON.stringify(text)})` : 'null'};
        const all = [...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => {
          const r = e.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return false;
          return !re || re.test((e.textContent || e.value || '').trim());
        });
        const e = all[${nth}]; if (!e) return null;
        e.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const r = e.getBoundingClientRect();
        return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)];
      })()`);
    },
    async click(sel, text, nth = 0) {
      const p = await P.at(sel, text, nth);
      if (!p) return false;
      const [x, y] = p;
      if (vp.touch) {
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await sleep(40);
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
        // park the mouse in a corner so no hover state is photographed
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: vp.w - 1, y: vp.h - 1 });
      }
      await sleep(150);
      await P.settled();
      return true;
    },
    async type(sel, text) {
      const ok = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.focus(); return true; })()`);
      if (!ok) return false;
      await send('Input.insertText', { text });
      await sleep(150);
      await P.settled();
      return true;
    },
    async key(key) {
      const code = { Escape: 'Escape', Enter: 'Enter' }[key] ?? key;
      const vk = { Escape: 27, Enter: 13 }[key] ?? 0;
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
      await sleep(150);
      await P.settled();
    },
    /** capture until two frames in a row are identical */
    async capture() {
      let prev = null, last = null;
      for (let i = 0; i < 6; i++) {
        const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
        last = Buffer.from(r.data, 'base64');
        const h = createHash('sha1').update(last).digest('hex');
        if (h === prev) return { png: last, stable: true };
        prev = h;
        await sleep(i === 0 ? 120 : 300);
      }
      return { png: last, stable: false };
    },
    async close() {
      try { ws.close(); } catch { /* gone */ }
      proc.kill();
      await sleep(300);
      rmSync(prof, { recursive: true, force: true });
    },
    pid: proc.pid,
  };
  return P;
}

/* the overflow walk (buttons/inputs past the window or clipped, and the page's
 * own sideways overflow) is ui-shots-overflow.mjs, so a test can run it */

// ── the run ─────────────────────────────────────────────────────────────

/** Run one state: clean storage, sign in if asked, open the url, do the steps.
 * Returns the step that failed, or null. */
async function runState(P, base, fx, s) {
  // a document on the origin with no app in it, to set storage from
  await P.stub(s.stub);
  await P.send('Storage.clearDataForOrigin', { origin: base, storageTypes: 'all' });
  await P.send('Page.navigate', { url: `${base}/favicon.ico` });
  await P.waitReady();
  const ls = { algoSound: '0', ...(s.ls ?? {}) };
  if (s.as) ls.algoToken = fx.tokens[fx.names[s.as] ?? s.as];
  await P.ev(`(() => { ${Object.entries(ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('')} })()`);
  await P.goto(base + s.url);
  for (const [i, st] of (s.steps ?? []).entries()) {
    let ok = true;
    if (st.click) ok = await P.click(st.click, st.text, st.nth ?? 0);
    else if (st.type) ok = await P.type(st.type, st.text);
    else if (st.key) await P.key(st.key);
    else if (st.eval) ok = (await P.ev(st.eval)) !== false;
    else if (st.wait) await sleep(st.wait);
    if (st.settle) { await sleep(st.settle); await P.settled(); }
    if (!ok && !st.optional) return `step ${i} ${JSON.stringify(st)}`;
  }
  if (s.css) {
    await P.ev(`(() => { const st = document.createElement('style'); st.textContent = ${JSON.stringify(s.css)}; document.head.appendChild(st); return true; })()`);
    await P.settled();
  }
  if (s.check) {
    const okCheck = await P.ev(`!!document.querySelector(${JSON.stringify(s.check)})`);
    if (!okCheck) return `check ${s.check} not on the page`;
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const fixtureDir = resolve(opt('fixture', join(tmpdir(), 'algo-ui-fixture')));
  const outDir = resolve(opt('out', './ui-shots-out'));
  const port = Number(opt('port', '5182'));
  const vps = opt('viewports', 'desktop,tablet,phone').split(',');
  const only = opt('only', '');
  const pages = Number(opt('pages', '3'));
  const verbose = args.includes('--verbose');
  const chrome = opt('chrome', '/usr/bin/google-chrome');

  if (!existsSync(join(HERE, '..', '..', 'ui', 'bundle.js'))) {
    console.error('no client/ui/bundle.js — run `npm --prefix client/ui run build` first');
    process.exit(2);
  }
  if (!existsSync(join(fixtureDir, 'fixture.json'))) {
    console.log(`building the fixture at ${fixtureDir}…`);
    const r = await buildFixture(fixtureDir);
    if (r.gaps.length) console.log(`fixture gaps:\n  ${r.gaps.join('\n  ')}`);
  }
  const fx = JSON.parse(readFileSync(join(fixtureDir, 'fixture.json'), 'utf8'));
  const { SCENARIOS } = await import('./ui-shots-states.mjs');
  const states = SCENARIOS(fx).filter(s => !only || `${s.page}__${s.state}`.includes(only));

  mkdirSync(outDir, { recursive: true });
  const live = new Set();
  const cleanup = async () => { for (const x of live) await x.close(); live.clear(); };
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup().finally(() => process.exit(130)); });

  const manifest = { fixture: fixtureDir, frozenAt: SHOTS_NOW, viewports: {}, shots: {} };
  const problems = [];
  let noScrollFailed = false;
  const t0 = Date.now();
  try {
    for (const vpName of vps) {
      if (!VIEWPORTS[vpName]) throw new Error(`unknown viewport ${vpName}`);
      manifest.viewports[vpName] = VIEWPORTS[vpName];
      // a fresh copy of the fixture per viewport: a state that writes (a
      // waiting room, the bell marking notes read) cannot leak into another
      // viewport's pictures, and `--viewports phone` alone shoots what a full
      // run's phone pass shoots
      const server = await startServer(fixtureDir, port);
      const srv = { close: () => server.stop() };
      live.add(srv);
      let P = await launch(vpName, { chrome, verbose });
      live.add(P);
      let n = 0;
      for (const s of states) {
        if (s.viewports && !s.viewports.includes(vpName)) continue;
        const name = `${s.page}__${s.state}__${vpName}`;
        const entry = { page: s.page, state: s.state, viewport: vpName, url: s.url, as: s.as ?? null, steps: s.steps ?? [], files: [] };
        if (s.stub) entry.stubbed = s.stub;
        if (s.css) entry.masked = s.css;
        const ts = Date.now();
        try {
          P.errors.length = 0;
          let failed;
          try { failed = await runState(P, server.base, fx, s); } catch (e) { failed = String(e?.message ?? e).slice(0, 300); }
          if (failed) entry.failed = failed;
          const ov = await P.ev(overflowJs(P.vp.w)).catch(() => null);
          entry.scroll = ov ? { w: ov.scrollW, h: ov.scrollH } : null;
          entry.overflow = ov ? { horizontal: ov.scrollW > ov.W, bad: ov.bad } : null;
          // the home is one window: its page must not scroll (docs/24)
          if (s.noScroll && NO_SCROLL_VIEWPORTS.includes(vpName) && (!ov || pageScrolls(ov))) {
            entry.pageScrolls = ov ? { w: ov.scrollW, h: ov.scrollH, W: ov.W, H: ov.H } : 'not measured';
            problems.push(`${name}: the page scrolls (${ov ? `${ov.scrollW}×${ov.scrollH} in a ${ov.W}×${ov.H} window` : 'not measured'}) — it must fit the window`);
            noScrollFailed = true;
          }
          // …and neither may the shell's main region, which scrolls inside itself
          // where the page cannot see it (ui-shots-overflow.mjs regionScrolls)
          if (s.noScroll && NO_SCROLL_VIEWPORTS.includes(vpName) && ov && regionScrolls(ov)) {
            entry.regionScrolls = { h: ov.region.scrollH, H: ov.region.H };
            problems.push(`${name}: the main region scrolls (${ov.region.scrollH}px in ${ov.region.H}px) — it must fit the window`);
            noScrollFailed = true;
          }
          // screenfuls: scroll the document, never resize the window
          const screens = Math.max(1, Math.min(pages, s.pages ?? pages, ov ? Math.ceil(ov.scrollH / ov.H) : 1));
          for (let k = 0; k < screens; k++) {
            if (k > 0) { await P.ev(`window.scrollTo(0, ${k * P.vp.h})`); await sleep(100); await P.settled(); }
            const { png, stable } = await P.capture();
            const file = `${name}${k ? `-p${k + 1}` : ''}.png`;
            writeFileSync(join(outDir, file), png);
            entry.files.push(file);
            if (!stable) { entry.unstable = true; problems.push(`${file}: never settled (two identical frames)`); }
          }
          if (P.errors.length) entry.errors = [...P.errors];
        } catch (e) {
          // a hung renderer: this state is lost, the run is not — a fresh Chrome
          entry.failed = `${entry.failed ? `${entry.failed}; ` : ''}${String(e?.message ?? e).slice(0, 200)} (Chrome restarted)`;
          await P.close(); live.delete(P);
          P = await launch(vpName, { chrome, verbose });
          live.add(P);
        }
        if (entry.failed) { problems.push(`${name}: ${entry.failed}`); console.log(`✗ ${name}: ${entry.failed}`); }
        manifest.shots[name] = entry;
        n++;
        entry.ms = Date.now() - ts;
        const flag = entry.unstable ? '~' : entry.overflow?.horizontal || entry.overflow?.bad?.length ? '⚠' : '✓';
        if (!entry.failed) console.log(`${flag} ${name} (${entry.files.length}) ${(entry.ms / 1000).toFixed(1)}s`);
      }
      await P.close(); live.delete(P);
      await server.stop(); live.delete(srv);
      console.log(`[${vpName}] ${n} states`);
    }
  } finally {
    await cleanup();
  }
  manifest.problems = problems;
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const files = Object.values(manifest.shots).reduce((a, e) => a + e.files.length, 0);
  console.log(`\n${Object.keys(manifest.shots).length} states, ${files} PNGs in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${outDir}`);
  if (problems.length) console.log(`${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  if (noScrollFailed) { console.log('✗ a page that must fit the window scrolls (noScroll) — see the problems above'); process.exitCode = 1; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e); process.exit(1); });
}
