const assert = require("node:assert/strict");
const test = require("node:test");
const { mapArticle } = require("../src/db/repositories");

test("mapArticle does not expose internal extracted article content", () => {
  const article = mapArticle({
    id: 1,
    source_id: 2,
    headline: "A headline",
    context: "Snippet",
    url: "https://example.com/story",
    canonical_url: "https://example.com/story",
    published_at: "2026-06-03T12:00:00.000Z",
    discovered_at: "2026-06-03T12:01:00.000Z",
    topics_json: [],
    raw_json: {},
    content_hash: "hash",
    content_markdown: "# Private",
    content_text: "Private",
    word_count: 10,
    extraction_status: "extracted",
    extraction_provider: "direct"
  });

  assert.equal(Object.hasOwn(article, "content_markdown"), false);
  assert.equal(Object.hasOwn(article, "contentMarkdown"), false);
  assert.equal(Object.hasOwn(article, "content_text"), false);
  assert.equal(Object.hasOwn(article, "contentText"), false);
  assert.equal(Object.hasOwn(article, "word_count"), false);
  assert.equal(Object.hasOwn(article, "wordCount"), false);
  assert.equal(Object.hasOwn(article, "extraction_status"), false);
  assert.equal(Object.hasOwn(article, "extractionStatus"), false);
});
