const fs = require("node:fs");
const path = require("node:path");
const { defaultCheckIntervalMinutes, maxEvaluationBatchSize } = require("../config");

type AnyRecord = Record<string, any>;

const dataDir = path.resolve(__dirname, "..", "..", "data");
const dataPath = path.join(dataDir, "hubnews.local.json");

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(value: any, fallback: any) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function emptyData() {
  return {
    nextIds: {
      sources: 1,
      articles: 1,
      topics: 1,
      evaluations: 1,
      sourceChecks: 1
    },
    sources: [],
    articles: [],
    articleEmbeddings: [],
    topics: [],
    evaluations: [],
    sourceChecks: []
  };
}

function readData() {
  try {
    return { ...emptyData(), ...JSON.parse(fs.readFileSync(dataPath, "utf8")) };
  } catch {
    return emptyData();
  }
}

function writeData(data: AnyRecord) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
}

function mutate(mutator: (data: AnyRecord) => any) {
  const data = readData();
  const result = mutator(data);
  writeData(data);
  return result;
}

function nextId(data: AnyRecord, key: string) {
  const value = data.nextIds[key] || 1;
  data.nextIds[key] = value + 1;
  return value;
}

function mapSource(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    homepageUrl: row.homepage_url,
    feedUrl: row.feed_url,
    language: row.language,
    country: row.country,
    enabled: Boolean(row.enabled),
    checkIntervalMinutes: row.check_interval_minutes,
    scrapeConfig: safeJsonParse(row.scrape_config_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastCheckedAt: row.last_checked_at,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error
  };
}

function mapArticle(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.source_name || null,
    headline: row.headline,
    headlineSk: row.headline_sk,
    headlineEn: row.headline_en,
    headlineLanguage: row.headline_language,
    headlineTranslatedAt: row.headline_translated_at,
    headlineTranslationModel: row.headline_translation_model,
    context: row.context,
    url: row.url,
    canonicalUrl: row.canonical_url,
    publishedAt: row.published_at,
    discoveredAt: row.discovered_at,
    byline: row.byline,
    imageUrl: row.image_url,
    language: row.language,
    topics: safeJsonParse(row.topics_json, []),
    raw: safeJsonParse(row.raw_json, {}),
    contentHash: row.content_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    evaluationStatus: row.evaluation_status,
    evaluationConfidence: row.evaluation_confidence,
    evaluationReason: row.evaluation_reason,
    evaluatedAt: row.evaluated_at
  };
}

