# Swiftpay revenue verification pipeline

## Local stack

1. Start infra:

```bash
docker compose up -d
```

2. Install and build shared packages:

```bash
npm install
npm run build:packages
```

3. Run API + worker + Vite UI:

```bash
npm run dev:api
npm run dev:worker
npm run dev
```

Environment defaults target `localhost` Postgres/Redis from `docker-compose.yml`.

### Wire the website to the pipeline (local)

1. Create a developer + JWT using the smoke-test commands below.
2. Open the Vite app (default `http://localhost:5173`). On the **App Store Connect gate**, paste the JWT under **Pipeline API (dev)** and click **Save token**.
3. Click **Connect & Verify Revenue** — the dashboard auto-loads **`GET /v1/dashboard/summary`** when a token is saved.
4. Use **Sync from API** / **Run ingestion refresh** in the dashboard banner as needed.

### Important env vars

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres DSN |
| `REDIS_URL` | Redis for BullMQ |
| `JWT_SECRET` | Signs bearer tokens |
| `ENCRYPTION_KEY` | AES-GCM for ASC private keys at rest |
| `DATA_DIR` | Raw gzip storage root (default `./data`) |
| `APPLE_MOCK` | `true` (default) uses deterministic mock Apple payloads |

## Happy-path smoke test

```bash
curl -s -X POST http://localhost:4000/v1/developers -H "content-type: application/json" -d "{\"name\":\"Demo Dev\"}"
# save developerId + apiSecret

curl -s -X POST http://localhost:4000/v1/auth/token -H "content-type: application/json" \
  -d "{\"developerId\":\"<UUID>\",\"apiSecret\":\"sp_live_...\"}"

export TOKEN="<accessToken>"

curl -s -X POST http://localhost:4000/v1/verification/refresh -H "authorization: Bearer $TOKEN"

# wait a few seconds for worker

curl -s http://localhost:4000/v1/limits -H "authorization: Bearer $TOKEN" | jq .
curl -s http://localhost:4000/v1/verification/status -H "authorization: Bearer $TOKEN" | jq .
```

Optional (dev-only):

```bash
curl -s http://localhost:4000/v1/debug/raw-tree -H "authorization: Bearer $TOKEN" | jq .
```

## Runbook / common failures

| Symptom | Likely cause | Mitigation |
|---------|--------------|------------|
| API boot fails on `runMigrations` | Postgres not ready | `docker compose ps`, retry |
| `invalid_token` | Wrong `JWT_SECRET` between runs | fixed secret in `.env` |
| Jobs stuck `queued` | Worker not running / Redis down | start `npm run dev:worker` |
| `PARSE_FAILED:*` | Corrupt gzip / wrong TSV | inspect `data/raw/...`; fix parser version |
| `APPLE_MOCK=false` error | ASC downloader not implemented | keep mock `true` for now |

## Production notes (short)

- Store `DATA_DIR` equivalent in object storage (S3/GCS) with SSE-KMS.
- Run API + worker on separate autoscaling groups; pin DB migrations as release job.
- Use managed Postgres + Redis, nightly backups, PITR.
- Rotate `JWT_SECRET`, `ENCRYPTION_KEY` via secrets manager; re-encrypt credentials on rotation policy.
- Add dead-letter queue alerts for failed BullMQ jobs.
