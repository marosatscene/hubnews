function canonicalizeUrl(inputUrl, baseUrl) {
  const parsed = new URL(inputUrl, baseUrl);
  parsed.hash = "";

  for (const key of [...parsed.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (
      lower.startsWith("utm_") ||
      lower === "fbclid" ||
      lower === "gclid" ||
      lower === "mc_cid" ||
      lower === "mc_eid"
    ) {
      parsed.searchParams.delete(key);
    }
  }

  if (parsed.pathname.length > 1) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }

  return parsed.toString();
}

function sameHostname(urlA, urlB) {
  try {
    return new URL(urlA).hostname.replace(/^www\./, "") ===
      new URL(urlB).hostname.replace(/^www\./, "");
  } catch {
    return false;
  }
}

module.exports = { canonicalizeUrl, sameHostname };
