const { fetchText } = require("../lib/http");

const DEFAULT_BOT_NAME = "HubNewsBot";
const ROBOTS_ACCEPT = "text/plain";

type AnyRecord = Record<string, any>;

function resolveBotName(botName: any) {
  return botName || process.env.ROBOTS_BOT_NAME || DEFAULT_BOT_NAME;
}

function stripComment(line: string) {
  const commentIndex = line.indexOf("#");
  return commentIndex === -1 ? line : line.slice(0, commentIndex);
}

function parseDirective(line: string) {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex === -1) return null;

  const key = line.slice(0, separatorIndex).trim().toLowerCase();
  const value = line.slice(separatorIndex + 1).trim();
  if (!key) return null;

  return { key, value };
}

function parseRobots(text: any, botName?: string) {
  const groups: AnyRecord[] = [];
  let currentGroup: AnyRecord | null = null;
  let currentGroupHasDirectives = false;

  String(text || "")
    .split(/\r?\n/)
    .forEach((rawLine, index) => {
      const line = stripComment(rawLine).trim();
      if (!line) return;

      const directive = parseDirective(line);
      if (!directive) return;

      if (directive.key === "user-agent") {
        if (!currentGroup || currentGroupHasDirectives) {
          currentGroup = { agents: [], rules: [] };
          groups.push(currentGroup);
          currentGroupHasDirectives = false;
        }
        currentGroup.agents.push(directive.value.toLowerCase());
        return;
      }

      if (!currentGroup) return;
      currentGroupHasDirectives = true;
      if (directive.key !== "allow" && directive.key !== "disallow") return;
      if (!directive.value) return;

      currentGroup.rules.push({
        directive: directive.key,
        pattern: directive.value,
        lineNumber: index + 1
      });
    });

  return {
    botName: resolveBotName(botName),
    groups
  };
}

function agentMatchesBot(agent: any, botName: any) {
  const normalizedAgent = String(agent || "").toLowerCase();
  const normalizedBot = String(botName || "").toLowerCase();
  if (!normalizedAgent || normalizedAgent === "*") return false;

  return normalizedBot === normalizedAgent || normalizedBot.startsWith(`${normalizedAgent}/`);
}

function selectRules(parsed: AnyRecord, botName?: string) {
  const resolvedBotName = resolveBotName(botName || parsed?.botName);
  const groups = parsed?.groups || [];
  const botGroups = groups.filter((group) =>
    group.agents.some((agent) => agentMatchesBot(agent, resolvedBotName))
  );
  const selectedGroups =
    botGroups.length > 0
      ? botGroups
      : groups.filter((group) => group.agents.some((agent) => agent === "*"));

  return selectedGroups.flatMap((group) => group.rules);
}

function escapeRegExp(value: string) {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

function patternMatches(pattern: string, path: string) {
  if (pattern.includes("*") || pattern.endsWith("$")) {
    const anchored = pattern.endsWith("$");
    const sourcePattern = anchored ? pattern.slice(0, -1) : pattern;
    const source = sourcePattern
      .split("*")
      .map((part) => escapeRegExp(part))
      .join(".*");
    const regex = new RegExp(`^${source}${anchored ? "$" : ""}`);
    return regex.test(path);
  }

  return path.startsWith(pattern);
}

function compareRules(left: AnyRecord, right: AnyRecord) {
  if (left.pattern.length !== right.pattern.length) {
    return right.pattern.length - left.pattern.length;
  }
  if (left.directive === right.directive) return 0;
  return left.directive === "allow" ? -1 : 1;
}

function evaluate(parsed: AnyRecord, url: string, botName?: string) {
  const parsedUrl = new URL(url);
  const path = `${parsedUrl.pathname}${parsedUrl.search}`;
  const matchedRule =
    selectRules(parsed, botName)
      .filter((rule) => patternMatches(rule.pattern, path))
      .sort(compareRules)[0] || null;

  return {
    allowed: matchedRule ? matchedRule.directive === "allow" : true,
    matchedRule
  };
}

function createRobotsCache(options: AnyRecord = {}) {
  return {
    entries: new Map(),
    botName: resolveBotName(options.botName),
    fetchText: options.fetchText || fetchText
  };
}

async function loadRobots(cache: AnyRecord, parsedUrl: URL, options: AnyRecord = {}) {
  const robotsUrl = `${parsedUrl.origin}/robots.txt`;
  const fetcher = options.fetchText || cache.fetchText || fetchText;

  if (!cache.entries.has(parsedUrl.origin)) {
    const requestOptions = {
      ...options.fetchOptions,
      accept: ROBOTS_ACCEPT
    };
    const promise = fetcher(robotsUrl, requestOptions)
      .then((text) => parseRobots(text, options.botName || cache.botName))
      .catch(() => parseRobots("", options.botName || cache.botName));
    cache.entries.set(parsedUrl.origin, promise);
  }

  return cache.entries.get(parsedUrl.origin);
}

async function checkUrl(cache: AnyRecord | null, url: string, options: AnyRecord = {}) {
  const robotsCache = cache || createRobotsCache(options);
  const parsedUrl = new URL(url);
  const host = parsedUrl.host;
  const parsed = await loadRobots(robotsCache, parsedUrl, options);
  const result = evaluate(parsed, url, options.botName || robotsCache.botName);

  if (!result.allowed && options.warn !== false) {
    const pattern = result.matchedRule?.pattern || "";
    console.warn(`Robots warning: ${host} disallows ${parsedUrl.pathname} via ${pattern}`);
  }

  return {
    allowed: result.allowed,
    matchedRule: result.matchedRule,
    host
  };
}

module.exports = {
  createRobotsCache,
  parseRobots,
  evaluate,
  checkUrl
};
