/* The page states ui-shots.mjs photographs — one row per picture.
 *
 *   page, state   the file name: <page>__<state>__<viewport>.png
 *   url           opened after storage is cleared (and the token set)
 *   as            'me' (the signed-in player, Quillon), 'admin' (Warden, an
 *                 admin with the owner badge), or absent (signed out)
 *   steps         after the page settles, in order:
 *                   {click: css, text?: regex, nth?}   a real mouse click, or a tap on touch
 *                   {type: css, text}                  focus and type
 *                   {key: 'Escape'}
 *                   {eval: js}                         false → the step failed
 *                   {settle: ms}                       wait, then settle again (add to any step)
 *                   optional: true                     a miss is not a failure
 *   check         a selector that must be on the page when the steps are done
 *   pages         at most this many screenfuls (default: --pages)
 *   stub          URL patterns answered with a plain placeholder page (CDP
 *                 Fetch) — for content that is not the client's; in the manifest
 *   css           a stylesheet added before the picture — a MASK, named in the
 *                 manifest; same rule
 *   viewports     only these
 *   also          opt-in viewports to shoot as well (ui-shots.mjs VIEWPORTS
 *                 `optIn`: the upright iPad, 'portrait')
 *   noScroll      the page must fit the window at desktop, tablet and portrait: a
 *                 document taller (or wider) than the viewport is a problem
 *                 and ui-shots exits 1 (the home screen, docs/24)
 *
 * A failed step is recorded in the manifest and the picture is still taken,
 * so a selector that rots shows up as a ✗ line rather than a silent skip.
 */
const btn = b => `[data-btn="${b}"]`;
const tab = (b, t) => `[data-btn="${b}"][data-tab="${t}"]`;
/** select an option of a <select> by its text, as a person would */
const pick = (sel, re) => ({ eval: `(() => { const s = document.querySelector(${JSON.stringify(sel)}); if (!s) return false;
  const o = [...s.options].find(o => ${re}.test(o.text)); if (!o) return false;
  s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`, settle: 300 });

/** the pages drawn in the app frame (ui/pages/frame.ts, 2026-11-04): one
 * window each, like the home — every one of their states is `noScroll` */
export const FRAME_PAGES = ['cards', 'meta', 'cardstats', 'queue', 'rules', 'auth', 'profile', 'admin', 'waiting', 'match', 'league', 'challenge',
  // BL-65 (2026-11-04): the Decks page (root `deckpage`) and the builder (root `ttpage`)
  'decks', 'builder',
  // docs/25 (2026-11-14): the cube draft page (root `cubepage`)
  'cube'];

/** the deck screens are laid out for an upright iPad too (BL-65) */
const PORTRAIT = { also: ['portrait'] };

