# Agora — Implementation Plan

A self-hostable, open-source multi-model group chat inspired by the functionality of lmcouncil.ai
(as seen in reference screenshots). Agora reproduces the _features_; its UI, branding, and assets are original work.

**Deployment target:** single user, self-hosted via Docker on a home LAN, used from any device on that network
(desktop, laptop, phone, tablet) in the browser.

Providers at launch: **OpenRouter, Anthropic, OpenAI, Hugging Face** (plus an optional OpenAI-compatible
"custom endpoint" so Ollama / LM Studio / vLLM work for free).

---

## 1. Feature inventory (from screenshots + owner's clarifications)

| Area        | Element                           | Behaviour in Agora                                                                                                                                                                      |
| ----------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header      | Title + ▾                         | Session switcher (new / rename / delete / list of saved sessions)                                                                                                                       |
|             | Hide                              | Collapse the model-slot bar to give the chat more room                                                                                                                                  |
|             | Save / Load                       | Export / import a session (config + transcript + context) as a JSON file                                                                                                                |
|             | `M`                               | **Global settings**: API keys per provider, username, custom endpoint URL, defaults (Self-Chat rounds, DM visibility default), theme                                                    |
| Slot bar    | Coloured slot cards (1…N)         | Each slot = one model instance with colour, display name, model id; `×` removes it                                                                                                      |
|             | Empty slot `4 +`                  | Opens model picker (searchable, grouped by provider, shows context length / price where known)                                                                                          |
|             | `+` (left)                        | Add another slot (soft cap, e.g. 8)                                                                                                                                                     |
|             | Roles                             | Opens the Roles modal (below)                                                                                                                                                           |
|             | Restore / Clear                   | Clear transcript; Restore undoes the last Clear (keep one snapshot)                                                                                                                     |
| Roles modal | Rapid Roleplay                    | Free-text scenario → **slot 1's model** generates N characters (name + per-slot prompt, optionally model count). Checkbox "allow overwrite of selection/number of models"               |
|             | System Prompt                     | Global prompt sent to every model                                                                                                                                                       |
|             | Custom Names                      | Per-slot display name + "show model names underneath" toggle                                                                                                                            |
|             | Slot Prompts                      | Per-slot prompt appended after the global prompt                                                                                                                                        |
|             | Clear All / Cancel / Save & Close | Draft state in modal, committed only on Save                                                                                                                                            |
| Composer    | Text box, Send                    | Group message to all active slots                                                                                                                                                       |
|             | Attach ▸ Files                    | Text/code/PDF/images → shared context (images go to vision-capable models)                                                                                                              |
|             | Attach ▸ Folders                  | Directory upload (`webkitdirectory`), ignore-list + size cap                                                                                                                            |
|             | Attach ▸ GitHub                   | Import a public (or token-authed) repo / path / branch as context                                                                                                                       |
|             | Attach ▸ Transcribe               | Audio → text via Whisper (OpenAI) or HF ASR model                                                                                                                                       |
|             | Attach ▸ YouTube                  | Fetch transcript of a video URL into context                                                                                                                                            |
|             | GitHub icon                       | Link to the Agora repo                                                                                                                                                                  |
|             | Clock icon                        | Unknown on the original (shown disabled) — omitted for now                                                                                                                              |
|             | Speech bubble                     | **Past chats**: list / search / open / delete saved sessions                                                                                                                            |
|             | Globe                             | Web search toggle                                                                                                                                                                       |
|             | Refresh                           | Regenerate last round                                                                                                                                                                   |
|             | DM target                         | Send to one slot only, with **Visible / Private** toggle (see §5)                                                                                                                       |
| Modes row   | `-` / `+`                         | **Pure UI**: collapses the mode buttons (Fusion, Imagine, Leader, Emoji, Self-Chat) into itself and becomes `+`; `+` expands them again. State remembered per device. No effect on chat |
|             | Fusion                            | After all models answer, **slot 1's model** merges answers into one synthesis                                                                                                           |
|             | Imagine                           | Image generation — **deferred** (button hidden until implemented)                                                                                                                       |
|             | Leader ♛                          | Leader mode on/off: others answer first, the leader sees their answers and gives the final answer                                                                                       |
|             | `↑` beside Leader                 | **Chooses which slot is the leader** (popover listing slots, leader slot gets a crown badge)                                                                                            |
|             | Emoji                             | **Emoji picker** that inserts emojis into the composer message                                                                                                                          |
|             | Self-Chat!                        | Models converse among themselves for K rounds without user input; Stop button                                                                                                           |

---

## 2. Architecture