function mapTopic(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapArticleEvaluation(row: any) {
  if (!row) return null;
  return {
    articleId: row.article_id,
    topicId: row.topic_id,
    status: row.status,
    confidence: row.confidence,
    checkedAt: row.checked_at
  };
}

function sourceToRow(input: AnyRecord) {
  const row: AnyRecord = {};
  if (input.name !== undefined) row.name = input.name;
  if (input.homepageUrl !== undefined) row.homepage_url = input.homepageUrl;
  if (input.feedUrl !== undefined) row.feed_url = input.feedUrl || null;
  if (input.language !== undefined) row.language = input.language || null;
  if (input.country !== undefined) row.country = input.country || null;
  if (input.enabled !== undefined) row.enabled = Boolean(input.enabled);
  if (input.checkIntervalMinutes !== undefined) {
    row.check_interval_minutes = input.checkIntervalMinutes || defaultCheckIntervalMinutes;
  }
  if (input.scrapeConfig !== undefined) row.scrape_config_json = input.scrapeConfig || {};
  if (input.lastCheckedAt !== undefined) row.last_checked_at = input.lastCheckedAt;
  if (input.lastSuccessAt !== undefined) row.last_success_at = input.lastSuccessAt;
  if (input.lastError !== undefined) row.last_error = input.lastError;
  return row;
}

function articleWithSource(data: AnyRecord, article: AnyRecord) {
  const source = data.sources.find((row) => row.id === article.source_id);
  return {
    ...article,
    source_name: source?.name || null
  };
}

function timestampForArticle(article: AnyRecord) {
  return Date.parse(article.discovered_at || article.published_at || article.created_at || "") || 0;
}

function compareArticlesDesc(left: AnyRecord, right: AnyRecord) {
  const timestampDiff = timestampForArticle(right) - timestampForArticle(left);
  if (timestampDiff !== 0) return timestampDiff;
  return (Number(right.id) || 0) - (Number(left.id) || 0);
}

function hashText(value: any) {
  const crypto = require("node:crypto");
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function articleEmbeddingText(article: AnyRecord) {
  return [
    article.headline,
    article.headline_sk,
    article.headline_en,
    article.context,
    article.content_text
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 12000);
}

const sourceRepo = {
  async listSources(filters: AnyRecord = {}) {
    return readData()
      .sources.filter((source) =>
        filters.enabled === undefined ? true : Boolean(source.enabled) === Boolean(filters.enabled)
      )
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(mapSource);
  },

  async getSource(id: any) {
    return mapSource(readData().sources.find((source) => source.id === Number(id)));
  },

  async getSourceByHomepage(homepageUrl: any) {
    return mapSource(readData().sources.find((source) => source.homepage_url === homepageUrl));
  },

  async createSource(input: AnyRecord) {
    return mutate((data) => {
      const now = nowIso();
      const row = {
        id: nextId(data, "sources"),
        name: input.name,
        homepage_url: input.homepageUrl,
        feed_url: input.feedUrl || null,
        language: input.language || null,
        country: input.country || null,
        enabled: input.enabled === undefined ? true : Boolean(input.enabled),
        check_interval_minutes: input.checkIntervalMinutes || defaultCheckIntervalMinutes,
        scrape_config_json: input.scrapeConfig || {},
        created_at: now,
        updated_at: now,
        last_checked_at: null,
        last_success_at: null,
        last_error: null
      };
      data.sources.push(row);
      return mapSource(row);
    });
  },

  async upsertSource(input: AnyRecord) {
    const existing = await this.getSourceByHomepage(input.homepageUrl);
    if (!existing) return this.createSource(input);
    return this.updateSource(existing.id, input);
  },

  async updateSource(id: any, patch: AnyRecord) {
    return mutate((data) => {
      const row = data.sources.find((source) => source.id === Number(id));
      if (!row) return null;
      Object.assign(row, sourceToRow(patch), { updated_at: nowIso() });
      return mapSource(row);
    });
  },

  async disableSource(id: any) {
    return this.updateSource(id, { enabled: false });
  },

  async markSourceSuccess(id: any, feedUrl: any) {
    const now = nowIso();
    return this.updateSource(id, {
      feedUrl: feedUrl || null,
      lastCheckedAt: now,
      lastSuccessAt: now,
      lastError: null
    });
  },

  async markSourceFailure(id: any, error: any) {
    return this.updateSource(id, {
      lastCheckedAt: nowIso(),
      lastError: String(error || "Unknown aggregation error").slice(0, 2000)
    });
  }
};

const articleRepo = {
  async upsertArticle(input: AnyRecord) {
    return mutate((data) => {
      let existing = data.articles.find(
        (article) =>
          article.source_id === Number(input.sourceId) &&
          article.canonical_url === input.canonicalUrl
      );
      const inserted = !existing;
      const now = nowIso();
      if (!existing) {
        existing = {
          id: nextId(data, "articles"),
          source_id: Number(input.sourceId),
          discovered_at: now,
          created_at: now,
          extraction_status: "pending"
        };
        data.articles.push(existing);
      }

      Object.assign(existing, {
        headline: input.headline,
        headline_language: input.language || existing.headline_language || null,
        context: input.context || null,
        url: input.url,
        canonical_url: input.canonicalUrl,
        published_at: input.publishedAt || existing.published_at || null,
        byline: input.byline || existing.byline || null,
        image_url: input.imageUrl || existing.image_url || null,
        language: input.language || existing.language || null,
        topics_json: input.topics || [],
        raw_json: input.raw || {},
        content_hash: input.contentHash,
        updated_at: now
      });

      return {
        article: mapArticle(articleWithSource(data, existing)),
        inserted,
        needsExtraction:
          inserted || !existing.extraction_status || existing.extraction_status === "pending"
      };
    });
  },

  async listArticles(filters: AnyRecord = {}) {
    const data = readData();
    let rows = data.articles.map((article) => articleWithSource(data, article));

    if (filters.topicId) {
      const evaluations = data.evaluations.filter(
        (evaluation) =>
          evaluation.topic_id === Number(filters.topicId) &&
          (!filters.status || evaluation.status === filters.status)
      );
      const evalByArticle = new Map(evaluations.map((evaluation) => [evaluation.article_id, evaluation]));
      rows = rows
        .filter((article) => evalByArticle.has(article.id))
        .map((article) => {
          const evaluation = evalByArticle.get(article.id) as AnyRecord;
          return {
            ...article,
            evaluation_status: evaluation.status,
            evaluation_confidence: evaluation.confidence,
            evaluation_reason: evaluation.reason,
            evaluated_at: evaluation.checked_at
          };
        });
    }

    if (filters.sourceId) rows = rows.filter((article) => article.source_id === Number(filters.sourceId));
    if (filters.q) {
      const q = String(filters.q).toLowerCase();
      rows = rows.filter((article) =>
        `${article.headline || ""} ${article.headline_sk || ""} ${article.headline_en || ""} ${article.context || ""}`.toLowerCase().includes(q)
      );
    }
    if (filters.from) rows = rows.filter((article) => timestampForArticle(article) >= Date.parse(filters.from));
    if (filters.to) rows = rows.filter((article) => timestampForArticle(article) <= Date.parse(filters.to));

    rows.sort(compareArticlesDesc);
    const limit = Math.min(Number(filters.limit) || 50, 200);
    const offset = Number(filters.offset) || 0;
    return rows.slice(offset, offset + limit).map(mapArticle);
  },

  async countArticlesBySource(sourceId: any) {
    const id = Number(sourceId);
    return readData().articles.filter((article) => article.source_id === id).length;
  },

  async getArticle(id: any) {
    const data = readData();
    const article = data.articles.find((row) => row.id === Number(id));
    return article ? mapArticle(articleWithSource(data, article)) : null;
  },

  async updateArticleContent(id: any, content: AnyRecord) {
    return mutate((data) => {
      const article = data.articles.find((row) => row.id === Number(id));
      if (!article) return null;
      Object.assign(article, {
        content_markdown: content.contentMarkdown || null,
        content_text: content.contentText || null,
        word_count: typeof content.wordCount === "number" ? content.wordCount : null,
        extraction_provider: content.provider || null,
        extraction_status: content.status || "failed",
        extraction_error: content.error || null,
        extracted_at: nowIso(),
        updated_at: nowIso()
      });
      return mapArticle(articleWithSource(data, article));
    });
  },

  async updateHeadlineTranslations(id: any, translation: AnyRecord) {
    return mutate((data) => {
      const article = data.articles.find((row) => row.id === Number(id));
      if (!article) return null;
      Object.assign(article, {
        headline_sk: translation.headlineSk || null,
        headline_en: translation.headlineEn || null,
        headline_language: translation.detectedLanguage || translation.language || null,
        headline_translated_at: translation.translatedAt || nowIso(),
        headline_translation_model: translation.model || null,
        updated_at: nowIso()
      });
      return mapArticle(articleWithSource(data, article));
    });
  },

  async listArticlesMissingHeadlineTranslations(limit = 200) {
    const data = readData();
    return data.articles
      .filter((article) => !article.headline_sk || !article.headline_en)
      .map((article) => articleWithSource(data, article))
      .sort(compareArticlesDesc)
      .slice(0, Math.min(Number(limit) || 200, 1000))
      .map(mapArticle);
  },

  async countArticlesMissingHeadlineTranslations() {
    return readData().articles.filter((article) => !article.headline_sk || !article.headline_en).length;
  },

  async listUnevaluatedForTopic(topicId: any, limit = 50) {
    const data = readData();
    const evaluatedIds = new Set(
      data.evaluations
        .filter((evaluation) => evaluation.topic_id === Number(topicId))
        .map((evaluation) => evaluation.article_id)
    );
    return data.articles
      .filter((article) => !evaluatedIds.has(article.id))
      .map((article) => articleWithSource(data, article))
      .sort(compareArticlesDesc)
      .slice(0, Math.min(Number(limit) || 50, maxEvaluationBatchSize))
      .map(mapArticle);
  },

  async listArticlesMissingContent(limit = 20, options: AnyRecord = {}) {
    const data = readData();
    const boundedLimit = Math.min(Number(limit) || 20, 200);
    return data.articles
      .filter((article) => {
        if (!article.url) return false;
        if (options.force) return true;
        return !article.extraction_status || article.extraction_status === "pending" || !article.content_text;
      })
      .map((article) => articleWithSource(data, article))
      .sort(compareArticlesDesc)
      .slice(0, boundedLimit)
      .map(mapArticle);
  },

  async listArticlesMissingEmbeddings(model: string, limit = 50) {
    const data = readData();
    const boundedLimit = Math.min(Number(limit) || 50, 200);
    const embeddings = Array.isArray(data.articleEmbeddings) ? data.articleEmbeddings : [];
    const embeddingByArticleId = new Map(
      embeddings
        .filter((embedding) => embedding.model === model)
        .map((embedding) => [Number(embedding.article_id), embedding])
    );

    return data.articles
      .filter((article) => {
        const text = articleEmbeddingText(article);
        if (!text) return false;
        const existing = embeddingByArticleId.get(Number(article.id));
        return !existing || existing.text_hash !== hashText(text);
      })
      .sort(compareArticlesDesc)
      .slice(0, boundedLimit)
      .map((article) => ({
        ...mapArticle(articleWithSource(data, article)),
        embeddingText: articleEmbeddingText(article),
        embeddingTextHash: hashText(articleEmbeddingText(article)),
        wordCount: article.word_count || null,
        extractionStatus: article.extraction_status || null
      }))
  },

  async upsertArticleEmbedding(input: AnyRecord) {
    return mutate((data) => {
      if (!Array.isArray(data.articleEmbeddings)) data.articleEmbeddings = [];
      const now = nowIso();
      const row = {
        article_id: Number(input.articleId),
        model: input.model,
        embedding: input.embedding,
        dimensions: Array.isArray(input.embedding) ? input.embedding.length : 0,
        text_hash: input.textHash,
        created_at: now,
        updated_at: now
      };
      const index = data.articleEmbeddings.findIndex(
        (embedding) => Number(embedding.article_id) === row.article_id && embedding.model === row.model
      );
      if (index >= 0) {
        data.articleEmbeddings[index] = {
          ...data.articleEmbeddings[index],
          ...row,
          created_at: data.articleEmbeddings[index].created_at || now
        };
      } else {
        data.articleEmbeddings.push(row);
      }
      return row;
    });
  },

  async listArticleEmbeddings(model: string) {
    const data = readData();
    const articlesById = new Map(data.articles.map((article) => [Number(article.id), article]));
    return (data.articleEmbeddings || [])
      .filter((embedding) => embedding.model === model && Array.isArray(embedding.embedding))
      .map((embedding) => {
        const article = articlesById.get(Number(embedding.article_id));
        if (!article) return null;
        return {
          article: mapArticle(articleWithSource(data, article)),
          embedding: embedding.embedding,
          model: embedding.model,
          textHash: embedding.text_hash
        };
      })
      .filter(Boolean);
  }
};

const topicRepo = {
  async listTopics() {
    return readData().topics.sort((left, right) => left.name.localeCompare(right.name)).map(mapTopic);
  },

  async getTopic(id: any) {
    return mapTopic(readData().topics.find((topic) => topic.id === Number(id)));
  },

  async createTopic(input: AnyRecord) {
    return mutate((data) => {
      const now = nowIso();
      const row = {
        id: nextId(data, "topics"),
        name: input.name,
        description: input.description || null,
        created_at: now,
        updated_at: now
      };
      data.topics.push(row);
      return mapTopic(row);
    });
  },

  async updateTopic(id: any, patch: AnyRecord) {
    return mutate((data) => {
      const row = data.topics.find((topic) => topic.id === Number(id));
      if (!row) return null;
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.description !== undefined) row.description = patch.description || null;
      row.updated_at = nowIso();
      return mapTopic(row);
    });
  },

  async deleteTopic(id: any) {
    return mutate((data) => {
      data.topics = data.topics.filter((topic) => topic.id !== Number(id));
    });
  }
};

const evaluationRepo = {
  async listEvaluationsForArticles(articleIds: any[]) {
    const ids = new Set(
      articleIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    );
    if (!ids.size) return [];

    return readData()
      .evaluations.filter((evaluation) => ids.has(evaluation.article_id))
      .map(mapArticleEvaluation)
      .filter(Boolean);
  },

  async upsertEvaluation(input: AnyRecord) {
    return mutate((data) => {
      const now = nowIso();
      let row = data.evaluations.find(
        (evaluation) =>
          evaluation.article_id === Number(input.articleId) &&
          evaluation.topic_id === Number(input.topicId)
      );
      if (!row) {
        row = {
          id: nextId(data, "evaluations"),
          article_id: Number(input.articleId),
          topic_id: Number(input.topicId),
          created_at: now
        };
        data.evaluations.push(row);
      }
      Object.assign(row, {
        status: input.status,
        confidence: input.confidence ?? null,
        reason: input.reason || null,
        model: input.model || null,
        raw_json: input.raw || {},
        checked_at: input.checkedAt || now,
        updated_at: now
      });
    });
  }
};

const checkRepo = {
  async createCheck(sourceId: any) {
    return mutate((data) => {
      const row = {
        id: nextId(data, "sourceChecks"),
        source_id: Number(sourceId),
        started_at: nowIso(),
        status: "running",
        items_found: 0,
        inserted_count: 0,
        updated_count: 0,
        direct_scrape_count: 0,
        firecrawl_call_count: 0,
        robots_warning_count: 0,
        robots_warnings_json: []
      };
      data.sourceChecks.push(row);
      return row.id;
    });
  },

  async finishCheck(id: any, patch: AnyRecord) {
    return mutate((data) => {
      const row = data.sourceChecks.find((check) => check.id === Number(id));
      if (!row) return;
      Object.assign(row, {
        completed_at: nowIso(),
        status: patch.status,
        feed_url: patch.feedUrl || null,
        items_found: patch.itemsFound || 0,
        inserted_count: patch.insertedCount || 0,
        updated_count: patch.updatedCount || 0,
        direct_scrape_count: patch.directScrapeCount || 0,
        firecrawl_call_count: patch.firecrawlCallCount || 0,
        robots_warning_count: patch.robotsWarningCount || 0,
        robots_warnings_json: patch.robotsWarnings || [],
        error: patch.error ? String(patch.error).slice(0, 2000) : null
      });
    });
  }
};

module.exports = {
  sourceRepo,
  articleRepo,
  topicRepo,
  evaluationRepo,
  checkRepo,
  mapArticle,
  mapArticleEvaluation,
  mapSource,
  mapTopic,
  nowIso,
  safeJsonParse,
  dataPath
};
