const {
  llmFilterBatchSize,
  llmFilterConcurrency,
  llmFilterUrl,
  openaiApiKey,
  openaiFilterModel,
  openaiResponsesApiUrl
} = require("../config");
const { tokenize } = require("../lib/text");

type AnyRecord = Record<string, any>;

function articlePayload(article: AnyRecord) {
  return {
    id: article.id,
    headline: article.headline,
    context: article.context,
    sourceName: article.sourceName,
    publishedAt: article.publishedAt,
    url: article.url
  };
}

function normalizeFilterResults(results: AnyRecord[], defaultModel: string) {
  return results.map((result) => ({
    articleId: result.articleId || result.id,
    status: result.status === "matched" ? "matched" : "rejected",
    confidence:
      typeof result.confidence === "number" ? Math.max(0, Math.min(1, result.confidence)) : null,
    reason: result.reason || null,
    model: result.model || defaultModel,
    raw: result
  }));
}

function keywordFallback(topic: AnyRecord, articles: AnyRecord[]) {
  const terms = new Set(tokenize(`${topic.name} ${topic.description || ""}`));
  return articles.map((article) => {
    const articleTerms = new Set(tokenize(`${article.headline} ${article.context || ""}`));
    const overlap = [...terms].filter((term) => articleTerms.has(term));
    const matched = overlap.length > 0;
    return {
      articleId: article.id,
      status: matched ? "matched" : "rejected",
      confidence: matched ? Math.min(0.5 + overlap.length * 0.1, 0.85) : 0.25,
      reason: matched
        ? `Keyword fallback matched: ${overlap.slice(0, 5).join(", ")}`
        : "Keyword fallback found no topic terms in the headline/context.",
      model: "keyword-fallback",
      raw: { overlap }
    };
  });
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

async function callExternalFilter(topic: AnyRecord, articles: AnyRecord[], filterUrl = llmFilterUrl) {
  const response = await fetch(filterUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      topic,
      articles: articles.map(articlePayload)
    })
  });

  if (!response.ok) {
    throw new Error(`LLM filter returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload.results)) {
    throw new Error("LLM filter response must include a results array");
  }

  return normalizeFilterResults(payload.results, "external-llm-filter");
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

function openaiRequestBody(topic: AnyRecord, articles: AnyRecord[], model: string) {
  return {
    model,
    input: [
      {
        role: "system",
        content:
          "Classify whether each news headline is relevant to the user's topic. Use headline, context, source, date, and link only. Return strict JSON only."
      },
      {
        role: "user",
        content: JSON.stringify({
          topic: {
            id: topic.id,
            name: topic.name,
            description: topic.description || ""
          },
          articles: articles.map(articlePayload)
        })
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "headline_filter_results",
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
                  status: { type: "string", enum: ["matched", "rejected"] },
                  confidence: { type: "number" },
                  reason: { type: "string" }
                },
                required: ["articleId", "status", "confidence", "reason"]
              }
            }
          },
          required: ["results"]
        }
      }
    }
  };
}

async function callOpenAIFilter(
  topic: AnyRecord,
  articles: AnyRecord[],
  options: AnyRecord = {}
) {
  const apiKey = options.apiKey || openaiApiKey;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const model = options.model || openaiFilterModel;
  const response = await fetch(options.apiUrl || openaiResponsesApiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(openaiRequestBody(topic, articles, model))
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenAI filter returned HTTP ${response.status}${body ? `: ${body}` : ""}`);
  }

  const payload = await response.json();
  const responseText = extractOpenAIResponseText(payload);
  const parsed = responseText ? JSON.parse(responseText) : payload;

  if (!Array.isArray(parsed.results)) {
    throw new Error("OpenAI filter response must include a results array");
  }

  return normalizeFilterResults(parsed.results, model);
}

async function filterArticleBatch(topic: AnyRecord, articles: AnyRecord[], options: AnyRecord = {}) {
  if (!articles.length) return [];
  if (typeof options.batchFilter === "function") {
    return options.batchFilter(topic, articles);
  }

  const filterUrl = options.filterUrl || llmFilterUrl;
  if (filterUrl) return callExternalFilter(topic, articles, filterUrl);
  if (options.apiKey || openaiApiKey) return callOpenAIFilter(topic, articles, options);
  return keywordFallback(topic, articles);
}

async function filterArticlesForTopic(
  topic: AnyRecord,
  articles: AnyRecord[],
  options: AnyRecord = {}
) {
  if (!articles.length) return [];

  const batchSize = positiveInteger(options.batchSize, positiveInteger(llmFilterBatchSize, 50));
  const concurrency = positiveInteger(
    options.concurrency,
    positiveInteger(llmFilterConcurrency, 3)
  );
  const batches = chunkArticles(articles, batchSize);
  const results = await mapWithConcurrency(batches, concurrency, (batch: AnyRecord[]) =>
    filterArticleBatch(topic, batch, options)
  );

  return results.flat();
}

module.exports = {
  callExternalFilter,
  callOpenAIFilter,
  chunkArticles,
  filterArticlesForTopic,
  keywordFallback,
  mapWithConcurrency,
  normalizeFilterResults,
  openaiRequestBody
};