```
┌──────── any browser on the LAN (desktop / phone / tablet) ────────┐
│ React + TS + Vite + Tailwind + Zustand                              │
│  SlotBar · RolesModal · Transcript · Composer · Settings · History  │
│  REST for commands  +  SSE subscription to the session's live feed  │
└──────────────────────────────────┬──────────────────────────────────┘
                                   ▼
┌──────────────────────── server (Node 22, Hono) ─────────────────────┐
│ Orchestrator  runs rounds/modes server-side, persists every token    │
│               batch to SQLite, fans events out to all subscribers    │
│ /api/sessions          CRUD, list (past chats), export/import        │
│ /api/sessions/:id/send send / DM / regenerate / self-chat / stop     │
│ /api/sessions/:id/events  SSE live feed (resumable via Last-Event-ID)│
│ /api/models            unified model catalogue (cached)              │
│ /api/roleplay          scenario → JSON character profiles            │
│ /api/context/*         github · youtube · transcribe · files         │
│ /api/settings          keys (write-only from UI), username, defaults │
│ providers/  openaiCompat.ts (OpenAI, OpenRouter, HF, custom)         │
│             anthropic.ts                                             │
└──────────────────────────────────────────────────────────────────────┘
```

### Why orchestration runs on the server

Because you'll use Agora from several devices, the server — not a browser tab — owns each run:

- A Self-Chat or long Fusion keeps going if your phone locks its screen or you close the tab.
- Start a chat on the desktop, open it on the phone, and watch the same tokens stream live.
- SQLite is the single source of truth; nothing important lives in one device's `localStorage`
  (only per-device UI prefs like the collapsed modes row or hidden slot bar).
- Concurrent edits from two devices: commands are serialised per session; config writes use an
  `updatedAt` check and the UI refreshes on conflict.

### Stack

pnpm workspace monorepo — `apps/web` (Vite/React), `apps/server` (Hono on Node), `packages/shared`
(types, zod schemas, prompt builder). SQLite via Node's built-in `node:sqlite` (no native module to compile, so the
server bundles to a single file and the Docker image needs only Node). In production the server also serves the built
SPA, so there is one container and one port.

### Repo layout

```
apps/web/src/{components,stores,api,lib}
apps/server/src/{routes,orchestrator,providers,context,db}
packages/shared/src/{types.ts,schemas.ts,buildMessages.ts,modes.ts}
docs/PLAN.md  .env.example  Dockerfile  compose.yaml
```

### LAN deployment & security

- `compose.yaml`: one service, `HOST=0.0.0.0`, `PORT=8080`, named volume `agora-data:/data` (SQLite + uploads),
  `restart: unless-stopped`. Reach it at `http://<server-ip>:8080` (or a hostname via your router/mDNS).
- **API keys stay on the server.** The settings UI can set/replace keys but never reads them back (shows `sk-…a1b2`).
  Keys entered in the UI are stored in SQLite; `.env` values take precedence if set.
- **Optional access password** (`AGORA_PASSWORD`): anyone on your Wi-Fi could otherwise spend your API credits.
  Single shared password → signed HTTP-only session cookie, long-lived per device. Off by default; strongly
  suggested if guests use your network.
- **HTTPS caveat:** browsers only allow microphone recording in a secure context. Over plain `http://<lan-ip>`,
  _Transcribe_ falls back to uploading an audio file from other devices (recording still works on `localhost`).
  An optional `compose.https.yaml` adds Caddy with an internal CA for those who want in-browser recording everywhere.
- Mobile-first responsive layout and a PWA manifest (add-to-home-screen on phones).

---

## 3. Provider layer

```ts
interface Provider {
  id: 'openai' | 'anthropic' | 'openrouter' | 'huggingface' | 'custom';
  listModels(): Promise<ModelInfo[]>; // id, label, ctx, vision, pricing?
  stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>; // delta | usage | error | done
}
```

| Provider     | Transport                                                                       | Notes                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| OpenAI       | `openai` SDK, Chat Completions                                                  | `/v1/models` is unannotated → keep a small local capability map                                                                                  |
| OpenRouter   | OpenAI-compatible, `baseURL=https://openrouter.ai/api/v1`                       | Rich `/models` (ctx, pricing, modalities); `HTTP-Referer`/`X-Title` headers; web search via `plugins:[{id:'web'}]`                               |
| Hugging Face | OpenAI-compatible Inference Providers router `https://router.huggingface.co/v1` | Model list from router `/v1/models`; ASR for Transcribe                                                                                          |
| Anthropic    | `@anthropic-ai/sdk` Messages API, streaming                                     | `system` is a top-level param; strict user/assistant alternation (merge adjacent same-role turns); native web-search tool; required `max_tokens` |
| Custom       | OpenAI-compatible with user base URL                                            | Ollama, LM Studio, vLLM, llama.cpp                                                                                                               |

Three of four providers share one `openaiCompat` adapter parameterised by base URL + headers. Model ids are
namespaced `provider/model`. Catalogues are cached (memory + SQLite, 6 h TTL) and only listed for providers whose
key is configured. A **mock provider** (`MOCK_PROVIDER=1`) streams canned text so the UI and tests work with no keys.

