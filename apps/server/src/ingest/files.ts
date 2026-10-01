import path from 'node:path';
import type { NewContextItem } from '../contextStore';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Images are sent to models inline; providers cap them at about 5 MB. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Per attachment; longer text is cut with a note. */
export const MAX_TEXT_CHARS = 2_000_000;

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/** An error whose message is safe to show to the user. */
export class IngestError extends Error {}

/** Heuristic: no NUL bytes and almost no invalid UTF-8 in the first 64 KB. */
export function looksLikeText(buf: Buffer): boolean {
  const head = buf.subarray(0, 65_536);
  if (head.includes(0)) return false;
  const decoded = head.toString('utf8');
  const bad = decoded.split('�').length - 1;
  return bad <= Math.max(2, decoded.length / 1000);
}

export function clip(text: string): { text: string; clipped: boolean } {
  return text.length > MAX_TEXT_CHARS
    ? { text: `${text.slice(0, MAX_TEXT_CHARS)}\n…[cut: the rest was too long]`, clipped: true }
    : { text, clipped: false };
}

async function pdfText(buf: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  if (!text.trim()) throw new IngestError('This PDF has no extractable text (it may be scanned images).');
  return `${text.trim()}\n\n[${totalPages} page${totalPages === 1 ? '' : 's'}]`;
}

async function docxText(buf: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return value.trim();
}

/**
 * Turns one uploaded file into an attachment: text and code as-is, PDF and Word as extracted text,
 * images as images. Anything else is rejected with a reason.
 */
export async function extractFile(name: string, buf: Buffer): Promise<NewContextItem> {
  if (buf.length > MAX_FILE_BYTES) throw new IngestError(`${name} is larger than 25 MB.`);
  const ext = path.extname(name).toLowerCase();
  const image = IMAGE_TYPES[ext];
  if (image) {
    if (buf.length > MAX_IMAGE_BYTES) throw new IngestError(`${name}: images must be under 5 MB.`);
    return { kind: 'image', title: name, text: '', mediaType: image, data: buf.toString('base64') };
  }
  let text: string;
  if (ext === '.pdf') text = await pdfText(buf);
  else if (ext === '.docx') text = await docxText(buf);
  else if (looksLikeText(buf)) text = buf.toString('utf8');
  else throw new IngestError(`${name} isn't a text, code, PDF, Word or image file.`);
  const { text: body, clipped } = clip(text);
  return { kind: 'file', title: name, text: body, ...(clipped && { note: 'cut to 2M characters' }) };
}

/** A folder upload becomes one attachment listing every readable file. */
export async function extractFolder(
  folder: string,
  files: { name: string; buf: Buffer }[],
): Promise<NewContextItem> {
  const parts: string[] = [];
  let skipped = 0;
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    try {
      const item = await extractFile(f.name, f.buf);
      if (item.kind === 'image') {
        skipped++;
        continue;
      }
      parts.push(`<file path="${f.name}">\n${item.text}\n</file>`);
    } catch {
      skipped++;
    }
  }
  if (!parts.length) throw new IngestError(`No readable files in ${folder}/.`);
  const { text, clipped } = clip(parts.join('\n\n'));
  const note = [
    `${parts.length} file${parts.length === 1 ? '' : 's'}`,
    skipped && `${skipped} skipped`,
    clipped && 'cut',
  ]
    .filter(Boolean)
    .join(', ');
  return { kind: 'folder', title: `${folder}/`, text, note };
}
