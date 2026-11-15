/* What is open, and the next free ids.
 *
 *   npm --prefix client/ledgers run ready
 *
 * A backlog ticket is "ready" when it has no open asks, every dep is closed,
 * and it is not XL (a project is never started off a spare hour).
 */
import { nextIds, openIds, openTickets, settled, ticketId, type BacklogTicket, type CardTicket } from './tickets.ts';

const open = new Set(openIds());
const tickets = await openTickets();
const SEV = { blocker: 0, major: 1, minor: 2 };
const cts = tickets.filter((t): t is CardTicket => typeof t.id === 'number')
  .sort((a, b) => SEV[a.severity] - SEV[b.severity] || a.id - b.id);
const bls = tickets.filter((t): t is BacklogTicket => typeof t.id === 'string');
const ready = (t: BacklogTicket) => !t.asks?.length && t.size !== 'XL' && !(t.deps ?? []).some(d => open.has(d));

for (const t of cts) console.log(`${ticketId(t)}  [${t.area}/${t.severity}] ${t.title}`);
for (const t of bls) console.log(`${t.id}  [${t.size}${ready(t) ? ', ready' : ''}] ${t.title}`);
const reports = [...settled().values()].filter(r => r.id.startsWith('#') && (r.as === 'ticket' || r.as === 'partial'));
console.log(`\n${cts.length} CT · ${bls.length} BL open (${bls.filter(ready).length} ready) · ${reports.length} reports carried by them`);
console.log(`next free: ${nextIds().CT} ${nextIds().BL}`);