---

## 4. The core: shared-transcript prompting

One transcript is shared by all slots. Each message:
`{id, author: 'user' | slotId, text, attachments?, mode?, round, model?, usage?, audience: 'all' | slotId}`.

`buildMessages(slot, transcript, config)` (in `packages/shared`, heavily unit-tested) produces the per-slot request:

1. **System** = global system prompt + slot prompt + an auto-generated _roster block_:
   "You are **{name}** in a group chat with **{username}** (the human) and: {other names}. Messages from others are
   prefixed `[Name]:`. Reply only as yourself; do not write other participants' lines." + mode instructions (leader…).
   `{username}` comes from global settings (default "User").
2. **Shared context** (attachments) injected once, as a leading user block with clear `<file path=…>` delimiters
   (Anthropic gets prompt-caching `cache_control` on it).
3. **History** — filtered by audience first (see §5 private DMs): the slot's own past messages → `assistant`;
   the user's and other slots' messages → `user`, prefixed with `[Name]:`. Adjacent `user` items are merged
   (required by Anthropic, harmless elsewhere).
4. **Truncation**: estimate tokens against the slot's context window; drop oldest rounds first, never the
   system/context block; show a "context trimmed" chip in the UI.
5. Strip a model's accidental `[OtherName]:` impersonation lines on output (configurable).

---

## 5. Orchestration modes (server-side)

All runs go through one `runRound(plan)` helper: a list of _steps_, each step = set of slots run in parallel, each
step seeing everything produced by earlier steps. Every slot call has its own `AbortController`; Stop aborts the
session's whole run. Tokens are batched (~50 ms) into SQLite and pushed to SSE subscribers.

| Mode                 | Steps                                                                                                                                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Group (default)      | `[[all slots]]` — parallel, each sees transcript up to the user message                                                                                                                                                    |
| Sequential (setting) | `[[s1],[s2],…]` — each sees prior answers this round                                                                                                                                                                       |
| DM                   | `[[target slot]]` — see below                                                                                                                                                                                              |
| Leader               | `[[non-leaders],[leader]]` + leader gets a "consider the others' answers and give the final answer" instruction. Leader chosen via the `↑` picker; defaults to slot 1; if the leader slot is removed, falls back to slot 1 |
| Fusion               | `[[all slots],[slot 1]]` — slot 1's model receives all answers and emits a merged answer, rendered as a distinct "Fusion" card                                                                                             |
| Self-Chat            | Repeat `[[s1],[s2],…]` for K rounds (default 6, set in Settings) or until Stop; optional seed topic from composer                                                                                                          |
| Regenerate           | Re-run the last round's plan, replacing those messages (previous versions kept as swipeable variants)                                                                                                                      |

### Private messages (DMs)

Composer has a DM target selector (`All` or a slot) and, when a slot is chosen, a **Visible / Private** toggle
(default set in Settings).

- **Visible DM**: `audience: 'all'`. Only the target slot responds, but the user message and reply join the shared
  transcript and every model sees them later (tagged "addressed to {name}").
- **Private DM**: `audience: <slotId>` on both the user message and the target's reply. `buildMessages` excludes
  them for every other slot. For the target slot they are wrapped as
  `[Private message from {username} — the other participants cannot see this]`, and the target's system prompt
  reminds it not to reveal private content unless the user asks.
- UI: private messages render with a lock icon and a dashed border in the target's colour, labelled
  "Private · {name}". Fusion/Leader/Self-Chat follow the same filter, so private content never leaks into other
  slots' prompts — including slot 1 when it acts as fuser (it only sees private messages that were addressed to it).

Failures are per-slot: an errored card shows the provider error + Retry, without blocking others.

---

## 6. Context ingestion (`/api/context/*`)

All produce `ContextItem {id, kind, title, text | imageRef, tokens}` shown as removable chips above the composer and
stored with the session (files under `/data/uploads`).

- **Files**: text/code read as UTF-8; PDF via `pdfjs-dist`; DOCX via `mammoth`; images stored and sent to
  vision-capable models (others get an "[image omitted]" note). Per-file and total size caps.
- **Folders**: browser `webkitdirectory` (desktop browsers; hidden on mobile where unsupported); client applies a
  `.gitignore`-style ignore list (node_modules, .git, binaries, lockfiles) before upload.
- **GitHub**: `owner/repo[@ref][/path]` → GitHub tarball/trees API (optional `GITHUB_TOKEN` in Settings), same
  filters; file tree with checkboxes before import.
- **YouTube**: extract video id → fetch captions track server-side; clear message if none exist.
- **Transcribe**: record (MediaRecorder; secure contexts only, see §2) or upload audio → OpenAI transcription or an
  HF ASR model. Shown locked when neither key is set.

