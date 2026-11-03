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
 *   noScroll      the page must fit the window at desktop and tablet: a
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

export function SCENARIOS(fx) {
  const S = [];
  const add = (page, state, url, o = {}) => S.push({ page, state, url, ...o });
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
  home('customrules-open', { ...me, steps: [{ click: sheetBtn('rules') }] });
  // the custom rules out of the sheet, on the Draft tab (owner, 2026-11-03).
  // Beginner signed out: the tallest Draft tab (the name box, the Mode line,
  // the two element chips rows)
  const CARDS_RULES = { v: 1, preset: null, elements: 3, packSize: 10, openingHand: 6, draftDraw: 2, startingLife: 20,
    simpleOnly: false, bans: ['Overwhelm', 'Ignis Sprite'], query: '-set:lightdark' };
  home('beginner', { steps: [{ click: '[data-btn="cr-beginner"][data-on="1"]' }] });
  home('cards-rules', { ...me, ls: { algoCustomRules: JSON.stringify(CARDS_RULES) } });
  home('ban-typing', { steps: [{ type: '#cr-ban', text: 'ign', settle: 200 }] });
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
  for (const t of ['stats', 'achievements', 'ladder', 'friends', 'decks', 'history']) {
    add('profile', t, '/', { ...me, steps: [{ click: btn('acct-open-profile') }, ...(t === 'stats' ? [] : [{ click: tab('acct-tab', t) }])] });
  }

  // ── my decks ──
  const decks = [{ click: btn('deck-openpage') }];
  const deck = name => [...decks, { click: btn('deck-open'), text: name }];
  add('decks', 'first', '/', { ...me, steps: decks });
  add('decks', 'public-deck', '/', { ...me, steps: deck('Ember Rush') });
  add('decks', 'curve', '/', { ...me, steps: [...deck('Ember Rush'), { click: tab('deck-tab', 'mana') }] });
  add('decks', 'games', '/', { ...me, steps: [...deck('Ember Rush'), { click: tab('deck-tab', 'games') }] });
  add('decks', 'maybeboard', '/', { ...me, steps: [...deck('Grove Keepers'), { click: tab('deck-tab', 'maybe') }] });
  add('decks', 'card-focus', '/', { ...me, steps: [...deck('Ember Rush'), { click: btn('deck-focus') }] });
  add('decks', 'group-cost', '/', { ...me, steps: [...deck('Ember Rush'), { click: '[data-btn="deck-group"][data-group="cost"]' }] });
  add('decks', 'add-drawer', '/', { ...me, steps: [...deck('Tidecaller'), { click: btn('deck-adding') }] });
  add('decks', 'settings', '/', { ...me, steps: [...deck('Ember Rush'), { click: btn('deck-settings') }], pages: 1 });
  add('decks', 'describe', '/', { ...me, steps: [...deck('Ember Rush'), { click: btn('deck-desc-edit') }], pages: 1 });
  add('decks', 'export', '/', { ...me, steps: [...deck('Ember Rush'), { click: btn('deck-settings') }, { click: btn('deck-export') }], pages: 1 });
  add('decks', 'import', '/', { ...me, steps: [...decks, { click: btn('deck-import-open') }], pages: 1 });
  add('tabletop', 'deck', '/', { ...me, steps: [...deck('Ember Rush'), { click: btn('deck-tabletop') }], pages: 1 });

  // ── the card browser ──
  add('cards', 'browse', '/?cards=1');
  add('cards', 'search', '/?cards=1', { steps: [{ type: '#cb-q', text: 'fire unit' }, { settle: 400 }] });
  add('cards', 'syntax', '/?cards=1', { steps: [{ click: btn('cards-help') }], pages: 1 });
  add('cards', 'list-view', '/?cards=1', { steps: [{ click: '[data-btn="cards-view"][data-view="list"]' }] });
  add('cards', 'text-view', '/?cards=1', { steps: [{ click: '[data-btn="cards-view"][data-view="text"]' }] });
  add('cards', 'pinned', '/?card=Soul%20Swallower');
  add('cards', 'deckbuilding', '/', { ...me, steps: [...deck('Tidecaller'), { click: btn('deck-browse') }] });

  // ── metagame ──
  add('meta', 'decks', '/?meta=1', me);
  add('meta', 'shared-deck', `/?deck=${fx.sharedDeck}`, me);
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

  // ── the weekly challenge ──
  add('challenge', 'page', '/?challenge=1', me);
  add('challenge', 'signed-out', '/?challenge=1');
  for (const t of ['leanest', 'purest', 'overall']) {
    add('challenge', `board-${t}`, '/?challenge=1', { ...me, steps: [{ click: tab('ch-tab', t) }] });
  }
  add('challenge', 'past-week', `/?challenge=1&board=${fx.challenge.past}`, me);
  add('challenge', 'builder', `/?table=ch:${fx.challenge.current}`, { ...me, pages: 1 });

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
    add('decks', 'cc-sideboard', '/', { ...me, steps: [...ccDeck, { click: tab('deck-tab', 'side') }] });
    add('tabletop', 'cc-sideboard', `/?table=${fx.cc.deck}`, { ...me, pages: 1 });
    add('match', 'between-paused', `/?ws=1&room=${fx.cc.room}&seat=${fx.cc.seat}&mode=constructed`,
      { ...me, steps: [{ settle: 1500 }], check: '#app' });
    // last: it creates a match room (seeded code, so the same one each run)
    add('match', 'registration', '/', { ...me, steps: [
      constructedTab,
      { click: '[data-btn="home-format"][data-format="competitive"]' },
      pick('#cc-deck', '/Competitive/'),
      { click: btn('cc-new'), settle: 1500 },
    ], check: '#app', pages: 1 });
  }
  return S;
}
