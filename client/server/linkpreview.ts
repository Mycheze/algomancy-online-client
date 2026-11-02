/* THE LINK PREVIEW — what Discord (and Slack, iMessage, WhatsApp…) shows under
 * a pasted algomancy.online link.
 *
 * Owner, 2026-11-01: "Links to algomancy.online are often posted in Discord …
 * it'd be sooooo cool if many of the other pages had specialized promo images
 * and descriptions that told more about that page specifically."
 *
 * A link unfurler fetches the URL and reads the <head>. It runs no script, so
 * the page's own routing (ui/main.ts reads `location.search`) never happens
 * for it: whatever the head says for `/` is what every page would say. So the
 * server writes the head per request — index.html keeps the home page's tags
 * (they are the fallback, and what file:// and the tests read), and
 * `withPreview` swaps in the ones `previewFor` picks off the query string.
 *
 * Every page has a fixed card (title, line, image, built by ui/site-icons.py)
 * and some pages say something LIVE on top of it: the league's season and
 * phase, this week's challenge, the room a code names, the deck a link
 * shares, the card a stats link opens, the rule a rules link points at. The
 * live part comes in through `PreviewCtx`, so this module is pure and
 * server/test/771-link-preview.test.ts can stage any of it.
 *
 * ⚠ A preview is PUBLIC to anyone who pastes a URL — the unfurler is not
 * signed in. Nothing here may say what the page itself would not say to a
 * signed-out stranger: no hidden season, no upcoming challenge, no private
 * deck (sharedDeck already answers null for one), no replay's players.
 */

export interface Preview {
  /** og:title — what the embed's blue headline says */
  title: string;
  /** og:description, and the page's <meta name="description"> */
  description: string;
  /** absolute; og:image */
  image: string;
  /** the image's size, when it is one of ours (a card scan's is not stated) */
  imageSize?: [number, number];
  /** absolute; og:url — the link as shared, so the embed links back to it */
  url: string;
  /** the home card: index.html's own tags are already it, and are left alone */
  home?: true;
}

/** What the server knows, asked for only when the URL needs it. Every answer
 * is what a signed-out stranger may see; null is "nothing to say". */
export interface PreviewCtx {
  /** the public origin, no trailing slash: https://algomancy.online */
  origin: string;
  /** a season by id, or the current one when `id` is null */
  league(id: string | null): LeaguePreview | null;
  /** the challenge open right now */
  challenge(): ChallengePreview | null;
  room(code: string): RoomPreview | null;
  deck(id: string): DeckPreview | null;
  card(name: string): CardPreview | null;
  /** how many cards a search finds, or null when it cannot be run */
  searchCount(q: string): number | null;
  /** a comprehensive rule by number ("608.2b") */
  rule(num: string): RulePreview | null;
}

export interface LeaguePreview {
  name: string;
  format: 'draft' | 'constructed' | 'competitive';
  /** "Sign-up week", "Week 2 of 4", "The final", … (league.ts phaseLabel) */
  phase: string;
  players: number;
  /** a stranger who signs up now is in this season */
  joinable: boolean;
  /** the season has not opened its sign-ups yet */
  announced: boolean;
  finished: boolean;
}
export interface ChallengePreview { title: string; blurb: string; closes: number }
export interface RoomPreview {
  /** "Live draft", "Constructed", "Single Card Duel", … (main.ts inviteRoom) */
  label: string;
  /** seat 0's name, when the seat is taken */
  host: string | null;
  /** a seat a stranger could take */
  open: boolean;
  finished: boolean;
}
export interface DeckPreview {
  name: string; author: string; size: number;
  /** the deck's own picture (its cover card fanned with two more, drawn by
   * the server — main.ts /og/deck/), a path from the origin; null when the
   * deck has no card with a scan */
  image: string | null;
}
export interface CardPreview {
  name: string; type: string; scan: string;
  /** the rules text as the oracle has it (its {tokens} are read as words here) */
  text: string;
}
export interface RulePreview { num: string; text: string; heading: string }

/** each page's fixed card: the image ui/site-icons.py draws for it */
const OG_SIZE: [number, number] = [1200, 630];
export const PAGE_IMAGES = [
  'home', 'league', 'cards', 'challenge', 'decks', 'stats', 'learn', 'rules', 'play', 'replay',
] as const;
export type PageImage = typeof PAGE_IMAGES[number];
/** where each one is served — and where site-icons.py writes it */
export const imagePath = (p: PageImage): string => (p === 'home' ? '/og-image.jpg' : `/og/${p}.jpg`);

