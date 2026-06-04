const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { supabase, throwIfError } = require("./supabase");

type AnyRecord = Record<string, any>;

type ImportOptions = {
  batchSize: number;
  dryRun: boolean;
  file: string;
  includeChecks: boolean;
};

const DEFAULT_FILE = path.resolve(process.cwd(), "data/hubnews.local.json");
const KEY_SEPARATOR = "\u0000";

function parseArgs(argv: string[]): ImportOptions {
  const options: ImportOptions = {
    batchSize: 50,
    dryRun: false,
    file: DEFAULT_FILE,
    includeChecks: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--include-checks") {
      options.includeChecks = true;
      continue;
    }
    if (arg === "--file") {
      options.file = path.resolve(process.cwd(), argv[index + 1] || "");
      index += 1;
      continue;
    }
    if (arg === "--batch-size") {
      const parsed = Number.parseInt(argv[index + 1] || "", 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.batchSize = Math.min(parsed, 500);
      }
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  npm run import:json:supabase -- [options]

Options:
  --file <path>        JSON file to import. Default: data/hubnews.local.json
  --batch-size <n>    Rows per Supabase write batch. Default: 50
  --include-checks    Also insert source_checks history. Not idempotent.
  --dry-run           Validate and print counts without writing to Supabase.
`);
}

function readLocalData(file: string) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    sources: Array.isArray(data.sources) ? data.sources : [],
    articles: Array.isArray(data.articles) ? data.articles : [],
    topics: Array.isArray(data.topics) ? data.topics : [],
    evaluations: Array.isArray(data.evaluations) ? data.evaluations : [],
    sourceChecks: Array.isArray(data.sourceChecks) ? data.sourceChecks : []
  };
}

function chunks<T>(items: T[], size: number): T[][] {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function compact<T extends AnyRecord>(row: T): T {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== undefined)
  ) as T;
}

function safeJson(value: any, fallback: any) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

function fallbackContentHash(article: AnyRecord) {
  return crypto
    .createHash("sha256")
    .update(`${article.source_id || ""}:${article.canonical_url || article.url || ""}:${article.headline || ""}`)
    .digest("hex");
}

function articleKey(sourceId: any, canonicalUrl: any) {
  return `${sourceId}${KEY_SEPARATOR}${canonicalUrl}`;
}

function sourceRow(source: AnyRecord) {
  return compact({
    name: source.name,
    homepage_url: source.homepage_url,
    feed_url: source.feed_url || null,
    language: source.language || null,
    country: source.country || null,
    enabled: source.enabled === undefined ? true : Boolean(source.enabled),
    check_interval_minutes: source.check_interval_minutes || 60,
    scrape_config_json: safeJson(source.scrape_config_json, {}),
    created_at: source.created_at,
    updated_at: source.updated_at,
    last_checked_at: source.last_checked_at || null,
    last_success_at: source.last_success_at || null,
    last_error: source.last_error || null
  });
}

function topicRow(topic: AnyRecord) {
  return compact({
    name: topic.name,
    description: topic.description || null,
    created_at: topic.created_at,
    updated_at: topic.updated_at
  });
}

function articleRow(article: AnyRecord, nextSourceId: number) {
  const extractionStatus = ["pending", "extracted", "failed", "skipped"].includes(article.extraction_status)
    ? article.extraction_status
    : "pending";
  const extractionProvider = ["direct", "firecrawl"].includes(article.extraction_provider)
    ? article.extraction_provider
    : null;

  return compact({
    source_id: nextSourceId,
    headline: article.headline,
    headline_sk: article.headline_sk || null,
    headline_en: article.headline_en || null,
    headline_language: article.headline_language || article.language || null,
    headline_translated_at: article.headline_translated_at || null,
    headline_translation_model: article.headline_translation_model || null,
    context: article.context || null,
    url: article.url,
    canonical_url: article.canonical_url || article.url,
    published_at: article.published_at || null,
    discovered_at: article.discovered_at,
    byline: article.byline || null,
    image_url: article.image_url || null,
    language: article.language || null,
    topics_json: safeJson(article.topics_json, []),
    raw_json: safeJson(article.raw_json, {}),
    content_hash: article.content_hash || fallbackContentHash(article),
    content_markdown: article.content_markdown || null,
    content_text: article.content_text || null,
    word_count: typeof article.word_count === "number" ? article.word_count : null,
    extraction_provider: extractionProvider,
    extraction_status: extractionStatus,
    extraction_error: article.extraction_error || null,
    extracted_at: article.extracted_at || null,
    created_at: article.created_at,
    updated_at: article.updated_at
  });
}

function evaluationRow(evaluation: AnyRecord, nextArticleId: number, nextTopicId: number) {
  const status = ["pending", "matched", "rejected"].includes(evaluation.status)
    ? evaluation.status
    : "pending";

  return compact({
    article_id: nextArticleId,
    topic_id: nextTopicId,
    status,
    confidence: evaluation.confidence ?? null,
    reason: evaluation.reason || null,
    model: evaluation.model || null,
    raw_json: safeJson(evaluation.raw_json, {}),
    checked_at: evaluation.checked_at || null,
    created_at: evaluation.created_at,
    updated_at: evaluation.updated_at
  });
}

function sourceCheckRow(check: AnyRecord, nextSourceId: number) {
  const status = ["running", "success", "failed"].includes(check.status) ? check.status : "failed";
  return compact({
    source_id: nextSourceId,
    started_at: check.started_at,
    completed_at: check.completed_at || null,
    status,
    feed_url: check.feed_url || null,
    items_found: check.items_found || 0,
    inserted_count: check.inserted_count || 0,
    updated_count: check.updated_count || 0,
    direct_scrape_count: check.direct_scrape_count || 0,
    firecrawl_call_count: check.firecrawl_call_count || 0,
    robots_warning_count: check.robots_warning_count || 0,
    robots_warnings_json: safeJson(check.robots_warnings_json, []),
    error: check.error || null
  });
}

async function upsertSources(sources: AnyRecord[], options: ImportOptions) {
  const sourceIdMap = new Map<number, number>();
  const validSources = sources.filter((source) => source.id && source.name && source.homepage_url);

  if (options.dryRun) {
    for (const source of validSources) sourceIdMap.set(Number(source.id), Number(source.id));
    return {
      map: sourceIdMap,
      skipped: sources.length - validSources.length,
      written: validSources.length
    };
  }

  for (const batch of chunks(validSources, options.batchSize)) {
    const rows = batch.map(sourceRow);
    const { data, error } = await supabase
      .from("sources")
      .upsert(rows, { onConflict: "homepage_url" })
      .select("id, homepage_url");
    throwIfError(error);

    const byHomepage = new Map((data || []).map((row: AnyRecord) => [row.homepage_url, row.id]));
    for (const source of batch) {
      const nextId = byHomepage.get(source.homepage_url);
      if (nextId) sourceIdMap.set(Number(source.id), Number(nextId));
    }
  }

  return {
    map: sourceIdMap,
    skipped: sources.length - validSources.length,
    written: sourceIdMap.size
  };
}

async function upsertTopics(topics: AnyRecord[], options: ImportOptions) {
  const topicIdMap = new Map<number, number>();
  const validTopics = topics.filter((topic) => topic.id && topic.name);

  if (options.dryRun) {
    for (const topic of validTopics) topicIdMap.set(Number(topic.id), Number(topic.id));
    return {
      map: topicIdMap,
      skipped: topics.length - validTopics.length,
      written: validTopics.length
    };
  }

  for (const batch of chunks(validTopics, options.batchSize)) {
    const rows = batch.map(topicRow);
    const { data, error } = await supabase
      .from("topics")
      .upsert(rows, { onConflict: "name" })
      .select("id, name");
    throwIfError(error);

    const byName = new Map((data || []).map((row: AnyRecord) => [row.name, row.id]));
    for (const topic of batch) {
      const nextId = byName.get(topic.name);
      if (nextId) topicIdMap.set(Number(topic.id), Number(nextId));
    }
  }

  return {
    map: topicIdMap,
    skipped: topics.length - validTopics.length,
    written: topicIdMap.size
  };
}

async function upsertArticles(articles: AnyRecord[], sourceIdMap: Map<number, number>, options: ImportOptions) {
  const articleIdMap = new Map<number, number>();
  const validArticles = articles.filter((article) => {
    const nextSourceId = sourceIdMap.get(Number(article.source_id));
    return article.id && nextSourceId && article.headline && article.url && (article.canonical_url || article.url);
  });

  if (options.dryRun) {
    for (const article of validArticles) articleIdMap.set(Number(article.id), Number(article.id));
    return {
      map: articleIdMap,
      skipped: articles.length - validArticles.length,
      written: validArticles.length
    };
  }

  for (const batch of chunks(validArticles, options.batchSize)) {
    const rows = batch.map((article) => articleRow(article, sourceIdMap.get(Number(article.source_id)) as number));
    const { data, error } = await supabase
      .from("articles")
      .upsert(rows, { onConflict: "source_id,canonical_url" })
      .select("id, source_id, canonical_url");
    throwIfError(error);

    const byUniqueKey = new Map(
      (data || []).map((row: AnyRecord) => [articleKey(row.source_id, row.canonical_url), row.id])
    );
    for (const article of batch) {
      const nextSourceId = sourceIdMap.get(Number(article.source_id));
      const nextArticleId = byUniqueKey.get(articleKey(nextSourceId, article.canonical_url || article.url));
      if (nextArticleId) articleIdMap.set(Number(article.id), Number(nextArticleId));
    }
  }

  return {
    map: articleIdMap,
    skipped: articles.length - validArticles.length,
    written: articleIdMap.size
  };
}

async function upsertEvaluations(
  evaluations: AnyRecord[],
  articleIdMap: Map<number, number>,
  topicIdMap: Map<number, number>,
  options: ImportOptions
) {
  const validEvaluations = evaluations.filter((evaluation) =>
    articleIdMap.has(Number(evaluation.article_id)) && topicIdMap.has(Number(evaluation.topic_id))
  );

  if (options.dryRun) {
    return {
      skipped: evaluations.length - validEvaluations.length,
      written: validEvaluations.length
    };
  }

  let written = 0;
  for (const batch of chunks(validEvaluations, options.batchSize)) {
    const rows = batch.map((evaluation) =>
      evaluationRow(
        evaluation,
        articleIdMap.get(Number(evaluation.article_id)) as number,
        topicIdMap.get(Number(evaluation.topic_id)) as number
      )
    );
    const { error } = await supabase
      .from("article_topic_evaluations")
      .upsert(rows, { onConflict: "article_id,topic_id" });
    throwIfError(error);
    written += rows.length;
  }

  return {
    skipped: evaluations.length - validEvaluations.length,
    written
  };
}

async function insertSourceChecks(
  sourceChecks: AnyRecord[],
  sourceIdMap: Map<number, number>,
  options: ImportOptions
) {
  const validChecks = sourceChecks.filter((check) => sourceIdMap.has(Number(check.source_id)));

  if (options.dryRun || !options.includeChecks) {
    return {
      skipped: sourceChecks.length - validChecks.length,
      written: options.includeChecks ? validChecks.length : 0
    };
  }

  let written = 0;
  for (const batch of chunks(validChecks, options.batchSize)) {
    const rows = batch.map((check) =>
      sourceCheckRow(check, sourceIdMap.get(Number(check.source_id)) as number)
    );
    const { error } = await supabase.from("source_checks").insert(rows);
    throwIfError(error);
    written += rows.length;
  }

  return {
    skipped: sourceChecks.length - validChecks.length,
    written
  };
}

async function importJsonToSupabase(options: ImportOptions) {
  const data = readLocalData(options.file);
  console.log(`Importing ${options.file}${options.dryRun ? " (dry run)" : ""}`);
  console.log(
    `Input: ${data.sources.length} sources, ${data.articles.length} articles, ${data.topics.length} topics, ${data.evaluations.length} evaluations, ${data.sourceChecks.length} checks`
  );

  const sourceResult = await upsertSources(data.sources, options);
  const topicResult = await upsertTopics(data.topics, options);
  const articleResult = await upsertArticles(data.articles, sourceResult.map, options);
  const evaluationResult = await upsertEvaluations(
    data.evaluations,
    articleResult.map,
    topicResult.map,
    options
  );
  const checkResult = await insertSourceChecks(data.sourceChecks, sourceResult.map, options);

  return {
    sources: sourceResult,
    topics: topicResult,
    articles: articleResult,
    evaluations: evaluationResult,
    sourceChecks: checkResult
  };
}

function printableSummary(summary: AnyRecord) {
  return Object.fromEntries(
    Object.entries(summary).map(([key, value]) => {
      if (!value || typeof value !== "object") return [key, value];
      const { map, ...rest } = value as AnyRecord;
      return [key, map instanceof Map ? { ...rest, mapped: map.size } : rest];
    })
  );
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  importJsonToSupabase(options)
    .then((summary) => {
      console.log(JSON.stringify(printableSummary(summary), null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  articleKey,
  articleRow,
  evaluationRow,
  importJsonToSupabase,
  parseArgs,
  printableSummary,
  sourceCheckRow,
  sourceRow,
  topicRow
};