---

## 7. Roles & Rapid Roleplay

- Store shape: `roles = {systemPrompt, slots: {[slotId]: {customName, prompt}}, showModelNames}`. Modal edits a
  draft copy; Save & Close commits; Clear All resets the draft.
- **Rapid Roleplay**: POST `{scenario, slotCount, allowOverwrite}` to `/api/roleplay`; the server calls **slot 1's
  model** with a schema-constrained prompt (zod-validated, one repair retry) returning
  `{characters:[{name, prompt}], sharedSystemPrompt?, slotCount?}`. If overwrite is allowed it may change the slot
  count (new slots copy slot 1's model); otherwise it fills existing slots only. Disabled with a hint if slot 1 is empty.
- Preset library of saved role setups, user-addable.

---

## 8. UI details

- Slot colours from a fixed palette; message cards tinted by slot colour; custom name with optional model
  name underneath; per-message footer: model, tokens, latency, cost (when pricing known), copy, regenerate.
- Markdown + code highlighting (`react-markdown`, `rehype-highlight`).
- Emoji picker (`emoji-mart` or a lightweight equivalent) inserting at the composer caret.
- Collapsible modes row (`-`/`+`), Hide slot bar — both per-device UI prefs in `localStorage`.
- Original animated background (canvas, low-CPU, respects `prefers-reduced-motion`, toggle in settings).
- Keyboard: Enter send, Shift+Enter newline, Esc stop. Touch-friendly targets on mobile.
- Save/Load = JSON file export/import with a `version` field for migrations; Load creates a new session.

---

## 9. Milestones

| #     | Deliverable                                                                                       | Done when                                                                             |
| ----- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| M0    | Monorepo scaffold, lint/format/typecheck, CI, mock provider, `.env.example`, Dockerfile + compose | `docker compose up` serves an empty shell reachable from another LAN device; CI green |
| M1    | Provider layer (4 + custom), Settings (`M`: keys, username), `/api/models`                        | Keys entered in UI; model picker lists real models                                    |
| M2    | Sessions in SQLite, server orchestrator, SSE feed, slot bar, group chat, stop                     | 3 models chat together; a second device sees the same stream live                     |
| M3    | `buildMessages` + Roles modal (system / names / slot prompts)                                     | Unit tests on prompt building; prompts visibly honoured                               |
| M4    | Past chats (speech bubble), session switcher, Save/Load JSON, Clear/Restore, Hide, mobile layout  | Export→import round-trips; usable on a phone                                          |
| M5    | Modes: Leader + picker, Fusion, Self-Chat, Regenerate, DMs (visible/private), sequential          | Each mode has an e2e test; private-DM leak test passes                                |
| M6    | Context: files, folders, GitHub, YouTube, Transcribe; web-search toggle                           | Chips + token counts; models use injected content                                     |
| M7    | Rapid Roleplay + presets; emoji picker; collapsible modes row                                     | Scenario → populated roles in one click                                               |
| M8    | Polish: optional password, PWA, cost display, background, a11y, optional HTTPS compose, README    | Clean-clone install works following README only                                       |
| Later | Imagine (image generation)                                                                        | —                                                                                     |

**Status:** M0–M6 implemented (Rapid Roleplay, originally a Roles tab, stays in M7). Also done early: the session
switcher, Hide, and adding models by ID. Docker build and live provider calls have been verified on a real LAN
host.

**Testing:** Vitest for `packages/shared` (prompt building, role mapping, audience filtering, truncation, Anthropic
alternation), provider adapters against recorded fixtures (`msw`), orchestrator tests with the mock provider, and
Playwright e2e (desktop + mobile viewport) against the mock provider. A dedicated test asserts private DM text never
appears in any other slot's outgoing request across every mode.

---

## 10. Decisions log

| Question                      | Decision                                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `-` button                    | UI-only collapse/expand of the modes row                                                                                      |
| Imagine                       | Image generation; deferred                                                                                                    |
| Emoji                         | Emoji picker inserting into the message                                                                                       |
| `M`                           | Global settings: API keys, username                                                                                           |
| Speech bubble                 | Past chats                                                                                                                    |
| `↑` beside Leader             | Picks the leader slot                                                                                                         |
| Users                         | Single user, private; optional shared password because it's on a LAN                                                          |
| DM visibility                 | Per-message Visible/Private toggle; private messages and their replies exist only in the target's context, flagged as private |
| Rapid Roleplay / Fusion model | Slot 1's model                                                                                                                |
| Distribution                  | Browser + Docker, LAN-accessible from all devices                                                                             |

### Remaining minor assumptions (change if you disagree)

- A private DM's **reply** is also private (only the user and that model see it).
- The clock icon is omitted until its purpose is known.
