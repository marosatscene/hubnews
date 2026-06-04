import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, CircleCheck, ExternalLink, OctagonX, RefreshCcw } from "lucide-react";

type SemanticTopicStatus = {
  id: number;
  name: string;
  status: "matched" | "rejected" | "pending";
  confidence: number | null;
  evaluatedAt: string | null;
};

export type NewsHubArticle = {
  id: number;
  headline: string;
  headlineSk: string | null;
  headlineEn: string | null;
  source: string | null;
  publishedAt: string | null;
  fetchedAt: string | null;
  snippet: string;
  topics: string[];
  semanticTopics: SemanticTopicStatus[];
  link: string | null;
};

export type NewsHubSource = {
  id: number;
  name: string;
  country: string | null;
  enabled: boolean;
  lastError: string | null;
  articleCount: number;
};

export type NewsHubTopic = {
  id: number;
  name: string;
  description: string | null;
};

type NewsHubLanguage = "sk" | "en";

interface NewsHubViewProps
  extends Readonly<{
    articles: NewsHubArticle[];
    sources: NewsHubSource[];
    topics: NewsHubTopic[];
    loading: boolean;
    error?: string | null;
    onRefresh?: () => void;
    onReviewTopic?: (topicId?: number) => void;
  }> {}

interface HeadlineRowProps
  extends Readonly<{
    article: NewsHubArticle;
    language: NewsHubLanguage;
    sourceCountry?: string | null;
  }> {}

type ActiveTopic = {
  key: string;
  label: string;
  count: number;
  topicId?: number;
};

type SourceCountryGroup = {
  country: string;
  articleCount: number;
  sourceCount: number;
  sources: SourceFilterItem[];
};

type SourceFilterItem = {
  name: string;
  articleCount: number;
};

