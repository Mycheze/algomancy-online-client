/* The profile's "Design (Storybook)" button (admins only): opens the design
 * system's Storybook, served by the game server at /storybook/
 * (server/storybook.ts says who may see it and why it works this way).
 *
 * A new window is a browser navigation, which carries no bearer header, so the
 * button first asks the server for a single-use ticket and opens
 * /storybook/?ticket=…; the server spends it, sets a cookie for /storybook
 * and drops the ticket from the URL.
 *
 * The window is opened INSIDE the click, before the ticket comes back, and
 * pointed at it afterwards: a window.open after an await is no longer a user
 * gesture, and a popup blocker would eat it. */
import { authHeaders } from './account.ts';

/** what the ticket route answers an admin */
interface Ticket { ok: true; url: string }

export async function openStorybook(): Promise<void> {
  const w = window.open('', '_blank');
  let url: string | null = null;
  try {
    const r = await fetch('/api/storybook/ticket', { method: 'POST', headers: authHeaders(false) });
    if (r.ok) url = ((await r.json()) as Ticket).url;
  } catch { /* the message below says so */ }
  if (!url) {
    if (w) w.document.body.textContent = "Storybook didn't open: the server refused or could not be reached. Close this tab and try again.";
    return;
  }
  if (w) { w.opener = null; w.location.replace(url); } else window.open(url, '_blank');
}
