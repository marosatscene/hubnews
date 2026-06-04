const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const test = require("node:test");
const express = require("express");
const { createAdminRouter } = require("../src/routes/admin");

type AnyRecord = Record<string, any>;

const adminHtmlPath = path.join(__dirname, "../public/admin/index.html");

function authHeader(username = "admin", password = "secret") {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function createRepos(overrides: AnyRecord = {}) {
  return {
    articleRepo: {
      async listArticles() {
        return [];
      },
      async countArticlesBySource() {
        return 0;
      },
      async listUnevaluatedForTopic() {
        return [];
      }
    },
    sourceRepo: {
      async listSources() {
        return [];
      }
    },
    topicRepo: {
      async listTopics() {
        return [];
      },
      async getTopic() {
        return null;
      },
      async createTopic(input) {
        return {
          id: 1,
          name: input.name,
          description: input.description || null
        };
      },
      async updateTopic(id, patch) {
        return {
          id,
          name: patch.name || "Updated",
          description: patch.description || null
        };
      },
      async deleteTopic() {
        return undefined;
      }
    },
    evaluationRepo: {
      async listEvaluationsForArticles() {
        return [];
      },
      async upsertEvaluation() {
        return undefined;
      }
    },
    ...overrides
  };
}

function normalizeHeaders(headers: AnyRecord = {}) {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])
  );
}

function chunkToBuffer(chunk: any, encoding: any) {
  if (Buffer.isBuffer(chunk)) return chunk;
  return Buffer.from(chunk, typeof encoding === "string" ? (encoding as BufferEncoding) : undefined);
}

function request(app: any, url: string, options: AnyRecord = {}) {
  return new Promise((resolve, reject) => {
    const bodyText =
      options.body === undefined
        ? null
        : typeof options.body === "string"
          ? options.body
          : JSON.stringify(options.body);
    const headers = normalizeHeaders(options.headers);
    if (bodyText !== null && headers["content-length"] === undefined) {
      headers["content-length"] = String(Buffer.byteLength(bodyText));
    }

    const socket = new PassThrough();
    const req = new http.IncomingMessage(socket);
    req.method = options.method || "GET";
    req.url = url;
    req.headers = headers;
    req.connection = socket;
    req.socket = socket;

    const res = new http.ServerResponse(req);
    const chunks: Buffer[] = [];

    res.write = (chunk, encoding, callback) => {
      if (chunk) chunks.push(chunkToBuffer(chunk, encoding));
      if (typeof encoding === "function") encoding();
      if (typeof callback === "function") callback();
      return true;
    };

    res.end = (chunk, encoding, callback) => {
      if (chunk) chunks.push(chunkToBuffer(chunk, encoding));
      if (typeof encoding === "function") encoding();
      if (typeof callback === "function") callback();

      const body = Buffer.concat(chunks).toString("utf8");
      resolve({
        status: res.statusCode,
        headers: res.getHeaders(),
        text: async () => body,
        json: async () => JSON.parse(body)
      });
    };

    if (bodyText !== null) req.push(bodyText);
    req.push(null);
    app.handle(req, res, reject);
  });
}

function header(response: AnyRecord, name: string) {
  return response.headers[name.toLowerCase()];
}

async function withAdminApp(options: AnyRecord, callback: any) {
  const app = express();
  const repos = createRepos(options.repos);

  app.use(express.json());
  app.use(
    "/admin",
    createAdminRouter({
      adminUser: options.adminUser,
      adminPassword: options.adminPassword,
      adminHtmlPath,
      autoTagArticlesForTopics: options.autoTagArticlesForTopics,
      filterArticlesForTopic: options.filterArticlesForTopic,
      translateHeadlines: options.translateHeadlines,
      aggregateSourceById: options.aggregateSourceById,
      aggregateMissingSources: options.aggregateMissingSources,
      ...repos
    })
  );

  app.use((error: any, _req: any, res: any, _next: any) => {
    res.status(error.status || 500).json({ error: error.message });
  });

  await callback((url, requestOptions) => request(app, url, requestOptions), repos);
}

test("admin routes challenge when credentials are unset", async () => {
  let called = false;

  await withAdminApp(
    {
      adminUser: "",
      adminPassword: "",
      repos: {
        articleRepo: {
          async listArticles() {
            called = true;
            return [];
          }
        }
      }
    },
    async (get) => {
      const response = await get("/admin/api/articles");
      assert.equal(response.status, 401);
      assert.match(header(response, "www-authenticate"), /^Basic realm="HubNews Admin"/);
      assert.equal(called, false);
    }
  );
});

