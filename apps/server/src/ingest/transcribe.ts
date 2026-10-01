import OpenAI, { toFile } from 'openai';
import { IngestError } from './files';

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export interface TranscribeKeys {
  openai?: string;
  huggingface?: string;
  mock?: boolean;
}

/** Audio to text: OpenAI Whisper if an OpenAI key is set, else Whisper on Hugging Face. */
export async function transcribe(
  name: string,
  type: string,
  buf: Buffer,
  keys: TranscribeKeys,
): Promise<string> {
  if (buf.length > MAX_AUDIO_BYTES) throw new IngestError('Audio must be under 25 MB.');
  if (keys.openai) {
    const client = new OpenAI({ apiKey: keys.openai, maxRetries: 1 });
    const result = await client.audio.transcriptions.create({
      file: await toFile(buf, name, { type: type || 'application/octet-stream' }),
      model: 'whisper-1',
    });
    return result.text.trim();
  }
  if (keys.huggingface) {
    const res = await fetch('https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${keys.huggingface}`,
        'Content-Type': type || 'application/octet-stream',
      },
      body: new Uint8Array(buf),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new IngestError(`Hugging Face transcription failed (${res.status}).`);
    const body = (await res.json()) as { text?: string };
    return (body.text ?? '').trim();
  }
  if (keys.mock) return `(Mock transcript of ${name}, ${buf.length} bytes.)`;
  throw new IngestError('Transcription needs an OpenAI or Hugging Face key (Settings).');
}
