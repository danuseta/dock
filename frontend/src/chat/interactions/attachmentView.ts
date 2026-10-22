import { IMAGE_TYPES } from '../composer/composerLogic';
import type { ChatAttachment } from '../messages';

export type ViewKind = 'image' | 'pdf' | 'html' | 'markdown' | 'csv' | 'text';

const TEXT_EXTENSIONS = new Set(['txt', 'log', 'json', 'yaml', 'yml', 'xml', 'css', 'js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'kt', 'sh', 'sql', 'diff', 'patch']);

const extensionOf = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');

/** How the viewer shows a file. The server stores html and code as text/plain or octet-stream, so the extension decides those. */
export function viewKind(attachment: Pick<ChatAttachment, 'name' | 'mime' | 'state'>): ViewKind | null {
  if (attachment.state === 'deleted') return null;
  if (IMAGE_TYPES.includes(attachment.mime)) return 'image';
  if (attachment.mime === 'application/pdf') return 'pdf';
  const extension = extensionOf(attachment.name);
  if (extension === 'html' || extension === 'htm') return 'html';
  if (extension === 'md' || attachment.mime === 'text/markdown') return 'markdown';
  if (extension === 'csv' || attachment.mime === 'text/csv') return 'csv';
  if (TEXT_EXTENSIONS.has(extension) || attachment.mime === 'application/json' || attachment.mime.startsWith('text/')) return 'text';
  return null;
}

export const hasSource = (kind: ViewKind | null) => kind === 'html' || kind === 'markdown' || kind === 'csv';

export const CSV_ROW_LIMIT = 500;

/** Rows of a CSV, quoted fields included; only the first CSV_ROW_LIMIT rows. */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length && rows.length < CSV_ROW_LIMIT; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (rows.length < CSV_ROW_LIMIT && (field || row.length)) rows.push([...row, field.replace(/\r$/, '')]);
  return rows;
}
