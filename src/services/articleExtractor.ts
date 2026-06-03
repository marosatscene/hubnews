const cheerio = require("cheerio");
const { articleMinWordCount: configuredArticleMinWordCount } = require("../config");
const { fetchText: defaultFetchText } = require("../lib/http");
const { cleanText } = require("../lib/text");
const firecrawl = require("./firecrawl");
const robots = require("./robots");

type AnyRecord = Record<string, any>;

const DEFAULT_ARTICLE_MIN_WORD_COUNT = 150;
const CONTENT_SELECTORS = [
  "article",
  "main",
  "[role='main']",
  ".article",
  ".article-content",
  ".entry-content",
  ".post-content",
  ".story",
  ".story-body",
  ".content",
  "#article",
  "#content"
];

function toInteger(value: any, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function articleMinWordCount(options: AnyRecord = {}) {
  return toInteger(
    options.minWordCount,
    configuredArticleMinWordCount || DEFAULT_ARTICLE_MIN_WORD_COUNT
  );
}

function countWords(value: any) {
  const words = cleanText(value).match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)?/gu);
  return words ? words.length : 0;
}

function removeBoilerplate($: any) {
  $(
    [
      "script",
      "style",
      "noscript",
      "template",
      "nav",
      "footer",
      "aside",
      "form",
      "iframe",
      "svg",
      "canvas",
      "button",
      "input",
      "select",
      "textarea",
      "[hidden]",
      "[aria-hidden='true']",
      ".ad",
      ".ads",
      ".advertisement",
      ".breadcrumbs",
      ".cookie",
      ".newsletter",
      ".related",
      ".share",
      ".social",
      ".subscribe"
    ].join(", ")
  ).remove();

  $("body > header, body > .site-header, body > #header").remove();
}

function findContentRoot($: any) {
  let bestElement = null;
  let bestScore = -1;

  for (const selector of CONTENT_SELECTORS) {
    $(selector).each((_, element) => {
      const text = cleanText($(element).text());
      const wordCount = countWords(text);
      const preferredBoost = /^(article|main|\[role='main'\])$/.test(selector) ? 25 : 0;
      const score = wordCount + preferredBoost;

      if (wordCount > 0 && score > bestScore) {
        bestElement = element;
        bestScore = score;
      }
    });
  }

  return bestElement ? $(bestElement) : $("body");
}

function pushBlock(blocks: AnyRecord[], type: string, text: any) {
  const normalized = cleanText(text);
  if (!normalized) return;

  const previous = blocks[blocks.length - 1];
  if (previous && previous.text === normalized) return;
  blocks.push({ type, text: normalized });
}

function contentBlocks($: any, root: any) {
  const blocks: AnyRecord[] = [];

  root.find("h1, h2, h3, h4, h5, h6, p, li, blockquote").each((_, element) => {
    const tag = element.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      pushBlock(blocks, tag, $(element).text());
    } else if (tag === "li") {
      pushBlock(blocks, "li", $(element).text());
    } else if (tag === "blockquote") {
      pushBlock(blocks, "blockquote", $(element).text());
    } else {
      pushBlock(blocks, "p", $(element).text());
    }
  });

  if (!blocks.length) {
    pushBlock(blocks, "p", root.text());
  }

  return blocks;
}

function blocksToText(blocks: AnyRecord[]) {
  return blocks.map((block) => block.text).join("\n\n").trim();
}

function blocksToMarkdown(blocks: AnyRecord[]) {
  return blocks
    .map((block) => {
      if (block.type === "h1") return `# ${block.text}`;
      if (block.type === "h2") return `## ${block.text}`;
      if (/^h[3-6]$/.test(block.type)) return `### ${block.text}`;
      if (block.type === "li") return `- ${block.text}`;
      if (block.type === "blockquote") return `> ${block.text}`;
      return block.text;
    })
    .join("\n\n")
    .trim();
}

function htmlToContent(html: any, url = "") {
  const $ = cheerio.load(html || "");
  removeBoilerplate($);

  const root = findContentRoot($);
  const blocks = contentBlocks($, root);
  const contentText = blocksToText(blocks);
  const contentMarkdown = blocksToMarkdown(blocks);

  return {
    status: "success",
    source: "direct",
    url,
    contentText,
    contentMarkdown,
    wordCount: countWords(contentText)
  };
}

async function extractDirectContent(url: string, options: AnyRecord = {}) {
  if (options.counters) options.counters.directScrapeCount += 1;
  const fetchText = options.fetchText || defaultFetchText;
  const html = await fetchText(url, {
    accept: "text/html, application/xhtml+xml",
    timeoutMs: options.timeoutMs
  });
  return htmlToContent(html, url);
}

