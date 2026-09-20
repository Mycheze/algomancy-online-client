/* The /api/decks endpoints: one person's saved deck collection.
 *
 * Every route here is authed — a collection belongs to an account by
 * definition — and every one answers with the WHOLE collection rather than
 * just the row it changed. That is deliberate: a deck's `problems` and
 * `record` are derived (collection.ts), renaming one deck can rename another
 * out of a name clash, and a client that has to stitch partial updates into a
 * local model is a client that will show a stale record. The payload is a few
 * kilobytes; the class of bug it removes is not worth saving them.
 *
 * Errors are 200 + { ok: false, error }, matching /api/auth and /api/deck/import
 * — one shape for the client to handle. The exception is a missing token,
 * which answers 401 so a stale login can be detected without parsing.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, readBody, str, tokenOf } from './api-util.ts';
import { accountForToken, type Account } from './accounts.ts';
import {
  collectionView, createDeck, deleteDeck, duplicateDeck, updateDeck,
} from './collection.ts';
import { importDeckPaste, importDeckUrl } from './decks.ts';
import { sharedDeck, sourceDeck } from './publicdecks.ts';

/** Handle a decks route. True when the request was ours. */
export async function deckRoutes(
  req: IncomingMessage, res: ServerResponse, path: string,
): Promise<boolean> {
  if (path !== '/api/decks' && !path.startsWith('/api/decks/')) return false;

  const account: Account | undefined = accountForToken(tokenOf(req));
  if (!account) {
    json(res, { ok: false, error: 'log in to keep a deck collection' }, 401);
    return true;
  }
  /** every write answers the same way: the new collection, plus a note */
  const answer = (extra: Record<string, unknown> = {}): void =>
    json(res, { ok: true, decks: collectionView(account), ...extra });

  if (path === '/api/decks') { answer(); return true; }

  if (req.method !== 'POST') {
    json(res, { ok: false, error: `${path} wants a POST` });
    return true;
  }
  const b = await readBody(req);
  const id = str(b['id'], 64);

  if (path === '/api/decks/create') {
    const r = createDeck(account, { name: b['name'], cards: b['cards'], maybe: b['maybe'] });
    if (!r.ok) return json(res, r), true;
    answer({ id: r.deck.id, ...(r.note ? { note: r.note } : {}) });
    return true;
  }

  if (path === '/api/decks/update') {
    const r = updateDeck(account, id, {
      // only the fields that were SENT are applied — see updateDeck
      ...('name' in b ? { name: b['name'] } : {}),
      ...('cards' in b ? { cards: b['cards'] } : {}),
      ...('maybe' in b ? { maybe: b['maybe'] } : {}),
      ...('cover' in b ? { cover: b['cover'] } : {}),
      // publishing is a field like any other, and sending it alone is the
      // whole point: the visibility toggle must not have to re-send 30 cards
      ...('visibility' in b ? { visibility: b['visibility'] } : {}),
      ...('description' in b ? { description: b['description'] } : {}),
    });
    if (!r.ok) return json(res, r), true;
    answer({ id: r.deck.id, ...(r.note ? { note: r.note } : {}) });
    return true;
  }

  if (path === '/api/decks/delete') {
    const r = deleteDeck(account, id);
    if (!r.ok) return json(res, r), true;
    answer();
    return true;
  }

  if (path === '/api/decks/duplicate') {
    const r = duplicateDeck(account, id);
    if (!r.ok) return json(res, r), true;
    answer({ id: r.deck.id });
    return true;
  }

  // Take a copy of somebody else's SHARED deck. It is a duplicate like any
  // other — same cap, same "(2)" on a name clash, same private-by-default copy
  // — with one difference that matters: what may be copied is decided by
  // publicdecks.ts, not by holding an id. `sharedDeck` returning null covers
  // both "private" and "no such deck", so this cannot be used to probe for ids.
  if (path === '/api/decks/take') {
    const shared = sharedDeck(id);
    if (!shared) return json(res, { ok: false, error: 'that deck is not shared' }), true;
    const src = sourceDeck(id);
    if (!src) return json(res, { ok: false, error: 'that deck is not shared' }), true;
    const r = duplicateDeck(account, id, src);
    if (!r.ok) return json(res, r), true;
    answer({ id: r.deck.id, note: `copied from ${shared.owner.username}` });
    return true;
  }

  // Import straight INTO the collection: an algomancer.cc link, a pasted card
  // list, or a pasted deck FILE (the rich format — ui/deckformat.ts). Cards
  // the engine does not script are reported as a note and left out rather than
  // failing the whole import — a 30-card deck with one unscripted card is 29
  // cards you want, and the note says which one is gone.
  //
  // What the deck carries BESIDE its list — the description, the cover card,
  // the maybeboard — rides in on whichever importer knew it and is dropped by
  // the ones that did not (`...(info.x ? …)`), so a pasted plain list never
  // writes a blank description over anything.
  if (path === '/api/decks/import') {
    try {
      const url = str(b['url'], 500).trim();
      const text = str(b['text'], 100_000);
      const info = url ? await importDeckUrl(url) : importDeckPaste(text);
      const r = createDeck(account, {
        name: str(b['name'], 60).trim() || info.name,
        cards: info.cards,
        author: info.author,
        ...(info.url ? { url: info.url } : {}),
        ...(info.description ? { description: info.description } : {}),
        ...(info.cover ? { cover: info.cover } : {}),
        ...(info.maybe?.length ? { maybe: info.maybe } : {}),
      });
      if (!r.ok) return json(res, r), true;
      // importDeckUrl's own problems (unscripted cards, deck-rule breaches)
      // are the useful half of the answer, so they ride along with the note
      const notes = [...info.problems.filter(p => !/at least 30 cards/.test(p)), ...(r.note ? [r.note] : [])];
      answer({
        id: r.deck.id,
        ...(notes.length ? { note: notes.slice(0, 4).join(' · ') + (notes.length > 4 ? ` (+${notes.length - 4} more)` : '') } : {}),
      });
      return true;
    } catch (err) {
      json(res, { ok: false, error: String(err instanceof Error ? err.message : err) });
      return true;
    }
  }

  json(res, { ok: false, error: `no such endpoint: ${path}` }, 404);
  return true;
}
