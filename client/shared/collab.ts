/* The colours a shared deck table draws its people in (docs/26), by the order
 * they first joined; the host is the first. The server hands out the index
 * (server/collab.ts admit), the browser draws it (ui/collab.ts). */
export const COLLAB_COLOURS = ['#e0a526', '#3d8bfd', '#e5534b', '#3fb950', '#a371f7', '#db61a2', '#2bb3c0', '#f0883e'] as const;

export const collabColour = (i: number): string => COLLAB_COLOURS[((i % COLLAB_COLOURS.length) + COLLAB_COLOURS.length) % COLLAB_COLOURS.length]!;
