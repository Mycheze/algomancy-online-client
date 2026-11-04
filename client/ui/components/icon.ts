/* Icon — the client's one icon set, as inline SVG.
 *
 * Drawn for the redesign's toolbars (client/docs/24-redesign/: big icons over
 * small captions, no emoji). ONE style for every glyph, so they sit together:
 * a 24×24 viewBox, outlines only (`fill="none"`), `stroke="currentColor"` at
 * 1.75, round caps and joins. The colour is the text colour around it, so a
 * hover, an `on` state or a danger tone recolours the icon with no rule of its
 * own. A "dot" is a zero-length segment (`h.01`), which round caps draw as a
 * disc — still a stroke, never a fill.
 *
 * Size: `1em` by default, so an icon is as big as the text it sits in and a
 * caller sizes it with font-size or a width rule on `.ui-icon`. `size` takes a
 * number (px) or any CSS length for a fixed one. iconButton() draws its icon at
 * --icon-button-icon (24px) through its own CSS, whatever `size` says.
 *
 * Decorative by default (`aria-hidden="true"`, `focusable="false"`): the button
 * or link around it carries the name. With `title` it is an image with that
 * name instead (`role="img"`, a <title>).
 *
 * ICON_NAMES is the list the story's gallery and test 1002 loop over; an
 * unknown name throws, because a name is code, never data. */
import { type Common, esc, rootAttrs } from './_shared.ts';

