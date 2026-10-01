# Agora — Implementation Plan

A self-hostable, open-source multi-model group chat inspired by the functionality of lmcouncil.ai
(as seen in reference screenshots). Agora reproduces the *features*; its UI, branding, and assets are original work.

Providers at launch: **OpenRouter, Anthropic, OpenAI, Hugging Face** (plus an optional OpenAI-compatible
"custom endpoint" so Ollama / LM Studio / vLLM work for free).

---

## 1. Feature inventory (from screenshots)

| Area | Element | Behaviour in Agora |
|---|---|---|
| Header | Title + ▾ | Session switcher (new / rename / delete / list of saved sessions) |
| | Hide | Collapse the model-slot bar to give the chat more room |
| | Save / Load | Export / import a session (config + transcript + context) as JSON; also persisted server-side |
| | `M` | Settings menu: API keys, defaults, theme |
| Slot bar | Coloured slot cards (1…N) | Each slot = one model instance with colour, display name, model id; `×` removes it |
| | Empty slot `4 +` | Opens model picker (searchable, grouped by provider, shows context length / price where known) |
| | `+` (left) | Add another slot (soft cap, e.g. 8) |
| | Roles | Opens the Roles modal (below) |
| | Restore / Clear | Clear transcript; Restore undoes the last Clear (keep one snapshot) |
| Roles modal | Rapid Roleplay | Free-text scenario → an LLM generates N characters (name + per-slot prompt, optionally model count). Checkbox "allow overwrite of selection/number of models" |
| | System Prompt | Global prompt sent to every model |
| | Custom Names | Per-slot display name + "show model names underneath" toggle |
| | Slot Prompts | Per-slot prompt appended after the global prompt |
| | Clear All / Cancel / Save & Close | Draft state in modal, committed only on Save |
| Composer | Text box, Send | Group message to all active slots |
| | Attach ▸ Files | Text/code/PDF/images → shared context (images go to vision-capable models) |
| | Attach ▸ Folders | Directory upload (`webkitdirectory`), ignore-list + size cap |
| | Attach ▸ GitHub | Import a public (or token-authed) repo / path / branch as context |
| | Attach ▸ Transcribe | Audio → text via Whisper (OpenAI) or HF ASR model |
| | Attach ▸ YouTube | Fetch transcript of a video URL into context |
| | Left icons | GitHub link, history (session list), DM toggle (talk to a single slot), web search toggle, regenerate last round |
| Modes row | `-` | Response-length / verbosity toggle (concise ↔ normal) |
| | Fusion | After all models answer, a chosen model merges answers into one synthesis |
| | Imagine | Image generation for the prompt (OpenAI images / OpenRouter image-output models) |
| | Leader ♛ + ↑ | One slot is leader: others answer first, leader sees them and gives the final answer; ↑ cycles which slot leads |
| | Emoji | "Casual" mode (playful tone instruction appended) |
| | Self-Chat! | Models converse among themselves for K rounds without user input; Stop button |

> Items marked with interpretations (`-`, Imagine, Emoji, `M`, chat icon) are inferred from icons only — see §10.

---

## 2. Architecture

```
┌──────────────────────── browser ────────────────────────┐
│ React + TS + Vite + Tailwind + Zustand                    │
│  SlotBar · RolesModal · Transcript · Composer · Settings  │
│  orchestrator client  ──SSE/fetch──┐                       │
└────────────────────────────────────┼───────────────────────┘
                                     ▼
┌──────────────────────── server (Node 22, Hono) ──────────┐
│ /api/models        unified model catalogue (cached)       │
│ /api/chat/stream   one slot turn → SSE token stream        │
│ /api/roleplay      scenario → JSON character profiles      │
│ /api/context/*     github · youtube · transcribe · files   │
│ /api/images        image generation                        │
│ /api/sessions      CRUD (SQLite)                           │
│ providers/  openaiCompat.ts (OpenAI, OpenRouter, HF, custom)│
│             anthropic.ts                                    │
└───────────────────────────────────────────────────────────┘
```

Why a server at all: API keys never touch the browser, CORS is avoided (Anthropic/HF/YouTube), and file/repo
ingestion is easier in Node. It binds to `127.0.0.1` by default.

**Stack:** pnpm workspace monorepo — `apps/web` (Vite/React), `apps/server` (Hono on Node), `packages/shared`
(types, zod schemas, prompt builder — shared so it can be unit-tested once). SQLite via `better-sqlite3` + Drizzle.
Shipping: `pnpm dev`, `pnpm build && pnpm start` (server serves the built SPA), and a `Dockerfile`/`compose.yaml`.

