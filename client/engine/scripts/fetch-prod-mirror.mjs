/* Mirror the deployment's saved games and a SANITIZED account store into
 * var/prod-mirror/snapshot/, so the stats can be built and looked at against
 * the real games. `npm --prefix client run mirror`.
 *
 *   --dev-password X   give every mirrored account the local password X, so
 *                      the dev:prod server can be signed into as anyone
 *                      (for "My games"). Only ever touches the local copy.
 *
 * Read-only on the box: `rsync` pulls, and the account store is read by
 * sanitize-accounts.mjs running THERE — the password hashes and session
 * tokens are dropped before a byte leaves. The local copy is then checked for
 * them anyway, and the script fails if one got through.
 *
 * `rsync -a`, not scp: history.ts dates a game by its file's mtime, and a
 * copy stamped "now" would date every game to the day it was fetched. */
import { execFileSync } from 'node:child_process';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { DEPLOY_HOST, DEPLOY_ROOT, PROD_MIRROR_DIR } from './paths.mjs';

const fail = msg => { console.error(`fetch-prod-mirror: ${msg}`); process.exit(1); };
if (hostname().split('.')[0] === DEPLOY_HOST.split('.')[0]) {
  fail(`this is ${hostname()} — the deploy box. Its var/ IS the live data; run this from the dev machine.`);
}
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const devPassword = arg('--dev-password');

const snap = join(PROD_MIRROR_DIR, 'snapshot');
mkdirSync(join(snap, 'games'), { recursive: true });

console.log(`mirroring games from ${DEPLOY_HOST}…`);
execFileSync('rsync', ['-a', '--delete', `${DEPLOY_HOST}:${DEPLOY_ROOT}/var/games/`, join(snap, 'games') + '/'], { stdio: 'inherit' });

console.log('sanitizing the account store on the box…');
const script = readFileSync(new URL('./sanitize-accounts.mjs', import.meta.url));
const text = execFileSync('ssh', [DEPLOY_HOST, 'node', '-', `${DEPLOY_ROOT}/var/accounts/accounts.json`],
  { input: script, maxBuffer: 256 << 20 }).toString('utf8');
if (/"(salt|hash|token)"\s*:/.test(text)) fail('the sanitized store still names a secret field — refusing to write it');
const store = JSON.parse(text);
if (devPassword) {
  for (const a of store.accounts) {
    a.salt = randomBytes(16).toString('hex');
    a.hash = scryptSync(devPassword, a.salt, 64).toString('hex');
  }
}
writeFileSync(join(snap, 'accounts.json'), JSON.stringify(store));

// a summary of what came down
const counts = {};
let cardLog = 0, sigs = 0, refs = 0;
for (const f of readdirSync(join(snap, 'games')).filter(f => f.endsWith('.json'))) {
  try {
    const g = JSON.parse(readFileSync(join(snap, 'games', f), 'utf8'));
    if (!g.actions?.length) continue;
    const k = `${g.mode ?? 'shared'}${g.scenario ? ' (scenario)' : ''}`;
    counts[k] = (counts[k] ?? 0) + 1;
    if (Array.isArray(g.cardLog)) cardLog++;
    if (Array.isArray(g.sigs)) sigs++;
    if (Array.isArray(g.refs)) refs++;
  } catch { /* a half-written file is not a game */ }
}
console.log(`games with actions: ${JSON.stringify(counts)}`);
console.log(`carrying cardLog ${cardLog} · sigs ${sigs} · refs ${refs} · history rows ${store.history?.length ?? 0}`
  + ` · accounts ${store.accounts.length}${devPassword ? ' (local dev password set)' : ''}`);
console.log(`→ ${snap}`);
