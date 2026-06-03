const {
  firecrawlApiKey,
  firecrawlApiUrl,
  firecrawlTimeoutMs
} = require("../config");

const DEFAULT_FIRECRAWL_API_URL = "https://api.firecrawl.dev/v2/scrape";
const DEFAULT_FORMATS = ["markdown"];

type AnyRecord = Record<string, any>;

function toInteger(value: any, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveApiKey(options: AnyRecord = {}) {
  if (Object.prototype.hasOwnProperty.call(options, "apiKey")) {
    return options.apiKey;
  }
  return firecrawlApiKey;
}

function resolveApiUrl(options: AnyRecord = {}) {
  return options.apiUrl || firecrawlApiUrl || DEFAULT_FIRECRAWL_API_URL;
}

function resolveTimeoutMs(options: AnyRecord = {}) {
  return toInteger(options.timeoutMs, firecrawlTimeoutMs);
}

function isEnabled(options: AnyRecord = {}) {
  return Boolean(String(resolveApiKey(options) || "").trim());
}

function skipped(reason: string, message: string, extra: AnyRecord = {}) {
  return {
    status: "skipped",
    ok: false,
    skipped: true,
    reason,
    error: message,
    ...extra
  };
}

function failed(reason: string, message: string, extra: AnyRecord = {}) {
  return {
    status: "failed",
    ok: false,
    reason,
    error: message,
    ...extra
  };
}

async function readResponseBody(response: AnyRecord) {
  if (typeof response.text === "function") {
    const text = await response.text();
    if (!text) return { text, json: null };
    try {
      return { text, json: JSON.parse(text) };
    } catch {
      return { text, json: null };
    }
  }

  if (typeof response.json === "function") {
    const json = await response.json();
    return { text: JSON.stringify(json), json };
  }

  return { text: "", json: null };
}

function responseMessage(payload: any, fallback: string) {
  return (
    payload?.error ||
    payload?.message ||
    payload?.data?.error ||
    payload?.data?.message ||
    fallback
  );
}

function normalizeScrapeData(payload: any) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload || {};
  return {
    data,
    html: data.html || "",
    markdown: data.markdown || data.content || "",
    links: Array.isArray(data.links) ? data.links : [],
    metadata: data.metadata || {},
    raw: payload
  };
}

async function scrape(url: string, formats = DEFAULT_FORMATS, options: AnyRecord = {}) {
  const normalizedFormats = Array.isArray(formats) && formats.length ? formats : DEFAULT_FORMATS;
  const apiKey = resolveApiKey(options);

  if (!String(apiKey || "").trim()) {
    return skipped("firecrawl_missing_api_key", "FIRECRAWL_API_KEY is not configured", {
      url,
      formats: normalizedFormats
    });
  }

  if (!url) {
    return failed("firecrawl_missing_url", "A URL is required for Firecrawl scraping", {
      formats: normalizedFormats
    });
  }

  const fetchImpl = options.fetchImpl || global.fetch;
  if (typeof fetchImpl !== "function") {
    return failed("firecrawl_fetch_unavailable", "fetch is not available", {
      url,
      formats: normalizedFormats
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), resolveTimeoutMs(options));
  if (typeof timeout.unref === "function") timeout.unref();

  try {
    const response = await fetchImpl(resolveApiUrl(options), {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...options.headers
      },
      body: JSON.stringify({
        url,
        formats: normalizedFormats,
        proxy: "auto"
      })
    });

    const { json } = await readResponseBody(response);

    if (response.status === 429) {
      return skipped("firecrawl_rate_limited", "Firecrawl rate limit exceeded", {
        url,
        formats: normalizedFormats,
        statusCode: response.status,
        raw: json
      });
    }

    if (!response.ok) {
      return failed(
        "firecrawl_http_error",
        responseMessage(json, `Firecrawl HTTP ${response.status}`),
        {
          url,
          formats: normalizedFormats,
          statusCode: response.status,
          raw: json
        }
      );
    }

    if (!json || typeof json !== "object") {
      return failed("firecrawl_invalid_response", "Firecrawl returned an invalid response", {
        url,
        formats: normalizedFormats
      });
    }

    if (json.success === false) {
      return failed("firecrawl_error", responseMessage(json, "Firecrawl scrape failed"), {
        url,
        formats: normalizedFormats,
        raw: json
      });
    }

    return {
      status: "success",
      ok: true,
      url,
      formats: normalizedFormats,
      ...normalizeScrapeData(json)
    };
  } catch (error: any) {
    const timedOut = error?.name === "AbortError";
    return failed(
      timedOut ? "firecrawl_timeout" : "firecrawl_error",
      timedOut ? "Firecrawl request timed out" : error.message,
      {
        url,
        formats: normalizedFormats
      }
    );
  } finally {
    clearTimeout(timeout);
  }
}

function scrapeForLinks(url: string, options: AnyRecord = {}) {
  return scrape(url, ["html", "links"], options);
}

function scrapeForContent(url: string, options: AnyRecord = {}) {
  return scrape(url, ["markdown"], options);
}

function createFirecrawlClient(defaultOptions: AnyRecord = {}) {
  return {
    isEnabled(options: AnyRecord = {}) {
      return isEnabled({ ...defaultOptions, ...options });
    },
    scrape(url: string, formats = DEFAULT_FORMATS, options: AnyRecord = {}) {
      return scrape(url, formats, { ...defaultOptions, ...options });
    },
    scrapeForLinks(url: string, options: AnyRecord = {}) {
      return scrapeForLinks(url, { ...defaultOptions, ...options });
    },
    scrapeForContent(url: string, options: AnyRecord = {}) {
      return scrapeForContent(url, { ...defaultOptions, ...options });
    }
  };
}

module.exports = {
  DEFAULT_FIRECRAWL_API_URL,
  isEnabled,
  scrape,
  scrapeForLinks,
  scrapeForContent,
  createFirecrawlClient
};
