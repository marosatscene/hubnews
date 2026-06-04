const express = require("express");
const path = require("node:path");
const { createBasicAuth } = require("../lib/basicAuth");
const { asyncRoute } = require("../lib/asyncRoute");
const {
  autoTaggingEnabled,
  autoTaggingLimitPerTopic,
  llmFilterUrl,
  maxEvaluationBatchSize,
  headlineTranslationBackfillLimit,
  openaiApiKey,
  openaiAutoTaggingModel,
  openaiFilterModel
} = require("../config");
const { cleanText, truncate } = require("../lib/text");
const {
  aggregateMissingSources: defaultAggregateMissingSources,
  aggregateSourceById: defaultAggregateSourceById
} = require("../services/aggregator");
const { filterArticlesForTopic: defaultFilterArticlesForTopic } = require("../services/headlineFilter");
const { translateHeadlines: defaultTranslateHeadlines } = require("../services/headlineTranslator");
const { autoTagArticlesForTopics: defaultAutoTagArticlesForTopics } = require("../services/autoTagger");
const { extractMissingArticleContent: defaultExtractMissingArticleContent } = require("../services/contentBackfill");
const {
  backfillLocalArticleEmbeddings: defaultBackfillLocalArticleEmbeddings,
  semanticSearchLocalArticles: defaultSemanticSearchLocalArticles
} = require("../services/localSemanticSearch");
const {
  sourceUpdateSchema,
  topicCreateSchema,
  topicUpdateSchema,
  validate
} = require("../validators");

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 200;
const DEFAULT_ADMIN_HTML_PATH = path.join(process.cwd(), "public/admin/index.html");
const DEFAULT_ADMIN_ASSETS_PATH = path.join(process.cwd(), "public/admin/assets");

type AnyRecord = Record<string, any>;

const starterTagSuggestions = [
  {
    name: "Slovensko",
    description: "Slovak politics, institutions, economy, public services, regions, and Slovak public figures."
  },
  {
    name: "Svet",
    description: "Major global events, foreign policy, diplomacy, international institutions, and cross-border risks."
  },
  {
    name: "Európska únia",
    description: "EU institutions, Brussels policy, European Parliament, Commission, Council, and member-state decisions."
  },
  {
    name: "Bezpečnosť",
    description: "Defense, NATO, armed conflict, cyber security, intelligence, strategic risks, and military policy."
  },
  {
    name: "Ekonomika",
    description: "Markets, companies, budgets, taxes, jobs, industry, trade, inflation, and economic policy."
  },
  {
    name: "Energetika",
    description: "Energy prices, electricity, gas, oil, renewables, nuclear power, grids, and energy security."
  },
  {
    name: "Ukrajina",
    description: "War in Ukraine, Ukrainian politics, reconstruction, diplomacy, sanctions, and regional impact."
  },
  {
    name: "Rusko",
    description: "Russian politics, war, economy, sanctions, foreign policy, and Kremlin-linked institutions."
  },
  {
    name: "Donald Trump",
    description: "Donald Trump, US administration, elections, policy decisions, allies, tariffs, NATO, and global impact."
  },
  {
    name: "Technológie",
    description: "AI, big tech, cybersecurity, platforms, chips, digital government, startups, and regulation."
  }
];

