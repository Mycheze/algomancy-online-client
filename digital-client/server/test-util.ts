/* Shared helper for the server integration tests.
 *
 * They each spawn the real server and drive it over raw WebSockets (no test
 * framework, on purpose), and each used to invent its own room code — which
 * worked only while joining was get-or-create. Creating a room is now the
 * privilege of a code the server minted (rooms.ts), so a test that wants a
 * room asks for one exactly the way the New-game button does.
 */

/** Ask the server for a fresh room code, reserved and ready to be created. */
export async function mintRoom(port: number): Promise<string> {
  const res = await fetch(`http://localhost:${port}/api/new`);
  if (!res.ok) throw new Error(`/api/new failed: ${res.status}`);
  const { code } = await res.json() as { code: string };
  if (!code) throw new Error('/api/new returned no code');
  return code;
}
