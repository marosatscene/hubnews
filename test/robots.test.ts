const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createRobotsCache,
  parseRobots,
  evaluate,
  checkUrl
} = require("../src/services/robots");

test("specific bot group is used before wildcard group", () => {
  const parsed = parseRobots(`
User-agent: *
Disallow: /blocked

User-agent: HubNewsBot
Allow: /blocked
Disallow: /bot-private
`);

  assert.deepEqual(evaluate(parsed, "https://example.com/blocked/story", "HubNewsBot"), {
    allowed: true,
    matchedRule: {
      directive: "allow",
      pattern: "/blocked",
      lineNumber: 6
    }
  });

  assert.equal(evaluate(parsed, "https://example.com/bot-private/story", "HubNewsBot").allowed, false);
});

test("wildcard group is used as fallback", () => {
  const parsed = parseRobots(`
User-agent: *
Disallow: /blocked
`);

  const result = evaluate(parsed, "https://example.com/blocked/story", "HubNewsBot");

  assert.equal(result.allowed, false);
  assert.deepEqual(result.matchedRule, {
    directive: "disallow",
    pattern: "/blocked",
    lineNumber: 3
  });
});

test("longest matching robots rule wins", () => {
  const parsed = parseRobots(`
User-agent: *
Disallow: /news
Allow: /news/public
`);

  const result = evaluate(parsed, "https://example.com/news/public/story", "HubNewsBot");

  assert.equal(result.allowed, true);
  assert.equal(result.matchedRule.pattern, "/news/public");
});

test("allow wins ties", () => {
  const parsed = parseRobots(`
User-agent: *
Disallow: /same
Allow: /same
`);

  const result = evaluate(parsed, "https://example.com/same/path", "HubNewsBot");

  assert.equal(result.allowed, true);
  assert.deepEqual(result.matchedRule, {
    directive: "allow",
    pattern: "/same",
    lineNumber: 4
  });
});

test("checkUrl fetches robots from origin with text/plain", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(
      `
User-agent: *
Disallow: /blocked
`,
      { status: 200 }
    );
  };

  try {
    const cache = createRobotsCache();
    const result = await checkUrl(cache, "https://example.com/blocked/story?utm=1", {
      botName: "HubNewsBot",
      warn: false
    });

    assert.equal(result.allowed, false);
    assert.equal(result.host, "example.com");
    assert.equal(result.matchedRule.pattern, "/blocked");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://example.com/robots.txt");
    assert.equal(calls[0].options.headers.Accept, "text/plain");
  } finally {
    global.fetch = originalFetch;
  }
});

test("missing or unreachable robots allows URL", async () => {
  const cache = createRobotsCache({
    fetchText: async () => {
      throw new Error("not found");
    }
  });

  const result = await checkUrl(cache, "https://missing.example/story", {
    botName: "HubNewsBot",
    warn: false
  });

  assert.deepEqual(result, {
    allowed: true,
    matchedRule: null,
    host: "missing.example"
  });
});
