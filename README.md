# ModelCompare

AI Model Comparison Dashboard — discover, compare, and test AI models side-by-side.

## Features

- **Model Library** — Browse and search models with specs, benchmarks, and capability scores
- **Side-by-Side Comparison** — Compare models on metrics, features, and pricing
- **Prompt Testing** — Test prompts against multiple models via OpenRouter (with streaming)
- **Model Discovery** — Discover models from Hugging Face and OpenRouter
- **Live Pricing** — Fetch real-time pricing from OpenRouter
- **Benchmark Sync** — Auto-import benchmark data from curated sources and Hugging Face
- **Leaderboard** — Weighted ranking with custom sort
- **Cost Optimizer** — Find the most cost-effective model for your task
- **Usage Analytics** — Track token usage, cost, and latency
- **Change Tracking** — Automatic snapshots and change alerts every 6 hours

## Quick Start

```bash
npm install     # installs deps + builds React client
npm run dev     # start server (client must already be built)
npm start       # build client then start server (production)
```

Open http://localhost:3001

> `npm run dev` skips the client rebuild for faster iteration during development.
> Run `npm run build:client` manually after pulling upstream changes to the React app.

## Configuration

Copy `.env.example` to `.env` and edit:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3001` | Server port |
| `API_KEY` | **For production** | unset | Shared secret for write access. **Must be set when deploying publicly.** When unset, all endpoints are open (suitable for local/personal use only). |
| `ALLOWED_ORIGINS` | **For production** | `http://localhost:3001,http://localhost:5173` | Comma-separated CORS origins. In production, set to your frontend domain(s). If empty in production, CORS falls back to open (not recommended). |
| `OPENROUTER_API_KEY` | No | unset | Default key for prompt testing. Users can also bring their own via `x-openrouter-key` header. |

> **⚠️ Production warning:** Auth is **opt-in**. Without `API_KEY`, any write endpoint (`POST/PUT/DELETE /api/models`, `/api/settings`, `/api/snapshot`) is open to anyone who can reach the server. Always set `API_KEY` and `ALLOWED_ORIGINS` when deploying publicly.

## Deploy

| Platform | Config | Notes |
|----------|--------|-------|
| Render | `render.yaml` | Free tier, auto-syncs |
| Fly.io | `fly.toml` + `Dockerfile` | Requires billing |

## Tech Stack

- **Backend:** Node.js, Express
- **Database:** SQLite (better-sqlite3)
- **Frontend:** React, TypeScript, Chart.js

## Project Structure

```
├── server.js            Express API server
├── db.js                SQLite database layer
├── routes/
│   ├── auth.js          Auth middleware (API_KEY, CSRF)
│   ├── models.js        Model CRUD with express-validator
│   ├── prompts.js       Prompt testing via OpenRouter
│   ├── analytics.js     Usage stats and web search
│   ├── discovery.js     Model discovery (HF, OpenRouter)
│   ├── settings.js      App settings with validation
│   ├── benchmarks.js    Benchmark sync (curated, HF)
│   └── utils.js         Shared helpers (pricing, search)
├── client/              React SPA (canonical frontend)
├── tests/               Test suite (Mocha + Supertest)
├── .env.example         Environment variable docs
├── render.yaml          Render deployment config
├── fly.toml             Fly.io deployment config
└── Dockerfile           Container build
```

## API Reference

### Models

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/models` | GET | List models. Supports pagination, search, and sorting (see query params below). |
| `/api/models/:id` | GET | Get a single model by ID. |
| `/api/providers` | GET | List unique model providers (sorted alphabetically). |
| `/api/models/export` | GET | Export all models as JSON or CSV (`?format=csv`). |
| `/api/models` | POST | Create a new model (requires auth if `API_KEY` is set). |
| `/api/models/:id` | PUT | Update a model (requires auth if `API_KEY` is set). |
| `/api/models/:id` | DELETE | Delete a model (requires auth if `API_KEY` is set). |

**`GET /api/models` query params:**

| Param | Type | Example | Description |
|-------|------|---------|-------------|
| `q` | string | `?q=llama` | Search by name, ID, description, and tags (case-insensitive substring). |
| `provider` | string | `?provider=OpenAI` | Filter by provider name (case-insensitive substring). |
| `tag` | string | `?tag=coding` | Filter by exact tag match. |
| `sort` | string | `?sort=-arenaElo` | Sort field. Prefix `-` for descending. Supported: `name`, `arenaElo`, `inputPrice`, `outputPrice`, `speed`, `contextWindow`. |
| `limit` | number | `?limit=50` | Max results (capped at 1000). |
| `offset` | number | `?offset=50` | Skip N results (for pagination). |

### Prompt Testing

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/test-prompt` | POST | Test a prompt against one or more models via OpenRouter. |
| `/api/test-prompt-stream` | POST | Streamed version — returns SSE with chunks. |

**Request body:**

```json
{
  "models": ["model-id-1", "model-id-2"],
  "prompt": "Hello, world!",
  "systemPrompt": "You are helpful",
  "maxTokens": 1024,
  "temperature": 0.7,
  "webSearch": true
}
```

### Usage & Analytics

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/usage/stats` | GET | Aggregated usage stats (`?days=7`). |
| `/api/usage/history` | GET | Raw usage log entries (`?days=30`). |

### Discovery & Pricing

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/discover` | GET | Discover models from HuggingFace and OpenRouter (`?source=hf&limit=50`). |
| `/api/live-pricing` | GET | Fetch live pricing from OpenRouter (`?force=true`). |

### Benchmarks

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/refresh` | GET | Sync benchmark data from the curated set onto all models. |
| `/api/benchmarks/sync` | GET | Deep sync: curated benchmarks + HuggingFace leaderboard results. |

### Changes & Snapshots

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/changes` | GET | All model changes since the last snapshot. |
| `/api/snapshot` | POST | Trigger a manual snapshot of all models (requires auth). |
| `/api/events` | GET | SSE stream — receives a `change` event when significant model changes are detected (30-min poll). |

### Settings

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/settings` | GET | Read all settings (OpenRouter API key, etc.). |
| `/api/settings/:key` | PUT | Update a setting by key (requires auth). |

### Other

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Server health check. |
| `/api/web-search` | POST | Search the web (Wikipedia). Body: `{ "query": "..." }`. |
| `/api/compare` | GET | Compare models by IDs (`?ids=id1,id2,id3`). |
| `/api/recommend` | GET | Recommend models for a task (`?task=coding`). |

### Rate Limiting

| Limit | Scope | Window |
|-------|-------|--------|
| 200 req/min | Read endpoints (GET) | 1 minute |
| 30 req/min | Write endpoints (POST/PUT/PATCH/DELETE) | 1 minute |

### Error Handling

All errors return JSON: `{ "error": "Description of what went wrong" }`.
Common status codes: `400` (validation), `401` (auth required), `404` (not found), `409` (duplicate), `429` (rate limited).
