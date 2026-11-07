/* the types of ui-shots-stable.mjs, for client/ui/test/1172 */
export const SHOTS_HOST: string;
export const SHOTS_ORIGIN: string;
/** Chrome's flags that serve SHOTS_ORIGIN from the server on `port` */
export function originFlags(port: number): string[];
/** the CDP call that makes the page believe its window has focus */
export const FOCUS_EMULATION: readonly [string, { enabled: boolean }];
/** a placeholder line the client draws while it fetches */
export const LOADING_RE: RegExp;
/** the page-side check: → the visible "Loading…" lines, [] when there are none */
export function stillLoadingJs(): string;
