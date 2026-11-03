/* The layers on every page: the report pill and dialog (ui/pages/report.ts)
 * and the bell with its list, popups and the waiting room's friends panel
 * (ui/pages/inbox.ts). Each is fixed to the window's corner on the site, so
 * a story draws it inside a frame. */
import { reportLayerHtml, type ReportDialogView } from '../../../ui/pages/report.ts';
import { inboxLayerHtml, type InboxListView, inviteRowsHtml, roomFriendsHtml } from '../../../ui/pages/inbox.ts';
import { frame } from '../_helpers.ts';

const dialog = (over: Partial<ReportDialogView> = {}): ReportDialogView =>
  ({ dispute: false, busy: false, kind: null, severity: null, complete: false, inGame: false, user: 'Quillon', error: '', ...over });

const LIST: InboxListView = {
  bellMsg: '',
  matches: [{ room: 'QXRM', seat: 1, asks: true, opponent: 'Nyar', text: 'vs <b>Nyar</b> · 1–0 · paused today', button: 'Resume' }],
  invites: [{ id: 'i1', from: 'Karanda', label: 'a constructed game' }],
  times: [{ season: 's1', seasonName: 'November', match: 'm1', from: 'Tomzy', when: 'Sat 7 Nov, 18:00' }],
  requests: [{ id: 'u9', username: 'Fennick' }],
  notes: [{ key: 'L1', season: 's1', match: 'm1', read: false, html: 'Your match with <b>Tomzy</b> starts in 15 minutes.', action: 'play' }],
};

export default { title: 'Pages/Layers (report, bell)' };

export const ReportPill = { name: 'Report pill', render: () => frame(reportLayerHtml({ dialog: null, onBoard: false, toast: null }), 80) };
export const ReportDialog = { name: 'Report dialog', render: () => frame(reportLayerHtml({ dialog: dialog(), onBoard: false, toast: null }), 560) };
export const ReportBug = { name: 'Report dialog, a bug', render: () => frame(reportLayerHtml({ dialog: dialog({ kind: 'bug', severity: 'gamebreaking', complete: true, inGame: true }), onBoard: false, toast: null }), 620) };
export const ReportError = { name: 'Report dialog, refused', render: () => frame(reportLayerHtml({ dialog: dialog({ kind: 'other', complete: true, error: 'the report was not accepted' }), onBoard: false, toast: null }), 560) };
export const Dispute = { render: () => frame(reportLayerHtml({ dialog: dialog({ dispute: true }), onBoard: false, toast: null }), 420) };
export const Toast = { render: () => frame(reportLayerHtml({ dialog: null, onBoard: false, toast: 'logged — thanks' }), 90) };

export const Bell = { render: () => frame(inboxLayerHtml({ unread: 0, list: null, pops: { invites: [], reminders: [] } }), 80) };
export const BellLit = { name: 'Bell, with an invite popup', render: () => frame(inboxLayerHtml({ unread: 5, list: null, pops: { invites: LIST.invites, reminders: [] } }), 220) };
export const BellOpen = { name: 'Bell, list open', render: () => frame(inboxLayerHtml({ unread: 5, list: LIST, pops: { invites: [], reminders: [] } }), 640) };
export const BellEmpty = { name: 'Bell, nothing new', render: () => frame(inboxLayerHtml({ unread: 0, list: { ...LIST, matches: [], invites: [], times: [], requests: [], notes: [] }, pops: { invites: [], reminders: [] } }), 200) };
export const RoomFriends = {
  name: 'Waiting room: Invite a friend',
  render: () => `<div style="max-width:420px">${roomFriendsHtml({ loaded: true, msg: '', friends: [
    { id: 'a', username: 'Nyar', favoriteElement: 'water', status: 'online', invite: null },
    { id: 'b', username: 'Karanda', favoriteElement: null, status: 'playing', invite: 'sent' },
    { id: 'c', username: 'Tomzy', favoriteElement: null, status: 'offline', invite: 'declined' },
  ] })}</div>`,
};
export const InviteRows = {
  name: 'Invites as rows (the home\'s Join sheet)',
  render: () => `<div style="max-width:420px">${inviteRowsHtml([
    { id: 'i1', from: 'Karanda', label: 'a constructed game' }, { id: 'i2', from: 'Nyar', label: 'a live draft' },
  ])}</div>`,
};
