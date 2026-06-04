const {
  openaiApiKey,
  openaiEmbeddingsApiUrl,
  openaiEmbeddingsModel,
  storageDriver
} = require("../config");
const { articleRepo } = require("../db/repositories");

type AnyRecord = Record<string, any>;

function assertLocalVectorStore() {
  if (storageDriver !== "json") {
    const error: any = new Error("Semantic vector prototype is local-only; set STORAGE_DRIVER=json.");
    error.status = 400;
    throw error;
  }

  for (const methodName of ["listArticlesMissingEmbeddings", "upsertArticleEmbedding", "listArticleEmbeddings"]) {
    if (typeof articleRepo[methodName] !== "function") {
      const error: any = new Error(`Local vector store is missing ${methodName}.`);
      error.status = 500;
      throw error;
    }
  }
}

function assertEmbeddingProvider() {
  if (!openaiApiKey) {
    const error: any = new Error("Semantic embeddings require OPENAI_API_KEY.");
    error.status = 400;
    throw error;
  }
}

function boundedLimit(value: any, fallback: number) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 200);
}

function chunk(items: any[], size: number) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function embedTexts(texts: string[], model = openaiEmbeddingsModel) {
  assertEmbeddingProvider();
  if (!texts.length) return [];

  const response = await fetch(openaiEmbeddingsApiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: texts
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Embeddings API returned HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  if (!Array.isArray(payload.data)) {
    throw new Error("Embeddings API response did not include data array.");
  }

  return payload.data
    .sort((left: AnyRecord, right: AnyRecord) => left.index - right.index)
    .map((item: AnyRecord) => item.embedding);
}

function dot(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length);
  let value = 0;
  for (let index = 0; index < length; index += 1) value += left[index] * right[index];
  return value;
}

function magnitude(vector: number[]) {
  return Math.sqrt(dot(vector, vector));
}

function cosineSimilarity(left: number[], right: number[]) {
  const denominator = magnitude(left) * magnitude(right);
  return denominator ? dot(left, right) / denominator : 0;
}

async function backfillLocalArticleEmbeddings(options: AnyRecord = {}) {
  assertLocalVectorStore();
  const model = options.model || openaiEmbeddingsModel;
  const limit = boundedLimit(options.limit, 50);
  const articles = await articleRepo.listArticlesMissingEmbeddings(model, limit);
  let embeddedCount = 0;

  for (const batch of chunk(articles, 25)) {
    const embeddings = await embedTexts(batch.map((article: AnyRecord) => article.embeddingText), model);
    for (let index = 0; index < batch.length; index += 1) {
      const article = batch[index];
      const embedding = embeddings[index];
      if (!Array.isArray(embedding)) continue;
      await articleRepo.upsertArticleEmbedding({
        articleId: article.id,
        model,
        embedding,
        textHash: article.embeddingTextHash
      });
      embeddedCount += 1;
    }
  }

  return {
    model,
    requestedCount: articles.length,
    embeddedCount
  };
}

async function semanticSearchLocalArticles(query: string, options: AnyRecord = {}) {
  assertLocalVectorStore();
  const trimmed = String(query || "").trim();
  if (!trimmed) {
    const error: any = new Error("Search query is required.");
    error.status = 400;
    throw error;
  }

  const model = options.model || openaiEmbeddingsModel;
  const limit = boundedLimit(options.limit, 20);
  const [queryEmbedding] = await embedTexts([trimmed], model);
  const stored = await articleRepo.listArticleEmbeddings(model);

  return {
    model,
    query: trimmed,
    indexedCount: stored.length,
    results: stored
      .map((item: AnyRecord) => ({
        score: cosineSimilarity(queryEmbedding, item.embedding),
        article: item.article
      }))
      .sort((left: AnyRecord, right: AnyRecord) => right.score - left.score)
      .slice(0, limit)
  };
}

module.exports = {
  backfillLocalArticleEmbeddings,
  semanticSearchLocalArticles,
  cosineSimilarity
};
