/* the types of ui-shots-states.mjs, for client/ui/test/1012 */
export interface ShotState {
  page: string; state: string; url: string; as?: string; steps?: unknown[]; check?: string; pages?: number;
  stub?: string[]; css?: string; viewports?: string[]; also?: string[]; noScroll?: boolean;
}
/** the pages drawn in the app frame: every state of theirs is noScroll */
export const FRAME_PAGES: string[];
export function SCENARIOS(fx: Record<string, unknown>): ShotState[];
