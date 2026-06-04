require("dotenv").config();

function toBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function toInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const supabaseSecretKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "";

module.exports = {
  port: toInteger(process.env.PORT, 4000),
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || "",
  supabaseSecretKey,
  supabaseServiceRoleKey: supabaseSecretKey,
  storageDriver:
    process.env.STORAGE_DRIVER ||
    (process.env.SUPABASE_URL && supabaseSecretKey ? "supabase" : "json"),
  aggregatorEnabled: toBoolean(process.env.AGGREGATOR_ENABLED, true),
  aggregatorCron: process.env.AGGREGATOR_CRON || "*/5 * * * *",
  defaultCheckIntervalMinutes: toInteger(process.env.DEFAULT_CHECK_INTERVAL_MINUTES, 60),
  maxArticlesPerSource: toInteger(process.env.MAX_ARTICLES_PER_SOURCE, 40),
  requestTimeoutMs: toInteger(process.env.REQUEST_TIMEOUT_MS, 15000),
  scraperUserAgent:
    process.env.SCRAPER_USER_AGENT ||
    "HubNewsBot/0.1 (+https://example.com/bot)",
  vercelCronSecret: process.env.CRON_SECRET || "",
  llmFilterUrl: process.env.LLM_FILTER_URL || "",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiFilterModel: process.env.OPENAI_FILTER_MODEL || "gpt-4.1-mini",
  openaiAutoTaggingModel:
    process.env.OPENAI_AUTO_TAGGING_MODEL ||
    "gpt-5.4-nano",
  openaiTranslationModel: process.env.OPENAI_TRANSLATION_MODEL || "gpt-4.1-mini",
  openaiResponsesApiUrl:
    process.env.OPENAI_RESPONSES_API_URL || "https://api.openai.com/v1/responses",
  openaiEmbeddingsModel: process.env.OPENAI_EMBEDDINGS_MODEL || "text-embedding-3-small",
  openaiEmbeddingsApiUrl:
    process.env.OPENAI_EMBEDDINGS_API_URL || "https://api.openai.com/v1/embeddings",
  maxEvaluationBatchSize: toInteger(process.env.MAX_EVALUATION_BATCH_SIZE, 1000),
  autoTaggingEnabled: toBoolean(process.env.AUTO_TAGGING_ENABLED, true),
  autoTaggingLimitPerTopic: toInteger(process.env.AUTO_TAGGING_LIMIT_PER_TOPIC, 25),
  llmFilterBatchSize: toInteger(process.env.LLM_FILTER_BATCH_SIZE, 50),
  llmFilterConcurrency: toInteger(process.env.LLM_FILTER_CONCURRENCY, 3),
  headlineTranslationBatchSize: toInteger(process.env.HEADLINE_TRANSLATION_BATCH_SIZE, 25),
  headlineTranslationConcurrency: toInteger(process.env.HEADLINE_TRANSLATION_CONCURRENCY, 2),
  headlineTranslationLimitPerSource: toInteger(process.env.HEADLINE_TRANSLATION_LIMIT_PER_SOURCE, 40),
  headlineTranslationBackfillLimit: toInteger(process.env.HEADLINE_TRANSLATION_BACKFILL_LIMIT, 200),
  firecrawlApiKey: process.env.FIRECRAWL_API_KEY || "",
  firecrawlApiUrl:
    process.env.FIRECRAWL_API_URL || "https://api.firecrawl.dev/v2/scrape",
  firecrawlTimeoutMs: toInteger(process.env.FIRECRAWL_TIMEOUT_MS, 60000),
  checkerBatchSize: toInteger(process.env.CHECKER_BATCH_SIZE, 5),
  checkerMaxRuntimeMs: toInteger(process.env.CHECKER_MAX_RUNTIME_MS, 45000),
  firecrawlMinDirectResults: toInteger(process.env.FIRECRAWL_MIN_DIRECT_RESULTS, 3),
  articleMinWordCount: toInteger(process.env.ARTICLE_MIN_WORD_COUNT, 150),
  articleExtractionLimitPerSource: toInteger(
    process.env.ARTICLE_EXTRACTION_LIMIT_PER_SOURCE,
    5
  ),
  adminUser: process.env.ADMIN_USER || "",
  adminPassword: process.env.ADMIN_PASSWORD || "",
  robotsBotName: process.env.ROBOTS_BOT_NAME || "HubNewsBot",
  robotsWarningsMaxStored: toInteger(process.env.ROBOTS_WARNINGS_MAX_STORED, 50)
};