function parsePositiveInt(value: any, fallback: number, max = MAX_PAGE_SIZE) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function parseOffset(value: any) {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function parseOptionalId(value: any, name: string) {
  if (value === undefined || value === null || value === "" || value === "all") {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;

  const error: any = new Error(`Invalid ${name}`);
  error.status = 400;
  throw error;
}

function optionalString(value: any) {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : undefined;
}

function dateValue(article: AnyRecord) {
  return article.discoveredAt || article.publishedAt || article.createdAt || null;
}

function toTimestamp(value: any) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function matchesAdminFilters(article: AnyRecord, filters: AnyRecord) {
  if (filters.sourceId && Number(article.sourceId) !== filters.sourceId) return false;

  if (filters.q) {
    const haystack = `${article.headline || ""} ${article.headlineSk || ""} ${article.headlineEn || ""} ${article.context || ""}`.toLowerCase();
    if (!haystack.includes(filters.q.toLowerCase())) return false;
  }

  const articleTimestamp = toTimestamp(dateValue(article));
  if (filters.from && articleTimestamp !== null) {
    const fromTimestamp = toTimestamp(filters.from);
    if (fromTimestamp !== null && articleTimestamp < fromTimestamp) return false;
  }

  if (filters.to && articleTimestamp !== null) {
    const toTimestampValue = toTimestamp(filters.to);
    if (toTimestampValue !== null && articleTimestamp > toTimestampValue) return false;
  }

  if (filters.status && article.evaluationStatus !== filters.status) return false;

  return true;
}

function sortArticlesByDateDesc(left: AnyRecord, right: AnyRecord) {
  const leftTimestamp = toTimestamp(dateValue(left)) || 0;
  const rightTimestamp = toTimestamp(dateValue(right)) || 0;
  const timestampDiff = rightTimestamp - leftTimestamp;
  if (timestampDiff !== 0) return timestampDiff;
  return (Number(right.id) || 0) - (Number(left.id) || 0);
}

function articleSnippet(article: AnyRecord) {
  const source = article.context || article.snippet || "";
  return truncate(cleanText(source), 240);
}

function serializeTopicStatus(topic: AnyRecord, evaluation?: AnyRecord) {
  const status = evaluation?.status === "matched" || evaluation?.status === "rejected"
    ? evaluation.status
    : "pending";

  return {
    id: topic.id,
    name: topic.name,
    status,
    confidence: evaluation?.confidence ?? null,
    evaluatedAt: evaluation?.checkedAt || null
  };
}

function topicStatusKey(articleId: any, topicId: any) {
  return `${articleId}:${topicId}`;
}

async function listEvaluationsForArticles(evaluationRepo: AnyRecord, articleIds: any[]) {
  if (!evaluationRepo || typeof evaluationRepo.listEvaluationsForArticles !== "function") {
    return [];
  }
  return evaluationRepo.listEvaluationsForArticles(articleIds);
}

async function serializeArticles(articles: AnyRecord[], topicRepo: AnyRecord, evaluationRepo: AnyRecord) {
  const topics = await topicRepo.listTopics();
  const articleIds = articles.map((article) => article.id).filter(Boolean);
  const evaluations = await listEvaluationsForArticles(evaluationRepo, articleIds);
  const evaluationsByArticleAndTopic = new Map(
    evaluations.map((evaluation: AnyRecord) => [
      topicStatusKey(evaluation.articleId, evaluation.topicId),
      evaluation
    ])
  );

  return articles.map((article) =>
    serializeArticle(
      article,
      topics.map((topic: AnyRecord) =>
        serializeTopicStatus(topic, evaluationsByArticleAndTopic.get(topicStatusKey(article.id, topic.id)))
      )
    )
  );
}

function serializeArticle(article: AnyRecord, semanticTopics: AnyRecord[] = []) {
  return {
    id: article.id,
    headline: article.headline,
    headlineSk: article.headlineSk || null,
    headlineEn: article.headlineEn || null,
    headlineLanguage: article.headlineLanguage || article.language || null,
    headlineTranslatedAt: article.headlineTranslatedAt || null,
    headlineTranslationModel: article.headlineTranslationModel || null,
    source: article.sourceName || null,
    publishedAt: article.publishedAt || null,
    fetchedAt: article.discoveredAt || article.createdAt || null,
    snippet: articleSnippet(article),
    topics: Array.isArray(article.topics)
      ? article.topics.map((topic: any) => cleanText(String(topic))).filter(Boolean).slice(0, 8)
      : [],
    semanticTopics,
    link: article.url
  };
}

function serializeSource(source: AnyRecord, articleCount = 0) {
  return {
    id: source.id,
    name: source.name,
    homepageUrl: source.homepageUrl || null,
    feedUrl: source.feedUrl || null,
    language: source.language || null,
    country: source.country || null,
    enabled: Boolean(source.enabled),
    checkIntervalMinutes: source.checkIntervalMinutes || null,
    lastCheckedAt: source.lastCheckedAt || null,
    lastSuccessAt: source.lastSuccessAt || null,
    lastError: source.lastError || null,
    articleCount
  };
}

function serializeTopic(topic: AnyRecord) {
  return {
    id: topic.id,
    name: topic.name,
    description: topic.description || null
  };
}

function tagKey(name: any) {
  return cleanText(String(name || "")).toLowerCase();
}

function firstNonEmpty(...values: any[]) {
  for (const value of values) {
    const cleaned = cleanText(String(value || ""));
    if (cleaned) return cleaned;
  }
  return "";
}

async function tagSuggestions(topicRepo: AnyRecord, articleRepo: AnyRecord) {
  const topics = await topicRepo.listTopics();
  const existingByKey: Map<string, AnyRecord> = new Map(
    topics.map((topic: AnyRecord) => [tagKey(topic.name), topic])
  );
  const suggestionsByKey: Map<string, AnyRecord> = new Map();

  function addSuggestion(input: AnyRecord) {
    const name = firstNonEmpty(input.name);
    if (!name) return;
    const key = tagKey(name);
    const existing = existingByKey.get(key);
    const current = suggestionsByKey.get(key) || {
      name,
      description: input.description || existing?.description || null,
      source: input.source || "recent",
      count: 0,
      existingTopicId: existing?.id || null
    };

    suggestionsByKey.set(key, {
      ...current,
      description: firstNonEmpty(current.description, input.description, existing?.description) || null,
      source: current.source === "existing" || input.source === "existing" ? "existing" : current.source,
      count: current.count + Number(input.count || 0),
      existingTopicId: current.existingTopicId || existing?.id || null
    });
  }

  for (const topic of topics) {
    addSuggestion({
      name: topic.name,
      description: topic.description,
      source: "existing",
      count: 0
    });
  }

  for (const suggestion of starterTagSuggestions) {
    addSuggestion({
      ...suggestion,
      source: "starter",
      count: 0
    });
  }

  const articles = await articleRepo.listArticles({ limit: 200, offset: 0 });
  for (const article of articles) {
    const seen = new Set();
    for (const topic of article.topics || []) {
      const name = cleanText(String(topic || ""));
      const key = tagKey(name);
      if (!name || seen.has(key)) continue;
      seen.add(key);
      addSuggestion({
        name,
        source: "recent",
        count: 1
      });
    }
  }

  return [...suggestionsByKey.values()]
    .sort((left: AnyRecord, right: AnyRecord) => {
      if (left.source === "existing" && right.source !== "existing") return -1;
      if (right.source === "existing" && left.source !== "existing") return 1;
      if (right.count !== left.count) return right.count - left.count;
      return left.name.localeCompare(right.name);
    })
    .slice(0, 40);
}

function readArticleFilters(query: AnyRecord) {
  const limit = parsePositiveInt(query.pageSize || query.limit, DEFAULT_PAGE_SIZE);
  const offset = parseOffset(query.offset);

  return {
    q: optionalString(query.q),
    sourceId: parseOptionalId(query.source || query.sourceId, "source"),
    topicId: parseOptionalId(query.topic || query.topicId, "topic"),
    status: optionalString(query.status),
    from: optionalString(query.from),
    to: optionalString(query.to),
    limit,
    offset
  };
}

function readSemanticFilterInput(body: AnyRecord) {
  const name = optionalString(body.topic || body.name);
  if (!name) {
    const error: any = new Error("Semantic topic is required");
    error.status = 400;
    throw error;
  }

  return {
    name,
    description:
      optionalString(body.description) ||
      `${name}; related people, places, institutions, politics, economy, business, security, culture, local-language names, major cities, and events.`,
    limit: parsePositiveInt(body.limit, 50, maxEvaluationBatchSize)
  };
}

function readHeadlineTranslationInput(body: AnyRecord) {
  return {
    limit: parsePositiveInt(body.limit, headlineTranslationBackfillLimit, 1000)
  };
}

function readContentExtractionInput(body: AnyRecord) {
  return {
    force: Boolean(body.force),
    limit: parsePositiveInt(body.limit, 20, 200)
  };
}

function readAutoTagInput(body: AnyRecord) {
  return {
    limitPerTopic: parsePositiveInt(body.limitPerTopic || body.limit, autoTaggingLimitPerTopic, maxEvaluationBatchSize)
  };
}

function readEmbeddingInput(body: AnyRecord) {
  return {
    limit: parsePositiveInt(body.limit, 50, 200),
    model: optionalString(body.model)
  };
}

function pricingForModel(model: string) {
  const prices: AnyRecord = {
    "gpt-4.1-mini": {
      inputUsdPerMillion: 0.4,
      outputUsdPerMillion: 1.6,
      sourceUrl: "https://platform.openai.com/docs/models/gpt-4.1-mini"
    },
    "gpt-4.1-nano": {
      inputUsdPerMillion: 0.1,
      outputUsdPerMillion: 0.4,
      sourceUrl: "https://developers.openai.com/api/docs/models/gpt-4.1-nano"
    },
    "gpt-5.4-nano": {
      inputUsdPerMillion: 0.2,
      outputUsdPerMillion: 1.25,
      sourceUrl: "https://developers.openai.com/api/docs/models/gpt-5.4-nano"
    }
  };
  return prices[model] || null;
}

function llmMeta(model = openaiFilterModel, options: AnyRecord = {}) {
  if (llmFilterUrl) {
    return {
      provider: "external",
      model: "external-llm-filter",
      configured: true,
      pricing: null
    };
  }

  if (openaiApiKey) {
    return {
      provider: "openai",
      model,
      configured: true,
      pricing: pricingForModel(model)
    };
  }

  if (options.allowKeywordFallback === false) {
    return {
      provider: "unconfigured",
      model,
      configured: false,
      pricing: pricingForModel(model)
    };
  }

  return {
    provider: "keyword-fallback",
    model: "keyword-fallback",
    configured: true,
    pricing: null
  };
}

function autoTaggingMeta() {
  const meta = llmMeta(openaiAutoTaggingModel, { allowKeywordFallback: false });
  return {
    ...meta,
    enabled: autoTaggingEnabled,
    limitPerTopic: autoTaggingLimitPerTopic
  };
}

async function findOrCreateTopic(topicRepo: AnyRecord, input: AnyRecord) {
  const topics = await topicRepo.listTopics();
  const existing = topics.find(
    (topic: AnyRecord) => topic.name.toLowerCase() === input.name.toLowerCase()
  );

  if (existing) {
    if (!existing.description && input.description) {
      return topicRepo.updateTopic(existing.id, { description: input.description });
    }
    return existing;
  }

  return topicRepo.createTopic({
    name: input.name,
    description: input.description
  });
}

async function countArticlesForSource(articleRepo: AnyRecord, sourceId: any) {
  if (!articleRepo || typeof articleRepo.countArticlesBySource !== "function") return 0;
  return articleRepo.countArticlesBySource(sourceId);
}

async function serializeSourcesWithCounts(articleRepo: AnyRecord, sources: AnyRecord[]) {
  return Promise.all(
    sources.map(async (source) => serializeSource(source, await countArticlesForSource(articleRepo, source.id)))
  );
}

function summarizeFilterResults(results: AnyRecord[]) {
  return {
    matchedCount: results.filter((result) => result.status === "matched").length,
    rejectedCount: results.filter((result) => result.status === "rejected").length
  };
}

async function translateAndStoreHeadlines(articleRepo: AnyRecord, translateHeadlines: any, limit: number) {
  if (!articleRepo || typeof articleRepo.listArticlesMissingHeadlineTranslations !== "function") {
    return {
      requestedCount: 0,
      translatedCount: 0,
      failedCount: 0,
      remainingMissingCount: 0
    };
  }

  const articles = await articleRepo.listArticlesMissingHeadlineTranslations(limit);
  const missingBefore =
    typeof articleRepo.countArticlesMissingHeadlineTranslations === "function"
      ? await articleRepo.countArticlesMissingHeadlineTranslations()
      : articles.length;
  let translatedCount = 0;
  let failedCount = 0;

  const chunks = [];
  for (let index = 0; index < articles.length; index += 100) {
    chunks.push(articles.slice(index, index + 100));
  }

  if (typeof articleRepo.updateHeadlineTranslations === "function") {
    for (const chunk of chunks) {
      const translations = await translateHeadlines(chunk);
      let chunkTranslatedCount = 0;

      for (const translation of translations) {
        if (translation.headlineSk || translation.headlineEn) {
          await articleRepo.updateHeadlineTranslations(translation.articleId, translation);
          translatedCount += 1;
          chunkTranslatedCount += 1;
        } else {
          failedCount += 1;
        }
      }

      failedCount += Math.max(chunk.length - translations.length, 0);
      if (!chunkTranslatedCount && chunk.length) break;
    }
  } else {
    const translations = await translateHeadlines(articles);
    for (const translation of translations) {
      if (translation.headlineSk || translation.headlineEn) translatedCount += 1;
      else failedCount += 1;
    }
    failedCount += Math.max(articles.length - translations.length, 0);
  }
  const remainingMissingCount =
    typeof articleRepo.countArticlesMissingHeadlineTranslations === "function"
      ? await articleRepo.countArticlesMissingHeadlineTranslations()
      : Math.max(missingBefore - translatedCount, 0);

  return {
    missingBefore,
    requestedCount: articles.length,
    translatedCount,
    failedCount,
    remainingMissingCount
  };
}

function readRefetchMissingInput(body: AnyRecord) {
  return {
    limit: parsePositiveInt(body.limit, 3, 10)
  };
}

function parseRequiredId(value: any, name: string) {
  const id = Number.parseInt(value, 10);
  if (Number.isFinite(id) && id > 0) return id;

  const error: any = new Error(`Invalid ${name}`);
  error.status = 400;
  throw error;
}

function createAdminRouter(options: AnyRecord = {}) {
  const router = express.Router();
  const sourceRepo = options.sourceRepo;
  const articleRepo = options.articleRepo;
  const evaluationRepo = options.evaluationRepo;
  const topicRepo = options.topicRepo;
  const filterArticlesForTopic =
    options.filterArticlesForTopic || defaultFilterArticlesForTopic;
  const autoTagArticlesForTopics =
    options.autoTagArticlesForTopics || defaultAutoTagArticlesForTopics;
  const translateHeadlines =
    options.translateHeadlines || defaultTranslateHeadlines;
  const aggregateMissingSources =
    options.aggregateMissingSources || defaultAggregateMissingSources;
  const aggregateSourceById =
    options.aggregateSourceById || defaultAggregateSourceById;
  const extractMissingArticleContent =
    options.extractMissingArticleContent || defaultExtractMissingArticleContent;
  const backfillLocalArticleEmbeddings =
    options.backfillLocalArticleEmbeddings || defaultBackfillLocalArticleEmbeddings;
  const semanticSearchLocalArticles =
    options.semanticSearchLocalArticles || defaultSemanticSearchLocalArticles;
  const adminHtmlPath = options.adminHtmlPath || DEFAULT_ADMIN_HTML_PATH;
  const adminAssetsPath = options.adminAssetsPath || DEFAULT_ADMIN_ASSETS_PATH;

  router.use(
    createBasicAuth({
      username: options.adminUser,
      password: options.adminPassword,
      realm: options.realm
    })
  );

  router.use("/assets", express.static(adminAssetsPath));

  router.get("/", (_req, res) => {
    res.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'"
    );
    res.sendFile(adminHtmlPath);
  });

  router.get(
    "/api/meta",
    asyncRoute(async (_req, res) => {
      res.json({
        llm: llmMeta(),
        autoTagging: autoTaggingMeta(),
        maxEvaluationBatchSize
      });
    })
  );

  router.get(
    "/api/articles",
    asyncRoute(async (req, res) => {
      const filters = readArticleFilters(req.query);
      let articles;

      if (filters.status && !filters.topicId) {
        const byId = new Map();
        const topics = await topicRepo.listTopics();

        for (const topic of topics) {
          const topicArticles = await articleRepo.listArticles({
            topicId: topic.id,
            status: filters.status,
            limit: MAX_PAGE_SIZE,
            offset: 0
          });

          for (const article of topicArticles) {
            if (!byId.has(article.id)) byId.set(article.id, article);
          }
        }

        articles = Array.from(byId.values())
          .filter((article) => matchesAdminFilters(article, filters))
          .sort(sortArticlesByDateDesc)
          .slice(filters.offset, filters.offset + filters.limit);
      } else {
        const repoFilters = {
          sourceId: filters.sourceId,
          topicId: filters.topicId,
          status: filters.status,
          q: filters.q,
          from: filters.from,
          to: filters.to,
          limit: filters.topicId ? MAX_PAGE_SIZE : filters.limit,
          offset: filters.topicId ? 0 : filters.offset
        };

        articles = (await articleRepo.listArticles(repoFilters)).sort(sortArticlesByDateDesc);
      }

      if (filters.topicId) {
        articles = articles
          .filter((article) => matchesAdminFilters(article, filters))
          .sort(sortArticlesByDateDesc)
          .slice(filters.offset, filters.offset + filters.limit);
      }

      res.json({
        articles: await serializeArticles(articles, topicRepo, evaluationRepo),
        filters: {
          q: filters.q || null,
          source: filters.sourceId || null,
          topic: filters.topicId || null,
          status: filters.status || null,
          from: filters.from || null,
          to: filters.to || null,
          pageSize: filters.limit,
          offset: filters.offset
        }
      });
    })
  );

  router.get(
    "/api/sources",
    asyncRoute(async (_req, res) => {
      const sources = await sourceRepo.listSources();
      res.json({ sources: await serializeSourcesWithCounts(articleRepo, sources) });
    })
  );

  router.patch(
    "/api/sources/:id",
    asyncRoute(async (req, res) => {
      const id = parseRequiredId(req.params.id, "source");
      const existing = await sourceRepo.getSource(id);
      if (!existing) return res.status(404).json({ error: "Source not found" });

      const input = validate(sourceUpdateSchema, req.body || {});
      const source = await sourceRepo.updateSource(id, input);
      const articleCount = await countArticlesForSource(articleRepo, source.id);
      return res.json({ source: serializeSource(source, articleCount) });
    })
  );

  router.post(
    "/api/sources/:id/recrawl",
    asyncRoute(async (req, res) => {
      const id = parseRequiredId(req.params.id, "source");
      const result = await aggregateSourceById(id);
      const source = await sourceRepo.getSource(id);
      const articleCount = source ? await countArticlesForSource(articleRepo, source.id) : 0;
      res.json({
        result,
        source: source ? serializeSource(source, articleCount) : null
      });
    })
  );

  router.get(
    "/api/topics",
    asyncRoute(async (_req, res) => {
      const topics = await topicRepo.listTopics();
      res.json({ topics: topics.map(serializeTopic) });
    })
  );

  router.post(
    "/api/topics",
    asyncRoute(async (req, res) => {
      const input = validate(topicCreateSchema, req.body || {});
      const topic = await findOrCreateTopic(topicRepo, input);
      res.status(201).json({ topic: serializeTopic(topic) });
    })
  );

  router.patch(
    "/api/topics/:id",
    asyncRoute(async (req, res) => {
      const id = parseRequiredId(req.params.id, "topic");
      if (!(await topicRepo.getTopic(id))) return res.status(404).json({ error: "Topic not found" });
      const input = validate(topicUpdateSchema, req.body || {});
      const topic = await topicRepo.updateTopic(id, input);
      res.json({ topic: serializeTopic(topic) });
    })
  );

  router.delete(
    "/api/topics/:id",
    asyncRoute(async (req, res) => {
      const id = parseRequiredId(req.params.id, "topic");
      if (!(await topicRepo.getTopic(id))) return res.status(404).json({ error: "Topic not found" });
      await topicRepo.deleteTopic(id);
      res.status(204).send();
    })
  );

  router.get(
    "/api/tag-suggestions",
    asyncRoute(async (_req, res) => {
      res.json({ suggestions: await tagSuggestions(topicRepo, articleRepo) });
    })
  );

  router.post(
    "/api/semantic-filter",
    asyncRoute(async (req, res) => {
      const input = readSemanticFilterInput(req.body || {});
      const topic = await findOrCreateTopic(topicRepo, input);
      const articles = await articleRepo.listUnevaluatedForTopic(topic.id, input.limit);
      const results = await filterArticlesForTopic(topic, articles);

      for (const result of results) {
        await evaluationRepo.upsertEvaluation({
          articleId: result.articleId,
          topicId: topic.id,
          status: result.status,
          confidence: result.confidence,
          reason: result.reason,
          model: result.model,
          raw: result.raw
        });
      }

      const summary = summarizeFilterResults(results);
      res.json({
        topic: serializeTopic(topic),
        evaluatedCount: results.length,
        ...summary,
        results: results.map((result) => ({
          articleId: result.articleId,
          status: result.status,
          confidence: result.confidence,
          reason: result.reason,
          model: result.model
        }))
      });
    })
  );

  router.post(
    "/api/auto-tag/run",
    asyncRoute(async (req, res) => {
      const input = readAutoTagInput(req.body || {});
      const result = await autoTagArticlesForTopics({
        articleRepo,
        evaluationRepo,
        filterArticlesForTopic,
        limitPerTopic: input.limitPerTopic,
        requireLlm: true,
        topicRepo
      });
      res.json(result);
    })
  );

  router.post(
    "/api/headline-translations/run",
    asyncRoute(async (req, res) => {
      const input = readHeadlineTranslationInput(req.body || {});
      const result = await translateAndStoreHeadlines(articleRepo, translateHeadlines, input.limit);
      res.json(result);
    })
  );

  router.post(
    "/api/articles/extract-content/run",
    asyncRoute(async (req, res) => {
      const input = readContentExtractionInput(req.body || {});
      const result = await extractMissingArticleContent(input);
      res.json(result);
    })
  );

  router.post(
    "/api/articles/semantic-index/run",
    asyncRoute(async (req, res) => {
      const input = readEmbeddingInput(req.body || {});
      const result = await backfillLocalArticleEmbeddings(input);
      res.json(result);
    })
  );

  router.get(
    "/api/articles/semantic-search",
    asyncRoute(async (req, res) => {
      const result = await semanticSearchLocalArticles(String(req.query.q || ""), {
        limit: req.query.limit,
        model: optionalString(req.query.model)
      });
      res.json(result);
    })
  );

  router.post(
    "/api/sources/refetch-missing",
    asyncRoute(async (req, res) => {
      const input = readRefetchMissingInput(req.body || {});
      const result = await aggregateMissingSources(input);
      res.json(result);
    })
  );

  return router;
}

module.exports = {
  createAdminRouter,
  serializeArticle
};
