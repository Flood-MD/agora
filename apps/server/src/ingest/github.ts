import type { NewContextItem } from '../contextStore';
import { clip, IngestError, looksLikeText } from './files';

const MAX_FILES = 400;
const MAX_FILE_BYTES = 300_000;
const CONCURRENCY = 8;

const IGNORED_DIR =
  /(^|\/)(node_modules|\.git|dist|build|out|target|vendor|\.next|\.nuxt|coverage|__pycache__|\.venv|venv)(\/|$)/;
const IGNORED_FILE =
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|poetry\.lock|composer\.lock|go\.sum)$/;
const TEXT_EXT =
  /\.(txt|md|mdx|markdown|rst|adoc|csv|tsv|json|jsonc|ya?ml|toml|ini|cfg|conf|xml|html?|css|scss|sass|less|js|jsx|mjs|cjs|ts|tsx|mts|cts|vue|svelte|astro|py|pyi|rb|go|rs|java|kt|kts|scala|swift|m|mm|c|h|cc|cpp|cxx|hpp|hh|cs|fs|php|pl|lua|r|jl|dart|ex|exs|erl|hs|ml|clj|sh|bash|zsh|fish|ps1|bat|sql|graphql|gql|proto|tf|hcl|nix|gradle|properties|env\.example|gitignore|dockerignore|editorconfig)$/i;
const TEXT_NAME =
  /(^|\/)(README|LICENSE|COPYING|CHANGELOG|CONTRIBUTING|Dockerfile|Makefile|Procfile|Gemfile|Rakefile|Justfile)[^/]*$/i;

export interface RepoRef {
  owner: string;
  repo: string;
  ref?: string;
  path: string;
}

/** Accepts `owner/repo`, `owner/repo@ref/sub/path`, or a github.com URL (…/tree/<ref>/<path>). */
export function parseRepo(input: string): RepoRef {
  const s = input.trim().replace(/\.git$/, '');
  const url = s.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)(?:\/(?:tree|blob)\/([^/\s]+)(?:\/([^\s#?]*))?)?/i,
  );
  if (url) return { owner: url[1]!, repo: url[2]!, ref: url[3], path: (url[4] ?? '').replace(/\/$/, '') };
  const short = s.match(/^([\w.-]+)\/([\w.-]+)(?:@([^/\s]+))?(?:\/(\S*))?$/);
  if (short)
    return { owner: short[1]!, repo: short[2]!, ref: short[3], path: (short[4] ?? '').replace(/\/$/, '') };
  throw new IngestError('Use owner/repo, owner/repo@branch/folder, or a github.com link.');
}

/** Which repository files are worth sending to a model. */
export function isWanted(path: string, size: number): boolean {
  if (size > MAX_FILE_BYTES || IGNORED_DIR.test(path) || IGNORED_FILE.test(path)) return false;
  return TEXT_EXT.test(path) || TEXT_NAME.test(path);
}

async function gh<T>(url: string, token?: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'agora',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) {
    throw new IngestError(
      token
        ? 'Repository, branch or folder not found.'
        : 'Repository not found. If it is private, add a GitHub token in Settings.',
    );
  }
  if (res.status === 403 || res.status === 429) {
    throw new IngestError('GitHub rate limit reached. Add a GitHub token in Settings, or try again later.');
  }
  if (!res.ok) throw new IngestError(`GitHub returned ${res.status} ${res.statusText}.`);
  return (await res.json()) as T;
}

/** Imports the readable files of a repository (or a folder of it) as one attachment. */
export async function importGithub(input: string, token?: string): Promise<NewContextItem> {
  const r = parseRepo(input);
  const base = `https://api.github.com/repos/${r.owner}/${r.repo}`;
  const ref = r.ref ?? (await gh<{ default_branch: string }>(base, token)).default_branch;
  const tree = await gh<{ tree: { path: string; type: string; size?: number }[]; truncated: boolean }>(
    `${base}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    token,
  );
  const prefix = r.path ? `${r.path}/` : '';
  const blobs = tree.tree.filter((e) => e.type === 'blob' && (!prefix || e.path.startsWith(prefix)));
  if (r.path && !blobs.length) throw new IngestError(`No files under ${r.path}/ on ${ref}.`);
  const wanted = blobs.filter((e) => isWanted(e.path, e.size ?? 0)).slice(0, MAX_FILES);

  const texts: { path: string; text: string }[] = [];
  let failed = 0;
  for (let i = 0; i < wanted.length; i += CONCURRENCY) {
    await Promise.all(
      wanted.slice(i, i + CONCURRENCY).map(async (e) => {
        const raw = `https://raw.githubusercontent.com/${r.owner}/${r.repo}/${encodeURIComponent(ref)}/${e.path
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`;
        try {
          const res = await fetch(raw, {
            headers: { 'User-Agent': 'agora', ...(token && { Authorization: `Bearer ${token}` }) },
            signal: AbortSignal.timeout(20_000),
          });
          const buf = Buffer.from(await res.arrayBuffer());
          if (!res.ok || !looksLikeText(buf)) throw new Error();
          texts.push({ path: e.path, text: buf.toString('utf8') });
        } catch {
          failed++;
        }
      }),
    );
  }
  if (!texts.length) throw new IngestError('No readable text files found there.');
  texts.sort((a, b) => a.path.localeCompare(b.path));
  const { text, clipped } = clip(
    texts.map((t) => `<file path="${t.path}">\n${t.text}\n</file>`).join('\n\n'),
  );
  const skipped = blobs.length - texts.length;
  const note = [
    `${texts.length} file${texts.length === 1 ? '' : 's'}`,
    skipped > 0 && `${skipped} skipped`,
    (tree.truncated || failed > 0 || clipped) && 'partial',
  ]
    .filter(Boolean)
    .join(', ');
  const title = `${r.owner}/${r.repo}${r.ref ? `@${ref}` : ''}${r.path ? `/${r.path}` : ''}`;
  return { kind: 'github', title, text, note };
}
