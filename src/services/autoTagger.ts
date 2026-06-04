const {
  autoTaggingLimitPerTopic,
  llmFilterUrl,
  maxEvaluationBatchSize,
  openaiApiKey,
  openaiAutoTaggingModel
} = require("../config");
const {
  articleRepo: defaultArticleRepo,
  evaluationRepo: defaultEvaluationRepo,
  topicRepo: defaultTopicRepo
} = require("../db/repositories");
const { filterArticlesForTopic: defaultFilterArticlesForTopic } = require("./headlineFilter");

type AnyRecord = Record<string, any>;

function positiveLimit(value: any, fallback: number) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maxEvaluationBatchSize);
}

function evaluationKey(articleId: any, topicId: any) {
  return `${Number(articleId)}:${Number(topicId)}`;
}

function summarizeResults(results: AnyRecord[]) {
  return {
    evaluatedCount: results.length,
    matchedCount: results.filter((result) => result.status === "matched").length,
    rejectedCount: results.filter((result) => result.status === "rejected").length
  };
}

function keepResultsForTargets(results: AnyRecord[], targets: AnyRecord[]) {
  const targetIds = new Set(targets.map((article) => Number(article.id)).filter(Number.isFinite));
  const seenIds = new Set<number>();

  return results
    .map((result) => ({
      ...result,
      articleId: Number(result.articleId)
    }))
    .filter((result) => {
      if (!Number.isFinite(result.articleId)) return false;
      if (!targetIds.has(result.articleId)) return false;
      if (seenIds.has(result.articleId)) return false;
      seenIds.add(result.articleId);
      return true;
    });
}

function hasAutoTaggingLlmProvider(options: AnyRecord = {}) {
  const filterOptions = options.filterOptions || {};
  return Boolean(
    filterOptions.filterUrl ||
      llmFilterUrl ||
      filterOptions.apiKey ||
      openaiApiKey ||
      filterOptions.batchFilter
  );
}

async function existingEvaluationKeys(evaluationRepo: AnyRecord, articles: AnyRecord[]): Promise<Set<string>> {
  if (!articles.length || typeof evaluationRepo.listEvaluationsForArticles !== "function") {
    return new Set<string>();
  }

  const evaluations = await evaluationRepo.listEvaluationsForArticles(
    articles.map((article) => article.id).filter(Boolean)
  );
  return new Set<string>(
    evaluations
      .filter((evaluation: AnyRecord) => evaluation.articleId && evaluation.topicId)
      .map((evaluation: AnyRecord) => evaluationKey(evaluation.articleId, evaluation.topicId))
  );
}

async function listTargetsForTopic(topic: AnyRecord, options: AnyRecord, existingKeys: Set<string>) {
  const limitPerTopic = options.limitPerTopic;
  if (Array.isArray(options.articles)) {
    return options.articles
      .filter((article: AnyRecord) => article?.id && !existingKeys.has(evaluationKey(article.id, topic.id)))
      .slice(0, limitPerTopic);
  }

  return options.articleRepo.listUnevaluatedForTopic(topic.id, limitPerTopic);
}

async function storeResults(evaluationRepo: AnyRecord, topic: AnyRecord, results: AnyRecord[]) {
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
}

async function autoTagArticlesForTopics(options: AnyRecord = {}) {
  const articleRepo = options.articleRepo || defaultArticleRepo;
  const evaluationRepo = options.evaluationRepo || defaultEvaluationRepo;
  const topicRepo = options.topicRepo || defaultTopicRepo;
  const filterArticlesForTopic = options.filterArticlesForTopic || defaultFilterArticlesForTopic;
  const usesDefaultFilter = filterArticlesForTopic === defaultFilterArticlesForTopic;
  const topics = Array.isArray(options.topics) ? options.topics : await topicRepo.listTopics();
  const limitPerTopic = positiveLimit(options.limitPerTopic, autoTaggingLimitPerTopic);
  const articles = Array.isArray(options.articles)
    ? options.articles.filter((article: AnyRecord) => article?.id)
    : undefined;
  const existingKeys: Set<string> = articles
    ? await existingEvaluationKeys(evaluationRepo, articles)
    : new Set<string>();
  const filterOptions = {
    ...(options.filterOptions || {}),
    model: options.model || openaiAutoTaggingModel,
    requireLlm: options.requireLlm !== false
  };

  if (filterOptions.requireLlm && usesDefaultFilter && !hasAutoTaggingLlmProvider(options)) {
    const error: any = new Error("Auto-tagging requires OPENAI_API_KEY or LLM_FILTER_URL");
    error.status = 400;
    throw error;
  }

  const topicResults = [];
  const allResults = [];

  for (const topic of topics) {
    const targets = await listTargetsForTopic(
      topic,
      {
        articleRepo,
        articles,
        limitPerTopic
      },
      existingKeys
    );

    if (!targets.length) {
      topicResults.push({
        topicId: topic.id,
        topicName: topic.name,
        requestedCount: 0,
        evaluatedCount: 0,
        matchedCount: 0,
        rejectedCount: 0
      });
      continue;
    }

    const results = keepResultsForTargets(
      await filterArticlesForTopic(topic, targets, filterOptions),
      targets
    );
    await storeResults(evaluationRepo, topic, results);
    const summary = summarizeResults(results);

    topicResults.push({
      topicId: topic.id,
      topicName: topic.name,
      requestedCount: targets.length,
      ...summary
    });
    allResults.push(...results);
  }

  return {
    model: filterOptions.model,
    topicCount: topics.length,
    limitPerTopic,
    ...summarizeResults(allResults),
    topics: topicResults
  };
}

module.exports = {
  autoTagArticlesForTopics,
  evaluationKey,
  hasAutoTaggingLlmProvider,
  summarizeResults
};
