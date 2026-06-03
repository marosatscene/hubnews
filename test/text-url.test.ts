const assert = require("node:assert/strict");
const test = require("node:test");
const { cleanText, tokenize, truncate } = require("../src/lib/text");
const { canonicalizeUrl, sameHostname } = require("../src/lib/url");
const { isDue } = require("../src/services/schedulePolicy");

test("cleanText strips tags and normalizes whitespace", () => {
  assert.equal(cleanText("<p>Hello&nbsp; <strong>world</strong></p>"), "Hello world");
});

test("truncate respects max length", () => {
  assert.equal(truncate("This is a long headline", 10), "This is a...");
});

test("tokenize keeps meaningful terms", () => {
  assert.deepEqual(tokenize("Polish energy policy"), ["polish", "energy", "policy"]);
});

test("canonicalizeUrl removes common tracking parameters", () => {
  assert.equal(
    canonicalizeUrl("/news/story?utm_source=x&id=12#section", "https://example.com"),
    "https://example.com/news/story?id=12"
  );
});

test("sameHostname ignores www prefix", () => {
  assert.equal(sameHostname("https://www.example.com/a", "https://example.com/b"), true);
});

test("isDue returns true for never checked enabled sources", () => {
  assert.equal(isDue({ enabled: true, lastCheckedAt: null, checkIntervalMinutes: 60 }), true);
});

test("isDue returns false inside interval", () => {
  assert.equal(
    isDue(
      {
        enabled: true,
        lastCheckedAt: new Date("2026-06-03T10:00:00.000Z").toISOString(),
        checkIntervalMinutes: 60
      },
      new Date("2026-06-03T10:30:00.000Z").getTime()
    ),
    false
  );
});