const HOME_TITLE = 'Algomancy — play online';
const HOME_LINE = 'Draft and play Algomancy online, free in your browser. Send a friend a room code, or find a match.';

/** one line of plain text, cut at a word to at most `n` characters */
export function clip(s: string, n: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  if (flat.length <= n) return flat;
  const cut = flat.slice(0, n - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.—-]+$/, '') + '…';
}

/** card text as prose: the oracle's {fire}/[Unaware]-style tokens read as words */
const prose = (s: string): string => s.replace(/[{}[\]]/g, '').replace(/\s+/g, ' ').trim();

const closesOn = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/** The preview for one URL. Unknown pages — and the admin's — get the home card. */
export function previewFor(url: URL, ctx: PreviewCtx): Preview {
  const q = url.searchParams;
  const shared = ctx.origin + url.pathname + url.search;
  const make = (img: PageImage | { scan: string } | { drawn: string }, title: string, description: string): Preview => ({
    title: clip(title, 90),
    description: clip(description, 240),
    ...(typeof img === 'string'
      ? { image: ctx.origin + imagePath(img), imageSize: OG_SIZE }
      : 'drawn' in img
        ? { image: ctx.origin + img.drawn, imageSize: OG_SIZE }
        : { image: ctx.origin + img.scan }),
    url: shared,
  });
  const has = (k: string): boolean => q.has(k);
  const val = (k: string): string => (q.get(k) ?? '').trim();

  // ── a game to sit down at ─────────────────────────────────────────────
  const free = 'Algomancy is free and runs in your browser.';
  if (val('room')) {
    const code = val('room').toUpperCase();
    const r = ctx.room(code);
    if (q.get('watch') === '1') {
      return make('play', 'Watch a game of Algomancy',
        'This game is being played right now. Open the link to watch it live in your browser.');
    }
    if (!r) {
      return make('play', 'Join a game of Algomancy',
        `Someone has invited you to a game. Open the link to take your seat. ${free}`);
    }
    if (r.finished) {
      return make('play', 'This game of Algomancy is over',
        'The game at this link has finished, but you can start a new one or find an opponent in the matchmaking queue.');
    }
    if (!r.open) {
      return make('play', 'A game of Algomancy in progress',
        'Both seats at this table are taken, but you can open the link to watch.');
    }
    return make('play', r.host ? `Join ${r.host}'s game of Algomancy` : 'Join a game of Algomancy',
      `${r.host ?? 'Someone'} is waiting for an opponent in a ${r.label.toLowerCase()} game. Open the link to take the other seat. ${free}`);
  }
  if (has('queue')) {
    const mode = val('queue');
    const what = mode === 'constructed' ? 'constructed' : mode === 'draft' ? 'live draft' : '';
    if (what && q.get('vs')) {
      return make('play', `Join a ${what} game of Algomancy`,
        `A player is looking for an opponent. Open the link to join their game.${mode === 'draft' ? ' You don\'t need an account to draft.' : ''}`);
    }
    return make('play', 'Find a game of Algomancy',
      'Join the matchmaking queue and you\'ll be paired with the next player looking for a game, in live draft or constructed.');
  }

  // ── the league ────────────────────────────────────────────────────────
  if (has('league')) {
    const want = val('league');
    const s = ctx.league(want && want !== '1' ? want : null);
    const about = 'Each week you play a few matches at times you arrange with your opponents. Your results go into the standings, and the season ends with a final.';
    if (!s) return make('league', 'The Algomancy League', `${about} Join us!`);
    const fmt = s.format === 'competitive' ? 'Competitive Constructed' : s.format === 'constructed' ? 'constructed' : 'live draft';
    const title = `${s.name} Algomancy League`;
    if (s.finished) {
      return make('league', title, `The ${s.name} season has finished. ${about} Look for the next season on the League page.`);
    }
    if (s.announced) return make('league', title, `Sign-ups for this ${fmt} season open soon. ${about}`);
    const players = s.players === 1 ? '1 player has' : `${s.players} players have`;
    const stage = s.phase.toLowerCase();
    if (s.joinable) {
      return make('league', title, s.phase === 'Sign-up week'
        ? `Sign-ups are open for this ${fmt} season, and ${players} joined so far. ${about} Join us!`
        : `This ${fmt} season is in ${stage}, and late sign-ups are still open. ${about} Join us!`);
    }
    return make('league', title, `This ${fmt} season is in ${stage}. ${about}`);
  }

  // ── the weekly challenge ──────────────────────────────────────────────
  if (has('challenge')) {
    const c = ctx.challenge();
    const how = 'Every week there\'s a new puzzle. Build a deck that solves it, then compare your run with everyone else\'s on the leaderboards.';
    if (q.get('challenge') === 'watch') {
      return make('challenge', 'A Weekly Challenge run',
        'Watch a solution to an Algomancy Weekly Challenge played back one move at a time, and then try to beat it.');
    }
    if (!c) return make('challenge', 'The Algomancy Weekly Challenge', how);
    return make('challenge', `Weekly Challenge: ${c.title}`,
      `This week's puzzle: ${prose(c.blurb)} Solve it with a deck of your own, then see how your run compares on the leaderboards. It closes on ${closesOn(c.closes)}.`);
  }

  // ── cards, decks, numbers ─────────────────────────────────────────────
  if (val('cardstats') && val('cardstats') !== '1') {
    const c = ctx.card(val('cardstats'));
    if (c) {
      return make({ scan: c.scan }, `${c.name} card stats`,
        `${prose(c.type)}. See how ${c.name} performs in real games on Algomancy Online, including its win rate when it's drawn, played or picked in a draft.`);
    }
  }
  if (has('cardstats')) {
    return make('stats', 'Algomancy card stats',
      'Win rates for every Algomancy card, taken from every game played on the site. Sort and filter them to see which cards are doing well.');
  }
  if (has('cardladder')) {
    return make('stats', 'The Algomancy card duel ladder',
      'In a Single Card Duel, each player has thirty copies of one card. The ladder ranks every card by how it does in those duels.');
  }
  if (val('deck')) {
    const d = ctx.deck(val('deck'));
    if (d) {
      return make(d.image ? { drawn: d.image } : 'decks', `${d.name}, an Algomancy deck`,
        `A ${d.size}-card constructed deck by ${d.author}. Open the link to see the full list and how it has done in games, or to copy it into your own collection.`);
    }
    return make('decks', 'An Algomancy deck', 'Open the link to see this constructed deck.');
  }
  if (has('meta')) {
    return make('decks', 'Algomancy decks',
      'Browse the constructed decks players have shared and see how each one has done in real games. You can copy any of them to play yourself.');
  }
  if (val('card')) {
    const c = ctx.card(val('card'));
    if (c) {
      const text = prose(c.text);
      return make({ scan: c.scan }, c.name, text ? `${prose(c.type)}. ${text}` : `${prose(c.type)}.`);
    }
  }
  if (has('cards') || has('card')) {
    const search = val('q');
    if (search) {
      const n = ctx.searchCount(search);
      return make('cards', `Algomancy card search: ${search}`,
        n === null ? 'Open the link to see the cards that match this search.'
          : `${n === 1 ? '1 card matches' : `${n} cards match`} this search. Open the link to see them, or change the search to look for something else.`);
    }
    return make('cards', 'Algomancy card search',
      'Search every Algomancy card by name, element, cost, type or rules text. It works much like Scryfall, and you can build a deck from the results.');
  }
  if (has('table')) {
    return make('decks', 'The Algomancy deck table',
      'Lay out a constructed deck by hand, sort the cards into piles, and take the finished deck straight into a game.');
  }

  // ── learning and the rules ────────────────────────────────────────────
  if (has('learn')) {
    return make('learn', 'Learn to play Algomancy',
      'Play your first game against a tutorial bot that explains each rule as it comes up. You don\'t need an account or the rulebook.');
  }
  if (val('question')) {
    // generic on purpose: the questions live in ui/questions.ts, which the
    // server may not compile (282-dom-free-trio)
    return make('rules', 'An Algomancy rules question',
      'A rules question set up on a real board. Step through it to see how the game handles it.');
  }
  if (has('rules')) {
    const tab = val('rules');
    if (tab === 'cr') {
      const at = val('at').replace(/^r/i, '');
      const r = at ? ctx.rule(at) : null;
      if (r) return make('rules', `Comprehensive Rules ${r.num}: ${r.heading}`, prose(r.text));
      return make('rules', 'The Algomancy Comprehensive Rules',
        'Every rule of Algomancy, numbered and searchable. These are the unofficial comprehensive rules that the online client follows.');
    }
    if (tab === 'book') {
      return make('rules', 'The Algomancy rulebook', 'Read the complete illustrated Algomancy Manual in your browser.');
    }
    if (tab === 'tutorial') {
      return make('rules', 'How to use the Algomancy client',
        'A guide to every part of the online table, from playing your cards to the keyboard shortcuts.');
    }
    return make('rules', 'How to play Algomancy',
      'Everything you need to learn the game: a quick reference, the full illustrated rulebook, and the complete numbered rules.');
  }
  if (has('crreview')) {
    return make('rules', 'Algomancy Comprehensive Rules review',
      'The unofficial comprehensive rules, open for review. Judges can check each rule against its sources and leave comments.');
  }
  if (val('replay')) {
    // a replay is its players' own: the preview never says whose
    return make('replay', 'A game of Algomancy, replayed',
      'Watch this finished game again from the start, one move at a time.');
  }
  return { ...make('home', HOME_TITLE, HOME_LINE), home: true };
}

