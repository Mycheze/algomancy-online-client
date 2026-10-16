/** Types for index-rq.mjs: the rules-questions snapshot writer. */
import type { RqMessage } from './cr/extract.d.mts';

export const RULES_QUESTIONS_CHANNEL: string;
/** one message of a DiscordChatExporter channel export, as far as the snapshot reads it */
export interface ExportMessage {
  id: string;
  timestamp: string;
  timestampEdited?: string | null;
  content?: string;
  author?: { name?: string; isBot?: boolean };
  reference?: { messageId?: string } | null;
}
/** the snapshot row for message `id` (no textHash: extract.mjs adds it), or why it is refused */
export function rowFor(messages: ExportMessage[], index: Map<string, number>, id: string):
  { row: Omit<RqMessage, 'textHash'>; refused?: undefined } | { refused: string; row?: undefined };
export function readSnapshot(file: string): Omit<RqMessage, 'textHash'>[];
