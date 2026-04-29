# Swiftpay

Prototype fintech UI for advancing against pending App Store revenue. Stack: React 19, Vite 6, Tailwind (CDN), lucide-react, Recharts, and `@google/genai` for the dashboard advisor.

## Quick start

```bash
npm install
cp .env.example .env
# Set VITE_API_KEY in .env (Gemini API key from Google AI Studio)
npm run dev
```

- **Production build:** `npm run build`
- **Preview build:** `npm run preview`

The advisor calls **Gemini 2.5 Flash** in the browser. Treat API keys as sensitive; prefer a small backend proxy for real products.

## Revenue verification pipeline (backend)

Monorepo workspaces add `api/` (Fastify + Postgres + BullMQ), `worker/` (ingest jobs), and `packages/{core,policy}`.

- **Architecture:** [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Runbook / smoke tests:** [docs/PIPELINE.md](./docs/PIPELINE.md)

Quick start:

```bash
docker compose up -d
npm install
npm run build:packages
npm run dev:api    # terminal 1
npm run dev:worker # terminal 2
npm run dev        # terminal 3 — UI; paste pipeline JWT on the gate screen (see docs/PIPELINE.md)
```

## Repository

https://github.com/keithanp/SWIFTPAY
