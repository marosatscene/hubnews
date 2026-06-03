const cheerio = require("cheerio");
const { fetchText } = require("../lib/http");
const { canonicalizeUrl } = require("../lib/url");

function rankFeedCandidate(candidate) {
  const haystack = `${candidate.type || ""} ${candidate.title || ""} ${candidate.url}`.toLowerCase();
  let score = 0;
  if (haystack.includes("rss")) score += 5;
  if (haystack.includes("atom")) score += 4;
  if (haystack.includes("json")) score += 2;
  if (haystack.includes("news")) score += 3;
  if (haystack.includes("world")) score += 1;
  if (haystack.includes("comments")) score -= 5;
  return score;
}

async function discoverFeedUrl(homepageUrl) {
  const html = await fetchText(homepageUrl, {
    accept: "text/html, application/xhtml+xml"
  });
  const $ = cheerio.load(html);
  const candidates = [];

  $("link[rel='alternate'], link[rel='ALTERNATE']").each((_, element) => {
    const href = $(element).attr("href");
    const type = $(element).attr("type") || "";
    if (!href) return;
    if (!/(rss|atom|json|xml)/i.test(type + href)) return;

    try {
      candidates.push({
        url: canonicalizeUrl(href, homepageUrl),
        type,
        title: $(element).attr("title") || ""
      });
    } catch {
      // Ignore malformed feed URLs advertised by the page.
    }
  });

  const uniqueCandidates = [...new Map(candidates.map((candidate) => [candidate.url, candidate])).values()];
  uniqueCandidates.sort((a, b) => rankFeedCandidate(b) - rankFeedCandidate(a));
  return uniqueCandidates[0]?.url || null;
}

module.exports = { discoverFeedUrl };
