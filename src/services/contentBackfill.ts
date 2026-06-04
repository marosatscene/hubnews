const { articleRepo, sourceRepo } = require("../db/repositories");
const { articleExtractionLimitPerSource, robotsBotName } = require("../config");
const { extractArticle } = require("./articleExtractor");
const robots = require("./robots");

type AnyRecord = Record<string, any>;

function normalizeExtractionStatus(status: string) {
  if (status === "success") return "extracted";
  if (status === "skipped") return "skipped";
  return "failed";
}

function boundedLimit(value: any, fallback: number) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 200);
}

async function extractMissingArticleContent(options: AnyRecord = {}) {
  if (typeof articleRepo.listArticlesMissingContent !== "function") {
    return {
      requestedCount: 0,
      extractedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      results: []
    };
  }

  const limit = boundedLimit(options.limit, articleExtractionLimitPerSource || 20);
  const articles = await articleRepo.listArticlesMissingContent(limit, {
    force: Boolean(options.force)
  });
  const robotsCache = robots.createRobotsCache({ botName: robotsBotName });
  const counters = {
    directScrapeCount: 0,
    firecrawlCallCount: 0
  };
  const results = [];

  for (const article of articles) {
    const source = article.sourceId ? await sourceRepo.getSource(article.sourceId) : null;
    const robotsWarnings = [];
    const result = await extractArticle(article.url, {
      counters,
      robotsBotName,
      robotsCache,
      recordRobotsWarning(url: string, matchedRule: AnyRecord | null, stage: string) {
        robotsWarnings.push({ url, matchedRule, stage });
      }
    });
    const status = normalizeExtractionStatus(result.status);

    await articleRepo.updateArticleContent(article.id, {
      contentMarkdown: result.contentMarkdown,
      contentText: result.contentText,
      wordCount: result.wordCount,
      provider: result.source,
      status,
      error: result.error || result.reason || null
    });

    results.push({
      articleId: article.id,
      sourceId: article.sourceId,
      sourceName: source?.name || article.sourceName || null,
      headline: article.headline,
      status,
      provider: result.source || null,
      wordCount: result.wordCount || 0,
      error: result.error || result.reason || null,
      robotsWarningCount: robotsWarnings.length
    });
  }

  return {
    requestedCount: articles.length,
    extractedCount: results.filter((result) => result.status === "extracted").length,
    skippedCount: results.filter((result) => result.status === "skipped").length,
    failedCount: results.filter((result) => result.status === "failed").length,
    directScrapeCount: counters.directScrapeCount,
    firecrawlCallCount: counters.firecrawlCallCount,
    results
  };
}

module.exports = {
  extractMissingArticleContent
};