/** the inner markup of each glyph, in a 24×24 box */
const GLYPHS = {
  // two cards, one behind the other
  decks: '<rect x="8" y="2.5" width="12" height="16" rx="2"/><path d="M5 6.5v12a3 3 0 0 0 3 3h8.5"/>',
  // a card with a magnifier over its corner
  cards: '<path d="M14 9V4.5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6"/><circle cx="16.5" cy="15" r="3.5"/><path d="m19 17.5 2.5 2.5"/>',
  // a head and shoulders
  account: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  // a conical flask with a fill line
  test: '<path d="M9 3h6"/><path d="M10 3v6.5l-5.6 9.4A1.4 1.4 0 0 0 5.6 21h12.8a1.4 1.4 0 0 0 1.2-2.1L14 9.5V3"/><path d="M7.2 15h9.6"/>',
  // an open book
  rules: '<path d="M12 6.5C9.5 4.8 6 4.3 2.5 5v14c3.5-.7 7 0 9.5 1.6 2.5-1.6 6-2.3 9.5-1.6V5c-3.5-.7-7-.2-9.5 1.5z"/><path d="M12 6.5v14"/>',
  // a bell
  alerts: '<path d="M6 9.5a6 6 0 0 1 12 0c0 5.5 2.5 7.5 2.5 7.5h-17S6 15 6 9.5"/><path d="M10.2 20.5a2 2 0 0 0 3.6 0"/>',
  // a flag on a pole
  report: '<path d="M5 21.5V3.5"/><path d="M5 4h12.5l-2.5 4.5 2.5 4.5H5"/>',
  // a play triangle
  play: '<path d="M7.5 4.2v15.6a.8.8 0 0 0 1.2.7l12.3-7.8a.8.8 0 0 0 0-1.4L8.7 3.5a.8.8 0 0 0-1.2.7z"/>',
  // a door, ajar on its frame, with a handle
  join: '<path d="M3 21h18"/><path d="M5.5 21V4.5a1.5 1.5 0 0 1 1.5-1.5h10a1.5 1.5 0 0 1 1.5 1.5V21"/><path d="M14.5 12.5h.01"/>',
  // a trophy
  league: '<path d="M7 3.5h10V9a5 5 0 0 1-10 0z"/><path d="M7 5.5H4.5v1.5A3.5 3.5 0 0 0 7.6 10.5"/><path d="M17 5.5h2.5v1.5a3.5 3.5 0 0 1-3.1 3.5"/><path d="M12 14v3.5"/><path d="M8 21h8"/><path d="M9.5 21v-1.5a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2V21"/>',
  // a target
  challenge: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12h.01"/>',
  // two crossed swords
  matchmaking: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6"/><path d="m16 16 4.5 4.5"/><path d="m19 21.5 2.5-2.5"/>'
    + '<path d="M14.5 6.5 18 3h3v3l-3.5 3.5"/><path d="m5 14 5 5"/><path d="m7 17-3.5 3.5"/><path d="m2.5 19 2.5 2.5"/>',
  // a sparkle and two small ones
  updates: '<path d="M11 4 12.8 9.2 18 11l-5.2 1.8L11 18l-1.8-5.2L4 11l5.2-1.8z"/><path d="M19 2.5v4"/><path d="M17 4.5h4"/><path d="M18.5 17v3.5"/><path d="M16.75 18.75h3.5"/>',
  // an i in a circle
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><path d="M12 7.5h.01"/>',
  // a cross
  close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  'chevron-right': '<path d="m9 5.5 6.5 6.5L9 18.5"/>',
  'chevron-down': '<path d="m5.5 9 6.5 6.5L18.5 9"/>',
  // a mortarboard with its tassel
  learn: '<path d="M2 9.5 12 4.5l10 5-10 5z"/><path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5"/><path d="M22 9.5V15"/>',
  // three bars on a baseline
  stats: '<path d="M3.5 20.5h17"/><path d="M7 17v-5"/><path d="M12 17V5.5"/><path d="M17 17V9"/>',
  // a shield with a tick
  admin: '<path d="M12 2.5 19.5 5.5v6c0 4.6-3.2 8.4-7.5 9.5-4.3-1.1-7.5-4.9-7.5-9.5v-6z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/>',
  // a box with an arrow leaving its corner
  link: '<path d="M14 3.5h6.5V10"/><path d="M20.5 3.5 11 13"/><path d="M18 14v5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5h5"/>',
  // an arrow going in through a door frame
  signin: '<path d="M14 3.5h4.5A1.5 1.5 0 0 1 20 5v14a1.5 1.5 0 0 1-1.5 1.5H14"/><path d="M3.5 12H15"/><path d="m11 7.5 4.5 4.5-4.5 4.5"/>',
  // a clock face
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  // two people, one behind
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M15.5 4.7a3.5 3.5 0 0 1 0 6.6"/><path d="M18 14.3a6.5 6.5 0 0 1 3.5 5.7"/>',
  // two bars
  pause: '<path d="M9 5v14"/><path d="M15 5v14"/>',
  // a house: the frame's way back to the home screen (pages/frame.ts)
  home: '<path d="M3.5 11 12 3.5l8.5 7.5"/><path d="M5.5 9.5V20a.5.5 0 0 0 .5.5h4.5v-6h3v6H18a.5.5 0 0 0 .5-.5V9.5"/>',
  // an arrow pointing left: back to the page this one was opened from
  back: '<path d="M20 12H4.5"/><path d="m10.5 5.5-6.5 6.5 6.5 6.5"/>',
  // a magnifier: a search box's mark
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
  // the deck screens' tools (BL-65, 2026-11-04): the builder's toolbar, the Decks page's preview actions
  // an arrow curling back to the left: take the last move back
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  // the same arrow, curling forward to the right
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  // a pencil
  edit: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7.5 18.5 3 20l1.5-4.5z"/><path d="m14.5 5.5 3 3"/>',
  // a funnel
  filter: '<path d="M3.5 4.5h17l-6.5 8v6l-4 2v-8z"/>',
  // a plus
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  // an arrow coming down into a tray
  import: '<path d="M12 3.5v11"/><path d="m7.5 10 4.5 4.5 4.5-4.5"/><path d="M4 15.5v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  // an arrow going up out of a tray
  export: '<path d="M12 14.5v-11"/><path d="m7.5 8 4.5-4.5L16.5 8"/><path d="M4 15.5v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  // three nodes joined: hand it on
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 13.3 7.6 4.4"/><path d="m15.8 6.3-7.6 4.4"/>',
  // two sheets, one over the other
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5v-3a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>',
  // a bin with its lid
  trash: '<path d="M3.5 6h17"/><path d="M8.5 6V4.5A1.5 1.5 0 0 1 10 3h4a1.5 1.5 0 0 1 1.5 1.5V6"/>'
    + '<path d="m5.5 6 1 13.6A1.5 1.5 0 0 0 8 21h8a1.5 1.5 0 0 0 1.5-1.4l1-13.6"/><path d="M10 10.5v6"/><path d="M14 10.5v6"/>',
} as const;

export type IconName = keyof typeof GLYPHS;
export const ICON_NAMES = Object.keys(GLYPHS) as IconName[];

export interface IconProps extends Common {
  /** a number is px; a string is any CSS length. Default `1em` (the text's size) */
  size?: number | string;
  /** the accessible name: makes it `role="img"` with a <title>. Without it the icon is decorative */
  title?: string;
}

export function icon(name: IconName, p: IconProps = {}): string {
  const glyph = (GLYPHS as Record<string, string>)[name];
  if (glyph === undefined) throw new Error(`icon: no icon named ${JSON.stringify(name)} (ICON_NAMES lists them)`);
  const size = p.size === undefined ? '1em' : typeof p.size === 'number' ? `${p.size}px` : p.size;
  const named = p.title !== undefined && p.title !== '';
  const attrs = rootAttrs(`ui-icon ui-icon--${name}`, p, {
    xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24', width: size, height: size,
    fill: 'none', stroke: 'currentColor', 'stroke-width': '1.75', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    focusable: 'false', 'aria-hidden': named ? undefined : 'true', role: named ? 'img' : undefined,
  });
  return `<svg${attrs}>${named ? `<title>${esc(p.title)}</title>` : ''}${glyph}</svg>`;
}