export function SCENARIOS(fx) {
  const S = [];
  const add = (page, state, url, o = {}) => S.push({ page, state, url, ...(FRAME_PAGES.includes(page) ? { noScroll: true } : {}), ...o });
  const me = { as: 'me' }, admin = { as: 'admin' };

  // ── home and the chrome on every page ──
  // The home is one window (client/docs/24-redesign/, 2026-11-03): `noScroll`
  // makes ui-shots fail a home state whose page scrolls at desktop or tablet
  // (ui-shots-overflow.mjs pageScrolls). Its tabs and sheets are states of
  // their own, each reached the way a player would (a click on the toolbar,
  // the Play card or the bottom bar).
  const home = (state, o = {}) => add('home', state, '/', { noScroll: true, ...o });
  const sheetBtn = name => `[data-btn="home-sheet"][data-sheet="${name}"]`;
  const constructedTab = { click: '[data-btn="home-mode"][data-mode="constructed"]' };
  home('signed-out');
  home('signed-in', me);
  home('constructed', { ...me, steps: [constructedTab] });
  home('competitive', { ...me, steps: [constructedTab, { click: '[data-btn="home-format"][data-format="competitive"]' }] });
  home('pick-now', { ...me, steps: [{ click: '[data-btn="home-els"][data-pick="now"]' }] });
  home('join-open', { ...me, steps: [{ click: sheetBtn('join') }] });
  home('info-open', { steps: [{ click: sheetBtn('info') }] });
  home('updates-open', { ...me, steps: [{ click: sheetBtn('updates') }] });
  // Cards, Banned and Game values are behind the Draft tab's More settings (2026-11-14)
  const moreOpen = { click: btn('home-more') };
  home('more-open', { ...me, steps: [moreOpen] });
  home('customrules-open', { ...me, steps: [moreOpen, { click: sheetBtn('rules') }] });
  // Alternate modes' Cube draft: the other rows greyed out, "Host a Cube draft"
  home('cube-draft', { ...me, steps: [{ click: btn('home-cube') }] });
  // the custom rules out of the sheet, on the Draft tab (owner, 2026-11-03).
  // Beginner signed out: the name box, the Beginner line, the two element chips rows
  const CARDS_RULES = { v: 1, preset: null, elements: 3, packSize: 10, openingHand: 6, draftDraw: 2, startingLife: 20,
    simpleOnly: false, bans: ['Overwhelm', 'Ignis Sprite'], query: '-set:lightdark' };
  home('beginner', { steps: [{ click: '[data-btn="cr-beginner"][data-on="1"]' }] });
  home('cards-rules', { ...me, ls: { algoCustomRules: JSON.stringify(CARDS_RULES) } });
  // …and with More settings open over them: the filter's box, two bans, the pool line
  home('cards-rules-open', { ...me, ls: { algoCustomRules: JSON.stringify(CARDS_RULES) }, steps: [moreOpen] });
  home('ban-typing', { steps: [moreOpen, { type: '#cr-ban', text: 'ign', settle: 200 }] });
  home('competitive-clock-off', { ...me, steps: [constructedTab, { click: '[data-btn="home-format"][data-format="competitive"]' },
    { click: '[data-btn="clockpick"][data-clockfor="competitive"][data-ms="0"]' }] });
  add('auth', 'sign-up', '/', { steps: [{ click: btn('acct-open-auth') }], pages: 1 });
  add('auth', 'log-in', '/', { steps: [{ click: btn('acct-open-auth') }, { click: btn('acct-toggle-mode') }], pages: 1 });
  // the legal pages open from the client info sheet (the bottom bar's left)
  for (const l of ['about', 'ai', 'privacy', 'terms']) {
    add('legal', l, '/', { steps: [{ click: sheetBtn('info') }, { click: `[data-legal="${l}"]` }], pages: 1 });
  }
  add('report', 'dialog', '/', { ...me, steps: [{ click: '[data-report="open"]' }], pages: 1 });
  add('report', 'bug', '/', { ...me, steps: [{ click: '[data-report="open"]' }, { click: '.reportbox [role="radio"]', text: '^Bug$' }], pages: 1 });

  // ── the profile ──
  // the account redesign (2026-11-07): five tabs; the Players board's three
  // boards; Settings for an admin (the Staff row) and with the accessible colours on
  for (const t of ['overview', 'achievements', 'games', 'players', 'settings']) {
    add('profile', t, '/', { ...me, steps: [{ click: btn('acct-open-profile') }, ...(t === 'overview' ? [] : [{ click: tab('acct-tab', t) }])] });
  }
  for (const m of ['draft', 'all']) {
    add('profile', `players-${m}`, '/', { ...me, steps: [{ click: btn('acct-open-profile') }, { click: tab('acct-tab', 'players') },
      { click: `[data-btn="acct-ladder-mode"][data-mode="${m}"]` }] });
  }
  add('profile', 'settings-admin', '/', { ...admin, steps: [{ click: btn('acct-open-profile') }, { click: tab('acct-tab', 'settings') }] });
  add('profile', 'accessible-colours', '/', { ...me, ls: { algoColors: 'accessible' }, steps: [{ click: btn('acct-open-profile') }] });

  // ── my decks (BL-65, 2026-11-04): the Decks page — a shelf of deck boxes and
  //    the chosen deck's preview — and the builder, the pool over the table.
  //    Every state is checked for its page's root class ──
  const decks = [{ click: btn('deck-openpage') }];
  // a box's text is its name then its count ("Ember Rush30 cards…"), after the
  // "Bo3 ready" badge when it has one — so the name is anchored on both sides by
  // the start or that badge, and a digit: "Ember Rush (Competitive)" is another deck
  const deck = name => [...decks, { click: btn('deck-open'), text: `(^|ready)${name}\\d` }];
  const onDecks = { ...me, ...PORTRAIT, check: '.deckpage' };
  const onBuilder = { ...me, ...PORTRAIT, check: '.ttpage', pages: 1 };
  add('decks', 'shelf', '/', { ...onDecks, steps: decks });
  add('decks', 'selected', '/', { ...onDecks, steps: deck('Ember Rush') });
  add('decks', 'maybe', '/', { ...onDecks, steps: deck('Grove Keepers') });
  add('decks', 'card-focus', '/', { ...onDecks, steps: [...deck('Ember Rush'), { click: btn('deck-focus') }] });
  add('decks', 'import', '/', { ...onDecks, steps: [...decks, { click: btn('deck-import-open') }] });
  add('decks', 'share', '/', { ...onDecks, steps: [...deck('Ember Rush'), { click: btn('deck-share') }] });
  add('decks', 'export', '/', { ...onDecks, steps: [...deck('Ember Rush'), { click: btn('deck-export') }] });
  add('decks', 'delete', '/', { ...onDecks, steps: [...deck('Ember Rush'), { click: btn('deck-delete') }] });
  add('decks', 'games', '/', { ...onDecks, steps: [...deck('Ember Rush'), { click: btn('deck-games') }] });
  add('decks', 'signed-out', '/', { ...PORTRAIT, check: '.deckpage', steps: decks });
  add('builder', 'deck', `/?table=${fx.decks.pub}`, onBuilder);
  add('builder', 'deck-info', `/?table=${fx.decks.pub}`, { ...onBuilder, steps: [{ click: btn('deck-settings') }] });
  add('builder', 'stats', `/?table=${fx.decks.pub}`, { ...onBuilder, steps: [{ click: btn('tt-stats') }] });
  add('builder', 'more-filters', `/?table=${fx.decks.pub}`, { ...onBuilder, steps: [{ click: btn('tt-filters') }] });
  add('builder', 'card-menu', `/?table=${fx.decks.pub}`, { ...onBuilder, steps: [{ click: '.tttable [data-btn="tt-card"]' }], check: '.ttpop' });
  add('builder', 'maybe', `/?table=${fx.decks.maybe}`, onBuilder);

  // ── the card browser ──
  add('cards', 'browse', '/?cards=1');
  add('cards', 'search', '/?cards=1', { steps: [{ type: '#cb-q', text: 'fire unit' }, { settle: 400 }] });
  add('cards', 'syntax', '/?cards=1', { steps: [{ click: btn('cards-help') }], pages: 1 });
  add('cards', 'list-view', '/?cards=1', { steps: [{ click: '[data-btn="cards-view"][data-view="list"]' }] });
  add('cards', 'text-view', '/?cards=1', { steps: [{ click: '[data-btn="cards-view"][data-view="text"]' }] });
  add('cards', 'pinned', '/?card=Soul%20Swallower');

  // ── metagame ──
  add('meta', 'decks', '/?meta=1', me);
  add('meta', 'shared-deck', `/?deck=${fx.sharedDeck}`, { ...me, ...PORTRAIT });
  add('meta', 'card-ladder', '/?cardladder=1');
  add('cardstats', 'cards', '/?cardstats=1', me);
  for (const v of ['elements', 'highlights', 'game']) {
    add('cardstats', v, '/?cardstats=1', { ...me, steps: [{ click: `[data-btn="meta-cs-section"][data-v="${v}"]` }] });
  }
  add('cardstats', 'card', '/?cardstats=Soul%20Swallower', me);

  // ── the league, a season in each phase ──
  for (const [phase, id] of Object.entries(fx.seasons)) add('league', phase, `/?league=${id}`, me);
  add('league', 'signed-out', `/?league=${fx.seasons.running}`);
  add('league', 'organizer', `/?league=${fx.seasons.running}`, admin);
  add('league', 'suggest-time', `/?league=${fx.seasons.running}`, { ...me, steps: [{ click: btn('lg-time-open') }] });
  // the page's parts, the toolbar's tabs since the app frame (2026-11-04)
  const lgTab = v => ({ click: `[data-btn="lg-section"][data-v="${v}"]` });
  add('league', 'availability', `/?league=${fx.seasons.running}`, { ...me, steps: [lgTab('avail')] });
  add('league', 'standings', `/?league=${fx.seasons.running}`, { ...me, steps: [lgTab('standings')] });
  add('league', 'time-code', `/?league=${fx.seasons.running}`, { ...me, steps: [lgTab('stamp')] });
  add('league', 'organizer-tab', `/?league=${fx.seasons.running}`, { ...admin, steps: [lgTab('organizer')] });

  // ── the weekly challenge ──
  add('challenge', 'page', '/?challenge=1', me);
  add('challenge', 'signed-out', '/?challenge=1');
  // docs/25: the cube draft page — my events and the New-event sheet (an event's own states need the fixture to hold one)
  add('cube', 'events', '/?cube=1', me);
  add('cube', 'new-event', '/?cube=1', { ...me, steps: [{ click: btn('cube-new') }] });
  add('cube', 'signed-out', '/?cube=1');
  // "Build a deck": the builder's summary on the page (the tabletop is challenge__builder)
  add('challenge', 'building', '/?challenge=1', { ...me, steps: [{ click: '[data-btn="ch-build"]' }] });
  for (const t of ['leanest', 'purest', 'overall']) {
    add('challenge', `board-${t}`, '/?challenge=1', { ...me, steps: [{ click: tab('ch-tab', t) }] });
  }
  add('challenge', 'past-week', `/?challenge=1&board=${fx.challenge.past}`, me);
  // the challenge deck on the builder (BL-65: in the app frame now)
  add('challenge', 'builder', `/?table=ch:${fx.challenge.current}`, { ...me, ...PORTRAIT, pages: 1, check: '.ttpage' });
  add('challenge', 'builder-import', `/?table=ch:${fx.challenge.current}`,
    { ...me, ...PORTRAIT, pages: 1, check: '.ttpage', steps: [{ click: btn('ch-import') }] });

  // ── admin ──
  add('admin', 'refused', '/?admin=1', me);
  for (const t of ['reports', 'accounts', 'games', 'rooms', 'challenges']) {
    add('admin', t, '/?admin=1', { ...admin, steps: t === 'reports' ? [] : [{ click: tab('admin-tab', t) }] });
  }

  // ── how to play, learn to play ──
  add('rules', 'rules', '/?rules', { pages: 1 });
  add('rules', 'search', '/?rules', { steps: [{ type: '#rules-q', text: 'erase' }, { settle: 300 }], pages: 1 });
  // The Rulebook tab frames the PDF manual in Chrome's own PDF viewer: not
  // the client's rendering, not byte-stable between runs, and it hung the
  // headless renderer (blocking the URL hung it too). The PDF request is
  // answered with a plain placeholder page; the tab around it is the picture.
  add('rules', 'rulebook', '/?rules=book', { pages: 1, stub: ['*.pdf'] });
  add('rules', 'cr', '/?rules=cr', { pages: 1 });
  // the comprehensive rules read natively (ui/crreader.ts, 2026-11-04): a search,
  // a link straight to a sub-rule, and a rule followed from another with Back
  add('rules', 'cr-search', '/?rules=cr', { steps: [{ type: '#rules-q', text: 'deadly' }, { settle: 300 }], pages: 1 });
  add('rules', 'cr-at', '/?rules=cr&at=608.2b', { pages: 1, check: '.rddoc .rd-at' });
  add('rules', 'cr-follow', '/?rules=cr', { steps: [{ click: '[data-btn="crgo"][data-to="s100"]' }, { click: '.rddoc a[data-to="r104"]', text: '104' }, { settle: 300 }], pages: 1, check: '.rdback' });
  // …and over a game: the board's own toolbar stays beside the reader (the ?demo table)
  add('rules', 'board-cr', '/?demo=1', { steps: [{ click: '[data-btn="helpopen"]' }, { click: '[data-btn="helptab"][data-tab="cr"]' }, { settle: 600 }], pages: 1, noScroll: false });
  add('rules', 'cr-glossary', '/?rules=cr', { steps: [{ click: '[data-btn="crgo"][data-to="glossary"]' }, { settle: 300 }], pages: 1 });
  add('rules', 'interface', '/?rules=tutorial', { pages: 1 });
  add('learn', 'menu', '/?learn', { pages: 1 });
  add('learn', 'lessons', '/?learn', { steps: [{ click: '.learnmenu summary, [data-learn] summary, details summary', text: 'lesson' }], pages: 1 });

  // ── the rules review page ──
  for (const t of ['doc', 'annexD', 'disc', 'oq', 'comments']) add('crreview', t, `/?crreview=${t}`, admin);

  // ── the queue and a waiting room ──
  add('queue', 'picker', '/?queue=1', me);
  add('queue', 'constructed', '/?queue=1', { ...me, steps: [{ click: '[data-btn="queue-mode"][data-mode="constructed"]' }] });
  add('queue', 'signed-out', '/?queue=1');
  // near the end: opening the bell marks the notes read, which changes the
  // unread count every later page shows
  home('bell-open', { ...me, steps: [{ click: '[data-inbox="bell"]' }], pages: 1 });
  // ── decks that WRITE: each makes a new (empty, so not legal) deck. After
  //    every state that shows a deck list, so none of them shows it ──
  add('decks', 'not-legal', '/', { ...onDecks, steps: [...decks, { click: btn('deck-new'), settle: 600 }, { click: btn('tt-close') }] });
  add('builder', 'whats-wrong', '/', { ...onBuilder, steps: [...decks, { click: btn('deck-new'), settle: 600 }, { click: btn('tt-problems') }] });
  // last: it creates a room on the server (seeded code, so the same one each run)
  add('waiting', 'constructed', '/', { ...me, steps: [
    constructedTab,
    pick('#h-deck', '/Ember Rush/'),
    { click: '[data-btn="newgame"][data-mode="constructed"]:not([data-single])', settle: 1500 },
  ], check: '#app', pages: 1 });

  // ── Competitive Constructed (docs/22): only on a fixture built with --cc
  //    (ui-fixture.ts), which the shared one predates. AFTER everything else:
  //    the last state creates a match room, and the paused match these read
  //    would show on the shared states' home and profile pictures.
  if (fx.cc) {
    const ccDeck = [...decks, { click: btn('deck-open'), text: 'Competitive' }];
    home('cc-your-matches', me);
    // the deck with a sideboard: its preview (Bo3 ready, Side n), and on the builder (the rail's Sideboard n/7)
    add('decks', 'cc-deck', '/', { ...onDecks, steps: ccDeck });
    add('builder', 'cc-sideboard', `/?table=${fx.cc.deck}`, onBuilder);
    // between games: the sideboarding table (the builder's table, paused here)
    add('match', 'between-paused', `/?ws=1&room=${fx.cc.room}&seat=${fx.cc.seat}&mode=constructed`,
      { ...me, ...PORTRAIT, steps: [{ settle: 1500 }], check: '#app' });
    // last: it creates a match room (seeded code, so the same one each run)
    add('match', 'registration', '/', { ...me, steps: [
      constructedTab,
      { click: '[data-btn="home-format"][data-format="competitive"]' },
      pick('#cc-deck', '/Competitive/'),
      { click: btn('cc-new'), settle: 1500 },
    ], check: '#app', pages: 1 });
  }

  // ── docs/25: the cube pick screen. LAST of all: each state makes an event and starts its
  //    draft (the player's "the draft is starting" bell line and the Draft tab's count of
  //    my events would show on every later picture). The event is made from the page, over the API,
  //    as a player would with the New-event sheet: me as host, the friend joined, Start.
  //    ⚠ needs ALGO_CUBE_DIR in ui-fixture.ts fixtureEnv, or the events land in the
  //    checkout's var/cube.
  const cubeDraft = (config) => ({ eval: `(async () => {
    const me = localStorage.getItem('algoToken');
    const call = async (path, tok) => (await fetch(path, { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok },
      body: JSON.stringify(path.endsWith('/new') ? { config: ${JSON.stringify({ name: 'Friday cube', fillBots: true, ...config })} } : {}) })).json();
    const made = await call('/api/cube/new', me);
    if (!made.ok) return false;
    if (!(await call('/api/cube/' + made.code + '/join', ${JSON.stringify(fx.tokens?.[fx.names?.friend] ?? '')})).ok) return false;
    if (!(await call('/api/cube/' + made.code + '/start', me)).ok) return false;
    location.search = '?cube=' + made.code;
    return true;
  })()`, settle: 2500 });
  // a full table (eight seats, six bots) and a fifteen-card pack: the widest strip, the most tiles
  add('cube', 'draft-pack', '/', { ...me, steps: [cubeDraft({ maxPlayers: 8, packs: 2, packSize: 15 })], check: '.cdpage', pages: 1 });
  // the last ten seconds: a five-card pack's clock is 30 s; held 19 s, then a card chosen
  // (the server answers a choice with a fresh view, so the clock on screen is the server's)
  add('cube', 'draft-urgent', '/', { ...me, steps: [
    cubeDraft({ maxPlayers: 8, packs: 6, packSize: 5 }),
    { wait: 19_000 },
    { click: btn('cd-card'), settle: 600 },
  ], check: '.cdpage', pages: 1 });
  // waiting for a pack: two seats, no bots — my pick goes to the friend, who holds theirs
  add('cube', 'draft-waiting', '/', { ...me, steps: [
    cubeDraft({ maxPlayers: 2, packs: 6, packSize: 5 }),
    { click: btn('cd-card') },
    { click: btn('cd-confirm'), settle: 1500 },
  ], check: '.cdwaiting', pages: 1 });
  // the home after them: the Draft tab's "Cube draft…" with my events' count (owner 2026-11-14:
  // a small thing in the Draft area, not a card of its own)
  home('cube-events', me);
  return S;
}
