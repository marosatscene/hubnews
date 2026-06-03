const assert = require("node:assert/strict");
const test = require("node:test");
const {
  callOpenAIHeadlineTranslation,
  fallbackTranslations,
  hasHeadlineTranslations,
  openaiHeadlineTranslationRequestBody,
  translateHeadlines
} = require("../src/services/headlineTranslator");

test("fallbackTranslations copies known English and Slovak headlines only for matching target", () => {
  const results = fallbackTranslations([
    { id: 1, headline: "Energy prices rise", language: "en" },
    { id: 2, headline: "Vláda schválila rozpočet", language: "sk" },
    { id: 3, headline: "Le parlement vote", language: "fr" }
  ]);

  assert.equal(results[0].headlineEn, "Energy prices rise");
  assert.equal(results[0].headlineSk, null);
  assert.equal(results[1].headlineSk, "Vláda schválila rozpočet");
  assert.equal(results[1].headlineEn, null);
  assert.equal(results[2].headlineSk, null);
  assert.equal(results[2].headlineEn, null);
});

test("translateHeadlines skips articles that already have both translations", async () => {
  const results = await translateHeadlines(
    [
      {
        id: 1,
        headline: "Already translated",
        headlineSk: "Už preložené",
        headlineEn: "Already translated"
      }
    ],
    {
      async batchTranslator() {
        throw new Error("should not be called");
      }
    }
  );

  assert.deepEqual(results, []);
  assert.equal(
    hasHeadlineTranslations({
      headlineSk: "Už preložené",
      headlineEn: "Already translated"
    }),
    true
  );
});

test("callOpenAIHeadlineTranslation posts Responses payload and normalizes translations", async () => {
  let received;
  const originalFetch = global.fetch;
  global.fetch = (async (url, options) => {
    received = {
      url,
      method: options.method,
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
                articleId: 7,
                detectedLanguage: "fr",
                headlineSk: "Francúzsky parlament schválil zákon",
                headlineEn: "French parliament approved the law"
              }
            ]
          })
        };
      }
    };
  }) as any;

  try {
    const results = await callOpenAIHeadlineTranslation(
      [
        {
          id: 7,
          headline: "Le parlement français a approuvé la loi",
          language: "fr",
          sourceName: "Le Monde"
        }
      ],
      {
        apiKey: "test-openai-key",
        model: "gpt-test",
        apiUrl: "https://api.openai.test/v1/responses"
      }
    );

    assert.equal(received.url, "https://api.openai.test/v1/responses");
    assert.equal(received.method, "POST");
    assert.equal(received.headers.Authorization, "Bearer test-openai-key");
    assert.equal(received.body.model, "gpt-test");
    assert.equal(received.body.text.format.name, "headline_translation_results");
    assert.equal(JSON.parse(received.body.input[1].content).articles[0].sourceName, "Le Monde");
    assert.deepEqual(results, [
      {
        articleId: 7,
        headlineSk: "Francúzsky parlament schválil zákon",
        headlineEn: "French parliament approved the law",
        detectedLanguage: "fr",
        model: "gpt-test",
        raw: {
          articleId: 7,
          detectedLanguage: "fr",
          headlineSk: "Francúzsky parlament schválil zákon",
          headlineEn: "French parliament approved the law"
        }
      }
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("openaiHeadlineTranslationRequestBody asks for Slovak and English target languages", () => {
  const body = openaiHeadlineTranslationRequestBody(
    [{ id: 1, headline: "Test", language: "en" }],
    "gpt-test"
  );
  const userPayload = JSON.parse(body.input[1].content);
  assert.deepEqual(userPayload.targets, ["sk", "en"]);
});
