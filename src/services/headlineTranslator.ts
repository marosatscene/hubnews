const {
  headlineTranslationBatchSize,
  headlineTranslationConcurrency,
  openaiApiKey,
  openaiResponsesApiUrl,
  openaiTranslationModel
} = require("../config");
const { cleanText, truncate } = require("../lib/text");

type AnyRecord = Record<string, any>;

function normalizeLanguage(value: any) {
  const language = String(value || "").trim().toLowerCase();
  if (!language) return null;
  if (["sk", "slovak", "slovakian", "slovenčina", "slovencina"].includes(language)) return "sk";
  if (["en", "eng", "english"].includes(language)) return "en";
  return language.split(/[-_]/)[0] || null;
}

function cleanHeadline(value: any) {
  const text = cleanText(String(value || ""));
  return text ? truncate(text, 500) : null;
}

function hasHeadlineTranslations(article: AnyRecord) {
  return Boolean(cleanHeadline(article.headlineSk || article.headline_sk)) &&
    Boolean(cleanHeadline(article.headlineEn || article.headline_en));
}

function articlePayload(article: AnyRecord) {
  return {
    id: article.id,
    headline: article.headline,
    language: normalizeLanguage(article.headlineLanguage || article.language),
    sourceName: article.sourceName || article.source_name || null
  };
}

function positiveInteger(value: any, fallback: number) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function chunkArticles(articles: AnyRecord[], batchSize: number) {
  const chunks = [];
  for (let index = 0; index < articles.length; index += batchSize) {
    chunks.push(articles.slice(index, index + batchSize));
  }
  return chunks;
}

async function mapWithConcurrency(items: any[], concurrency: number, worker: any) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => run())
  );
  return results;
}

function shortcutTranslation(article: AnyRecord, model: string) {
  const headline = cleanHeadline(article.headline);
  const language = normalizeLanguage(article.headlineLanguage || article.language);
  return {
    articleId: article.id,
    headlineSk: language === "sk" ? headline : null,
    headlineEn: language === "en" ? headline : null,
    detectedLanguage: language,
    model,
    raw: { shortcut: true }
  };
}

function mergeWithShortcut(article: AnyRecord, result: AnyRecord, defaultModel: string) {
  const shortcut = shortcutTranslation(article, defaultModel);
  const detectedLanguage = normalizeLanguage(
    result.detectedLanguage || result.language || shortcut.detectedLanguage
  );

  return {
    articleId: result.articleId || result.id || article.id,
    headlineSk: cleanHeadline(result.headlineSk) || shortcut.headlineSk,
    headlineEn: cleanHeadline(result.headlineEn) || shortcut.headlineEn,
    detectedLanguage,
    model: result.model || defaultModel,
    raw: result
  };
}

function normalizeTranslationResults(
  results: AnyRecord[],
  articles: AnyRecord[],
  defaultModel: string
) {
  const articlesById = new Map(articles.map((article) => [Number(article.id), article]));
  return results
    .map((result) => {
      const articleId = Number(result.articleId || result.id);
      const article = articlesById.get(articleId);
      if (!article) return null;
      return mergeWithShortcut(article, result, defaultModel);
    })
    .filter(Boolean);
}

function fallbackTranslations(articles: AnyRecord[], reason = "openai_missing_api_key") {
  return articles.map((article) => ({
    ...shortcutTranslation(article, "headline-translation-fallback"),
    raw: { reason }
  }));
}

function extractOpenAIResponseText(payload: AnyRecord) {
  if (typeof payload.output_text === "string") return payload.output_text;
  if (!Array.isArray(payload.output)) return "";

  return payload.output
    .flatMap((item: AnyRecord) => (Array.isArray(item.content) ? item.content : []))
    .map((content: AnyRecord) => content.text || "")
    .join("")
    .trim();
}

function openaiHeadlineTranslationRequestBody(
  articles: AnyRecord[],
  model: string
) {
  return {
    model,
    input: [
      {
        role: "system",
        content:
          "Translate news headlines to Slovak and English. Preserve names, places, numbers, quotes, and meaning. If a headline is already in a target language, copy it unchanged for that target. Return strict JSON only."
      },
      {
        role: "user",
        content: JSON.stringify({
          targets: ["sk", "en"],
          articles: articles.map(articlePayload)
        })
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "headline_translation_results",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            results: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  articleId: { type: "number" },
                  detectedLanguage: { type: "string" },
                  headlineSk: { type: "string" },
                  headlineEn: { type: "string" }
                },
                required: ["articleId", "detectedLanguage", "headlineSk", "headlineEn"]
              }
            }
          },
          required: ["results"]
        }
      }
    }
  };
}

async function callOpenAIHeadlineTranslation(
  articles: AnyRecord[],
  options: AnyRecord = {}
) {
  const apiKey = options.apiKey || openaiApiKey;
  if (!apiKey) return fallbackTranslations(articles);

  const model = options.model || openaiTranslationModel;
  const response = await fetch(options.apiUrl || openaiResponsesApiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(openaiHeadlineTranslationRequestBody(articles, model))
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenAI headline translation returned HTTP ${response.status}${body ? `: ${body}` : ""}`);
  }

  const payload = await response.json();
  const responseText = extractOpenAIResponseText(payload);
  const parsed = responseText ? JSON.parse(responseText) : payload;
  if (!Array.isArray(parsed.results)) {
    throw new Error("OpenAI headline translation response must include a results array");
  }

  return normalizeTranslationResults(parsed.results, articles, model);
}

async function translateHeadlineBatch(articles: AnyRecord[], options: AnyRecord = {}) {
  if (!articles.length) return [];
  if (typeof options.batchTranslator === "function") {
    return options.batchTranslator(articles);
  }
  return callOpenAIHeadlineTranslation(articles, options);
}

async function translateHeadlines(articles: AnyRecord[], options: AnyRecord = {}) {
  const targets = articles.filter((article) => article.id && article.headline && !hasHeadlineTranslations(article));
  if (!targets.length) return [];

  const batchSize = positiveInteger(
    options.batchSize,
    positiveInteger(headlineTranslationBatchSize, 25)
  );
  const concurrency = positiveInteger(
    options.concurrency,
    positiveInteger(headlineTranslationConcurrency, 2)
  );
  const batches = chunkArticles(targets, batchSize);
  const results = await mapWithConcurrency(batches, concurrency, (batch: AnyRecord[]) =>
    translateHeadlineBatch(batch, options)
  );

  return results.flat();
}

module.exports = {
  callOpenAIHeadlineTranslation,
  fallbackTranslations,
  hasHeadlineTranslations,
  normalizeLanguage,
  normalizeTranslationResults,
  openaiHeadlineTranslationRequestBody,
  translateHeadlines
};
