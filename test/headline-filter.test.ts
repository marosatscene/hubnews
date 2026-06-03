const assert = require("node:assert/strict");
const test = require("node:test");
const {
  callExternalFilter,
  callOpenAIFilter,
  filterArticlesForTopic,
  keywordFallback
} = require("../src/services/headlineFilter");

test("keywordFallback marks articles with overlapping topic terms", () => {
  const results = keywordFallback(
    { name: "Trump", description: "US politics" },
    [
      { id: 1, headline: "Trump and Netanyahu meet", context: "" },
      { id: 2, headline: "Roman villa discovered", context: "" }
    ]
  );

  assert.equal(results[0].status, "matched");
  assert.equal(results[0].model, "keyword-fallback");
  assert.equal(results[1].status, "rejected");
});

test("callExternalFilter posts expected LLM payload and normalizes results", async () => {
  let received;
  const originalFetch = global.fetch;
  global.fetch = (async (url, options) => {
    received = {
      method: options.method,
      url,
      body: JSON.parse(options.body)
    };

    return {
      ok: true,
      async json() {
        return {
          results: [
            {
              articleId: 1,
              status: "matched",
              confidence: 2,
              reason: "Mock LLM matched the topic",
              model: "mock-llm"
            }
          ]
        };
      }
    } as any;
  }) as any;

  try {
    const results = await callExternalFilter(
      { id: 7, name: "Politics", description: "US election" },
      [
        {
          id: 1,
          headline: "Trump meets Netanyahu",
          context: "US politics",
          sourceName: "The Times",
          publishedAt: "2026-06-03T12:00:00.000Z",
          url: "https://example.com/story"
        }
      ],
      "https://llm-filter.example/filter"
    );

    assert.equal(received.method, "POST");
    assert.equal(received.url, "https://llm-filter.example/filter");
    assert.equal(received.body.topic.name, "Politics");
    assert.equal(received.body.articles[0].headline, "Trump meets Netanyahu");
    assert.deepEqual(results, [
      {
        articleId: 1,
        status: "matched",
        confidence: 1,
        reason: "Mock LLM matched the topic",
        model: "mock-llm",
        raw: {
          articleId: 1,
          status: "matched",
          confidence: 2,
          reason: "Mock LLM matched the topic",
          model: "mock-llm"
        }
      }
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("callOpenAIFilter posts OpenAI Responses payload and normalizes output_text results", async () => {
  let received;
  const originalFetch = global.fetch;
  global.fetch = (async (url, options) => {
    received = {
      method: options.method,
      url,
      headers: options.headers,
      body: JSON.parse(options.body)
    };

    return {
      ok: true,
      async json() {
        return {
          output_text: JSON.stringify({
            results: [
              {
                articleId: 2,
                status: "rejected",
                confidence: 0.12,
                reason: "Not about the requested topic"
              }
            ]
          })
        };
      }
    } as any;
  }) as any;

  try {
    const results = await callOpenAIFilter(
      { id: 7, name: "Energy", description: "European gas markets" },
      [
        {
          id: 2,
          headline: "Sports club announces new manager",
          context: "Football",
          sourceName: "BBC News",
          publishedAt: "2026-06-03T12:00:00.000Z",
          url: "https://example.com/sports"
        }
      ],
      {
        apiKey: "test-openai-key",
        model: "gpt-test",
        apiUrl: "https://api.openai.test/v1/responses"
      }
    );

    assert.equal(received.method, "POST");
    assert.equal(received.url, "https://api.openai.test/v1/responses");
    assert.equal(received.headers.Authorization, "Bearer test-openai-key");
    assert.equal(received.body.model, "gpt-test");
    assert.equal(received.body.text.format.type, "json_schema");
    assert.equal(received.body.input[1].role, "user");
    assert.equal(JSON.parse(received.body.input[1].content).topic.name, "Energy");
    assert.deepEqual(results, [
      {
        articleId: 2,
        status: "rejected",
        confidence: 0.12,
        reason: "Not about the requested topic",
        model: "gpt-test",
        raw: {
          articleId: 2,
          status: "rejected",
          confidence: 0.12,
          reason: "Not about the requested topic"
        }
      }
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("filterArticlesForTopic evaluates unevaluated articles in bounded parallel batches", async () => {
  const articles = [1, 2, 3, 4, 5].map((id) => ({
    id,
    headline: `Headline ${id}`,
    context: ""
  }));
  const batchSizes = [];
  let activeCalls = 0;
  let maxActiveCalls = 0;

  const results = await filterArticlesForTopic(
    { id: 7, name: "Slovakia", description: "Slovensko, Bratislava" },
    articles,
    {
      batchSize: 2,
      concurrency: 2,
      async batchFilter(_topic, batch) {
        batchSizes.push(batch.length);
        activeCalls += 1;
        maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeCalls -= 1;
        return batch.map((article) => ({
          articleId: article.id,
          status: "matched",
          confidence: 0.9,
          reason: "Mock batch match",
          model: "mock-batch",
          raw: {}
        }));
      }
    }
  );

  assert.deepEqual(batchSizes, [2, 2, 1]);
  assert.equal(maxActiveCalls, 2);
  assert.deepEqual(
    results.map((result) => result.articleId),
    [1, 2, 3, 4, 5]
  );
});
