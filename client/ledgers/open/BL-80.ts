import type { BacklogTicket } from '../tickets.ts';

export default {
  id: 'BL-80',
  slug: 'admin-reports-newest-first',
  title: 'The admin reports list shows the newest reports first, not the owner\'s own',
  area: 'server',
  size: 'S',
  track: 'qol',
  said:
    'The admin "reports" list panel is sorted by who made the report, rather than chronologically. '
    + 'I need to be able to see the most recent reports, not just my own.',
  means:
    'The server sends the reports newest first (admin.ts reportRows reverses them), but the reports tab '
    + 'reorders them in reportOrder (ui/pages/admin.ts): an unjudged report from a badged filer is lifted '
    + 'to the top, the owner highest. The owner is the one reading the list and files more reports than '
    + 'anyone (84 of the 420 in the snapshot on 2026-11-17), so every report of his own he has not '
    + 'marked sits above everybody else\'s newer ones. The lift was asked for so the owner sees judges\' '
    + 'reports early; it was never meant to surface his own reports to himself.',
  doneWhen: [
    'On the admin reports tab, the owner\'s own reports are listed by date like anyone else\'s, marked or not, so the newest reports from players are at the top',
    'An unjudged report from a judge is still surfaced ahead of the rest, as before',
    'The note above the table says how the list is ordered, in the new terms',
  ],
  decided: [
    'Only the owner\'s own reports stop lifting; the judges\' lift stays. If the owner wants plain date order for everything, that is a one-message change on top.',
  ],
  deps: [],
  touches: [
    'client/ui/pages/admin.ts',
    'client/ui/test/975-page-admin-html.test.ts',
  ],
  notes: 'Filed from report #418 (2026-11-17, the owner, on the admin page).',
} satisfies BacklogTicket;