### Repo layout
```
apps/web/src/{components,stores,orchestrator,lib}
apps/server/src/{routes,providers,context,db}
packages/shared/src/{types.ts,schemas.ts,buildMessages.ts,modes.ts}
docs/PLAN.md  .env.example  Dockerfile  compose.yaml
```

---

## 3. Provider layer

```ts
interface Provider {
  id: 'openai' | 'anthropic' | 'openrouter' | 'huggingface' | 'custom';
  listModels(): Promise<ModelInfo[]>;          // id, label, ctx, vision, imageOut, pricing?
  stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>; // delta | usage | error | done
}
```

| Provider | Transport | Notes |
|---|---|---|
| OpenAI | `openai` SDK, Chat Completions (Responses API later) | `/v1/models` is unannotated → keep a small local capability map |
| OpenRouter | OpenAI-compatible, `baseURL=https://openrouter.ai/api/v1` | Rich `/models` (ctx, pricing, modalities); `HTTP-Referer`/`X-Title` headers; web search via `plugins:[{id:'web'}]` |
| Hugging Face | OpenAI-compatible Inference Providers router `https://router.huggingface.co/v1` | Model list from router `/v1/models`; ASR for Transcribe via HF inference |
| Anthropic | `@anthropic-ai/sdk` Messages API, streaming | `system` is a top-level param; strict user/assistant alternation (merge adjacent same-role turns); native web-search tool; required `max_tokens` |
| Custom | OpenAI-compatible with user base URL | Ollama, LM Studio, vLLM, llama.cpp |

Three of four providers share one `openaiCompat` adapter parameterised by base URL + headers. Model ids are
namespaced `provider/model` (e.g. `anthropic/claude-…`, `openrouter/google/gemini-…`). Catalogues are cached
(memory + SQLite, 6 h TTL) and only listed for providers whose key is configured.

Keys come from `.env` (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `HF_TOKEN`, `CUSTOM_BASE_URL`,
optional `GITHUB_TOKEN`) or can be entered in Settings and stored server-side in SQLite.
A **mock provider** (`MOCK_PROVIDER=1`) streams canned text so the UI and tests work with no keys.

---

## 4. The core: shared-transcript prompting

One transcript is shared by all slots. Each message: `{id, author: 'user' | slotId | 'system-event', text,
attachments?, mode?, round, model?, usage?}`.

`buildMessages(slot, transcript, config)` (in `packages/shared`, heavily unit-tested) produces the per-slot request:

1. **System** = global system prompt + slot prompt + an auto-generated *roster block*:
   "You are **{name}** in a group chat with the user and: {other names}. Messages from others are prefixed
   `[Name]:`. Reply only as yourself; do not write other participants' lines." + mode instructions (concise, casual, leader…).
2. **Shared context** (attachments) injected once, as a leading user block with clear `<file path=…>` delimiters
   (Anthropic gets prompt-caching `cache_control` on it).
3. **History**: the slot's own past messages → `assistant`; user and other slots' messages → `user`, prefixed
   with `[Name]:`. Adjacent `user` items are merged (required by Anthropic, harmless elsewhere).
4. **Truncation**: estimate tokens (`gpt-tokenizer` heuristic) against the slot's context window; drop oldest
   rounds first, never the system/context block; show a "context trimmed" chip in the UI.
5. Strip a model's accidental `[OtherName]:` impersonation lines on output (configurable).

---

## 5. Orchestration modes (client-side state machine)

All runs go through one `runRound(plan)` helper: a list of *steps*, each step = set of slots run in parallel, each
step seeing everything produced by earlier steps. Every slot call is an independent SSE stream with its own
`AbortController`; a global Stop aborts all.

| Mode | Steps |
|---|---|
| Group (default) | `[[all slots]]` — parallel, each sees transcript up to the user message |
| Sequential (setting) | `[[s1],[s2],…]` — each sees prior answers this round |
| DM | `[[selected slot]]` — message tagged private-to-slot or visible to all (setting) |
| Leader | `[[non-leaders],[leader]]` + leader gets "synthesise and decide" instruction |
| Fusion | `[[all slots],[fuser]]` — fuser (configurable, default leader or slot 1) emits a merged answer rendered as a distinct "Fusion" card |
| Self-Chat | Repeat `[[s1],[s2],…]` for K rounds (default 6) or until Stop / token budget; optional seed topic from composer |
| Regenerate | Re-run the last round's plan, replacing those messages (keep previous versions as swipeable variants) |
| Imagine | Prompt → `/api/images` with chosen image model; result displayed inline and stored as attachment |

