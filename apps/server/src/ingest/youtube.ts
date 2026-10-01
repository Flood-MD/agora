import type { NewContextItem } from '../contextStore';
import { clip, IngestError } from './files';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

/** Accepts watch, youtu.be, shorts, embed and live links, or a bare 11-character id. */
export function videoId(input: string): string {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/);
  if (!m) throw new IngestError('That doesn’t look like a YouTube link.');
  return m[1]!;
}

/** Extracts the JSON object assigned after `marker` in a page, by matching braces outside strings. */
export function extractJsonAfter(html: string, marker: string): unknown {
  const at = html.indexOf(marker);
  if (at < 0) return undefined;
  const start = html.indexOf('{', at + marker.length);
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

interface Track {
  baseUrl: string;
  languageCode: string;
  kind?: string;
}

/** Prefers English captions written by a person, then English auto-captions, then anything. */
export function pickTrack(tracks: Track[]): Track | undefined {
  const en = (t: Track) => t.languageCode === 'en' || t.languageCode.startsWith('en-');
  return (
    tracks.find((t) => en(t) && t.kind !== 'asr') ??
    tracks.find((t) => en(t)) ??
    tracks.find((t) => t.kind !== 'asr') ??
    tracks[0]
  );
}

/** Joins the text of a json3 caption file. */
export function json3Text(body: { events?: { segs?: { utf8?: string }[] }[] }): string {
  return (body.events ?? [])
    .map((e) => (e.segs ?? []).map((s) => s.utf8 ?? '').join(''))
    .filter((line) => line.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fetches a video's captions as an attachment. */
export async function importYoutube(input: string): Promise<NewContextItem> {
  const id = videoId(input);
  const page = await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(20_000),
  });
  if (!page.ok) throw new IngestError(`YouTube returned ${page.status}.`);
  const player = extractJsonAfter(await page.text(), 'ytInitialPlayerResponse') as
    | {
        videoDetails?: { title?: string; author?: string };
        captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: Track[] } };
      }
    | undefined;
  if (!player) throw new IngestError('Could not read that YouTube page.');
  const title = player.videoDetails?.title ?? id;
  const track = pickTrack(player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []);
  if (!track) throw new IngestError(`“${title}” has no captions to import.`);
  const res = await fetch(`${track.baseUrl}&fmt=json3`, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(20_000),
  });
  const raw = res.ok ? await res.text() : '';
  let text = '';
  try {
    text = json3Text(JSON.parse(raw));
  } catch {
    // Empty or non-JSON body.
  }
  if (!text)
    throw new IngestError(
      'YouTube didn’t return the captions (it sometimes blocks servers). Try again later.',
    );
  const by = player.videoDetails?.author ? ` (${player.videoDetails.author})` : '';
  const { text: body } = clip(`Transcript of “${title}”${by}, https://youtu.be/${id}\n\n${text}`);
  return {
    kind: 'youtube',
    title,
    text: body,
    note: track.kind === 'asr' ? 'auto-generated captions' : `${track.languageCode} captions`,
  };
}
