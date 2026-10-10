/** scripts/cr/extract-test-titles.mjs: test titles read with a JS tokenizer */
export interface Token { t: 'id' | 'str' | 'tmpl' | 'num' | 're' | 'p'; v: string; s: number; e: number }
export function tokenize(src: string): Token[];
/** every `test(…)` / `it(…)` title in one source, escapes undone; `partial` when a
 *  concatenation reached a non-literal operand */
export function testTitlesOf(src: string): { title: string; partial?: true }[];
