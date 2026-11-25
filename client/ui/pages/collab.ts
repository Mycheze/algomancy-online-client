/* A SHARED DECK TABLE'S OWN MARKUP (docs/26) — what ui/collab.ts adds to the builder.
 *
 *   collabStartHtml  the deck builder's Build together, which opens a session
 *   collabToolHtml   the toolbar's Together button: who is at the table, as dots
 *   collabSheetHtml  its sheet: the link, friends to invite, who is here, and the
 *                    host's End or a guest's Save a copy and Leave
 *   collabPageHtml   the page before the table is up: joining, signed out, or over
 *   collabMarksHtml  the layer over the table: everyone else's pointer and the card
 *                    in their hand, placed by ui/collab.ts
 *
 * Pure: a view in, a string out. Every button on the table is `tt-collab-…`,
 * which the table hands to its host (TableHost.button); the page's own are
 * `collab-…`, which ui/collab.ts handleButton takes.
 */
import { button, field, iconButton, sheet } from '../components/index.ts';
import { esc } from '../util.ts';
import { frameHtml, type FrameChrome } from './frame.ts';

export interface CollabPerson {
  id: string;
  name: string;
  /** a CSS colour */
  colour: string;
  here: boolean;
  host: boolean;
}

export interface CollabFriend {
  id: string;
  username: string;
  status: 'online' | 'playing' | 'offline';
  /** asked from this table already */
  sent: boolean;
  /** at the table already */
  joined: boolean;
}

export interface CollabSheetView {
  link: string;
  people: readonly CollabPerson[];
  me: string;
  youHost: boolean;
  hostName: string;
  friends: readonly CollabFriend[];
  /** false until the bell's first poll has said who the friends are */
  friendsLoaded: boolean;
  /** the sheet's own line: a copy saved, an invite that did not go */
  msg: string;
}

const dot = (p: { colour: string; name: string }): string =>
  `<span class="collabdot" style="--collab:${esc(p.colour)}" title="${esc(p.name)}"></span>`;

/** the toolbar's Together button: the people here, as dots */
export function collabToolHtml(people: readonly CollabPerson[], on: boolean): string {
  const here = people.filter(p => p.here);
  return iconButton({
    label: here.length > 1 ? `Together · ${here.length}` : 'Together', icon: 'users', dataBtn: 'tt-collab-sheet', on,
    className: 'collabtool',
  }) + `<span class="collabdots" aria-hidden="true">${here.map(dot).join('')}</span>`;
}

/** the deck builder's Build together: open this deck to friends */
export const collabStartHtml = (): string =>
  iconButton({ label: 'Build together', icon: 'users', dataBtn: 'tt-collab-start', className: 'collabstart' });