type SourceFilterGroups = {
  countries: SourceCountryGroup[];
  looseSources: SourceFilterItem[];
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function text(language: NewsHubLanguage, sk: string, en: string) {
  return language === "sk" ? sk : en;
}

function displayHeadline(article: NewsHubArticle, language: NewsHubLanguage) {
  if (language === "en") return article.headlineEn || article.headline || article.headlineSk || "Untitled headline";
  return article.headlineSk || article.headline || article.headlineEn || "Titulok nie je k dispozicii";
}

function displaySnippet(article: NewsHubArticle, language: NewsHubLanguage) {
  if (article.snippet) return article.snippet;
  return text(language, "Zhrnutie zatial nie je ulozene.", "No stored summary yet.");
}

function formatNewsTime(value: string | null, language: NewsHubLanguage) {
  if (!value) return text(language, "Bez datumu", "No date");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === "sk" ? "sk-SK" : "en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatMinuteTime(value: string | null, language: NewsHubLanguage) {
  if (!value) return "--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return new Intl.DateTimeFormat(language === "sk" ? "sk-SK" : "en", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function articleTimeValue(article: NewsHubArticle) {
  const timestamp = Date.parse(article.fetchedAt || article.publishedAt || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareArticlesDesc(left: NewsHubArticle, right: NewsHubArticle) {
  const timestampDiff = articleTimeValue(right) - articleTimeValue(left);
  if (timestampDiff !== 0) return timestampDiff;
  return right.id - left.id;
}

function matchedSemanticTopics(article: NewsHubArticle) {
  return (article.semanticTopics || []).filter((topic) => topic.status === "matched" && topic.name);
}

function articleTopics(article: NewsHubArticle) {
  const semantic = (article.semanticTopics || [])
    .filter((topic) => topic.status === "matched")
    .map((topic) => topic.name);
  return [...new Set([...semantic, ...(article.topics || [])].filter(Boolean))];
}

function articleSearchText(article: NewsHubArticle) {
  return [
    article.headline,
    article.headlineSk,
    article.headlineEn,
    article.source,
    article.snippet,
    ...articleTopics(article)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesTopic(article: NewsHubArticle, topicId: string) {
  if (topicId === "all") return true;
  return (article.semanticTopics || []).some((topic) => String(topic.id) === topicId && topic.status === "matched");
}

function activeTopicsFromArticles(articles: NewsHubArticle[], hours: number) {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const counts = new Map<string, ActiveTopic>();

  for (const article of articles) {
    const timestamp = articleTimeValue(article);
    if (!timestamp || timestamp < cutoff) continue;

    const seen = new Set<string>();
    for (const topic of matchedSemanticTopics(article)) {
      const key = `semantic:${topic.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const current = counts.get(key) || { key, label: topic.name, count: 0, topicId: topic.id };
      counts.set(key, { ...current, count: current.count + 1 });
    }

    for (const label of article.topics || []) {
      const trimmed = String(label).trim();
      if (!trimmed) continue;
      const key = `raw:${trimmed.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const current = counts.get(key) || { key, label: trimmed, count: 0 };
      counts.set(key, { ...current, count: current.count + 1 });
    }
  }

  return [...counts.values()]
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, 10);
}

function countryEmoji(country?: string | null) {
  const normalized = normalizeCountry(country);
  if (!normalized) return "🌐";

  const first = normalized.charCodeAt(0) - 65 + 0x1f1e6;
  const second = normalized.charCodeAt(1) - 65 + 0x1f1e6;
  return String.fromCodePoint(first, second);
}

function normalizeCountry(country?: string | null) {
  const normalized = country?.trim().toUpperCase();
  if (!normalized || normalized === "INT") return "";
  if (!/^[A-Z]{2}$/.test(normalized)) return "";
  return normalized;
}

function SourceStatusIcon({ enabled }: Readonly<{ enabled: boolean }>) {
  if (enabled) {
    return <CircleCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />;
  }

  return <OctagonX className="h-4 w-4 text-red-600" aria-hidden="true" />;
}

function sourceFilterGroupsFromData(
  sources: readonly NewsHubSource[],
  articles: readonly NewsHubArticle[]
): SourceFilterGroups {
  const countries = new Map<string, SourceCountryGroup>();
  const looseSources = new Map<string, LooseSourceGroup>();
  const sourceCountries = new Map<string, string>();
  const articleCounts = new Map<string, number>();
  const sourceNames = new Set<string>();

  for (const source of sources) {
    if (!source.name) continue;
    sourceNames.add(source.name);
    const country = normalizeCountry(source.country);
    if (country) sourceCountries.set(source.name, country);
  }

  for (const article of articles) {
    if (!article.source) continue;
    sourceNames.add(article.source);
    articleCounts.set(article.source, (articleCounts.get(article.source) || 0) + 1);
  }

  for (const sourceName of sourceNames) {
    const country = sourceCountries.get(sourceName);
    const articleCount = articleCounts.get(sourceName) || 0;
    if (articleCount <= 0) continue;

    if (country) {
      const current = countries.get(country) || {
        country,
        articleCount: 0,
        sourceCount: 0,
        sources: []
      };
      current.articleCount += articleCount;
      current.sourceCount += 1;
      current.sources.push({ name: sourceName, articleCount });
      countries.set(country, current);
    } else {
      looseSources.set(sourceName, { name: sourceName, articleCount });
    }
  }

  return {
    countries: [...countries.values()]
      .map((group) => ({
        ...group,
        sources: group.sources.sort(
          (left, right) => right.articleCount - left.articleCount || left.name.localeCompare(right.name)
        )
      }))
      .sort((left, right) => right.articleCount - left.articleCount || left.country.localeCompare(right.country)),
    looseSources: [...looseSources.values()]
      .sort((left, right) => right.articleCount - left.articleCount || left.name.localeCompare(right.name))
  };
}

function HeadlineRow({ article, language, sourceCountry }: HeadlineRowProps) {
  const title = displayHeadline(article, language);
  const topics = articleTopics(article).slice(0, 4);
  const sourceLabel = article.source || text(language, "Neznamy zdroj", "Unknown source");
  const country = sourceCountry?.trim().toUpperCase() || "INT";

  return (
    <article className="grid grid-cols-[54px_minmax(0,1fr)] gap-3 border-b border-slate-200 py-4 last:border-b-0">
      <time className="pt-1 text-[13px] font-extrabold tabular-nums text-slate-950">
        {formatMinuteTime(article.publishedAt || article.fetchedAt, language)}
      </time>

      <div className="min-w-0">
        <div className="mb-1 flex min-w-0 items-center gap-1.5 text-[12px] font-bold text-slate-500">
          <span aria-label={text(language, `Zdroj z krajiny ${country}`, `Source country ${country}`)}>
            {countryEmoji(sourceCountry)}
          </span>
          <span className="truncate">{sourceLabel}</span>
          <span className="text-slate-300">/</span>
          <span className="truncate">{formatNewsTime(article.publishedAt || article.fetchedAt, language)}</span>
        </div>
        <h2 className="text-[17px] font-bold leading-6 text-slate-950 md:text-[18px]">
            {article.link ? (
              <a className="inline hover:text-red-700" href={article.link} rel="noreferrer" target="_blank">
                {title}
                <ExternalLink className="ml-2 inline h-4 w-4 align-[-1px] text-slate-400" />
              </a>
            ) : (
              title
            )}
        </h2>
        <p className="mt-1 text-[15px] leading-6 text-slate-700">{displaySnippet(article, language)}</p>
          {topics.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {topics.map((topic) => (
                <span
                className="text-[12px] font-extrabold text-red-700 hover:text-red-800"
                  key={topic}
                >
                  {topic}
                </span>
              ))}
            </div>
          )}
        </div>
    </article>
  );
}

function SidebarControls({
  language,
  query,
  topicId,
  disabledCountries,
  disabledSources,
  sourceGroups,
  topics,
  activeHours,
  activeTopics,
  onQueryChange,
  onReset,
  onActiveHoursChange,
  onActiveTopicClick,
  onEnableAllSources,
  onTopicChange,
  onToggleCountry,
  onToggleSource
}: Readonly<{
  language: NewsHubLanguage;
  query: string;
  topicId: string;
  disabledCountries: ReadonlySet<string>;
  disabledSources: ReadonlySet<string>;
  sourceGroups: SourceFilterGroups;
  topics: readonly NewsHubTopic[];
  activeHours: number;
  activeTopics: readonly ActiveTopic[];
  onQueryChange: (value: string) => void;
  onReset: () => void;
  onActiveHoursChange: (value: number) => void;
  onActiveTopicClick: (topic: ActiveTopic) => void;
  onEnableAllSources: () => void;
  onTopicChange: (value: string) => void;
  onToggleCountry: (country: string) => void;
  onToggleSource: (source: string) => void;
}>) {
  const sourceFiltersActive = disabledCountries.size > 0 || disabledSources.size > 0;
  const [expandedCountryList, setExpandedCountryList] = useState<string[]>([]);
  const expandedCountries = useMemo(() => new Set(expandedCountryList), [expandedCountryList]);

  function toggleExpandedCountry(country: string) {
    setExpandedCountryList((current) =>
      current.includes(country)
        ? current.filter((item) => item !== country)
        : [...current, country]
    );
  }

  return (
    <aside className="space-y-6 border-b border-slate-200 pb-5 lg:sticky lg:top-4 lg:border-b-0 lg:pb-0">
      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 className="text-[12px] font-extrabold uppercase tracking-[0.08em] text-slate-500">
            {text(language, "Aktualne temy", "Current topics")}
          </h2>
          <select
            className="h-8 rounded border border-slate-300 bg-white px-2 text-[12px] font-bold text-slate-800"
            value={activeHours}
            onChange={(event) => onActiveHoursChange(Number(event.target.value))}
          >
            {[6, 12, 24, 48].map((hours) => (
              <option key={hours} value={hours}>
                {hours}h
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          {activeTopics.length ? (
            activeTopics.map((topic) => (
              <button
                className="flex w-full items-center justify-between gap-3 border-b border-slate-100 py-1.5 text-left text-[14px] font-bold text-slate-950 hover:text-red-700"
                key={topic.key}
                type="button"
                onClick={() => onActiveTopicClick(topic)}
              >
                <span className="truncate">{topic.label}</span>
                <span className="text-[12px] text-slate-400">{topic.count}</span>
              </button>
            ))
          ) : (
            <p className="text-sm font-semibold leading-5 text-slate-500">
              {text(language, "Ziadne tagy v tomto casovom okne.", "No tags in this time window.")}
            </p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[12px] font-extrabold uppercase tracking-[0.08em] text-slate-500">
          {text(language, "Filtre", "Filters")}
        </h2>

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-extrabold uppercase tracking-[0.05em] text-slate-500">
              {text(language, "Zdroje", "Sources")}
            </h3>
            <button
              className={cx(
                "min-h-8 rounded border px-2 text-[12px] font-extrabold",
                sourceFiltersActive
                  ? "border-slate-950 bg-slate-950 text-white"
                  : "border-slate-200 bg-white text-slate-400"
              )}
              type="button"
              onClick={onEnableAllSources}
            >
              {text(language, "Vsetky", "All")}
            </button>
          </div>

          <div className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-1">
            {sourceGroups.countries.map((group) => {
              const disabled = disabledCountries.has(group.country);
              const expanded = expandedCountries.has(group.country);
              return (
                <div
                  className={cx(
                    "min-w-0 rounded border bg-white",
                    disabled
                      ? "border-red-100 bg-red-50/50"
                      : "border-slate-300"
                  )}
                  key={group.country}
                >
                  <div className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-stretch">
                    <button
                      aria-expanded={expanded}
                      className="grid min-w-0 grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-1.5 px-2 py-1.5 text-left text-slate-950 hover:bg-slate-50"
                      type="button"
                      onClick={() => toggleExpandedCountry(group.country)}
                      title={group.sources.map((source) => source.name).join(", ")}
                    >
                      {expanded ? (
                        <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
                      )}
                      <span className="text-base leading-none">{countryEmoji(group.country)}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-extrabold">{group.country}</span>
                        <span className="block truncate text-[10px] font-bold text-slate-400">
                          {group.sourceCount} {text(language, "zdrojov", "sources")}
                        </span>
                      </span>
                      <span className="text-[11px] font-extrabold tabular-nums text-slate-400">
                        {group.articleCount}
                      </span>
                    </button>

                    <button
                      aria-label={text(
                        language,
                        `${disabled ? "Zapnut" : "Vypnut"} vsetky zdroje z krajiny ${group.country}`,
                        `${disabled ? "Enable" : "Disable"} all sources from ${group.country}`
                      )}
                      aria-pressed={!disabled}
                      className={cx(
                        "flex w-10 items-center justify-center border-l",
                        disabled
                          ? "border-red-100 bg-red-50 hover:bg-red-100"
                          : "border-slate-200 bg-white hover:bg-emerald-50"
                      )}
                      type="button"
                      onClick={() => onToggleCountry(group.country)}
                      title={disabled ? "STOP" : "Checked"}
                    >
                      <SourceStatusIcon enabled={!disabled} />
                      <span className="sr-only">{disabled ? "STOP" : "Checked"}</span>
                    </button>
                  </div>

                  {expanded && (
                    <div className="border-t border-slate-100 bg-slate-50/70 p-1.5">
                      <div className="grid gap-1">
                        {group.sources.map((source) => {
                          const sourceDisabled = disabledSources.has(source.name);
                          const effectivelyEnabled = !disabled && !sourceDisabled;
                          return (
                            <button
                              aria-pressed={effectivelyEnabled}
                              className={cx(
                                "grid min-h-9 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded border px-2 py-1.5 text-left",
                                effectivelyEnabled
                                  ? "border-slate-200 bg-white text-slate-950 hover:bg-emerald-50"
                                  : "border-red-100 bg-white text-slate-500 hover:bg-red-50"
                              )}
                              key={source.name}
                              type="button"
                              onClick={() => onToggleSource(source.name)}
                              title={effectivelyEnabled ? "Checked" : "STOP"}
                            >
                              <SourceStatusIcon enabled={effectivelyEnabled} />
                              <span className="min-w-0 truncate text-[12px] font-extrabold">{source.name}</span>
                              <span className="text-[11px] font-extrabold tabular-nums text-slate-400">
                                {source.articleCount}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {sourceGroups.looseSources.map((source) => {
              const disabled = disabledSources.has(source.name);
              return (
                <button
                  aria-pressed={!disabled}
                  className={cx(
                    "grid min-h-11 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 rounded border px-2 py-1.5 text-left",
                    disabled
                      ? "border-slate-200 bg-slate-100 text-slate-400"
                      : "border-slate-300 bg-white text-slate-950 hover:bg-slate-50"
                  )}
                  key={source.name}
                  type="button"
                  onClick={() => onToggleSource(source.name)}
                  title={disabled ? "STOP" : "Checked"}
                >
                  <SourceStatusIcon enabled={!disabled} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-extrabold">{source.name}</span>
                    <span className="block truncate text-[10px] font-bold text-slate-400">
                      {text(language, "bez krajiny", "no country")}
                    </span>
                  </span>
                  <span className="text-[11px] font-extrabold tabular-nums text-slate-400">
                    {source.articleCount}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <label className="grid gap-1 text-xs font-extrabold uppercase tracking-[0.05em] text-slate-500">
          {text(language, "Hladanie", "Search")}
          <input
            className="min-h-9 rounded border border-slate-300 bg-white px-2 text-sm font-bold normal-case tracking-normal text-slate-950"
            placeholder={text(language, "Trump, Slovensko, NATO...", "Trump, Slovakia, NATO...")}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </label>

        <div>
          <p className="mb-1 text-xs font-extrabold uppercase tracking-[0.05em] text-slate-500">
            {text(language, "Sekcia", "Section")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button
              className={cx(
                "whitespace-nowrap rounded-full border px-2.5 py-1.5 text-[12px] font-extrabold",
                topicId === "all"
                  ? "border-slate-950 bg-slate-950 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              )}
              type="button"
              onClick={() => onTopicChange("all")}
            >
              {text(language, "Vsetky spravy", "All news")}
            </button>
            {topics.map((topic) => (
              <button
                className={cx(
                  "whitespace-nowrap rounded-full border px-2.5 py-1.5 text-[12px] font-extrabold",
                  topicId === String(topic.id)
                    ? "border-slate-950 bg-slate-950 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                )}
                key={topic.id}
                type="button"
                onClick={() => onTopicChange(String(topic.id))}
              >
                {topic.name}
              </button>
            ))}
          </div>
        </div>

        <button
          className="min-h-9 rounded border border-slate-300 bg-white px-3 text-sm font-extrabold text-slate-950 hover:bg-slate-50"
          type="button"
          onClick={onReset}
        >
          {text(language, "Reset", "Reset")}
        </button>
      </section>
    </aside>
  );
}

function feedTitle(language: NewsHubLanguage, query: string, topicName?: string) {
  const trimmedQuery = query.trim();

  if (trimmedQuery) {
    return text(language, `Najnovsie spravy: ${trimmedQuery}`, `Latest news about ${trimmedQuery}`);
  }

  if (topicName) {
    return text(language, `Najnovsie spravy: ${topicName}`, `Latest news about ${topicName}`);
  }

  return text(language, "Najnovsie spravy", "Latest news");
}

export function NewsHubView({ articles, sources, topics, loading, error, onRefresh }: NewsHubViewProps) {
  const [language, setLanguage] = useState<NewsHubLanguage>("sk");
  const [query, setQuery] = useState("");
  const [topicId, setTopicId] = useState("all");
  const [disabledCountryList, setDisabledCountryList] = useState<string[]>([]);
  const [disabledSourceList, setDisabledSourceList] = useState<string[]>([]);
  const [activeHours, setActiveHours] = useState(24);

  const disabledCountries = useMemo(() => new Set(disabledCountryList), [disabledCountryList]);
  const disabledSources = useMemo(() => new Set(disabledSourceList), [disabledSourceList]);
  const sourceGroups = useMemo(() => sourceFilterGroupsFromData(sources, articles), [articles, sources]);

  const sourceCountries = useMemo(() => {
    const countries = new Map<string, string | null>();
    for (const source of sources) {
      if (source.name) countries.set(source.name, source.country);
    }
    return countries;
  }, [sources]);

  const selectedTopic = topics.find((topic) => String(topic.id) === topicId);
  const activeTopics = useMemo(() => activeTopicsFromArticles(articles, activeHours), [activeHours, articles]);
  const visibleArticles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return articles
      .filter((article) => {
        const articleCountry = article.source ? normalizeCountry(sourceCountries.get(article.source)) : "";
        if (article.source && disabledSources.has(article.source)) return false;
        if (articleCountry && disabledCountries.has(articleCountry)) return false;
        if (!matchesTopic(article, topicId)) return false;
        if (normalizedQuery && !articleSearchText(article).includes(normalizedQuery)) return false;
        return true;
      })
      .sort(compareArticlesDesc);
  }, [articles, disabledCountries, disabledSources, query, sourceCountries, topicId]);

  const title = feedTitle(language, query, selectedTopic?.name);

  return (
    <section className="w-full bg-[#fbfaf8] text-slate-950">
      <div className="mx-auto grid max-w-[1120px] gap-6 px-3 py-4 md:px-5 lg:grid-cols-[240px_minmax(0,720px)]">
        <SidebarControls
          activeHours={activeHours}
          activeTopics={activeTopics}
          disabledCountries={disabledCountries}
          disabledSources={disabledSources}
          language={language}
          query={query}
          sourceGroups={sourceGroups}
          topicId={topicId}
          topics={topics}
          onActiveHoursChange={setActiveHours}
          onActiveTopicClick={(topic) => {
            if (topic.topicId) {
              setTopicId(String(topic.topicId));
              setQuery("");
            } else {
              setTopicId("all");
              setQuery(topic.label);
            }
          }}
          onEnableAllSources={() => {
            setDisabledCountryList([]);
            setDisabledSourceList([]);
          }}
          onQueryChange={setQuery}
          onReset={() => {
            setQuery("");
            setTopicId("all");
            setDisabledCountryList([]);
            setDisabledSourceList([]);
          }}
          onTopicChange={setTopicId}
          onToggleCountry={(country) => {
            setDisabledCountryList((current) =>
              current.includes(country)
                ? current.filter((item) => item !== country)
                : [...current, country]
            );
          }}
          onToggleSource={(source) => {
            setDisabledSourceList((current) =>
              current.includes(source)
                ? current.filter((item) => item !== source)
                : [...current, source]
            );
          }}
        />

        <main className="min-w-0">
          <header className="border-b-2 border-slate-950 pb-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] font-extrabold uppercase tracking-[0.08em] text-red-700">
                Smart News Hub
              </p>
              <div className="inline-flex min-h-10 overflow-hidden rounded border border-slate-300 bg-white">
                {(["sk", "en"] as const).map((option) => (
                  <button
                    className={cx(
                      "px-4 text-sm font-extrabold uppercase",
                      language === option ? "bg-slate-950 text-white" : "text-slate-700 hover:bg-slate-100"
                    )}
                    key={option}
                    type="button"
                    onClick={() => setLanguage(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-[28px] font-extrabold leading-tight tracking-normal text-slate-950 md:text-[34px]">
                  {title}
                </h1>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  {visibleArticles.length.toLocaleString()} {text(language, "sprav", "items")}
                </p>
              </div>
              {onRefresh && (
                <button
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded border border-slate-300 bg-white px-3 text-sm font-extrabold text-slate-950 hover:bg-slate-50"
                  type="button"
                  onClick={onRefresh}
                >
                  <RefreshCcw size={16} />
                  {text(language, "Obnovit", "Refresh")}
                </button>
              )}
            </div>
          </header>

          {error && (
            <div className="mt-4 border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">
              {error}
            </div>
          )}

          <div className="bg-[#fbfaf8]">
            {loading ? (
              <div className="border-b border-slate-200 py-8 text-sm font-bold text-slate-500">
                {text(language, "Nacitavam spravy z databazy...", "Loading news from the database...")}
              </div>
            ) : visibleArticles.length ? (
              visibleArticles.map((article) => (
                <HeadlineRow
                  article={article}
                  key={article.id}
                  language={language}
                  sourceCountry={article.source ? sourceCountries.get(article.source) : null}
                />
              ))
            ) : (
              <div className="border-b border-slate-200 py-8">
                <p className="text-xl font-extrabold text-slate-950">
                  {text(language, "Ziadne spravy na zobrazenie.", "No news to show.")}
                </p>
                <p className="mt-2 text-sm font-semibold text-slate-500">
                  {articles.length
                    ? text(language, "Ziadne spravy nezodpovedaju filtrom.", "No news matches the current filters.")
                    : text(
                        language,
                        "Hub nepouziva demo data. Spravy sa nacitavaju z rovnakeho backendu ako admin zoznam.",
                        "The hub does not use demo data. News is loaded from the same backend as the admin list."
                      )}
                </p>
              </div>
            )}
          </div>
        </main>
      </div>
    </section>
  );
}
