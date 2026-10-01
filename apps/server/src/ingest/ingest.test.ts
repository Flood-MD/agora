import { afterEach, describe, expect, it, vi } from 'vitest';
import { importGithub, isWanted, parseRepo } from './github';
import { extractJsonAfter, importYoutube, json3Text, pickTrack, videoId } from './youtube';

afterEach(() => vi.restoreAllMocks());

/** Serves canned responses by URL substring. */
function stubFetch(routes: Record<string, (url: string) => Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    const key = Object.keys(routes).find((k) => url.includes(k));
    return key ? routes[key]!(url) : new Response('not found', { status: 404 });
  });
}

describe('GitHub import', () => {
  it('parses shorthand and links', () => {
    expect(parseRepo('vercel/next.js')).toEqual({
      owner: 'vercel',
      repo: 'next.js',
      ref: undefined,
      path: '',
    });
    expect(parseRepo('a/b@dev/docs/guide/')).toEqual({
      owner: 'a',
      repo: 'b',
      ref: 'dev',
      path: 'docs/guide',
    });
    expect(parseRepo('https://github.com/a/b/tree/main/src/lib')).toEqual({
      owner: 'a',
      repo: 'b',
      ref: 'main',
      path: 'src/lib',
    });
    expect(parseRepo('https://github.com/a/b.git')).toMatchObject({ owner: 'a', repo: 'b' });
    expect(() => parseRepo('not a repo')).toThrow(/owner\/repo/);
  });

  it('keeps source and docs, skips dependencies, lockfiles, binaries and huge files', () => {
    expect(isWanted('src/index.ts', 100)).toBe(true);
    expect(isWanted('README.md', 100)).toBe(true);
    expect(isWanted('Dockerfile', 100)).toBe(true);
    expect(isWanted('node_modules/x/index.js', 100)).toBe(false);
    expect(isWanted('pnpm-lock.yaml', 100)).toBe(false);
    expect(isWanted('assets/logo.png', 100)).toBe(false);
    expect(isWanted('data/huge.json', 5_000_000)).toBe(false);
  });

  it('imports the readable files of a folder at the default branch', async () => {
    stubFetch({
      'api.github.com/repos/a/b/git/trees/main': () =>
        Response.json({
          truncated: false,
          tree: [
            { path: 'docs/intro.md', type: 'blob', size: 20 },
            { path: 'docs/img.png', type: 'blob', size: 20 },
            { path: 'docs/sub', type: 'tree' },
            { path: 'src/app.ts', type: 'blob', size: 20 },
          ],
        }),
      'api.github.com/repos/a/b': () => Response.json({ default_branch: 'main' }),
      'raw.githubusercontent.com/a/b/main/docs/intro.md': () => new Response('# Intro'),
    });
    const item = await importGithub('a/b/docs');
    expect(item).toMatchObject({ kind: 'github', title: 'a/b/docs', note: '1 file, 1 skipped' });
    expect(item.text).toBe('<file path="docs/intro.md">\n# Intro\n</file>');
  });

  it('explains missing repos and rate limits', async () => {
    stubFetch({});
    await expect(importGithub('a/private')).rejects.toThrow(/add a GitHub token/);
    stubFetch({ 'api.github.com': () => new Response('', { status: 403 }) });
    await expect(importGithub('a/b')).rejects.toThrow(/rate limit/);
  });
});

describe('YouTube import', () => {
  it('finds the video id in every link style', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?feature=share&v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ?t=42',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'dQw4w9WgXcQ',
    ]) {
      expect(videoId(url)).toBe('dQw4w9WgXcQ');
    }
    expect(() => videoId('https://example.com')).toThrow();
  });

  it('extracts a JSON object from a page, including braces inside strings', () => {
    const html = 'x var ytInitialPlayerResponse = {"a":"}{\\"","b":{"c":1}};var next = {};';
    expect(extractJsonAfter(html, 'ytInitialPlayerResponse')).toEqual({ a: '}{"', b: { c: 1 } });
    expect(extractJsonAfter('nothing', 'ytInitialPlayerResponse')).toBeUndefined();
  });

  it('prefers human English captions and joins json3 text', () => {
    const tracks = [
      { baseUrl: 'fr', languageCode: 'fr' },
      { baseUrl: 'en-auto', languageCode: 'en', kind: 'asr' },
      { baseUrl: 'en-gb', languageCode: 'en-GB' },
    ];
    expect(pickTrack(tracks)!.baseUrl).toBe('en-gb');
    expect(pickTrack(tracks.slice(0, 2))!.baseUrl).toBe('en-auto');
    expect(
      json3Text({
        events: [
          { segs: [{ utf8: 'Hello' }, { utf8: ' world' }] },
          { segs: [{ utf8: '\n' }] },
          { segs: [{ utf8: 'again' }] },
        ],
      }),
    ).toBe('Hello world again');
  });

  it('imports captions from the watch page', async () => {
    const player = {
      videoDetails: { title: 'A talk', author: 'Someone' },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext?v=x', languageCode: 'en' }],
        },
      },
    };
    stubFetch({
      'youtube.com/watch': () =>
        new Response(`<script>var ytInitialPlayerResponse = ${JSON.stringify(player)};</script>`),
      timedtext: () =>
        Response.json({ events: [{ segs: [{ utf8: 'First line' }] }, { segs: [{ utf8: 'second' }] }] }),
    });
    const item = await importYoutube('https://youtu.be/dQw4w9WgXcQ');
    expect(item).toMatchObject({ kind: 'youtube', title: 'A talk', note: 'en captions' });
    expect(item.text).toBe(
      'Transcript of “A talk” (Someone), https://youtu.be/dQw4w9WgXcQ\n\nFirst line second',
    );
  });

  it('says so when a video has no captions', async () => {
    stubFetch({
      'youtube.com/watch': () =>
        new Response(
          `var ytInitialPlayerResponse = ${JSON.stringify({ videoDetails: { title: 'Silent' } })};`,
        ),
    });
    await expect(importYoutube('dQw4w9WgXcQ')).rejects.toThrow('“Silent” has no captions');
  });
});