function markdownToText(markdown: any) {
  return cleanText(
    String(markdown || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
      .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^>\s?/gm, "")
      .replace(/^[*-]\s+/gm, "")
      .replace(/[`*_~]/g, " ")
  );
}

function firecrawlContent(result: AnyRecord, url: string) {
  const data = result?.data && typeof result.data === "object" ? result.data : result || {};
  const markdown = data.markdown || result?.markdown || data.content || "";
  const html = data.html || result?.html || "";
  const contentMarkdown = markdown || htmlToContent(html, url).contentMarkdown;
  const contentText = markdown ? markdownToText(markdown) : cleanText(contentMarkdown);

  return {
    status: "success",
    source: "firecrawl",
    url,
    contentText,
    contentMarkdown,
    wordCount: countWords(contentText),
    raw: result?.raw || result
  };
}

function shouldUseFirecrawl(client: AnyRecord, options: AnyRecord = {}) {
  if (typeof options.firecrawlEnabled === "boolean") return options.firecrawlEnabled;
  if (typeof client?.isEnabled === "function") {
    return client.isEnabled(options.firecrawlOptions || {});
  }
  return typeof client?.scrapeForContent === "function";
}

function finishSkipped(reason: string, message: string, extra: AnyRecord = {}) {
  return {
    status: "skipped",
    reason,
    error: message,
    ...extra
  };
}

function finishFailed(reason: string, message: string, extra: AnyRecord = {}) {
  return {
    status: "failed",
    reason,
    error: message,
    ...extra
  };
}

async function extractArticleContent(url: string, options: AnyRecord = {}) {
  const minWordCount = articleMinWordCount(options);
  const firecrawlClient = options.firecrawlClient || firecrawl;
  let directResult = null;
  let directError = null;

  if (options.robotsCache) {
    const robotsResult = await robots.checkUrl(options.robotsCache, url, {
      warn: false,
      botName: options.robotsBotName
    });
    if (!robotsResult.allowed && typeof options.recordRobotsWarning === "function") {
      options.recordRobotsWarning(url, robotsResult.matchedRule, "article");
    }
  }

  try {
    directResult = await extractDirectContent(url, options);
    if (directResult.wordCount >= minWordCount) {
      return directResult;
    }
  } catch (error: any) {
    directError = error;
  }

  if (shouldUseFirecrawl(firecrawlClient, options)) {
    try {
      if (options.counters) options.counters.firecrawlCallCount += 1;
      const firecrawlResult = await firecrawlClient.scrapeForContent(
        url,
        options.firecrawlOptions || {}
      );

      if (firecrawlResult?.status === "success" || firecrawlResult?.ok) {
        const result = firecrawlContent(firecrawlResult, url);
        if (result.wordCount >= minWordCount) return result;

        return finishSkipped(
          "content_too_short",
          `Extracted content has ${result.wordCount} words; minimum is ${minWordCount}`,
          {
            url,
            source: "firecrawl",
            contentText: result.contentText,
            contentMarkdown: result.contentMarkdown,
            wordCount: result.wordCount,
            direct: directResult,
            raw: firecrawlResult.raw || firecrawlResult
          }
        );
      }

      return {
        status: firecrawlResult?.status === "skipped" ? "skipped" : "failed",
        reason: firecrawlResult?.reason || "firecrawl_failed",
        error: firecrawlResult?.error || "Firecrawl fallback failed",
        url,
        direct: directResult,
        directError: directError?.message
      };
    } catch (error: any) {
      return finishFailed("firecrawl_error", error.message, {
        url,
        direct: directResult,
        directError: directError?.message
      });
    }
  }

  if (directResult) {
    return finishSkipped(
      "content_too_short",
      `Direct extraction found ${directResult.wordCount} words; minimum is ${minWordCount}`,
      {
        url,
        source: "direct",
        contentText: directResult.contentText,
        contentMarkdown: directResult.contentMarkdown,
        wordCount: directResult.wordCount
      }
    );
  }

  return finishFailed("direct_extraction_failed", directError?.message || "Direct extraction failed", {
    url
  });
}

async function extractArticle(url: string, options: AnyRecord = {}) {
  try {
    return await extractArticleContent(url, options);
  } catch (error: any) {
    return finishFailed("article_extraction_error", error.message, { url });
  }
}

module.exports = {
  DEFAULT_ARTICLE_MIN_WORD_COUNT,
  articleMinWordCount,
  countWords,
  htmlToContent,
  extractDirectContent,
  extractArticleContent,
  extractArticle
};
