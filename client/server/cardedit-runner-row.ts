/* The home box's runner reports a card edit's progress: one row appended to
 * `<id>.runner.jsonl` (cardedit.ts), then the runner's index rebuilt.
 *
 *   node client/server/cardedit-runner-row.ts <id> <step> [why]
 *
 * The runner runs it over its own ssh to the VPS, so it is the one writer of
 * that file. It refuses an id outside [a-z0-9-], an edit that does not exist
 * and a step it does not know, and exits 2 having written nothing.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { RUNNER_STEPS, appendRunnerRow, isEditId, type RunnerStep } from './cardedit.ts';
import { cardEditsDir } from './statepaths.ts';

const [id, step, ...rest] = process.argv.slice(2);
const why = rest.join(' ').replace(/\s+/g, ' ').trim().slice(0, 300);

function refuse(msg: string): never {
  process.stderr.write(`cardedit-runner-row: ${msg}\n`);
  process.exit(2);
}

if (!isEditId(id)) refuse(`not an edit id: ${JSON.stringify(id ?? '')}`);
if (!(RUNNER_STEPS as readonly string[]).includes(step ?? '')) refuse(`not a step (${RUNNER_STEPS.join(', ')}): ${JSON.stringify(step ?? '')}`);
if (!existsSync(join(cardEditsDir(), `${id}.json`))) refuse(`no such edit: ${id}`);
const row = appendRunnerRow(id, step as RunnerStep, why || undefined);
process.stdout.write(JSON.stringify(row) + '\n');
