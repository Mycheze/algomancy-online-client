/** the text with comments blanked to spaces and string bodies to `_` — same length, same newlines */
export function maskCss(text: string): string;
/** one declaration: text.slice(start, end) is its value; `selector` the rule's prelude, `at` the enclosing at-rules */
export interface Declaration { prop: string; start: number; end: number; selector: string; at: string[] }
/** every declaration in a stylesheet, with offsets into the original text */
export function declarations(text: string): { masked: string; decls: Declaration[] };
/** a hex or rgb()/rgba() colour literal */
export const COLOUR_RE: RegExp;
/** a colour literal of any spelling: hex, a colour function, a named colour */
export const ANY_COLOUR_RE: RegExp;
/** [r, g, b, a] for a hex or rgb() literal, or null */
export function parseColour(lit: string): [number, number, number, number] | null;
/** a canonical key: two literals with the same key are the same colour */
export function colourKey(c: [number, number, number, number]): string;
/** the spans of a value inside var(…) or url(…) */
export function shieldedSpans(value: string): [number, number][];
export function inSpans(spans: [number, number][], a: number, b: number): boolean;
/** every colour literal in the declaration values of a stylesheet, var() fallbacks included */
export function colourLiterals(text: string): { selector: string; prop: string; literal: string }[];
/** CIE76 ΔE between two colours */
export function deltaE(a: number[], b: number[]): number;