/** the Together sheet */
export function collabSheetHtml(v: CollabSheetView): string {
  const people = v.people.map(p => `<li class="collabperson${p.here ? '' : ' away'}">${dot(p)}<span class="collabname">${esc(p.name)}${
    p.id === v.me ? ' <span class="dim">(you)</span>' : ''}</span><span class="collabstate dim">${p.host ? 'host' : p.here ? 'here' : 'away'}</span>${
    v.youHost && !p.host ? button({ label: 'Remove', size: 'sm', variant: 'link', dataBtn: 'tt-collab-kick', attrs: { 'data-user': p.id } }) : ''}</li>`).join('');
  const friends = !v.friendsLoaded ? '<p class="hint">Loading your friends…</p>'
    : !v.friends.length ? '<p class="hint">Add friends from your profile to invite them here. Anyone signed in with the link can join too.</p>'
      : `<ul class="collabfriends">${v.friends.map(f => `<li><span class="collabname">${esc(f.username)}</span><span class="collabstate dim">${f.status}</span>${
        f.joined ? '<span class="dim">here</span>'
          : f.sent ? '<span class="dim">invited ✓</span>'
            : button({ label: 'Invite', size: 'sm', dataBtn: 'tt-collab-invite', attrs: { 'data-user': f.id } })}</li>`).join('')}</ul>`;
  const foot = v.youHost
    ? `<p class="dksheetnote">This is your deck. Everyone here edits it with you; when you leave the table, the session ends for everyone.</p>
      ${button({ label: 'End the session', variant: 'danger', size: 'sm', dataBtn: 'tt-collab-end' })}`
    : `<p class="dksheetnote">This is ${esc(v.hostName)}’s deck. Keep a copy of it as it stands now in your own decks.</p>
      ${button({ label: 'Save a copy to my decks', variant: 'primary', size: 'sm', dataBtn: 'tt-collab-copy' })}
      ${button({ label: 'Leave', size: 'sm', dataBtn: 'tt-collab-leave' })}`;
  return sheet({
    open: true, placement: 'side', width: 'md', id: 'tt-collab', title: 'Build together', dismissBtn: 'tt-collab-sheet',
    className: 'dksheet collabsheet',
    bodyHtml: `<div class="collablink">${field({ id: 'tt-collab-link', label: 'Link', value: v.link, attrs: { readonly: true, spellcheck: 'false' },
      hint: 'Anyone signed in who has it can join. The search is yours alone; the deck, sideboard and Maybe are shared.' })}${
        button({ label: 'Copy', size: 'sm', dataBtn: 'tt-collab-copylink' })}</div>
      ${v.msg ? `<p class="collabmsg">${esc(v.msg)}</p>` : ''}
      <h3 class="dksheeth">At the table</h3><ul class="collabpeople">${people}</ul>
      <h3 class="dksheeth">Invite a friend</h3>${friends}
      <div class="collabfoot">${foot}</div>`,
  });
}

/** the page while the table is not up yet: joining, signed out, or the session over */
export function collabPageHtml(
  v: { state: 'joining' | 'signin' | 'ended'; msg: string; canCopy?: boolean; copyMsg?: string },
  chrome: FrameChrome,
): string {
  const body = v.state === 'joining' ? '<p class="hint ttloading">Joining the table…</p>'
    : v.state === 'signin'
      ? `<div class="collabgate"><p>${esc(v.msg)}</p>${button({ label: 'Sign in', variant: 'primary', dataBtn: 'acct-open-auth' })}</div>`
      : `<div class="collabgate"><p>${esc(v.msg)}</p>${
        v.canCopy ? button({ label: 'Save a copy to my decks', variant: 'primary', dataBtn: 'collab-copy' }) : ''}${
        v.copyMsg ? `<p class="collabmsg">${esc(v.copyMsg)}</p>` : ''}${button({ label: 'Home', dataBtn: 'collab-home' })}</div>`;
  return frameHtml({
    page: 'ttpage', title: 'Build together', back: { dataBtn: 'collab-home', label: 'Home', icon: 'home' }, chrome, mainHtml: body,
  });
}

export interface CollabMark {
  id: string;
  name: string;
  colour: string;
  /** where their pointer is on this screen, or null */
  x: number | null;
  y: number | null;
  /** the box of the card in their hand on this screen, or null */
  held: { left: number; top: number; width: number; height: number } | null;
}

/** everyone else's pointer, and the card in their hand, as fixed-position marks */
export function collabMarksHtml(marks: readonly CollabMark[]): string {
  return marks.map(m => {
    const c = `--collab:${esc(m.colour)}`;
    const held = m.held ? `<div class="collabheld" style="${c};left:${m.held.left}px;top:${m.held.top}px;width:${m.held.width}px;height:${m.held.height}px"><span class="collabtag">${esc(m.name)}</span></div>` : '';
    const ptr = m.x !== null && m.y !== null
      ? `<div class="collabptr" style="${c};transform:translate(${Math.round(m.x)}px,${Math.round(m.y)}px)"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M1 1l5.5 13 1.8-5.2L13.5 7z"/></svg><span class="collabtag">${esc(m.name)}</span></div>`
      : '';
    return held + ptr;
  }).join('');
}
