/* the types of ui-shots-states.mjs, for client/ui/test/1012 */
export interface ShotState {
  page: string; state: string; url: string; as?: string; steps?: unknown[]; check?: string; pages?: number;
  stub?: string[]; css?: string; viewports?: string[]; noScroll?: boolean;
}
export function SCENARIOS(fx: Record<string, unknown>): ShotState[];
