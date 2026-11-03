/* the types of ui-shots-overflow.mjs, for client/ui/test/999 */
export interface OverflowFinding { text: string; cls: string; why: string }
export interface OverflowResult { scrollW: number; scrollH: number; W: number; H: number; bad: OverflowFinding[] }
export function overflowWalk(W: number): OverflowResult;
export function overflowJs(width: number): string;
/** the document is taller or wider than the window (the home must not be) */
export function pageScrolls(ov: { scrollW: number; scrollH: number; W: number; H: number }): boolean;
/** the viewports a `noScroll` state is held to */
export const NO_SCROLL_VIEWPORTS: readonly string[];
