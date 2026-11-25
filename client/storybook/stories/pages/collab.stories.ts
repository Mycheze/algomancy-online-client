import { collabPageHtml, collabSheetHtml, collabToolHtml, type CollabSheetView } from '../../../ui/pages/collab.ts';
import { CHROME, page } from './_page.ts';

/* A shared deck table's own markup (pages/collab.ts, docs/26), from made-up views: the
 * Together button, its sheet for the host and for a guest, and the page a link lands on
 * before the table is up. */

const PEOPLE = [
  { id: 'h', name: 'Ben', colour: '#e0a526', here: true, host: true },
  { id: 'r', name: 'Rashi', colour: '#3d8bfd', here: true, host: false },
  { id: 'q', name: 'Quill', colour: '#e5534b', here: false, host: false },
];
const view = (over: Partial<CollabSheetView> = {}): CollabSheetView => ({
  link: 'https://algomancy.online/?collab=ABCDEFGHJK', people: PEOPLE, me: 'h', youHost: true, hostName: 'Ben',
  friends: [
    { id: 'r', username: 'Rashi', status: 'online', sent: false, joined: true },
    { id: 'z', username: 'Zed', status: 'offline', sent: true, joined: false },
    { id: 'y', username: 'Yara', status: 'playing', sent: false, joined: false },
  ],
  friendsLoaded: true, msg: '', ...over,
});

export default { title: 'Pages/Build together', parameters: { layout: 'fullscreen' } };

export const Tool = { name: 'The Together button: two here', render: () => `<div style="padding:16px">${collabToolHtml(PEOPLE, false)}</div>` };
export const HostSheet = { name: 'The host’s sheet', render: () => page(collabSheetHtml(view())) };
export const GuestSheet = { name: 'A guest’s sheet', render: () => page(collabSheetHtml(view({ me: 'r', youHost: false }))) };
export const Joining = { name: 'A link, joining', render: () => page(collabPageHtml({ state: 'joining', msg: '' }, CHROME)) };
export const SignedOut = { name: 'A link, signed out', render: () => page(collabPageHtml({ state: 'signin', msg: 'Sign in to join this deck-building session.' }, { signedIn: false, alerts: 0 })) };
export const Ended = {
  name: 'The host left',
  render: () => page(collabPageHtml({ state: 'ended', msg: 'The host left, so the session ended.', canCopy: true }, CHROME)),
};