const attr = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** the tags a page with none of its own is given, after its <title> */
function previewTags(p: Preview): string {
  return [
    `<meta name="description" content="${attr(p.description)}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Algomancy Online">',
    `<meta property="og:title" content="${attr(p.title)}">`,
    `<meta property="og:description" content="${attr(p.description)}">`,
    `<meta property="og:url" content="${attr(p.url)}">`,
    `<meta property="og:image" content="${attr(p.image)}">`,
    ...(p.imageSize ? [
      `<meta property="og:image:width" content="${p.imageSize[0]}">`,
      `<meta property="og:image:height" content="${p.imageSize[1]}">`,
    ] : []),
    '<meta name="twitter:card" content="summary_large_image">',
  ].join('\n');
}

/** A page's head with this preview's values in place. index.html carries the
 * tags and is the template: every one it has must still be there (a tag that
 * went missing would silently stop varying). A page with no preview tags at
 * all — the generated comprehensive rules — is given the whole set. */
export function withPreview(html: string, p: Preview): string {
  if (!html.includes('<meta property="og:title"')) {
    const at = html.indexOf('</title>');
    if (at < 0) throw new Error('a page with no <title> to put a preview after');
    const end = at + '</title>'.length;
    return html.slice(0, end) + '\n' + previewTags(p) + html.slice(end);
  }
  if (p.home) return html;
  let out = html;
  const swap = (re: RegExp, to: string): void => {
    if (!re.test(out)) throw new Error(`index.html has lost ${re.source}`);
    out = out.replace(re, () => to);
  };
  // not the <title>: Discord reads og:title, and the tab's title is the
  // client's — an in-app move to another page does not reload the head
  swap(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${attr(p.description)}">`);
  swap(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${attr(p.title)}">`);
  swap(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${attr(p.description)}">`);
  swap(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${attr(p.url)}">`);
  // the image and its size go together: a card scan is not 1200×630, and a
  // stated size that is wrong makes some unfurlers crop it
  swap(/<meta property="og:image" content="[^"]*">(\s*<meta property="og:image:(?:width|height)" content="\d+">)*/,
    `<meta property="og:image" content="${attr(p.image)}">` + (p.imageSize
      ? `\n  <meta property="og:image:width" content="${p.imageSize[0]}">\n  <meta property="og:image:height" content="${p.imageSize[1]}">`
      : ''));
  return out;
}

/** What the deck picture needs to know about one card. */
export interface TrioFacts { element: string; cost: number; hasScan: boolean }

/**
 * The three cards a deck's picture fans: its cover in the middle, and two more
 * from the deck (owner, 2026-11-01: "the main card in front, plus two others
 * from the deck"). The two are the cards the deck runs most copies of, the
 * dearer first on a tie, preferring an element the picture does not show yet —
 * the same "several elements" rule as the page pictures. No cover: the deck's
 * own first choice by those rules leads. Fewer than three cards with a scan
 * gives fewer; none gives [].
 */
export function deckTrio(cards: readonly string[], cover: string | null,
                         facts: (name: string) => TrioFacts | null): string[] {
  const copies = new Map<string, number>();
  for (const c of cards) copies.set(c, (copies.get(c) ?? 0) + 1);
  const ranked = [...copies.keys()]
    .filter(n => facts(n)?.hasScan)
    .sort((a, b) => copies.get(b)! - copies.get(a)! || facts(b)!.cost - facts(a)!.cost || a.localeCompare(b));
  const lead = cover && facts(cover)?.hasScan ? cover : ranked[0];
  if (!lead) return [];
  const out = [lead];
  const shown = new Set([facts(lead)?.element]);
  for (const pass of [true, false]) {
    for (const n of ranked) {
      if (out.length === 3) break;
      if (out.includes(n) || (pass && shown.has(facts(n)!.element))) continue;
      out.push(n);
      shown.add(facts(n)!.element);
    }
  }
  return out;
}
