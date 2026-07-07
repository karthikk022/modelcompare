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

## Deploy

| Platform | Config | Notes |
|----------|--------|-------|
| Render | `render.yaml` | Free tier, auto-syncs |
| Fly.io | `fly.toml` + `Dockerfile` | Requires billing |

## Tech Stack

- **Backend:** Node.js, Express
- **Database:** SQLite (better-sqlite3)
- **Frontend:** HTML, CSS, JavaScript, Chart.js
