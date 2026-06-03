const crypto = require("node:crypto");
const { cleanText, truncate } = require("../lib/text");
const { canonicalizeUrl } = require("../lib/url");

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function contentHash(parts) {
  return crypto
    .createHash("sha256")
    .update(parts.filter(Boolean).join("|"))
    .digest("hex");
}

function normalizeFeedItem(item, source) {
  const headline = truncate(item.title, 300);
  const link = item.link || item.guid;
  if (!headline || !link) return null;

  const canonicalUrl = canonicalizeUrl(link, source.homepageUrl);
  const context = truncate(
    item.contentSnippet || item.summary || item.content || item.description || "",
    1000
  );

  return {
    sourceId: source.id,
    headline,
    context,
    url: new URL(link, source.homepageUrl).toString(),
    canonicalUrl,
    publishedAt: parseDate(item.isoDate || item.pubDate),
    byline: truncate(item.creator || item.author || "", 200) || null,
    imageUrl: item.enclosure?.url || item.itunes?.image || null,
    language: source.language,
    topics: [],
    raw: item,
    contentHash: contentHash([source.id, canonicalUrl, headline])
  };
}

function normalizeHtmlHeadline(candidate, source) {
  const headline = truncate(candidate.headline, 300);
  if (!headline || !candidate.url) return null;

  const canonicalUrl = canonicalizeUrl(candidate.url, source.homepageUrl);
  return {
    sourceId: source.id,
    headline,
    context: truncate(candidate.context || "", 1000),
    url: new URL(candidate.url, source.homepageUrl).toString(),
    canonicalUrl,
    publishedAt: null,
    byline: null,
    imageUrl: candidate.imageUrl || null,
    language: source.language,
    topics: [],
    raw: candidate.raw || {},
    contentHash: contentHash([source.id, canonicalUrl, headline])
  };
}

module.exports = { normalizeFeedItem, normalizeHtmlHeadline, parseDate };
