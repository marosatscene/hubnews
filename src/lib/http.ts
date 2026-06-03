const { requestTimeoutMs, scraperUserAgent } = require("../config");

type AnyRecord = Record<string, any>;

async function fetchText(url: string, options: AnyRecord = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || requestTimeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": scraperUserAgent,
        Accept:
          options.accept ||
          "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8",
        ...options.headers
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { fetchText };
