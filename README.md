# Hub News Backend

TypeScript Express backend for collecting news from dynamic sources, storing it in Supabase Postgres or local JSON storage, and filtering article/topic matches with an LLM. It can run locally as an Express server and deploy to Vercel as serverless API routes.

## Setup

```sh
npm install
cp .env.example .env
# Apply supabase/schema.sql in Supabase SQL Editor or with the Supabase CLI.
npm run seed
npm run dev
```

The API starts on `http://localhost:4000` by default.

On Vercel, routes are served under `/api`, for example `/api/health` and `/api/sources`.
The read-only admin UI is served at `/admin`.

For quick local demos without Supabase credentials, set `STORAGE_DRIVER=json`. Data is stored in `data/hubnews.local.json`.

The local dev server runs TypeScript directly with `tsx`. Production builds compile to `dist/`:

```sh
npm run build
npm start
```

## Supabase Setup

1. Create a Supabase project.
2. Run [supabase/schema.sql](/Users/maros/hubnews/supabase/schema.sql) in the Supabase SQL editor.
3. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env` for local development.
4. Add the same values as Vercel environment variables for deployment.
5. Run `npm run seed` once to insert the starter sources.

## Data Model

- `sources`: dynamic list of news websites with homepage URL, optional discovered feed URL, scrape interval, language/country, and scrape status.
- `articles`: normalized article/headline records with source, headline, context/snippet, canonical URL, date, topics JSON, raw source payload, and internal-only extracted article content fields.
- `topics`: user-defined topics that can later drive the LLM headline checks.
- `article_topic_evaluations`: stored results of headline/topic filtering, including status, confidence, reason, model, and raw response.
- `source_checks`: aggregation run logs for observability, including direct scrape counts, Firecrawl call counts, and robots.txt warning telemetry.

## LLM Filtering

Set `OPENAI_API_KEY` to use direct OpenAI headline/topic filtering. Optional settings:

- `OPENAI_FILTER_MODEL`, default `gpt-4.1-mini`
- `OPENAI_RESPONSES_API_URL`, default `https://api.openai.com/v1/responses`

`POST /topics/:id/evaluate` classifies unevaluated articles for a topic and stores results in `article_topic_evaluations`. If `LLM_FILTER_URL` is set, the backend uses that external webhook instead of direct OpenAI. If neither OpenAI nor `LLM_FILTER_URL` is configured, it falls back to keyword matching.

## Main Endpoints

- `GET /health`
- `GET /admin` read-only Basic-Auth admin UI
- `GET /admin/api/articles` authenticated admin article list
- `GET /admin/api/sources` authenticated admin source list
- `GET /admin/api/topics` authenticated admin topic list
- `GET /sources`
- `POST /sources`
- `PATCH /sources/:id`
- `DELETE /sources/:id` disables a source
- `POST /sources/:id/check` runs aggregation for one source
- `POST /aggregation/run` runs a bounded aggregation batch; pass `{ "force": true, "limit": 2 }` for a manual local smoke test
- `GET /cron/aggregate` Vercel Cron entrypoint for due-source aggregation
- `GET /articles`
- `GET /articles/:id`
- `GET /topics`
- `POST /topics`
- `POST /topics/:id/evaluate` evaluates recent unevaluated headlines for a topic
- `GET /topics/:id/articles` returns articles with stored evaluations for that topic

For Vercel, prefix these with `/api`.

## Vercel Setup

- Deploy the repo to Vercel.
- Add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_USER`, `ADMIN_PASSWORD`, and optionally `CRON_SECRET` and `FIRECRAWL_API_KEY`.
- [vercel.json](/Users/maros/hubnews/vercel.json) schedules `/api/cron/aggregate` every 15 minutes.
- Vercel Cron sends a `GET` request. If `CRON_SECRET` is set, the endpoint expects `Authorization: Bearer <CRON_SECRET>`.
- `/admin` is rewritten to `/api/admin` on Vercel and remains Basic-Auth protected.

## Aggregation Strategy

The checker runs in bounded batches. It first tries RSS/Atom/JSON feeds, then direct homepage/listing scraping, then Firecrawl as a fallback if direct scraping fails or produces too few results. Newly discovered articles are upserted idempotently by source and canonical URL.

For newly inserted or pending articles, the checker attempts internal article-content extraction. Direct HTML extraction runs first; Firecrawl is used only as a fallback when configured. Extracted full text is stored internally and is intentionally not returned by article APIs or the admin UI.

Robots.txt is checked before homepage, feed, article, and Firecrawl fetches. The current policy is warn-only telemetry: disallowed URLs are logged to `source_checks`, but scraping continues.

Keep a conservative user agent and respect each site's terms. Some sources may block automated requests, require subscriptions, or expose only limited public metadata. The implementation does not bypass paywalls, logins, or cookie-gated content.

## Admin UI

Set `ADMIN_USER` and `ADMIN_PASSWORD` before opening `/admin`. If either value is unset, admin routes return `401`.

The admin UI supports filtering by search text, source, topic, evaluation status, date range, and page size. It displays headline, source, date, snippet, evaluation status/reason, and outbound link only.

## Seed Sources

Run `npm run seed` to add:

- Gazeta Wyborcza
- Rzeczpospolita
- TVN24
- TVP
- BBC News
- The Guardian
- The Times
- Financial Times
- Daily Mail
- Reuters
- Press Association
- PAP