Failures are per-slot: an errored card shows the provider error + Retry, without blocking others.

---

## 6. Context ingestion (`/api/context/*`)

All produce `ContextItem {id, kind, title, text | imageDataUrl, tokens}` shown as removable chips above the composer.

- **Files**: text/code read as UTF-8; PDF via `pdfjs-dist`; DOCX via `mammoth`; images kept as data URLs for
  vision models (non-vision models get a "[image omitted]" note). Per-file and total size caps.
- **Folders**: browser `webkitdirectory`; client applies `.gitignore`-style ignore list (node_modules, .git,
  binaries, lockfiles) before upload.
- **GitHub**: `owner/repo[@ref][/path]` → GitHub tarball/trees API (optional `GITHUB_TOKEN`), same filters; shows a
  file tree to tick files before import.
- **YouTube**: extract video id → fetch captions track (timedtext) server-side; fallback message if none.
- **Transcribe**: record (MediaRecorder) or upload audio → OpenAI `whisper-1`/`gpt-4o-transcribe` or HF ASR model.
  Hidden/disabled when neither key is set (mirrors the 🔒 state).

---

## 7. Roles & Rapid Roleplay

- Store shape: `roles = {systemPrompt, slots: {[slotId]: {customName, prompt}}, showModelNames}`. Modal edits a
  draft copy; Save & Close commits; Clear All resets the draft.
- **Rapid Roleplay**: POST `{scenario, slotCount, allowOverwrite}` to `/api/roleplay`; server calls a configurable
  "utility model" with a JSON-schema'd prompt (zod-validated, one repair retry) returning
  `{characters:[{name, prompt, suggestedModel?}], sharedSystemPrompt?}`. If overwrite is allowed it may change the
  slot count/models; otherwise it fills existing slots only.
- Preset library (JSON in repo) of saved role setups, user-addable.

---

## 8. UI details

- Slot colours from a fixed palette; message cards tinted by slot colour; custom name with optional model
  name underneath; per-message footer: model, tokens, latency, cost (OpenRouter pricing when known), copy, regenerate.
- Markdown + code highlighting (`react-markdown`, `rehype-highlight`), KaTeX optional.
- Original animated background (canvas, low-CPU, respects `prefers-reduced-motion`, toggle in settings).
- Keyboard: Enter send, Shift+Enter newline, Esc stop.
- Autosave current session to localStorage (fast) and server SQLite (durable); Save/Load = JSON file export/import
  with a `version` field for migrations.

---

## 9. Milestones

| # | Deliverable | Done when |
|---|---|---|
| M0 | Monorepo scaffold, lint/format/typecheck, CI (GitHub Actions), mock provider, `.env.example` | `pnpm dev` shows empty shell; CI green |
| M1 | Provider layer (4 + custom) + `/api/models` + `/api/chat/stream` | Can stream from each provider via curl |
| M2 | Slot bar, model picker, group chat (parallel), transcript rendering, stop | 3 models chat together in the UI |
| M3 | `buildMessages` + Roles modal (system / names / slot prompts) | Unit tests on prompt building; prompts visibly honoured |
| M4 | Sessions: SQLite, autosave, Save/Load JSON, Clear/Restore, Hide, history | Reload keeps state; export→import round-trips |
| M5 | Modes: sequential, DM, Leader, Fusion, Self-Chat, Regenerate, concise/casual | Each mode has an e2e test against mock provider |
| M6 | Context: files, folders, GitHub, YouTube, Transcribe; web-search toggle | Chips + token counts; models cite injected content |
| M7 | Rapid Roleplay + presets; Imagine (image gen) | Scenario → populated roles in one click |
| M8 | Polish: cost/usage display, background, a11y, mobile layout, Docker, README | `docker compose up` works from clean clone |

**Testing:** Vitest for `packages/shared` (prompt building, role mapping, truncation, Anthropic alternation),
provider adapters against recorded fixtures (`msw`), and Playwright e2e against the mock provider.

---

## 10. Open questions

1. **Ambiguous controls** — please confirm what these do on the original: `-`, **Imagine** (image gen vs. brainstorming),
   the **emoji** button, `M`, the speech-bubble icon, and the `↑` beside Leader.
2. Single-user localhost only, or multi-user with login (affects key storage and DB schema)?
3. Should DM'd messages be visible to the other models afterwards?
4. Preferred default "utility model" for Rapid Roleplay / Fusion when the user hasn't picked one?
5. Is a desktop wrapper (Tauri/Electron) wanted later, or browser + Docker is enough?
