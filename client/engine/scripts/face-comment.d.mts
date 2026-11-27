/** Types for face-comment.mjs: the printed face a card() definition quotes above itself. */
export interface FaceStats { p: string; t: string; sep: string }
export interface Face { start: number; end: number; line: number; lead: string; pips: string; mana: string; stats?: FaceStats }
export interface FaceCard { name: string; cost: string; mana: number | string; power: number; toughness: number; kind: string }
export const SETS_DIR: string;
export function parseFaces(src: string): { name: string; line: number; faces: Face[] }[];
export function faceDisagrees(face: Face, card: FaceCard): string[];
export function rewriteFaces(src: string, name: string, card: FaceCard): string;
export function loadPrinted(): Map<string, FaceCard>;
export function setFiles(): string[];
export function allFaces(printed?: Map<string, FaceCard>): { file: string; line: number; name: string; face: Face; bad: string[] }[];
export function parseFile(src: string): { defs: { name: string; line: number; faces: Face[] }[]; loose: Face[] };
export function looseFaces(): { file: string; line: number }[];
