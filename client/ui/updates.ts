/*
 * RECENT UPDATES — the changelog on the home page, one line per push.
 *
 * The owner, 2026-09-23: "a little area on the homepage, above the footer …
 * a 'recent updates' log that shows what's been added/fixed/changed with each
 * new push". Every push that reaches algomancy.online adds an entry at the TOP
 * of `UPDATES`, in the same commit as the change it describes (CLAUDE.md §
 * Deploy, "Every push players can see gets an update line") — not
 * reconstructed afterwards.
 *
 * WHAT AN ENTRY IS. One or two plain sentences a player would care about, the
 * length of a short tweet (`MAX_UPDATE_CHARS`). Say what changed for someone
 * playing, not how: no ruling numbers, no ticket ids, no file names. A push
 * with nothing a player can see (a test, a ledger row, a deploy script) gets
 * no entry. A push that does three unrelated visible things can take three.
 *
 * `323-recent-updates.test.ts` holds the list to that shape: newest first, a
 * real date not in the future, a known kind, and short.
 *
 * Painted by `renderHome()` as a SIBLING after `.homepage`, inside `#app`:
 * the home menu keeps its one-screenful floor (legal.ts's `100dvh - 128px`
 * applies to `#app`'s first child) and this band sits between it and the
 * footer. It exists on the home screen only.
 */
import { esc } from './util.ts';

export type UpdateKind = 'new' | 'fix' | 'change';

export interface Update {
  /** ISO day the push went live, `YYYY-MM-DD` */
  date: string;
  kind: UpdateKind;
  /** plain text — escaped when painted, so no markup */
  text: string;
}

/** a short tweet's worth */
export const MAX_UPDATE_CHARS = 240;

/** how many show before "Older updates" */
export const SHOWN_UPDATES = 6;

const KIND_LABEL: Record<UpdateKind, string> = { new: 'New', fix: 'Fix', change: 'Change' };

