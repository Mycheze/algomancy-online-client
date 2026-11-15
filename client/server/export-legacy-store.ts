/* Before rolling back to a build that kept the history inside accounts.json,
 * with the server stopped: puts it back there and moves the history file (and
 * its .bak) aside, so rolling forward migrates it again.
 *   node server/export-legacy-store.ts [accounts.json] */
import { existsSync, renameSync } from 'node:fs';
import { accountsFile, historyBeside } from './statepaths.ts';
import { isRecord, readStoreFile, readStoreLines, writeStoreFile } from './store-file.ts';

const file = process.argv[2] ?? accountsFile(), lines = readStoreLines(historyBeside(file), isRecord, false) as { code: string }[] | undefined;
const store = readStoreFile(file, isRecord) as Record<string, unknown> | undefined;
if (!store || !lines) throw new Error(`nothing to export: ${file} or ${historyBeside(file)} is missing`);
const history = [...new Map(lines.map(g => [g.code, g])).values()];
writeStoreFile(file, JSON.stringify({ ...store, history }, null, 1), 0o600);
for (const f of [historyBeside(file), `${historyBeside(file)}.bak`]) if (existsSync(f)) renameSync(f, `${f}.rolled-back`);
console.log(`${file}: ${history.length} history rows written back; the history file is moved aside`);
