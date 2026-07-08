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
npm install
npm start
```

Open http://localhost:3001

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
