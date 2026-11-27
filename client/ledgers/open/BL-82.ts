import type { BacklogTicket } from '../tickets.ts';

export default {
  id: 'BL-82',
  slug: 'admin-reports-newest-first',
  title: 'The admin reports list reads newest first',
  area: 'client',
  size: 'S',
  track: 'qol',
  said:
    'The admin reports page is sorted by who made the report, not by “latest” reports first.',
  means:
    'Report #433, the owner\'s second report of this (the first, #418, was BL-80). The server sends the '
    + 'reports newest first; the tab\'s reportOrder (ui/pages/admin.ts) then lifts every judge report that '
    + 'carries no 👍/👎 mark above all the rest, highest level first. BL-80 stopped lifting the owner\'s own '
    + 'reports and kept the judges\' lift (BL-17). On the 2026-11-27 snapshot that lift pins 56 reports at the '
    + 'head, back to 2026-10-23, in runs by filer (Nyar\'s sixteen, then Karanda\'s, then LordZZX\'s) — most of '
    + 'them settled in the ledger long ago, because the lift lets go only on a mark, never on a ledger '
    + 'outcome. The list he reads opens on October and reads as sorted by who filed. He has now asked twice '
    + 'for latest first: the list goes back to the server\'s date order.',
  doneWhen: [
    'The reports tab lists reports newest first, whoever filed them, with or without "only unjudged"',
    'The note above the table no longer says judges\' reports come first',
    'Judge reports stay findable without reordering the list (the badge chips already mark them)',
  ],
  asks: [
    'Whether anything of the judge lift should survive in another form (a "judges only" filter, or a lift that lets go once the ledger settles the report) — not asked for; the default is plain date order.',
  ],
  deps: [],
  touches: [
    'client/ui/pages/admin.ts',
  ],
  notes: 'Filed in triage 2026-11-27 from report #433.',
} satisfies BacklogTicket;
