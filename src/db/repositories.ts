const { defaultCheckIntervalMinutes, maxEvaluationBatchSize, storageDriver } = require("../config");
const { supabase, throwIfError } = require("./supabase");

type AnyRecord = Record<string, any>;

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
  // Internal extraction columns are intentionally omitted from all client-facing article maps.
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.source_name || row.sources?.name || null,
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

function articleTimestamp(article: AnyRecord) {
  return Date.parse(article.discoveredAt || article.publishedAt || article.createdAt || "") || 0;
}

function compareArticlesDesc(left: AnyRecord, right: AnyRecord) {
  const timestampDiff = articleTimestamp(right) - articleTimestamp(left);
  if (timestampDiff !== 0) return timestampDiff;
  return (Number(right.id) || 0) - (Number(left.id) || 0);
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

const sourceRepo = {
  async listSources(filters: AnyRecord = {}) {
    let query = supabase.from("sources").select("*").order("name", { ascending: true });
    if (filters.enabled !== undefined) query = query.eq("enabled", Boolean(filters.enabled));
    const { data, error } = await query;
    throwIfError(error);
    return data.map(mapSource);
  },

  async getSource(id: any) {
    const { data, error } = await supabase
      .from("sources")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    throwIfError(error);
    return mapSource(data);
  },

  async getSourceByHomepage(homepageUrl: any) {
    const { data, error } = await supabase
      .from("sources")
      .select("*")
      .eq("homepage_url", homepageUrl)
      .maybeSingle();
    throwIfError(error);
    return mapSource(data);
  },

  async createSource(input: AnyRecord) {
    const row = sourceToRow({
      enabled: true,
      checkIntervalMinutes: defaultCheckIntervalMinutes,
      scrapeConfig: {},
      ...input
    });
    const { data, error } = await supabase.from("sources").insert(row).select("*").single();
    throwIfError(error);
    return mapSource(data);
  },

  async upsertSource(input: AnyRecord) {
    const existing = await this.getSourceByHomepage(input.homepageUrl);
    if (!existing) return this.createSource(input);
    return this.updateSource(existing.id, input);
  },

  async updateSource(id: any, patch: AnyRecord) {
    const row = sourceToRow(patch);
    if (!Object.keys(row).length) return this.getSource(id);
    const { data, error } = await supabase
      .from("sources")
      .update(row)
      .eq("id", id)
      .select("*")
      .single();
    throwIfError(error);
    return mapSource(data);
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
    const { data: existing, error: existingError } = await supabase
      .from("articles")
      .select("id, extraction_status")
      .eq("source_id", input.sourceId)
      .eq("canonical_url", input.canonicalUrl)
      .maybeSingle();
    throwIfError(existingError);

    const row = {
      source_id: input.sourceId,
      headline: input.headline,
      headline_language: input.language || null,
      context: input.context || null,
      url: input.url,
      canonical_url: input.canonicalUrl,
      published_at: input.publishedAt || null,
      byline: input.byline || null,
      image_url: input.imageUrl || null,
      language: input.language || null,
      topics_json: input.topics || [],
      raw_json: input.raw || {},
      content_hash: input.contentHash
    };

    const { data, error } = await supabase
      .from("articles")
      .upsert(row, { onConflict: "source_id,canonical_url" })
      .select("*, sources(name)")
      .single();
    throwIfError(error);

    return {
      article: mapArticle(data),
      inserted: !existing,
      needsExtraction:
        !existing || !existing.extraction_status || existing.extraction_status === "pending"
    };
  },

  async listArticles(filters: AnyRecord = {}) {
    if (filters.topicId) {
      let query = supabase
        .from("article_topic_evaluations")
        .select("status, confidence, reason, checked_at, articles(*, sources(name))")
        .eq("topic_id", filters.topicId);

      if (filters.status) query = query.eq("status", filters.status);

      const limit = Math.min(Number(filters.limit) || 50, 200);
      const offset = Number(filters.offset) || 0;
      const { data, error } = await query.limit(Math.max(offset + limit, limit));
      throwIfError(error);

      return data
        .map((row: any) =>
          mapArticle({
          ...row.articles,
          evaluation_status: row.status,
          evaluation_confidence: row.confidence,
          evaluation_reason: row.reason,
          evaluated_at: row.checked_at
          })
        )
        .sort(compareArticlesDesc)
        .slice(offset, offset + limit);
    }

    let query = supabase.from("articles").select("*, sources(name)");

    if (filters.sourceId) query = query.eq("source_id", filters.sourceId);
    if (filters.q) {
      const q = String(filters.q).replaceAll("%", "\\%");
      query = query.or(`headline.ilike.%${q}%,headline_sk.ilike.%${q}%,headline_en.ilike.%${q}%,context.ilike.%${q}%`);
    }
    if (filters.from) query = query.gte("published_at", filters.from);
    if (filters.to) query = query.lte("published_at", filters.to);

    const limit = Math.min(Number(filters.limit) || 50, 200);
    const offset = Number(filters.offset) || 0;
    const { data, error } = await query
      .order("discovered_at", { ascending: false })
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .range(offset, offset + limit - 1);
    throwIfError(error);
    return data.map(mapArticle);
  },

  async countArticlesBySource(sourceId: any) {
    const { count, error } = await supabase
      .from("articles")
      .select("id", { count: "exact", head: true })
      .eq("source_id", sourceId);
    throwIfError(error);
    return count || 0;
  },

  async getArticle(id: any) {
    const { data, error } = await supabase
      .from("articles")
      .select("*, sources(name)")
      .eq("id", id)
      .maybeSingle();
    throwIfError(error);
    return mapArticle(data);
  },

  async updateArticleContent(id: any, content: AnyRecord) {
    const status = content.status || content.extractionStatus || "failed";
    const provider = content.provider || content.extractionProvider || null;
    const row = {
      content_markdown: content.contentMarkdown || null,
      content_text: content.contentText || null,
      word_count:
        typeof content.wordCount === "number" && Number.isFinite(content.wordCount)
          ? content.wordCount
          : null,
      extraction_provider: provider,
      extraction_status: status,
      extraction_error: content.error || content.extractionError || null,
      extracted_at: nowIso()
    };

    const { data, error } = await supabase
      .from("articles")
      .update(row)
      .eq("id", id)
      .select("*, sources(name)")
      .single();
    throwIfError(error);
    return mapArticle(data);
  },

  async updateHeadlineTranslations(id: any, translation: AnyRecord) {
    const row = {
      headline_sk: translation.headlineSk || null,
      headline_en: translation.headlineEn || null,
      headline_language: translation.detectedLanguage || translation.language || null,
      headline_translated_at: translation.translatedAt || nowIso(),
      headline_translation_model: translation.model || null
    };

    const { data, error } = await supabase
      .from("articles")
      .update(row)
      .eq("id", id)
      .select("*, sources(name)")
      .single();
    throwIfError(error);
    return mapArticle(data);
  },

  async listArticlesMissingHeadlineTranslations(limit = 200) {
    const boundedLimit = Math.min(Number(limit) || 200, 1000);
    const { data, error } = await supabase
      .from("articles")
      .select("*, sources(name)")
      .or("headline_sk.is.null,headline_en.is.null")
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("discovered_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(boundedLimit);
    throwIfError(error);
    return data.map(mapArticle);
  },

  async countArticlesMissingHeadlineTranslations() {
    const { count, error } = await supabase
      .from("articles")
      .select("id", { count: "exact", head: true })
      .or("headline_sk.is.null,headline_en.is.null");
    throwIfError(error);
    return count || 0;
  },

  async listUnevaluatedForTopic(topicId: any, limit = 50) {
    const { data: evaluations, error: evaluationsError } = await supabase
      .from("article_topic_evaluations")
      .select("article_id")
      .eq("topic_id", topicId)
      .limit(10000);
    throwIfError(evaluationsError);

    const evaluatedIds = evaluations.map((row: any) => row.article_id);
    let query = supabase.from("articles").select("*, sources(name)");
    if (evaluatedIds.length) {
      query = query.not("id", "in", `(${evaluatedIds.join(",")})`);
    }

    const { data, error } = await query
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("discovered_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(Math.min(Number(limit) || 50, maxEvaluationBatchSize));
    throwIfError(error);
    return data.map(mapArticle);
  },

  async listArticlesMissingContent(limit = 20, options: AnyRecord = {}) {
    let query = supabase.from("articles").select("*, sources(name)");

    if (!options.force) {
      query = query.or("extraction_status.eq.pending,content_text.is.null");
    }

    const { data, error } = await query
      .order("discovered_at", { ascending: false })
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(Math.min(Number(limit) || 20, 200));
    throwIfError(error);
    return data.map(mapArticle);
  }
};

const topicRepo = {
  async listTopics() {
    const { data, error } = await supabase.from("topics").select("*").order("name");
    throwIfError(error);
    return data.map(mapTopic);
  },

  async getTopic(id: any) {
    const { data, error } = await supabase
      .from("topics")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    throwIfError(error);
    return mapTopic(data);
  },

  async createTopic(input: AnyRecord) {
    const { data, error } = await supabase
      .from("topics")
      .insert({
        name: input.name,
        description: input.description || null
      })
      .select("*")
      .single();
    throwIfError(error);
    return mapTopic(data);
  },

  async updateTopic(id: any, patch: AnyRecord) {
    const row: AnyRecord = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.description !== undefined) row.description = patch.description || null;
    if (!Object.keys(row).length) return this.getTopic(id);

    const { data, error } = await supabase
      .from("topics")
      .update(row)
      .eq("id", id)
      .select("*")
      .single();
    throwIfError(error);
    return mapTopic(data);
  },

  async deleteTopic(id: any) {
    const { error } = await supabase.from("topics").delete().eq("id", id);
    throwIfError(error);
  }
};

const evaluationRepo = {
  async listEvaluationsForArticles(articleIds: any[]) {
    const ids = Array.from(
      new Set(
        articleIds
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0)
      )
    );
    if (!ids.length) return [];

    const { data, error } = await supabase
      .from("article_topic_evaluations")
      .select("article_id, topic_id, status, confidence, checked_at")
      .in("article_id", ids);
    throwIfError(error);
    return data.map(mapArticleEvaluation).filter(Boolean);
  },

  async upsertEvaluation(input: AnyRecord) {
    const { error } = await supabase.from("article_topic_evaluations").upsert(
      {
        article_id: input.articleId,
        topic_id: input.topicId,
        status: input.status,
        confidence: input.confidence ?? null,
        reason: input.reason || null,
        model: input.model || null,
        raw_json: input.raw || {},
        checked_at: input.checkedAt || nowIso()
      },
      { onConflict: "article_id,topic_id" }
    );
    throwIfError(error);
  }
};

const checkRepo = {
  async createCheck(sourceId: any) {
    const { data, error } = await supabase
      .from("source_checks")
      .insert({
        source_id: sourceId,
        status: "running"
      })
      .select("id")
      .single();
    throwIfError(error);
    return data.id;
  },

  async finishCheck(id: any, patch: AnyRecord) {
    const { error } = await supabase
      .from("source_checks")
      .update({
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
      })
      .eq("id", id);
    throwIfError(error);
  }
};

const supabaseRepositories = {
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
  safeJsonParse
};

module.exports =
  storageDriver === "json" ? require("./jsonRepositories") : supabaseRepositories;
