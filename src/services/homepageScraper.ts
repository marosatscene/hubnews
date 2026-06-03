const cheerio = require("cheerio");
const { fetchText } = require("../lib/http");
const { cleanText } = require("../lib/text");
const { canonicalizeUrl, sameHostname } = require("../lib/url");

const rejectedText = [
  "cookie",
  "cookies",
  "privacy",
  "subscribe",
  "sign in",
  "log in",
  "newsletter",
  "advertise",
  "terms",
  "contact"
];

function isLikelyHeadline(text) {
  const normalized = cleanText(text);
  const lower = normalized.toLowerCase();
  if (normalized.length < 20 || normalized.length > 220) return false;
  if (/[{};]/.test(normalized) || /\bcss-[a-z0-9]+/i.test(normalized)) return false;
  if (rejectedText.some((term) => lower.includes(term))) return false;
  if (/^(home|news|sport|business|opinion|video)$/i.test(normalized)) return false;
  return /[\p{L}\p{N}]/u.test(normalized);
}

function extractHeadlinesFromHtml(html, source, limit = 40, mode = "homepage") {
  const $ = cheerio.load(html);
  const seen = new Set();
  const results = [];

  $("a[href]").each((_, element) => {
    if (results.length >= limit) return;
    const href = $(element).attr("href");
    const text = cleanText($(element).text());
    if (!href || !isLikelyHeadline(text)) return;

    let url;
    try {
      url = canonicalizeUrl(href, source.homepageUrl);
    } catch {
      return;
    }

    if (!sameHostname(url, source.homepageUrl)) return;
    if (seen.has(url)) return;
    seen.add(url);

    const imageUrl = $(element).find("img").attr("src") || null;
    results.push({
      headline: text,
      url,
      imageUrl,
      raw: {
        mode,
        href
      }
    });
  });

  return results;
}

function extractHeadlinesFromLinks(links, source, limit = 40, mode = "firecrawl-links") {
  const seen = new Set();
  const results = [];

  for (const candidate of links || []) {
    if (results.length >= limit) break;
    const href = typeof candidate === "string" ? candidate : candidate.url || candidate.href;
    const label = typeof candidate === "string" ? "" : candidate.title || candidate.text || "";
    if (!href) continue;

    let url;
    try {
      url = canonicalizeUrl(href, source.homepageUrl);
    } catch {
      continue;
    }

    if (!sameHostname(url, source.homepageUrl) || seen.has(url)) continue;
    seen.add(url);

    const headline = cleanText(label || new URL(url).pathname.split("/").filter(Boolean).pop() || "");
    if (!isLikelyHeadline(headline)) continue;

    results.push({
      headline,
      url,
      raw: {
        mode,
        href
      }
    });
  }

  return results;
}

async function scrapeHomepageHeadlines(source, limit = 40) {
  const html = await fetchText(source.homepageUrl, {
    accept: "text/html, application/xhtml+xml"
  });
  return extractHeadlinesFromHtml(html, source, limit);
}

module.exports = {
  extractHeadlinesFromHtml,
  extractHeadlinesFromLinks,
  scrapeHomepageHeadlines,
  isLikelyHeadline
};
