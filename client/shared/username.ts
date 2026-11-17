/* A USERNAME'S LENGTH, named once.
 *
 * server/accounts.ts usernameProblem refuses a name outside these bounds, and
 * every box a player types a username into stops at USERNAME_MAX, so the box
 * cannot take a name the server will turn away.
 */

export const USERNAME_MIN = 2;
export const USERNAME_MAX = 20;
