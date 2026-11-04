/* the types of ui-shots-overflow.mjs, for client/ui/test/999 */
export interface OverflowFinding { text: string; cls: string; why: string }
/** the shell's main region (components/app-shell.ts), or null on a page with no shell */
export interface RegionSize { scrollH: number; H: number }
export interface OverflowResult { scrollW: number; scrollH: number; W: number; H: number; region: RegionSize | null; bad: OverflowFinding[] }
export function overflowWalk(W: number): OverflowResult;
export function overflowJs(width: number): string;
/** the document is taller or wider than the window (the home must not be) */
export function pageScrolls(ov: { scrollW: number; scrollH: number; W: number; H: number }): boolean;
/** the shell's main region is taller than it is: it scrolls inside itself, where pageScrolls cannot see */
export function regionScrolls(ov: { region?: RegionSize | null }): boolean;
/** the viewports a `noScroll` state is held to */
export const NO_SCROLL_VIEWPORTS: readonly string[];
/** viewports a state is shot at only when it names them in `also` */
export const OPT_IN_VIEWPORTS: readonly string[];
/** does state `s` get a picture at viewport `vpName`? */
export function shotAt(s: { viewports?: string[]; also?: string[] }, vpName: string): boolean;