/** NEWEST FIRST. Add the next push's line at the top. */
export const UPDATES: readonly Update[] = [
  { date: '2026-09-23', kind: 'new', text: 'Recent updates: this list. Every push to the site adds a line here, so you can see what changed since you last played.' },
  { date: '2026-09-23', kind: 'new', text: 'Watch a finished game back, one action at a time. Press ▶ on any game in your match history or on a deck’s games.' },
  { date: '2026-09-23', kind: 'new', text: 'Try the new regions board: ▦ in the side rail switches layouts. Each player’s region gets its own colour. The classic board is still the default.' },
  { date: '2026-09-23', kind: 'change', text: '“Local hotseat” is gone from the home screen. It was a test rig, not a way to play.' },
  { date: '2026-09-21', kind: 'fix', text: 'Caught up with Caleb’s errata to ten Light & Dark cards, including Deathcoil Construct, Blob of the Dark Order, Greed Angel and Tithe Enforcer.' },
  { date: '2026-09-20', kind: 'change', text: 'Life totals are bigger and flash red or green, with the amount, every time they change.' },
  { date: '2026-09-20', kind: 'fix', text: 'An expired glimpse is gone for good: a cached card can no longer be grafted or augmented after its window closes.' },
  { date: '2026-09-20', kind: 'fix', text: 'Eleven Light & Dark cards had lost affinity pips from their alternative costs, and two had lost the cost altogether. Fixed from the card scans.' },
  { date: '2026-09-20', kind: 'fix', text: 'Bin and cache abilities no longer fire while the card is on the battlefield. Cinder Scuttler can’t return itself from a fight it died in.' },
  { date: '2026-09-20', kind: 'change', text: 'Card panels show one short sentence per keyword. The full rule is in the Rules reference.' },
  { date: '2026-09-20', kind: 'new', text: 'New decks are shared by default. The Metagame list shows legal decks that people have actually played, and a deck exports as a full file with its description and cover.' },
  { date: '2026-09-20', kind: 'change', text: 'Deck builder tidy-up: Play and settings buttons at the side, fewer banners, and pressing ? while writing a description no longer erases it.' },
  { date: '2026-09-19', kind: 'new', text: 'You can recycle for a Prismite and choose its element later. Recycling for a Shard is at the bottom of “more…”.' },
  { date: '2026-09-18', kind: 'new', text: 'Single Card Duel: each player blind-picks one card and plays thirty copies of it. Find it under Constructed, and see which cards win on the Metagame page’s card ladder.' },
  { date: '2026-09-18', kind: 'new', text: 'Learn to Play: a guided game against a tutorial bot, with a short lesson each time something new comes up. Under “On your own” on the home page.' },
  { date: '2026-09-17', kind: 'fix', text: 'Light and Dark Resource cards show their official art and turn up in card search.' },
  { date: '2026-09-16', kind: 'change', text: 'Recycled cards now go past a mark at the bottom of your deck and are shuffled back in when the deck runs out. The deck counter shows how many.' },
  { date: '2026-09-16', kind: 'fix', text: 'Three bugs you reported: Sluggish now holds its triggers between split damage steps, units in a column share its attributes for effect damage, and Formless strips the whole column.' },
  { date: '2026-09-15', kind: 'new', text: 'How to play and the full Rulebook open from the home page, and the footer links the Algomancy Discord. A background tab’s title flashes when a match is found or it’s your move.' },
  { date: '2026-09-14', kind: 'new', text: 'Custom rules for live drafts: pack size, number of elements, Simple cards only, bans, starting life, hand size and draws. Custom games are kept out of your stats.' },
  { date: '2026-09-14', kind: 'change', text: 'The site moved to algomancy.online. Old links, room links included, redirect here.' },
  { date: '2026-09-05', kind: 'change', text: 'Better on an iPad: no hover popup after a tap, card menus in the side rail, and Pass and Confirm at the bottom of the screen for everyone.' },
  { date: '2026-09-05', kind: 'new', text: 'Choose your favourite element on your stats tab. It shows as its icon on your profile and friends list.' },
  { date: '2026-09-05', kind: 'change', text: 'A turn-1 concede no longer counts as a game, and a concede by turn 2 moves ratings by half.' },
  { date: '2026-09-05', kind: 'change', text: 'The opponent’s turn summary reads like a sentence: “played Flesh Tithe (X = 11), lost 11 life”, not a log.' },
  { date: '2026-09-05', kind: 'new', text: 'The Rules reference reads like the printed rules: the help cards, the manual and the card reminders, with a search box.' },
  { date: '2026-09-05', kind: 'new', text: 'The Report button is on every page. Pick bug, UX issue or feature request, say how bad it is, and add a note.' },
  { date: '2026-09-05', kind: 'new', text: 'Algomancy Online opens to players: live drafts, constructed games, accounts and stats.' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "23 Sep" */
export function updateDay(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]}`;
}

/** one row; `showDate` is false for a second entry on the same day */
function rowHtml(u: Update, showDate: boolean): string {
  return `<li class="upd ${u.kind}">
      <time datetime="${u.date}">${showDate ? updateDay(u.date) : ''}</time>
      <span class="updkind">${KIND_LABEL[u.kind]}</span>
      <p>${esc(u.text)}</p>
    </li>`;
}

function listHtml(list: readonly Update[], prevDate: string | null): string {
  return list.map((u, i) => rowHtml(u, u.date !== (i ? list[i - 1]!.date : prevDate))).join('');
}

/** whether "Older updates" is open — kept across home repaints, which rebuild it */
let olderOpen = false;

/** The band under the home menu. Empty when there is nothing to say. */
export function updatesHtml(list: readonly Update[] = UPDATES): string {
  if (!list.length) return '';
  const shown = list.slice(0, SHOWN_UPDATES);
  const older = list.slice(SHOWN_UPDATES);
  return `<section class="updates" aria-labelledby="upd-h">
    <h2 id="upd-h">Recent updates</h2>
    <ol class="updlist">${listHtml(shown, null)}</ol>
    ${older.length ? `<details class="updolder"${olderOpen ? ' open' : ''}>
      <summary>Older updates (${older.length})</summary>
      <ol class="updlist">${listHtml(older, shown[shown.length - 1]!.date)}</ol>
    </details>` : ''}
  </section>`;
}

/** after `renderHome()` paints: remember the disclosure, since the next paint rebuilds it */
export function wireUpdates(): void {
  const d = document.querySelector?.('.updates .updolder') as HTMLDetailsElement | null;
  d?.addEventListener?.('toggle', () => { olderOpen = d.open; });
}
