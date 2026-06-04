const assert = require("node:assert/strict");
const test = require("node:test");
const { autoTagArticlesForTopics } = require("../src/services/autoTagger");

test("autoTagArticlesForTopics evaluates unevaluated articles for every stored topic", async () => {
  const requested = [];
  const stored = [];
  const filtered = [];

  const result = await autoTagArticlesForTopics({
    model: "mock-nano",
    limitPerTopic: 2,
    topicRepo: {
      async listTopics() {
        return [
          { id: 1, name: "Slovakia", description: "Slovak politics" },
          { id: 2, name: "Energy", description: "Power markets" }
        ];
      }
    },
    articleRepo: {
      async listUnevaluatedForTopic(topicId, limit) {
        requested.push({ topicId, limit });
        return topicId === 1
          ? [
              { id: 10, headline: "Slovak cabinet meets", context: "Bratislava" },
              { id: 11, headline: "Sports final starts", context: "Football" }
            ]
          : [{ id: 12, headline: "Gas prices rise", context: "European power markets" }];
      }
    },
    evaluationRepo: {
      async upsertEvaluation(input) {
        stored.push(input);
      }
    },
    async filterArticlesForTopic(topic, articles, options) {
      filtered.push({ topic, articles, options });
      return articles.map((article, index) => ({
        articleId: article.id,
        status: index === 0 ? "matched" : "rejected",
        confidence: index === 0 ? 0.9 : 0.2,
        reason: "Mock classification",
        model: options.model,
        raw: { private: true }
      }));
    }
  });

  assert.deepEqual(requested, [
    { topicId: 1, limit: 2 },
    { topicId: 2, limit: 2 }
  ]);
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].options.model, "mock-nano");
  assert.deepEqual(
    stored.map((row) => [row.articleId, row.topicId, row.status, row.model]),
    [
      [10, 1, "matched", "mock-nano"],
      [11, 1, "rejected", "mock-nano"],
      [12, 2, "matched", "mock-nano"]
    ]
  );
  assert.deepEqual(result, {
    model: "mock-nano",
    topicCount: 2,
    limitPerTopic: 2,
    evaluatedCount: 3,
    matchedCount: 2,
    rejectedCount: 1,
    topics: [
      {
        topicId: 1,
        topicName: "Slovakia",
        requestedCount: 2,
        evaluatedCount: 2,
        matchedCount: 1,
        rejectedCount: 1
      },
      {
        topicId: 2,
        topicName: "Energy",
        requestedCount: 1,
        evaluatedCount: 1,
        matchedCount: 1,
        rejectedCount: 0
      }
    ]
  });
});

test("autoTagArticlesForTopics skips supplied article-topic pairs that are already evaluated", async () => {
  const filteredArticleIdsByTopic = [];
  const stored = [];

  const result = await autoTagArticlesForTopics({
    topics: [
      { id: 1, name: "Security", description: "Defense" },
      { id: 2, name: "Economy", description: "Markets" }
    ],
    articles: [
      { id: 20, headline: "NATO summit begins", context: "Defense" },
      { id: 21, headline: "Markets move higher", context: "Stocks" }
    ],
    evaluationRepo: {
      async listEvaluationsForArticles(articleIds) {
        assert.deepEqual(articleIds, [20, 21]);
        return [{ articleId: 20, topicId: 1, status: "matched" }];
      },
      async upsertEvaluation(input) {
        stored.push(input);
      }
    },
    async filterArticlesForTopic(topic, articles) {
      filteredArticleIdsByTopic.push({
        topicId: topic.id,
        articleIds: articles.map((article) => article.id)
      });
      return articles.map((article) => ({
        articleId: article.id,
        status: "matched",
        confidence: 0.8,
        reason: "Mock match",
        model: "mock-nano",
        raw: {}
      }));
    }
  });

  assert.deepEqual(filteredArticleIdsByTopic, [
    { topicId: 1, articleIds: [21] },
    { topicId: 2, articleIds: [20, 21] }
  ]);
  assert.deepEqual(
    stored.map((row) => [row.articleId, row.topicId]),
    [
      [21, 1],
      [20, 2],
      [21, 2]
    ]
  );
  assert.equal(result.evaluatedCount, 3);
});
