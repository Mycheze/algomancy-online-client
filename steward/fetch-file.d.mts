/** types for fetch-file.mjs, so a typed test can import it (client/server/test/1152) */
export function normalizeUrl(raw: string): string | null;
export function linksIn(text: string, embeds?: readonly unknown[]): string[];
export function fileNameOf(url: string, contentType?: string): string;
export function download(url: string, dir: string, opts?: { prefix?: string }): Promise<{ path: string; url: string; type: string; bytes: number }>;