test("admin routes challenge missing and wrong credentials", async () => {
  await withAdminApp(
    {
      adminUser: "admin",
      adminPassword: "secret"
    },
    async (get) => {
      const missing = await get("/admin/api/sources");
      assert.equal(missing.status, 401);
      assert.match(header(missing, "www-authenticate"), /^Basic realm="HubNews Admin"/);

      const wrong = await get("/admin/api/sources", {
        headers: { Authorization: authHeader("admin", "wrong") }
      });
      assert.equal(wrong.status, 401);
      assert.match(header(wrong, "www-authenticate"), /^Basic realm="HubNews Admin"/);
    }
  );
});

test("admin page is protected and serves HTML with valid credentials", async () => {
  await withAdminApp(
    {
      adminUser: "admin",
      adminPassword: "secret"
    },
    async (get) => {
      const blocked = await get("/admin/");
      assert.equal(blocked.status, 401);

      const allowed = await get("/admin/", {
        headers: { Authorization: authHeader() }
      });
      assert.equal(allowed.status, 200);
      assert.match(header(allowed, "content-type"), /text\/html/);

      const html = await allowed.text();
      assert.match(html, /id="root"/);
      assert.match(html, /\/admin\/assets\//);
    }
  );
});

test("admin article API passes filters and returns sanitized article fields", async () => {
  let receivedFilters;
  const secretBody = "Full extracted body must not be exposed";

  await withAdminApp(
    {
      adminUser: "admin",
      adminPassword: "secret",
      repos: {
        articleRepo: {
          async listArticles(filters) {
            receivedFilters = filters;
            return [
              {
                id: 10,
                sourceId: 1,
                sourceName: "Daily Example",
                headline: "Energy story",
                headlineSk: "Energetický príbeh",
                headlineEn: "Energy story",
                headlineLanguage: "en",
                headlineTranslatedAt: "2026-06-03T10:04:00.000Z",
                headlineTranslationModel: "mock-translation",
                context: "<p>Energy prices moved today.</p>",
                url: "https://example.com/story",
                publishedAt: "2026-06-03T10:00:00.000Z",
                discoveredAt: "2026-06-03T10:06:00.000Z",
                evaluationStatus: "matched",
                evaluationConfidence: 0.92,
                evaluationReason: "Matched the energy topic",
                evaluatedAt: "2026-06-03T10:05:00.000Z",
                topics: ["energy", "markets"],
                raw: { private: true },
                contentMarkdown: `# ${secretBody}`,
                contentText: secretBody
              },
              {
                id: 11,
                sourceId: 99,
                sourceName: "Other Source",
                headline: "Energy story from another source",
                context: "Energy",
                url: "https://example.com/other",
                publishedAt: "2026-06-03T10:00:00.000Z",
                discoveredAt: "2026-06-03T10:07:00.000Z",
                evaluationStatus: "matched"
              }
            ];
          }
        },
        topicRepo: {
          async listTopics() {
            return [
              { id: 2, name: "Energy", description: "Power markets" },
              { id: 3, name: "Slovakia", description: "Slovensko, Bratislava" },
              { id: 4, name: "Security", description: "Defense and security" }
            ];
          }
        },
        evaluationRepo: {
          async listEvaluationsForArticles(articleIds) {
            assert.deepEqual(articleIds, [10]);
            return [
              {
                articleId: 10,
                topicId: 2,
                status: "matched",
                confidence: 0.92,
                checkedAt: "2026-06-03T10:05:00.000Z"
              },
              {
                articleId: 10,
                topicId: 3,
                status: "rejected",
                confidence: 0.2,
                checkedAt: "2026-06-03T10:06:00.000Z"
              }
            ];
          }
        }
      }
    },
    async (get) => {
      const response = await get(
        "/admin/api/articles?q=energy&source=1&topic=2&status=matched&from=2026-06-01&to=2026-06-04&pageSize=10",
        { headers: { Authorization: authHeader() } }
      );

      assert.equal(response.status, 200);
      assert.deepEqual(receivedFilters, {
        sourceId: 1,
        topicId: 2,
        status: "matched",
        q: "energy",
        from: "2026-06-01",
        to: "2026-06-04",
        limit: 200,
        offset: 0
      });

      const body = await response.json();
      assert.equal(body.articles.length, 1);
      assert.deepEqual(Object.keys(body.articles[0]), [
        "id",
        "headline",
        "headlineSk",
        "headlineEn",
        "headlineLanguage",
        "headlineTranslatedAt",
        "headlineTranslationModel",
        "source",
        "publishedAt",
        "fetchedAt",
        "snippet",
        "topics",
        "semanticTopics",
        "link"
      ]);
      assert.equal(body.articles[0].headlineSk, "Energetický príbeh");
      assert.equal(body.articles[0].headlineEn, "Energy story");
      assert.equal(body.articles[0].headlineLanguage, "en");
      assert.equal(body.articles[0].headlineTranslatedAt, "2026-06-03T10:04:00.000Z");
      assert.equal(body.articles[0].headlineTranslationModel, "mock-translation");
      assert.equal(body.articles[0].source, "Daily Example");
      assert.equal(body.articles[0].publishedAt, "2026-06-03T10:00:00.000Z");
      assert.equal(body.articles[0].fetchedAt, "2026-06-03T10:06:00.000Z");
      assert.equal(body.articles[0].snippet, "Energy prices moved today.");
      assert.deepEqual(body.articles[0].topics, ["energy", "markets"]);
      assert.deepEqual(body.articles[0].semanticTopics, [
        {
          id: 2,
          name: "Energy",
          status: "matched",
          confidence: 0.92,
          evaluatedAt: "2026-06-03T10:05:00.000Z"
        },
        {
          id: 3,
          name: "Slovakia",
          status: "rejected",
          confidence: 0.2,
          evaluatedAt: "2026-06-03T10:06:00.000Z"
        },
        {
          id: 4,
          name: "Security",
          status: "pending",
          confidence: null,
          evaluatedAt: null
        }
      ]);
      assert.equal(JSON.stringify(body).includes(secretBody), false);
      assert.equal(JSON.stringify(body).includes("Matched the energy topic"), false);
      assert.equal(JSON.stringify(body).includes("contentMarkdown"), false);
      assert.equal(JSON.stringify(body).includes("contentText"), false);
      assert.equal(JSON.stringify(body).includes('"raw"'), false);
    }
  );
});

test("admin sources and topics APIs are read-only list endpoints", async () => {
  await withAdminApp(
    {
      adminUser: "admin",
      adminPassword: "secret",
      repos: {
        sourceRepo: {
          async listSources() {
            return [
              {
                id: 1,
                name: "Daily Example",
                enabled: true,
                homepageUrl: "https://example.com",
                scrapeConfig: { private: true }
              }
            ];
          }
        },
        articleRepo: {
          async countArticlesBySource(sourceId) {
            return sourceId === 1 ? 12 : 0;
          }
        },
        topicRepo: {
          async listTopics() {
            return [{ id: 2, name: "Energy", description: "Power markets" }];
          }
        }
      }
    },
    async (get) => {
      const headers = { Authorization: authHeader() };
      const sourcesResponse = await get("/admin/api/sources", { headers });
      const topicsResponse = await get("/admin/api/topics", { headers });

      assert.equal(sourcesResponse.status, 200);
      assert.equal(topicsResponse.status, 200);

      const sources = await sourcesResponse.json();
      const topics = await topicsResponse.json();

      assert.deepEqual(sources.sources, [
        {
          id: 1,
          name: "Daily Example",
          homepageUrl: "https://example.com",
          feedUrl: null,
          language: null,
          country: null,
          enabled: true,
          checkIntervalMinutes: null,
          lastCheckedAt: null,
          lastSuccessAt: null,
          lastError: null,
          articleCount: 12
        }
      ]);
      assert.deepEqual(topics.topics, [{ id: 2, name: "Energy", description: "Power markets" }]);
    }
  );
});

test("admin tag endpoints suggest, create, update, and delete protected tags", async () => {
  const topics = [{ id: 2, name: "Energy", description: "Power markets" }];
  const deletedIds = [];
  let createInput;
  let updateInput;

  await withAdminApp(
    {
      adminUser: "admin",
      adminPassword: "secret",
      repos: {
        topicRepo: {
          async listTopics() {
            return topics;
          },
          async getTopic(id) {
            return topics.find((topic) => topic.id === Number(id)) || null;
          },
          async createTopic(input) {
            createInput = input;
            const topic = { id: 3, name: input.name, description: input.description || null };
            topics.push(topic);
            return topic;
          },
          async updateTopic(id, input) {
            updateInput = { id, input };
            const topic = topics.find((item) => item.id === Number(id));
            Object.assign(topic, input);
            return topic;
          },
          async deleteTopic(id) {
            deletedIds.push(id);
          }
        },
        articleRepo: {
          async listArticles(filters) {
            assert.deepEqual(filters, { limit: 200, offset: 0 });
            return [
              { id: 10, topics: ["Energy", "NATO"] },
              { id: 11, topics: ["NATO", "Ukraine"] }
            ];
          }
        }
      }
    },
    async (get) => {
      const headers = {
        Authorization: authHeader(),
        "Content-Type": "application/json"
      };

      const suggestionsResponse = await get("/admin/api/tag-suggestions", { headers });
      assert.equal(suggestionsResponse.status, 200);
      const suggestions = await suggestionsResponse.json();
      const energy = suggestions.suggestions.find((suggestion) => suggestion.name === "Energy");
      const nato = suggestions.suggestions.find((suggestion) => suggestion.name === "NATO");
      assert.equal(energy.existingTopicId, 2);
      assert.equal(nato.count, 2);

      const createResponse = await get("/admin/api/topics", {
        method: "POST",
        headers,
        body: { name: "NATO", description: "Alliance and defense" }
      });
      assert.equal(createResponse.status, 201);
      assert.deepEqual(createInput, { name: "NATO", description: "Alliance and defense" });

      const updateResponse = await get("/admin/api/topics/2", {
        method: "PATCH",
        headers,
        body: { name: "Energy prices", description: "Gas, oil, electricity" }
      });
      assert.equal(updateResponse.status, 200);
      assert.deepEqual(updateInput, {
        id: 2,
        input: { name: "Energy prices", description: "Gas, oil, electricity" }
      });

      const deleteResponse = await get("/admin/api/topics/2", {
        method: "DELETE",
        headers
      });
      assert.equal(deleteResponse.status, 204);
      assert.deepEqual(deletedIds, [2]);
    }
  );
});

test("admin headline translation endpoint translates missing rows and stores results", async () => {
  const storedTranslations = [];
  let requestedLimit;
  let translatedArticles;

  await withAdminApp(
    {
      adminUser: "admin",
      adminPassword: "secret",
      translateHeadlines: async (articles) => {
        translatedArticles = articles;
        return [
          {
            articleId: 21,
            headlineSk: "Francúzsky parlament schválil zákon",
            headlineEn: "French parliament approved the law",
            detectedLanguage: "fr",
            model: "mock-translation",
            raw: { privatePrompt: "not returned" }
          }
        ];
      },
      repos: {
        articleRepo: {
          async listArticlesMissingHeadlineTranslations(limit) {
            requestedLimit = limit;
            return [
              {
                id: 21,
                headline: "Le parlement français a approuvé la loi",
                language: "fr",
                sourceName: "Le Monde"
              }
            ];
          },
          async updateHeadlineTranslations(id, translation) {
            storedTranslations.push({ id, translation });
          },
          async countArticlesMissingHeadlineTranslations() {
            return storedTranslations.length ? 0 : 1;
          }
        }
      }
    },
    async (get) => {
      const response = await get("/admin/api/headline-translations/run", {
        method: "POST",
        headers: {
          Authorization: authHeader(),
          "Content-Type": "application/json"
        },
        body: { limit: 25 }
      });

      assert.equal(response.status, 200);
      assert.equal(requestedLimit, 25);
      assert.equal(translatedArticles[0].headline, "Le parlement français a approuvé la loi");
      assert.equal(storedTranslations.length, 1);
      assert.equal(storedTranslations[0].id, 21);
      assert.equal(storedTranslations[0].translation.headlineSk, "Francúzsky parlament schválil zákon");
      assert.equal(storedTranslations[0].translation.headlineEn, "French parliament approved the law");

      const body = await response.json();
      assert.deepEqual(body, {
        missingBefore: 1,
        requestedCount: 1,
        translatedCount: 1,
        failedCount: 0,
        remainingMissingCount: 0
      });
      assert.equal(JSON.stringify(body).includes("privatePrompt"), false);
    }
  );
});

test("admin source update endpoint validates and persists editable source fields", async () => {
  let updateInput;

  await withAdminApp(
    {
      adminUser: "admin",
      adminPassword: "secret",
      repos: {
        sourceRepo: {
          async listSources() {
            return [];
          },
          async getSource(id) {
            return id === 7
              ? {
                  id: 7,
                  name: "Old Source",
                  homepageUrl: "https://old.example.com",
                  enabled: true
                }
              : null;
          },
          async updateSource(id, input) {
            updateInput = { id, input };
            return {
              id,
              name: input.name,
              homepageUrl: input.homepageUrl,
              feedUrl: input.feedUrl,
              language: input.language,
              country: input.country,
              enabled: input.enabled,
              checkIntervalMinutes: input.checkIntervalMinutes,
              lastCheckedAt: null,
              lastSuccessAt: null,
              lastError: null
            };
          }
        },
        articleRepo: {
          async countArticlesBySource(sourceId) {
            return sourceId === 7 ? 9 : 0;
          }
        }
      }
    },
    async (get) => {
      const response = await get("/admin/api/sources/7", {
        method: "PATCH",
        headers: {
          Authorization: authHeader(),
          "Content-Type": "application/json"
        },
        body: {
          enabled: false,
          name: "Edited Source",
          homepageUrl: "https://edited.example.com",
          feedUrl: "https://edited.example.com/feed.xml",
          checkIntervalMinutes: 30,
          language: "en",
          country: "gb"
        }
      });

      assert.equal(response.status, 200);
      assert.deepEqual(updateInput, {
        id: 7,
        input: {
          enabled: false,
          name: "Edited Source",
          homepageUrl: "https://edited.example.com",
          feedUrl: "https://edited.example.com/feed.xml",
          checkIntervalMinutes: 30,
          language: "en",
          country: "gb"
        }
      });

      const body = await response.json();
      assert.deepEqual(body.source, {
        id: 7,
        name: "Edited Source",
        homepageUrl: "https://edited.example.com",
        feedUrl: "https://edited.example.com/feed.xml",
        language: "en",
        country: "gb",
        enabled: false,
        checkIntervalMinutes: 30,
        lastCheckedAt: null,
        lastSuccessAt: null,
        lastError: null,
        articleCount: 9
      });
    }
  );
});

test("admin source recrawl endpoint runs one source and returns refreshed count", async () => {
  let requestedId;

  await withAdminApp(
    {
      adminUser: "admin",
      adminPassword: "secret",
      aggregateSourceById: async (id) => {
        requestedId = id;
        return {
          sourceId: id,
          sourceName: "Daily Example",
          status: "success",
          insertedCount: 2,
          updatedCount: 3
        };
      },
      repos: {
        sourceRepo: {
          async getSource(id) {
            return id === 7
              ? {
                  id: 7,
                  name: "Daily Example",
                  homepageUrl: "https://example.com",
                  enabled: true,
                  lastCheckedAt: "2026-06-03T10:00:00.000Z",
                  lastSuccessAt: "2026-06-03T10:00:00.000Z"
                }
              : null;
          }
        },
        articleRepo: {
          async countArticlesBySource(sourceId) {
            return sourceId === 7 ? 14 : 0;
          }
        }
      }
    },
    async (get) => {
      const response = await get("/admin/api/sources/7/recrawl", {
        method: "POST",
        headers: { Authorization: authHeader() }
      });

      assert.equal(response.status, 200);
      assert.equal(requestedId, 7);

      const body = await response.json();
      assert.deepEqual(body.result, {
        sourceId: 7,
        sourceName: "Daily Example",
        status: "success",
        insertedCount: 2,
        updatedCount: 3
      });
      assert.equal(body.source.articleCount, 14);
      assert.equal(body.source.name, "Daily Example");
    }
  );
});

test("admin semantic filter creates a topic, evaluates articles, and stores results", async () => {
  const storedEvaluations = [];
  let createdTopicInput;
  let requestedTopicId;
  let filteredTopic;
  let filteredArticles;

  await withAdminApp(
    {
      adminUser: "admin",
      adminPassword: "secret",
      filterArticlesForTopic: async (topic, articles) => {
        filteredTopic = topic;
        filteredArticles = articles;
        return [
          {
            articleId: 5,
            status: "matched",
            confidence: 0.91,
            reason: "Relevant to Slovakia",
            model: "mock-openai",
            raw: { privatePromptTrace: "not returned" }
          }
        ];
      },
      repos: {
        topicRepo: {
          async listTopics() {
            return [];
          },
          async createTopic(input) {
            createdTopicInput = input;
            return {
              id: 42,
              name: input.name,
              description: input.description
            };
          }
        },
        articleRepo: {
          async listUnevaluatedForTopic(topicId, limit) {
            requestedTopicId = { topicId, limit };
            return [
              {
                id: 5,
                headline: "Slovak cabinet discusses budget",
                context: "Central Europe",
                sourceName: "Daily Example",
                url: "https://example.com/slovakia"
              }
            ];
          }
        },
        evaluationRepo: {
          async upsertEvaluation(input) {
            storedEvaluations.push(input);
          }
        }
      }
    },
    async (get) => {
      const response = await get("/admin/api/semantic-filter", {
        method: "POST",
        headers: {
          Authorization: authHeader(),
          "Content-Type": "application/json"
        },
        body: {
          topic: "Slovakia",
          description: "Slovakia, Slovensko, Bratislava, Slovak politics",
          limit: 25
        }
      });

      assert.equal(response.status, 200);
      const body = await response.json();

      assert.deepEqual(createdTopicInput, {
        name: "Slovakia",
        description: "Slovakia, Slovensko, Bratislava, Slovak politics"
      });
      assert.deepEqual(requestedTopicId, { topicId: 42, limit: 25 });
      assert.equal(filteredTopic.name, "Slovakia");
      assert.equal(filteredArticles[0].headline, "Slovak cabinet discusses budget");
      assert.equal(storedEvaluations.length, 1);
      assert.equal(storedEvaluations[0].articleId, 5);
      assert.equal(storedEvaluations[0].topicId, 42);
      assert.equal(storedEvaluations[0].status, "matched");

      assert.equal(body.topic.id, 42);
      assert.equal(body.evaluatedCount, 1);
      assert.equal(body.matchedCount, 1);
      assert.equal(body.rejectedCount, 0);
      assert.deepEqual(Object.keys(body.results[0]), [
        "articleId",
        "status",
        "confidence",
        "reason",
        "model"
      ]);
      assert.equal(JSON.stringify(body).includes("privatePromptTrace"), false);
    }
  );
});

test("admin auto-tag endpoint runs stored topics with a bounded limit", async () => {
  let receivedOptions;

  await withAdminApp(
    {
      adminUser: "admin",
      adminPassword: "secret",
      autoTagArticlesForTopics: async (options) => {
        receivedOptions = options;
        return {
          model: "mock-nano",
          topicCount: 2,
          limitPerTopic: options.limitPerTopic,
          evaluatedCount: 3,
          matchedCount: 2,
          rejectedCount: 1,
          topics: []
        };
      }
    },
    async (get) => {
      const blocked = await get("/admin/api/auto-tag/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: { limitPerTopic: 20 }
      });
      assert.equal(blocked.status, 401);

      const response = await get("/admin/api/auto-tag/run", {
        method: "POST",
        headers: {
          Authorization: authHeader(),
          "Content-Type": "application/json"
        },
        body: { limitPerTopic: 5000 }
      });

      assert.equal(response.status, 200);
      assert.equal(receivedOptions.limitPerTopic, 1000);
      assert.ok(receivedOptions.articleRepo);
      assert.ok(receivedOptions.topicRepo);
      assert.ok(receivedOptions.evaluationRepo);
      assert.equal(typeof receivedOptions.filterArticlesForTopic, "function");
      assert.deepEqual(await response.json(), {
        model: "mock-nano",
        topicCount: 2,
        limitPerTopic: 1000,
        evaluatedCount: 3,
        matchedCount: 2,
        rejectedCount: 1,
        topics: []
      });
    }
  );
});

