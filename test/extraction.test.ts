const assert = require("node:assert/strict");
const test = require("node:test");
const firecrawl = require("../src/services/firecrawl");
const {
  extractArticle,
  htmlToContent
} = require("../src/services/articleExtractor");

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    }
  };
}

test("Firecrawl client skips cleanly without an API key", async () => {
  let called = false;
  const result = await firecrawl.scrape("https://example.com/story", ["markdown"], {
    apiKey: "",
    fetchImpl: async () => {
      called = true;
    }
  });

  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "firecrawl_missing_api_key");
  assert.equal(called, false);
});

test("Firecrawl scrape posts expected payload and headers", async () => {
  let request;
  const result = await firecrawl.scrapeForLinks("https://example.com/story", {
    apiKey: "test-key",
    apiUrl: "https://firecrawl.test/v2/scrape",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse(200, {
        success: true,
        data: {
          html: "<a href='/a'>A</a>",
          links: ["https://example.com/a"]
        }
      });
    }
  });

  assert.equal(result.status, "success");
  assert.equal(request.url, "https://firecrawl.test/v2/scrape");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "Bearer test-key");
  assert.deepEqual(JSON.parse(request.options.body), {
    url: "https://example.com/story",
    formats: ["html", "links"],
    proxy: "auto"
  });
  assert.deepEqual(result.links, ["https://example.com/a"]);
});

test("Firecrawl 429 is reported as skipped", async () => {
  const result = await firecrawl.scrapeForContent("https://example.com/story", {
    apiKey: "test-key",
    fetchImpl: async () => jsonResponse(429, { error: "Too many requests" })
  });

  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "firecrawl_rate_limited");
});

test("direct extractor prefers article content and strips boilerplate", () => {
  const result = htmlToContent(
    `
      <html>
        <body>
          <nav>Home Subscribe</nav>
          <article>
            <h1>Useful Headline</h1>
            <p>The first paragraph has useful article text.</p>
            <script>window.bad = true;</script>
            <p>The second paragraph continues the actual article body.</p>
          </article>
          <footer>Contact us</footer>
        </body>
      </html>
    `,
    "https://example.com/story"
  );

  assert.equal(result.status, "success");
  assert.equal(result.source, "direct");
  assert.match(result.contentText, /Useful Headline/);
  assert.match(result.contentMarkdown, /^# Useful Headline/);
  assert.doesNotMatch(result.contentText, /Subscribe|window\.bad|Contact us/);
  assert.equal(result.wordCount, 17);
});

test("extractor falls back to Firecrawl when direct content is too short", async () => {
  const result = await extractArticle("https://example.com/story", {
    minWordCount: 5,
    fetchText: async () => "<main><p>Too short.</p></main>",
    firecrawlClient: {
      isEnabled: () => true,
      scrapeForContent: async () => ({
        status: "success",
        data: {
          markdown: "## Full story\n\nThis Firecrawl article has enough extracted words."
        }
      })
    }
  });

  assert.equal(result.status, "success");
  assert.equal(result.source, "firecrawl");
  assert.equal(result.wordCount, 9);
  assert.match(result.contentText, /Firecrawl article/);
});

test("extractor never throws when direct fetch fails and Firecrawl is disabled", async () => {
  const result = await extractArticle("https://example.com/story", {
    fetchText: async () => {
      throw new Error("offline");
    },
    firecrawlClient: {
      isEnabled: () => false
    }
  });

  assert.equal(result.status, "failed");
  assert.equal(result.reason, "direct_extraction_failed");
  assert.match(result.error, /offline/);
});
