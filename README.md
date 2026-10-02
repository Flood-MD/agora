# Agora

An open-source, self-hosted group chat with several AI models at once — inspired by lmcouncil.ai.
Every model sees the shared conversation (including the other models' replies), each slot can have its own
name and prompt, and the server runs the conversation so every device on your network sees it live.

Providers: **OpenRouter, Anthropic, OpenAI, Hugging Face**, plus any OpenAI-compatible server
(Ollama, LM Studio, vLLM…).

> Status: early. Group chat, model picker (including models added by ID), Roles (system prompt, custom names,
> slot prompts), settings, past chats with search, Save/Load to a file, Clear/Restore, live multi-device sync,
> the conversation modes (Leader, Fusion, Self-Chat, Regenerate, visible or private messages to one model),
> attachments (files, folders, GitHub, YouTube, transcription), web search, Rapid Roleplay with saved role
> setups, and an emoji picker work. Polish (optional password, PWA, cost display) is next — see
> [docs/PLAN.md](docs/PLAN.md).

## Run it on your LAN with Docker

```sh
git clone https://github.com/flood-md/agora.git
cd agora
cp .env.example .env        # optional: put API keys here, or add them later in the app
docker compose up -d --build
```

Open `http://<this machine's IP>:8080` from any device on your network (the container logs the address too:
`docker compose logs agora`). Click the round initial button at the top right to set your name and API keys.

- Data (chats, settings, keys entered in the app) lives in the `agora-data` Docker volume.
- Change the port with `AGORA_PORT=9000 docker compose up -d`.
- Keys in `.env` take precedence over keys entered in the app. Keys are never sent to the browser.
- There is no login yet: anyone who can reach the port can use your keys. Keep it on a trusted network
  (an optional password is planned).

## Develop

Requires Node 22.13+ and pnpm (`corepack enable`).

```sh
pnpm install
pnpm dev:mock     # server on :8080 + Vite on :5173, with offline "Mock" models — no keys needed
pnpm dev          # same, with only the providers you've configured
```

Open `http://localhost:5173` (or `http://<your IP>:5173` from your phone).

| Command                        | What it does                                            |
| ------------------------------ | ------------------------------------------------------- |
| `pnpm test`                    | Unit and API tests (Vitest)                             |
| `pnpm build && pnpm e2e`       | Browser tests against the production build (Playwright) |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript                                     |
| `pnpm format`                  | Prettier                                                |
| `pnpm build && pnpm start`     | Production server serving the built UI on :8080         |

### Layout

```
apps/server      Hono API: providers, server-side orchestration, SQLite, SSE live feed
apps/web         React + Tailwind UI
packages/shared  Types, request schemas, and the per-model prompt builder
e2e              Playwright tests (run against the mock provider)
docs/PLAN.md     Feature inventory, architecture, and milestones
```

### How a group message works

1. `POST /api/sessions/:id/messages` stores your message and starts a round on the server.
2. For each slot, `buildMessages` turns the shared transcript into that model's view: its own replies become
   `assistant` turns, everyone else's become `user` turns prefixed with `[Name]:`, and a system prompt tells it who
   is in the room.
3. All slots stream in parallel; tokens are saved to SQLite and pushed to every device subscribed to
   `GET /api/sessions/:id/events` (Server-Sent Events, which start with a full snapshot so reconnects resync).

## License

GPL-3.0 — see [LICENSE](LICENSE).