test("admin refetch missing sources endpoint is authenticated and bounded", async () => {
  let receivedOptions;

  await withAdminApp(
    {
      adminUser: "admin",
      adminPassword: "secret",
      aggregateMissingSources: async (options) => {
        receivedOptions = options;
        return {
          checkedCount: 2,
          missingCount: 5,
          remainingMissingCount: 3,
          results: [
            { sourceId: 1, sourceName: "Missing One", status: "success", insertedCount: 4 },
            { sourceId: 2, sourceName: "Missing Two", status: "failed", error: "HTTP 401" }
          ]
        };
      }
    },
    async (get) => {
      const blocked = await get("/admin/api/sources/refetch-missing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: { limit: 2 }
      });
      assert.equal(blocked.status, 401);

      const response = await get("/admin/api/sources/refetch-missing", {
        method: "POST",
        headers: {
          Authorization: authHeader(),
          "Content-Type": "application/json"
        },
        body: { limit: 20 }
      });

      assert.equal(response.status, 200);
      assert.deepEqual(receivedOptions, { limit: 10 });
      assert.deepEqual(await response.json(), {
        checkedCount: 2,
        missingCount: 5,
        remainingMissingCount: 3,
        results: [
          { sourceId: 1, sourceName: "Missing One", status: "success", insertedCount: 4 },
          { sourceId: 2, sourceName: "Missing Two", status: "failed", error: "HTTP 401" }
        ]
      });
    }
  );
});
