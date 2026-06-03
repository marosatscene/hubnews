const Parser = require("rss-parser");
const {
  articleExtractionLimitPerSource,
  checkerBatchSize,
  checkerMaxRuntimeMs,
  firecrawlMinDirectResults,
  headlineTranslationLimitPerSource,
  maxArticlesPerSource,
  robotsBotName,
  robotsWarningsMaxStored
} = require("../config");
const { fetchText } = require("../lib/http");
const { articleRepo, checkRepo, sourceRepo } = require("../db/repositories");
const { discoverFeedUrl } = require("./feedDiscovery");
const firecrawl = require("./firecrawl");
const {
  extractHeadlinesFromHtml,
  extractHeadlinesFromLinks
} = require("./homepageScraper");
const { normalizeFeedItem, normalizeHtmlHeadline } = require("./articleNormalizer");
const { extractArticle } = require("./articleExtractor");
const {
  hasHeadlineTranslations,
  translateHeadlines
} = require("./headlineTranslator");
const robots = require("./robots");
const { isDue } = require("./schedulePolicy");

type AnyRecord = Record<string, any>;

const parser = new Parser({
  timeout: 15000,
  customFields: {
    item: ["media:content", "media:thumbnail"]
  }
});

function checkedLimit(value: any, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function dueSortValue(source: AnyRecord) {
  if (!source.lastCheckedAt) return 0;
  const time = new Date(source.lastCheckedAt).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function selectDueSources(sources: AnyRecord[], options: AnyRecord = {}) {
  const dueSources = sources
    .filter((source) => source.enabled !== false && (options.force || isDue(source)))
    .sort((left, right) => dueSortValue(left) - dueSortValue(right));
  const dueCount = dueSources.length;
  const limit = Math.min(checkedLimit(options.limit, checkerBatchSize), dueCount);

  return {
    dueCount,
    selectedSources: dueSources.slice(0, limit)
  };
}

async function sourceNeedsMissingRefetch(source: AnyRecord, repository = articleRepo) {
  if (source.enabled === false) return false;
  if (!source.lastSuccessAt || source.lastError) return true;

  const articles = await repository.listArticles({
    sourceId: source.id,
    limit: 1,
    offset: 0
  });
  return articles.length === 0;
}

async function selectMissingSources(
  sources: AnyRecord[],
  options: AnyRecord = {},
  repository = articleRepo
) {
  const missingSources = [];
  for (const source of sources) {
    if (await sourceNeedsMissingRefetch(source, repository)) {
      missingSources.push(source);
    }
  }

  missingSources.sort((left, right) => dueSortValue(left) - dueSortValue(right));
  const missingCount = missingSources.length;
  const limit = Math.min(checkedLimit(options.limit, checkerBatchSize), missingCount);

  return {
    missingCount,
    selectedSources: missingSources.slice(0, limit)
  };
}

function isPastDeadline(deadlineMs: any, bufferMs = 1000) {
  return deadlineMs && Date.now() >= deadlineMs - bufferMs;
}

function createSourceContext(options: AnyRecord = {}) {
  const robotsWarnings = [];
  let robotsWarningCount = 0;

  function recordRobotsWarning(url: string, matchedRule: AnyRecord | null, stage: string) {
    robotsWarningCount += 1;
    if (robotsWarnings.length >= robotsWarningsMaxStored) return;
    robotsWarnings.push({
      url,
      stage,
      matchedRule: matchedRule
        ? {
            directive: matchedRule.directive,
            pattern: matchedRule.pattern,
            lineNumber: matchedRule.lineNumber
          }
        : null
    });
  }

  return {
    robotsCache: options.robotsCache || robots.createRobotsCache({ botName: robotsBotName }),
    deadlineMs: options.deadlineMs,
    counters: {
      directScrapeCount: 0,
      firecrawlCallCount: 0
    },
    robotsWarnings,
    recordRobotsWarning,
    get robotsWarningCount() {
      return robotsWarningCount;
    }
  };
}

async function checkRobots(ctx: AnyRecord, url: string, stage: string) {
  const result = await robots.checkUrl(ctx.robotsCache, url, {
    warn: false,
    botName: robotsBotName
  });
  if (!result.allowed) {
    ctx.recordRobotsWarning(url, result.matchedRule, stage);
  }
  return result;
}

async function loadFeedArticles(source: AnyRecord, feedUrl: string, ctx: AnyRecord) {
  await checkRobots(ctx, feedUrl, "feed");
  ctx.counters.directScrapeCount += 1;
  const xml = await fetchText(feedUrl);
  const feed = await parser.parseString(xml);
  return feed.items
    .map((item) => normalizeFeedItem(item, source))
    .filter(Boolean);
}

async function loadHomepageArticles(source: AnyRecord, limit: number, ctx: AnyRecord) {
  await checkRobots(ctx, source.homepageUrl, "homepage");
  ctx.counters.directScrapeCount += 1;
  const html = await fetchText(source.homepageUrl, {
    accept: "text/html, application/xhtml+xml"
  });
  const candidates = extractHeadlinesFromHtml(html, source, limit);
  return candidates
    .map((candidate) => normalizeHtmlHeadline(candidate, source))
    .filter(Boolean);
}

async function loadFirecrawlListingArticles(source: AnyRecord, limit: number, ctx: AnyRecord) {
  if (!firecrawl.isEnabled()) return [];

  await checkRobots(ctx, source.homepageUrl, "firecrawl-listing");
  ctx.counters.firecrawlCallCount += 1;
  const result = await firecrawl.scrapeForLinks(source.homepageUrl);
  if (result.status !== "success" && !result.ok) return [];

  const candidatesByUrl = new Map();
  for (const candidate of extractHeadlinesFromLinks(result.links || [], source, limit)) {
    candidatesByUrl.set(candidate.url, candidate);
  }
  for (const candidate of extractHeadlinesFromHtml(result.html || "", source, limit, "firecrawl-html")) {
    if (!candidatesByUrl.has(candidate.url)) candidatesByUrl.set(candidate.url, candidate);
    if (candidatesByUrl.size >= limit) break;
  }

  return [...candidatesByUrl.values()]
    .slice(0, limit)
    .map((candidate) => normalizeHtmlHeadline(candidate, source))
    .filter(Boolean);
}

function normalizeExtractionStatus(status: string) {
  if (status === "success") return "extracted";
  if (status === "skipped") return "skipped";
  return "failed";
}

async function extractArticleContentForTargets(targets: AnyRecord[], source: AnyRecord, ctx: AnyRecord) {
  const limit = Math.min(
    articleExtractionLimitPerSource,
    source.scrapeConfig.articleExtractionLimit || articleExtractionLimitPerSource
  );
  let extractedCount = 0;
  let failedCount = 0;

  for (const article of targets.slice(0, limit)) {
    if (isPastDeadline(ctx.deadlineMs, 5000)) break;

    const result = await extractArticle(article.url, {
      robotsCache: ctx.robotsCache,
      robotsBotName,
      counters: ctx.counters,
      recordRobotsWarning: ctx.recordRobotsWarning
    });

    const status = normalizeExtractionStatus(result.status);
    if (status === "extracted") extractedCount += 1;
    if (status === "failed") failedCount += 1;

    await articleRepo.updateArticleContent(article.id, {
      contentMarkdown: result.contentMarkdown,
      contentText: result.contentText,
      wordCount: result.wordCount,
      provider: result.source,
      status,
      error: result.error || result.reason || null
    });
  }

  return { extractedCount, failedCount };
}

async function translateHeadlineTargets(targets: AnyRecord[], source: AnyRecord) {
  const limit = Math.min(
    headlineTranslationLimitPerSource,
    source.scrapeConfig.headlineTranslationLimit || headlineTranslationLimitPerSource
  );
  const candidates = targets
    .filter((article) => !hasHeadlineTranslations(article))
    .slice(0, limit)
    .map((article) => ({
      ...article,
      language: article.language || source.language,
      sourceName: article.sourceName || source.name
    }));

  if (!candidates.length) return { translatedCount: 0, failedCount: 0 };

  try {
    const translations = await translateHeadlines(candidates);
    let translatedCount = 0;
    let failedCount = 0;

    for (const translation of translations) {
      if (translation.headlineSk || translation.headlineEn) {
        await articleRepo.updateHeadlineTranslations(translation.articleId, translation);
        translatedCount += 1;
      } else {
        failedCount += 1;
      }
    }

    failedCount += Math.max(candidates.length - translations.length, 0);
    return { translatedCount, failedCount };
  } catch {
    return { translatedCount: 0, failedCount: candidates.length };
  }
}

async function aggregateSource(source: AnyRecord, options: AnyRecord = {}) {
  const checkId = await checkRepo.createCheck(source.id);
  const ctx = createSourceContext(options);
  let feedUrl = source.feedUrl;
  let articles = [];
  let insertedCount = 0;
  let updatedCount = 0;
  let contentExtractedCount = 0;
  let contentFailedCount = 0;
  let headlineTranslatedCount = 0;
  let headlineTranslationFailedCount = 0;
  let scrapeError = null;

  try {
    if (!feedUrl) {
      try {
        await checkRobots(ctx, source.homepageUrl, "feed-discovery");
        ctx.counters.directScrapeCount += 1;
        feedUrl = await discoverFeedUrl(source.homepageUrl);
        if (feedUrl) {
          await sourceRepo.updateSource(source.id, { feedUrl });
        }
      } catch (error) {
        scrapeError = error;
      }
    }

    if (feedUrl) {
      try {
        articles = await loadFeedArticles(source, feedUrl, ctx);
      } catch (error) {
        scrapeError = error;
        articles = [];
      }
    }

    const maxItems = source.scrapeConfig.maxArticles || maxArticlesPerSource;
    if (!articles.length) {
      try {
        articles = await loadHomepageArticles(source, maxItems, ctx);
      } catch (error) {
        scrapeError = error;
        articles = [];
      }
    }

    if (articles.length < firecrawlMinDirectResults) {
      const fallbackArticles = await loadFirecrawlListingArticles(source, maxItems, ctx);
      if (fallbackArticles.length > articles.length) articles = fallbackArticles;
    }

    if (!articles.length && scrapeError) {
      throw scrapeError;
    }

    const extractionTargets = [];
    const headlineTranslationTargets = [];
    for (const article of articles.slice(0, maxItems)) {
      const result = await articleRepo.upsertArticle(article);
      if (result.inserted) insertedCount += 1;
      else updatedCount += 1;
      if (result.inserted || !hasHeadlineTranslations(result.article)) {
        headlineTranslationTargets.push(result.article);
      }
      if (result.needsExtraction) extractionTargets.push(result.article);
    }

    if (headlineTranslationTargets.length && !isPastDeadline(ctx.deadlineMs, 5000)) {
      const translationResult = await translateHeadlineTargets(
        headlineTranslationTargets,
        source
      );
      headlineTranslatedCount = translationResult.translatedCount;
      headlineTranslationFailedCount = translationResult.failedCount;
    }

    if (extractionTargets.length && !isPastDeadline(ctx.deadlineMs, 5000)) {
      const extractionResult = await extractArticleContentForTargets(
        extractionTargets,
        source,
        ctx
      );
      contentExtractedCount = extractionResult.extractedCount;
      contentFailedCount = extractionResult.failedCount;
    }

    await checkRepo.finishCheck(checkId, {
      status: "success",
      feedUrl,
      itemsFound: articles.length,
      insertedCount,
      updatedCount,
      directScrapeCount: ctx.counters.directScrapeCount,
      firecrawlCallCount: ctx.counters.firecrawlCallCount,
      robotsWarningCount: ctx.robotsWarningCount,
      robotsWarnings: ctx.robotsWarnings
    });
    await sourceRepo.markSourceSuccess(source.id, feedUrl);

    return {
      sourceId: source.id,
      sourceName: source.name,
      status: "success",
      feedUrl,
      itemsFound: articles.length,
      insertedCount,
      updatedCount,
      contentExtractedCount,
      contentFailedCount,
      headlineTranslatedCount,
      headlineTranslationFailedCount,
      directScrapeCount: ctx.counters.directScrapeCount,
      firecrawlCallCount: ctx.counters.firecrawlCallCount,
      robotsWarningCount: ctx.robotsWarningCount
    };
  } catch (error: any) {
    await checkRepo.finishCheck(checkId, {
      status: "failed",
      feedUrl,
      error: error.message,
      directScrapeCount: ctx.counters.directScrapeCount,
      firecrawlCallCount: ctx.counters.firecrawlCallCount,
      robotsWarningCount: ctx.robotsWarningCount,
      robotsWarnings: ctx.robotsWarnings
    });
    await sourceRepo.markSourceFailure(source.id, error.message);

    return {
      sourceId: source.id,
      sourceName: source.name,
      status: "failed",
      feedUrl,
      error: error.message,
      directScrapeCount: ctx.counters.directScrapeCount,
      firecrawlCallCount: ctx.counters.firecrawlCallCount,
      robotsWarningCount: ctx.robotsWarningCount
    };
  }
}

async function aggregateSourceById(id: any) {
  const source = await sourceRepo.getSource(id);
  if (!source) {
    const error: any = new Error("Source not found");
    error.status = 404;
    throw error;
  }
  return aggregateSource(source);
}

async function aggregateSources(options: AnyRecord = {}) {
  const allEnabledSources = await sourceRepo.listSources({ enabled: true });
  const { dueCount, selectedSources } = selectDueSources(allEnabledSources, options);
  const deadlineMs = Date.now() + checkerMaxRuntimeMs;
  const robotsCache = robots.createRobotsCache({ botName: robotsBotName });
  const results = [];
  for (const source of selectedSources) {
    if (isPastDeadline(deadlineMs, 1000)) break;
    results.push(await aggregateSource(source, { robotsCache, deadlineMs }));
  }

  return {
    checkedCount: results.length,
    dueCount,
    remainingDueCount: Math.max(dueCount - results.length, 0),
    results
  };
}

async function aggregateMissingSources(options: AnyRecord = {}) {
  const allEnabledSources = await sourceRepo.listSources({ enabled: true });
  const { missingCount, selectedSources } = await selectMissingSources(
    allEnabledSources,
    options,
    articleRepo
  );
  const deadlineMs = Date.now() + checkerMaxRuntimeMs;
  const robotsCache = robots.createRobotsCache({ botName: robotsBotName });
  const results = [];

  for (const source of selectedSources) {
    if (isPastDeadline(deadlineMs, 1000)) break;
    results.push(await aggregateSource(source, { robotsCache, deadlineMs }));
  }

  const refreshedSources = await sourceRepo.listSources({ enabled: true });
  const afterRun = await selectMissingSources(refreshedSources, { limit: Number.MAX_SAFE_INTEGER }, articleRepo);

  return {
    checkedCount: results.length,
    missingCount,
    remainingMissingCount: afterRun.missingCount,
    results
  };
}

module.exports = {
  aggregateMissingSources,
  aggregateSource,
  aggregateSourceById,
  aggregateSources,
  selectMissingSources,
  selectDueSources,
  isDue
};
