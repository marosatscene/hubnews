create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as '
begin
  new.updated_at = now();
  return new;
end;
';

create table if not exists public.sources (
  id bigint generated always as identity primary key,
  name text not null,
  homepage_url text not null unique,
  feed_url text,
  language text,
  country text,
  enabled boolean not null default true,
  check_interval_minutes integer not null default 60 check (check_interval_minutes >= 5),
  scrape_config_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error text
);

create index if not exists idx_sources_enabled on public.sources(enabled);
create index if not exists idx_sources_last_checked_at on public.sources(last_checked_at);

drop trigger if exists set_sources_updated_at on public.sources;
create trigger set_sources_updated_at
before update on public.sources
for each row execute function public.set_updated_at();

create table if not exists public.articles (
  id bigint generated always as identity primary key,
  source_id bigint not null references public.sources(id) on delete cascade,
  headline text not null,
  headline_sk text,
  headline_en text,
  headline_language text,
  headline_translated_at timestamptz,
  headline_translation_model text,
  context text,
  url text not null,
  canonical_url text not null,
  published_at timestamptz,
  discovered_at timestamptz not null default now(),
  byline text,
  image_url text,
  language text,
  topics_json jsonb not null default '[]'::jsonb,
  raw_json jsonb not null default '{}'::jsonb,
  content_hash text not null,
  content_markdown text,
  content_text text,
  word_count integer,
  extraction_provider text check (
    extraction_provider is null or extraction_provider in ('direct', 'firecrawl')
  ),
  extraction_status text not null default 'pending' check (
    extraction_status in ('pending', 'extracted', 'failed', 'skipped')
  ),
  extraction_error text,
  extracted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, canonical_url)
);

alter table public.articles add column if not exists content_markdown text;
alter table public.articles add column if not exists headline_sk text;
alter table public.articles add column if not exists headline_en text;
alter table public.articles add column if not exists headline_language text;
alter table public.articles add column if not exists headline_translated_at timestamptz;
alter table public.articles add column if not exists headline_translation_model text;
alter table public.articles add column if not exists content_text text;
alter table public.articles add column if not exists word_count integer;
alter table public.articles add column if not exists extraction_provider text;
alter table public.articles add column if not exists extraction_status text not null default 'pending';
alter table public.articles add column if not exists extraction_error text;
alter table public.articles add column if not exists extracted_at timestamptz;

alter table public.articles
  drop constraint if exists articles_extraction_provider_check;

alter table public.articles
  add constraint articles_extraction_provider_check
  check (extraction_provider is null or extraction_provider in ('direct', 'firecrawl'));

alter table public.articles
  drop constraint if exists articles_extraction_status_check;

alter table public.articles
  add constraint articles_extraction_status_check
  check (extraction_status in ('pending', 'extracted', 'failed', 'skipped'));

create index if not exists idx_articles_source_id on public.articles(source_id);
create index if not exists idx_articles_published_at on public.articles(published_at);
create index if not exists idx_articles_discovered_at on public.articles(discovered_at);
create index if not exists idx_articles_content_hash on public.articles(content_hash);

drop trigger if exists set_articles_updated_at on public.articles;
create trigger set_articles_updated_at
before update on public.articles
for each row execute function public.set_updated_at();

create table if not exists public.topics (
  id bigint generated always as identity primary key,
  name text not null unique,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_topics_updated_at on public.topics;
create trigger set_topics_updated_at
before update on public.topics
for each row execute function public.set_updated_at();

create table if not exists public.article_topic_evaluations (
  id bigint generated always as identity primary key,
  article_id bigint not null references public.articles(id) on delete cascade,
  topic_id bigint not null references public.topics(id) on delete cascade,
  status text not null check (status in ('pending', 'matched', 'rejected')),
  confidence real check (confidence is null or (confidence >= 0 and confidence <= 1)),
  reason text,
  model text,
  raw_json jsonb not null default '{}'::jsonb,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (article_id, topic_id)
);

create index if not exists idx_article_topic_topic_status
  on public.article_topic_evaluations(topic_id, status);

drop trigger if exists set_article_topic_evaluations_updated_at on public.article_topic_evaluations;
create trigger set_article_topic_evaluations_updated_at
before update on public.article_topic_evaluations
for each row execute function public.set_updated_at();

create table if not exists public.source_checks (
  id bigint generated always as identity primary key,
  source_id bigint not null references public.sources(id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null check (status in ('running', 'success', 'failed')),
  feed_url text,
  items_found integer not null default 0,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  direct_scrape_count integer not null default 0,
  firecrawl_call_count integer not null default 0,
  robots_warning_count integer not null default 0,
  robots_warnings_json jsonb not null default '[]'::jsonb,
  error text
);

alter table public.source_checks add column if not exists direct_scrape_count integer not null default 0;
alter table public.source_checks add column if not exists firecrawl_call_count integer not null default 0;
alter table public.source_checks add column if not exists robots_warning_count integer not null default 0;
alter table public.source_checks add column if not exists robots_warnings_json jsonb not null default '[]'::jsonb;

create index if not exists idx_source_checks_source_id
  on public.source_checks(source_id, started_at);
