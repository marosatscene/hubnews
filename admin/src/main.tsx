import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  ExternalLink,
  List,
  Menu,
  Pencil,
  RefreshCcw,
  Save,
  Search,
  ServerCog,
  Sparkles,
  X
} from "lucide-react";
import "./styles.css";

type Article = {
  id: number;
  headline: string;
  headlineSk: string | null;
  headlineEn: string | null;
  headlineLanguage: string | null;
  headlineTranslatedAt: string | null;
  headlineTranslationModel: string | null;
  source: string | null;
  publishedAt: string | null;
  fetchedAt: string | null;
  snippet: string;
  topics: string[];
  semanticTopics: SemanticTopicStatus[];
  link: string | null;
};

type SemanticTopicStatus = {
  id: number;
  name: string;
  status: "matched" | "rejected" | "pending";
  confidence: number | null;
  evaluatedAt: string | null;
};

type Source = {
  id: number;
  name: string;
  homepageUrl: string | null;
  feedUrl: string | null;
  language: string | null;
  country: string | null;
  enabled: boolean;
  checkIntervalMinutes: number | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  articleCount: number;
};

type Topic = {
  id: number;
  name: string;
  description: string | null;
};

type View = "news" | "sources";

type AdminMeta = {
  llm: {
    provider: string;
    model: string;
    configured: boolean;
    pricing: null | {
      inputUsdPerMillion: number;
      outputUsdPerMillion: number;
      sourceUrl?: string;
    };
  };
  maxEvaluationBatchSize: number;
};

const endpoints = {
  articles: "/admin/api/articles",
  meta: "/admin/api/meta",
  sources: "/admin/api/sources",
  topics: "/admin/api/topics",
  semanticFilter: "/admin/api/semantic-filter",
  headlineTranslations: "/admin/api/headline-translations/run",
  sourceRefetch: "/admin/api/sources/refetch-missing"
};

const defaultAdminMeta: AdminMeta = {
  llm: {
    provider: "unknown",
    model: "unknown",
    configured: false,
    pricing: null
  },
  maxEvaluationBatchSize: 1000
};

const emptyNewsFilters = {
  q: "",
  source: "",
  topic: "",
  status: "",
  from: "",
  to: "",
  pageSize: "25"
};

const emptySourceFilters = {
  q: "",
  country: "",
  condition: "all"
};

const tooltips = {
  semanticTopic:
    "Runs an LLM/semantic evaluation over unevaluated articles and creates or updates a stored topic filter.",
  semanticContext:
    "Extra semantic guidance for the LLM evaluation, such as aliases, places, institutions, and related concepts.",
  semanticLimit: "Maximum number of unevaluated articles to send to the semantic evaluator.",
  semanticEvaluate: "Evaluate headlines against the semantic topic using the configured LLM model.",
  headlineTranslate:
    "Translate stored article headlines missing Slovak or English versions. Existing translations are skipped.",
  fullTextSearch: "Full-text keyword search over stored headline and context fields. This is not semantic search.",
  sourceFilter: "Filter articles by one news source. Changing this reloads results automatically.",
  topicFilter: "Filter by stored semantic topic evaluations created by the Evaluate action.",
  statusFilter: "Filter topic-evaluated articles by matched, rejected, or pending status.",
  fromFilter: "Show articles published or discovered on or after this date.",
  toFilter: "Show articles published or discovered on or before this date.",
  pageSize: "Number of articles to show per page. Changing this reloads results automatically.",
  resetFilters: "Clear all article filters and reload results.",
  refreshResults: "Refresh results with the current filters. Filters also auto-apply when changed.",
  previousPage: "Load the previous page of filtered article results.",
  nextPage: "Load the next page of filtered article results.",
  reloadSources: "Reload sources, topics, and crawl status from the backend.",
  refetchMissing: "Run the checker for sources with no articles, no successful fetch, or a recent error.",
  sourceSearch: "Filter the source list by source name, homepage URL, or feed URL.",
  sourceCountryFilter: "Filter the source list by country code.",
  sourceConditionFilter:
    "Filter sources by article count or crawl health: zero articles, non-working, or either condition.",
  resetSourceFilters: "Clear source list filters.",
  sourceName: "Open a modal with fetched articles for this source.",
  editSource: "Open this source in the edit modal.",
  saveSource: "Save edits for this source configuration.",
  viewSourceArticles: "Open a modal with fetched articles for this source.",
  recrawlSource: "Run a crawl for this source now.",
  mobileMenu: "Toggle navigation",
  closeModal: "Close this modal"
};

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(new URL(url, window.location.origin), {
    ...options,
    credentials: "same-origin"
  });
  if (!response.ok) {
    throw new Error(`Request failed with HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function formatDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatPublishedDate(value: string | null) {
  return value ? formatDate(value) : "Not provided";
}

function formatCountry(value: string | null) {
  const country = value?.trim();
  return country ? country.toUpperCase() : "int";
}

function countryEmoji(country: string) {
  if (country === "int") return "🌐";
  if (!/^[A-Z]{2}$/.test(country)) return "🌐";

  const first = country.charCodeAt(0) - 65 + 0x1f1e6;
  const second = country.charCodeAt(1) - 65 + 0x1f1e6;
  return String.fromCodePoint(first, second);
}

function normalizeSourcePayload(source: Source) {
  return {
    enabled: source.enabled,
    name: source.name.trim(),
    homepageUrl: source.homepageUrl?.trim() || "",
    feedUrl: source.feedUrl?.trim() || null,
    checkIntervalMinutes: Number(source.checkIntervalMinutes || 60),
    language: source.language?.trim() || null,
    country: source.country?.trim() || null
  };
}

function crawlStatus(source: Source) {
  if (source.lastError) return "Failed";
  if (source.lastSuccessAt) return "Success";
  if (source.lastCheckedAt) return "Checked";
  return "Never fetched";
}

function crawlStatusClass(source: Source) {
  if (source.lastError) return "failed";
  if (source.lastSuccessAt) return "success";
  if (source.lastCheckedAt) return "checked";
  return "never";
}

function estimateEvaluationCost(articleCount: number, meta: AdminMeta) {
  const pricing = meta.llm.pricing;
  if (!pricing || articleCount <= 0) return null;

  const inputTokens = 550 + articleCount * 130;
  const outputTokens = articleCount * 45;
  const usd =
    (inputTokens / 1_000_000) * pricing.inputUsdPerMillion +
    (outputTokens / 1_000_000) * pricing.outputUsdPerMillion;

  return { inputTokens, outputTokens, usd };
}

function formatUsd(value: number) {
  if (value > 0 && value < 0.01) return "< $0.01";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  }).format(value);
}

function TopicBadges({ topics }: { topics?: string[] }) {
  const visibleTopics = (topics || []).filter(Boolean).slice(0, 6);
  if (!visibleTopics.length) return null;

  return (
    <div className="topic-badges">
      {visibleTopics.map((topic) => (
        <span className="topic-badge" key={topic}>
          {topic}
        </span>
      ))}
    </div>
  );
}

function SemanticTopicBadges({ topics }: { topics?: SemanticTopicStatus[] }) {
  const visibleTopics = (topics || []).filter((topic) => topic.name);
  if (!visibleTopics.length) return <span className="muted">No topics</span>;

  return (
    <div className="semantic-topic-badges">
      {visibleTopics.map((topic) => {
        const title =
          topic.status === "matched"
            ? `${topic.name}: confirmed as relevant`
            : topic.status === "rejected"
              ? `${topic.name}: confirmed as not relevant`
              : `${topic.name}: not evaluated yet`;

        return (
          <span className={`semantic-topic-badge ${topic.status}`} key={topic.id} title={title}>
            {topic.name}
          </span>
        );
      })}
    </div>
  );
}

function HeadlineBlock({ article }: { article: Article }) {
  const original = article.headline || "Untitled";
  const translatedAt = article.headlineTranslatedAt ? `Translated ${formatDate(article.headlineTranslatedAt)}` : "";

  return (
    <div className="headline-block">
      <a className="headline" href={article.link || "#"} target="_blank" rel="noreferrer">
        {original}
      </a>
      <div className="headline-translations" title={translatedAt || "Headline translation status"}>
        <div className="headline-translation">
          <span className="lang-chip">SK</span>
          <span className={article.headlineSk ? "" : "headline-pending"}>
            {article.headlineSk || "Translation pending"}
          </span>
        </div>
        <div className="headline-translation">
          <span className="lang-chip">EN</span>
          <span className={article.headlineEn ? "" : "headline-pending"}>
            {article.headlineEn || "Translation pending"}
          </span>
        </div>
      </div>
    </div>
  );
}

function Sidebar({
  collapsed,
  currentView,
  onToggle,
  onViewChange
}: {
  collapsed: boolean;
  currentView: View;
  onToggle: () => void;
  onViewChange: (view: View) => void;
}) {
  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="brand">
        {!collapsed && (
          <div>
            <div className="brand-title">HubNews</div>
            <div className="brand-subtitle">Admin</div>
          </div>
        )}
        <button className="icon-button" type="button" onClick={onToggle} title="Collapse navigation">
          {collapsed ? <Menu size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>
      <nav className="nav-list" aria-label="Admin views">
        <button
          className={`nav-item ${currentView === "news" ? "active" : ""}`}
          type="button"
          onClick={() => onViewChange("news")}
          title="List of news"
        >
          <List size={18} />
          {!collapsed && <span>List of news</span>}
        </button>
        <button
          className={`nav-item ${currentView === "sources" ? "active" : ""}`}
          type="button"
          onClick={() => onViewChange("sources")}
          title="Sources"
        >
          <ServerCog size={18} />
          {!collapsed && <span>Sources</span>}
        </button>
      </nav>
    </aside>
  );
}

function NewsView({
  articles,
  adminMeta,
  topics,
  sources,
  filters,
  loading,
  offset,
  lastPageSize,
  totalArticleCount,
  onFilterChange,
  onApply,
  onReset,
  onPrev,
  onNext,
  onSemanticEvaluate,
  onTranslateHeadlines
}: {
  articles: Article[];
  adminMeta: AdminMeta;
  topics: Topic[];
  sources: Source[];
  filters: typeof emptyNewsFilters;
  loading: boolean;
  offset: number;
  lastPageSize: number;
  totalArticleCount: number;
  onFilterChange: (name: keyof typeof emptyNewsFilters, value: string) => void;
  onApply: () => void;
  onReset: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSemanticEvaluate: (input: { topic: string; description: string; limit: number }) => Promise<void>;
  onTranslateHeadlines: () => Promise<void>;
}) {
  const [semantic, setSemantic] = useState({
    topic: "",
    description: "",
    limit: "50"
  });
  const [evaluating, setEvaluating] = useState(false);
  const [translatingHeadlines, setTranslatingHeadlines] = useState(false);
  const page = Math.floor(offset / lastPageSize) + 1;
  const requestedEvalCount =
    semantic.limit === "all"
      ? Math.min(totalArticleCount, adminMeta.maxEvaluationBatchSize)
      : Math.min(Number(semantic.limit || 50), adminMeta.maxEvaluationBatchSize);
  const costEstimate = estimateEvaluationCost(requestedEvalCount, adminMeta);

  async function submitSemantic(event: FormEvent) {
    event.preventDefault();
    const topic = semantic.topic.trim();
    if (!topic) return;
    setEvaluating(true);
    try {
      await onSemanticEvaluate({
        topic,
        description: semantic.description.trim(),
        limit: requestedEvalCount
      });
    } finally {
      setEvaluating(false);
    }
  }

  async function translateMissingHeadlines() {
    setTranslatingHeadlines(true);
    try {
      await onTranslateHeadlines();
    } finally {
      setTranslatingHeadlines(false);
    }
  }

  return (
    <section className="view">
      <div className="view-header">
        <div>
          <h1>List of news</h1>
          <p>Browse scraped records and filter by stored topic evaluations.</p>
        </div>
      </div>

      <form className="semantic-card" onSubmit={submitSemantic}>
        <label title={tooltips.semanticTopic}>
          Semantic topic
          <input
            value={semantic.topic}
            onChange={(event) => setSemantic({ ...semantic, topic: event.target.value })}
            placeholder="Slovakia"
            title={tooltips.semanticTopic}
            type="search"
          />
        </label>
        <label title={tooltips.semanticContext}>
          Context
          <input
            value={semantic.description}
            onChange={(event) => setSemantic({ ...semantic, description: event.target.value })}
            placeholder="Politics, economy, places, people"
            title={tooltips.semanticContext}
            type="search"
          />
        </label>
        <label title={tooltips.semanticLimit}>
          Evaluate
          <select
            value={semantic.limit}
            onChange={(event) => setSemantic({ ...semantic, limit: event.target.value })}
            title={tooltips.semanticLimit}
          >
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="200">200</option>
            <option value="all">All articles</option>
          </select>
        </label>
        <button className="button primary" disabled={evaluating} title={tooltips.semanticEvaluate} type="submit">
          <Sparkles size={16} />
          {evaluating ? "Evaluating" : "Evaluate"}
        </button>
        <button
          className="button secondary"
          disabled={translatingHeadlines}
          title={tooltips.headlineTranslate}
          type="button"
          onClick={translateMissingHeadlines}
        >
          <Sparkles size={16} />
          {translatingHeadlines ? "Translating" : "Translate headlines"}
        </button>
        <div className="cost-note">
          <span>Model: {adminMeta.llm.model}</span>
          <span>
            Estimate:{" "}
            {costEstimate
              ? `${formatUsd(costEstimate.usd)} for ${requestedEvalCount.toLocaleString()} articles`
              : "no LLM token cost"}
          </span>
        </div>
      </form>

      <form
        className="filters-card"
        onSubmit={(event) => {
          event.preventDefault();
          onApply();
        }}
      >
        <label title={tooltips.fullTextSearch}>
          Search
          <input
            value={filters.q}
            onChange={(event) => onFilterChange("q", event.target.value)}
            title={tooltips.fullTextSearch}
            type="search"
          />
        </label>
        <label title={tooltips.sourceFilter}>
          Source
          <select
            value={filters.source}
            onChange={(event) => onFilterChange("source", event.target.value)}
            title={tooltips.sourceFilter}
          >
            <option value="">All sources</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        </label>
        <label title={tooltips.topicFilter}>
          Topic
          <select
            value={filters.topic}
            onChange={(event) => onFilterChange("topic", event.target.value)}
            title={tooltips.topicFilter}
          >
            <option value="">All topics</option>
            {topics.map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.name}
              </option>
            ))}
          </select>
        </label>
        <label title={tooltips.statusFilter}>
          Status
          <select
            value={filters.status}
            onChange={(event) => onFilterChange("status", event.target.value)}
            title={tooltips.statusFilter}
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="matched">Matched</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
        <label title={tooltips.fromFilter}>
          From
          <input
            value={filters.from}
            onChange={(event) => onFilterChange("from", event.target.value)}
            title={tooltips.fromFilter}
            type="date"
          />
        </label>
        <label title={tooltips.toFilter}>
          To
          <input
            value={filters.to}
            onChange={(event) => onFilterChange("to", event.target.value)}
            title={tooltips.toFilter}
            type="date"
          />
        </label>
        <label title={tooltips.pageSize}>
          Page size
          <select
            value={filters.pageSize}
            onChange={(event) => onFilterChange("pageSize", event.target.value)}
            title={tooltips.pageSize}
          >
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </label>
        <div className="toolbar-actions">
          <button className="button secondary" title={tooltips.resetFilters} type="button" onClick={onReset}>
            Reset
          </button>
          <button className="button primary" title={tooltips.refreshResults} type="submit">
            <Search size={16} />
            Refresh
          </button>
        </div>
      </form>

      <div className="table-panel">
        <table className="news-table">
          <colgroup>
            <col style={{ width: "34%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "24%" }} />
            <col style={{ width: "4%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Headline</th>
              <th>Source</th>
              <th>Published</th>
              <th>Fetched</th>
              <th>Semantic topics</th>
              <th>Link</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="empty" colSpan={6}>
                  Loading
                </td>
              </tr>
            ) : articles.length ? (
              articles.map((article) => (
                <tr key={article.id}>
                  <td>
                    <HeadlineBlock article={article} />
                    <div className="snippet">{article.snippet || ""}</div>
                    <TopicBadges topics={article.topics} />
                  </td>
                  <td className="muted">{article.source || ""}</td>
                  <td className="muted">{formatPublishedDate(article.publishedAt)}</td>
                  <td className="muted">{formatDate(article.fetchedAt)}</td>
                  <td>
                    <SemanticTopicBadges topics={article.semanticTopics} />
                  </td>
                  <td>
                    {article.link && (
                      <a className="open-link" href={article.link} target="_blank" rel="noreferrer" title="Open article">
                        <ExternalLink size={16} />
                      </a>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="empty" colSpan={6}>
                  No articles found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <span className="muted">Page {page}</span>
        <div className="pager-buttons">
          <button
            className="button secondary"
            disabled={offset <= 0}
            title={tooltips.previousPage}
            type="button"
            onClick={onPrev}
          >
            Previous
          </button>
          <button
            className="button secondary"
            disabled={articles.length < lastPageSize}
            title={tooltips.nextPage}
            type="button"
            onClick={onNext}
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}

function SourceArticlesModal({
  articles,
  loading,
  source,
  onClose
}: {
  articles: Article[];
  loading: boolean;
  source: Source | null;
  onClose: () => void;
}) {
  if (!source) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal" aria-modal="true" role="dialog">
        <div className="modal-header">
          <div>
            <h2>{source.name}</h2>
            <p>
              {(source.articleCount ?? 0).toLocaleString()} fetched articles
              {articles.length ? `, showing ${articles.length.toLocaleString()}` : ""}
            </p>
          </div>
          <button className="icon-button close-button" type="button" onClick={onClose} title={tooltips.closeModal}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <table className="modal-table">
            <colgroup>
              <col style={{ width: "46%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "6%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Headline</th>
                <th>Published</th>
                <th>Fetched</th>
                <th>Semantic topics</th>
                <th>Link</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="empty" colSpan={5}>
                    Loading
                  </td>
                </tr>
              ) : articles.length ? (
                articles.map((article) => (
                  <tr key={article.id}>
                  <td>
                      <HeadlineBlock article={article} />
                      <div className="snippet">{article.snippet || ""}</div>
                      <TopicBadges topics={article.topics} />
                    </td>
                    <td className="muted">{formatPublishedDate(article.publishedAt)}</td>
                    <td className="muted">{formatDate(article.fetchedAt)}</td>
                    <td>
                      <SemanticTopicBadges topics={article.semanticTopics} />
                    </td>
                    <td>
                      {article.link && (
                        <a className="open-link" href={article.link} target="_blank" rel="noreferrer" title="Open article">
                          <ExternalLink size={16} />
                        </a>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="empty" colSpan={5}>
                    No articles found for this source
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SourceEditModal({
  draft,
  saving,
  onCancel,
  onChange,
  onSave
}: {
  draft: Source | null;
  saving: boolean;
  onCancel: () => void;
  onChange: (patch: Partial<Source>) => void;
  onSave: () => Promise<void>;
}) {
  if (!draft) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSave();
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal edit-modal" aria-modal="true" role="dialog">
        <div className="modal-header">
          <div>
            <h2>Edit source</h2>
            <p>{draft.name || "Source configuration"}</p>
          </div>
          <button className="icon-button close-button" type="button" onClick={onCancel} title={tooltips.closeModal}>
            <X size={18} />
          </button>
        </div>
        <form className="modal-body edit-source-form" onSubmit={submit}>
          <label className="checkbox-label" title="Enable or disable this source for scheduled checks.">
            <input
              className="checkbox"
              checked={draft.enabled}
              onChange={(event) => onChange({ enabled: event.target.checked })}
              type="checkbox"
            />
            Enabled
          </label>
          <label>
            Name
            <input
              value={draft.name || ""}
              onChange={(event) => onChange({ name: event.target.value })}
              title="Source display name."
            />
          </label>
          <label>
            Homepage
            <input
              value={draft.homepageUrl || ""}
              onChange={(event) => onChange({ homepageUrl: event.target.value })}
              title="Source homepage used for feed discovery and homepage scraping."
              type="url"
            />
          </label>
          <label>
            Feed
            <input
              value={draft.feedUrl || ""}
              onChange={(event) => onChange({ feedUrl: event.target.value })}
              title="RSS/feed URL if known. Empty means the backend will try discovery/homepage scraping."
              type="url"
            />
          </label>
          <div className="edit-source-grid">
            <label>
              Minutes
              <input
                min={5}
                max={1440}
                value={draft.checkIntervalMinutes || 60}
                onChange={(event) =>
                  onChange({ checkIntervalMinutes: Number(event.target.value || 60) })
                }
                title="Minimum minutes between scheduled checks for this source."
                type="number"
              />
            </label>
            <label>
              Language
              <input
                value={draft.language || ""}
                onChange={(event) => onChange({ language: event.target.value })}
                title="Optional language code for this source."
              />
            </label>
            <label>
              Country
              <input
                value={draft.country || ""}
                onChange={(event) => onChange({ country: event.target.value })}
                title="Optional country code for this source."
              />
            </label>
          </div>
          <div className="modal-actions">
            <button className="button secondary" title="Close without saving changes." type="button" onClick={onCancel}>
              Cancel
            </button>
            <button className="button primary" disabled={saving} title={tooltips.saveSource} type="submit">
              <Save size={16} />
              {saving ? "Saving" : "Save"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function SourcesView({
  sources,
  loading,
  onReload,
  onOpenSource,
  onRecrawlSource,
  onRefetchMissing,
  onSaveSource
}: {
  sources: Source[];
  loading: boolean;
  onReload: () => Promise<void>;
  onOpenSource: (source: Source) => Promise<void>;
  onRecrawlSource: (source: Source) => Promise<void>;
  onRefetchMissing: (limit: number) => Promise<void>;
  onSaveSource: (source: Source) => Promise<void>;
}) {
  const [editDraft, setEditDraft] = useState<Source | null>(null);
  const [sourceFilters, setSourceFilters] = useState(emptySourceFilters);
  const [refetchLimit, setRefetchLimit] = useState("3");
  const [savingEdit, setSavingEdit] = useState(false);
  const [recrawlingId, setRecrawlingId] = useState<number | null>(null);
  const [refetching, setRefetching] = useState(false);
  const countries = useMemo(() => {
    const counts = new Map<string, number>();
    for (const source of sources) {
      const country = formatCountry(source.country);
      counts.set(country, (counts.get(country) || 0) + 1);
    }
    return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [sources]);
  const sourceSummary = useMemo(
    () => ({
      zeroArticleCount: sources.filter((source) => Number(source.articleCount || 0) === 0).length,
      nonWorkingCount: sources.filter((source) => Boolean(source.lastError)).length,
      neverFetchedCount: sources.filter((source) => !source.lastCheckedAt).length
    }),
    [sources]
  );

  const crawlRows = useMemo(
    () => {
      const query = sourceFilters.q.trim().toLowerCase();
      return sources
        .filter((source) => {
          if (sourceFilters.country && formatCountry(source.country) !== sourceFilters.country) return false;

          const isZero = Number(source.articleCount || 0) === 0;
          const isNonWorking = Boolean(source.lastError);
          const isWorking = Boolean(source.lastSuccessAt) && !source.lastError;
          const isNeverFetched = !source.lastCheckedAt;

          if (sourceFilters.condition === "zero" && !isZero) return false;
          if (sourceFilters.condition === "hasArticles" && isZero) return false;
          if (sourceFilters.condition === "nonWorking" && !isNonWorking) return false;
          if (sourceFilters.condition === "zeroOrNonWorking" && !(isZero || isNonWorking)) return false;
          if (sourceFilters.condition === "working" && !isWorking) return false;
          if (sourceFilters.condition === "neverFetched" && !isNeverFetched) return false;

          if (query) {
            const haystack = `${source.name || ""} ${source.homepageUrl || ""} ${source.feedUrl || ""}`.toLowerCase();
            if (!haystack.includes(query)) return false;
          }

          return true;
        })
        .sort((left, right) => {
          const leftTime = Date.parse(left.lastCheckedAt || left.lastSuccessAt || "") || 0;
          const rightTime = Date.parse(right.lastCheckedAt || right.lastSuccessAt || "") || 0;
          return rightTime - leftTime;
        });
    },
    [sourceFilters, sources]
  );

  function updateSourceFilter(name: keyof typeof emptySourceFilters, value: string) {
    setSourceFilters((current) => ({ ...current, [name]: value }));
  }

  function openEdit(source: Source) {
    setEditDraft({ ...source });
  }

  function updateEditDraft(patch: Partial<Source>) {
    setEditDraft((current) => (current ? { ...current, ...patch } : current));
  }

  async function saveEdit() {
    if (!editDraft) return;
    setSavingEdit(true);
    try {
      await onSaveSource(editDraft);
      setEditDraft(null);
    } finally {
      setSavingEdit(false);
    }
  }

  async function recrawl(source: Source) {
    setRecrawlingId(source.id);
    try {
      await onRecrawlSource(source);
    } finally {
      setRecrawlingId(null);
    }
  }

  async function refetchMissing(event: FormEvent) {
    event.preventDefault();
    setRefetching(true);
    try {
      await onRefetchMissing(Number(refetchLimit || 3));
    } finally {
      setRefetching(false);
    }
  }

  function openSource(source: Source) {
    void onOpenSource(source);
  }

  return (
    <section className="view">
      <div className="view-header">
        <div>
          <h1>Sources</h1>
          <p>Edit source configuration and refetch sources that have missing data.</p>
        </div>
        <button className="button secondary" title={tooltips.reloadSources} type="button" onClick={onReload}>
          <RefreshCcw size={16} />
          Reload
        </button>
      </div>

      <form className="refetch-card" onSubmit={refetchMissing}>
        <label>
          Missing source data
          <input value="No articles, no success, or last error" disabled title="Criteria used by the refetch-missing action." />
        </label>
        <label>
          Sources
          <select
            value={refetchLimit}
            onChange={(event) => setRefetchLimit(event.target.value)}
            title="Maximum number of missing sources to check in this run."
          >
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="5">5</option>
            <option value="10">10</option>
          </select>
        </label>
        <button className="button secondary" disabled={refetching} title={tooltips.refetchMissing} type="submit">
          <RefreshCcw size={16} />
          {refetching ? "Refetching" : "Refetch missing"}
        </button>
      </form>

      <form
        className="source-filters-card"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <label title={tooltips.sourceSearch}>
          Search sources
          <input
            value={sourceFilters.q}
            onChange={(event) => updateSourceFilter("q", event.target.value)}
            placeholder="BBC or vrt.be"
            title={tooltips.sourceSearch}
            type="search"
          />
        </label>
        <label title={tooltips.sourceCountryFilter}>
          Country
          <select
            value={sourceFilters.country}
            onChange={(event) => updateSourceFilter("country", event.target.value)}
            title={tooltips.sourceCountryFilter}
          >
            <option value="">All countries</option>
            {countries.map(([country, count]) => (
              <option key={country} value={country}>
                {countryEmoji(country)} {country} ({count})
              </option>
            ))}
          </select>
        </label>
        <label title={tooltips.sourceConditionFilter}>
          Source state
          <select
            value={sourceFilters.condition}
            onChange={(event) => updateSourceFilter("condition", event.target.value)}
            title={tooltips.sourceConditionFilter}
          >
            <option value="all">All sources</option>
            <option value="zero">Zero articles</option>
            <option value="hasArticles">Has articles</option>
            <option value="nonWorking">Non-working</option>
            <option value="zeroOrNonWorking">Zero articles or non-working</option>
            <option value="working">Working</option>
            <option value="neverFetched">Never fetched</option>
          </select>
        </label>
        <div className="source-filter-summary">
          <span title="Visible sources after filters.">{crawlRows.length.toLocaleString()} shown</span>
          <span title="Sources with zero fetched articles.">{sourceSummary.zeroArticleCount.toLocaleString()} zero articles</span>
          <span title="Sources with a stored last error.">{sourceSummary.nonWorkingCount.toLocaleString()} non-working</span>
          <span title="Sources that have not been crawled yet.">{sourceSummary.neverFetchedCount.toLocaleString()} never fetched</span>
        </div>
        <button
          className="button secondary"
          title={tooltips.resetSourceFilters}
          type="button"
          onClick={() => setSourceFilters(emptySourceFilters)}
        >
          Reset
        </button>
      </form>

      <div className="table-panel crawl-panel">
        <div className="panel-heading">
          <h2>Crawl status</h2>
          <span>
            {crawlRows.length.toLocaleString()} of {sources.length.toLocaleString()} sources
          </span>
        </div>
        <table className="crawl-table">
          <colgroup>
            <col style={{ width: "22%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "20%" }} />
            <col style={{ width: "14%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Source</th>
              <th>Country</th>
              <th>Articles</th>
              <th>Last fetch</th>
              <th>Result</th>
              <th>Last error</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="empty" colSpan={7}>
                  Loading
                </td>
              </tr>
            ) : crawlRows.length ? (
              crawlRows.map((source) => {
                const country = formatCountry(source.country);
                return (
                <tr key={source.id}>
                  <td>
                    <button
                      className="button secondary source-name-button"
                      title={tooltips.sourceName}
                      type="button"
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openSource(source);
                        }
                      }}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        openSource(source);
                      }}
                    >
                      {source.name}
                    </button>
                  </td>
                  <td>
                    <span className="country-badge">
                      <span aria-hidden="true">{countryEmoji(country)}</span>
                      {country}
                    </span>
                  </td>
                  <td className="count-cell">{(source.articleCount ?? 0).toLocaleString()}</td>
                  <td className="muted">{formatDate(source.lastCheckedAt)}</td>
                  <td>
                    <span className={`crawl-pill ${crawlStatusClass(source)}`}>{crawlStatus(source)}</span>
                  </td>
                  <td className={source.lastError ? "error-text" : "muted"}>
                    {source.lastError || ""}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="icon-action"
                        title={tooltips.viewSourceArticles}
                        type="button"
                        onClick={() => {
                          void onOpenSource(source);
                        }}
                      >
                        <Eye size={16} />
                      </button>
                      <button
                        className="icon-action"
                        title={tooltips.recrawlSource}
                        disabled={recrawlingId === source.id}
                        type="button"
                        onClick={() => recrawl(source)}
                      >
                        <RefreshCcw size={16} />
                      </button>
                      <button
                        className="icon-action"
                        title={tooltips.editSource}
                        type="button"
                        onClick={() => openEdit(source)}
                      >
                        <Pencil size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })
            ) : (
              <tr>
                <td className="empty" colSpan={7}>
                  {sources.length ? "No sources match the current filters" : "No sources configured"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <SourceEditModal
        draft={editDraft}
        saving={savingEdit}
        onCancel={() => setEditDraft(null)}
        onChange={updateEditDraft}
        onSave={saveEdit}
      />
    </section>
  );
}

function App() {
  const articleRequestId = useRef(0);
  const filtersReady = useRef(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [view, setView] = useState<View>("news");
  const [adminMeta, setAdminMeta] = useState<AdminMeta>(defaultAdminMeta);
  const [articles, setArticles] = useState<Article[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);
  const [sourceArticles, setSourceArticles] = useState<Article[]>([]);
  const [filters, setFilters] = useState(emptyNewsFilters);
  const [offset, setOffset] = useState(0);
  const [lastPageSize, setLastPageSize] = useState(25);
  const [loadingArticles, setLoadingArticles] = useState(false);
  const [loadingSourceArticles, setLoadingSourceArticles] = useState(false);
  const [loadingSources, setLoadingSources] = useState(false);
  const [message, setMessage] = useState("Loading");
  const totalArticleCount = useMemo(
    () => sources.reduce((sum, source) => sum + Number(source.articleCount || 0), 0),
    [sources]
  );

  async function loadSourcesAndTopics() {
    setLoadingSources(true);
    try {
      const [metaPayload, sourcesPayload, topicsPayload] = await Promise.all([
        fetchJson<AdminMeta>(endpoints.meta),
        fetchJson<{ sources: Source[] }>(endpoints.sources),
        fetchJson<{ topics: Topic[] }>(endpoints.topics)
      ]);
      setAdminMeta(metaPayload || defaultAdminMeta);
      setSources(sourcesPayload.sources || []);
      setTopics(topicsPayload.topics || []);
    } finally {
      setLoadingSources(false);
    }
  }

  async function loadArticles(nextOffset = offset, nextFilters = filters) {
    const requestId = articleRequestId.current + 1;
    articleRequestId.current = requestId;
    setLoadingArticles(true);
    try {
      const params = new URLSearchParams();
      Object.entries(nextFilters).forEach(([key, value]) => {
        if (String(value).trim()) params.set(key, String(value).trim());
      });
      params.set("offset", String(nextOffset));
      const payload = await fetchJson<{ articles: Article[]; filters: { pageSize: number } }>(
        `${endpoints.articles}?${params}`
      );
      if (requestId !== articleRequestId.current) return;
      setArticles(payload.articles || []);
      setLastPageSize(Number(payload.filters?.pageSize || nextFilters.pageSize || 25));
      setOffset(nextOffset);
      setMessage(`${(payload.articles || []).length} shown`);
    } catch (error) {
      if (requestId !== articleRequestId.current) return;
      setMessage(error instanceof Error ? error.message : "Error loading articles");
    } finally {
      if (requestId === articleRequestId.current) setLoadingArticles(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    loadSourcesAndTopics()
      .then(async () => {
        if (cancelled) return;
        await loadArticles(0, filters);
        filtersReady.current = true;
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!filtersReady.current) return;
    const timer = window.setTimeout(() => {
      void loadArticles(0, filters);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [filters]);

  function updateFilter(name: keyof typeof emptyNewsFilters, value: string) {
    setFilters((current) => ({ ...current, [name]: value }));
  }

  async function semanticEvaluate(input: { topic: string; description: string; limit: number }) {
    const payload = await fetchJson<{
      topic: Topic;
      evaluatedCount: number;
      matchedCount: number;
    }>(endpoints.semanticFilter, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    await loadSourcesAndTopics();
    const nextFilters = { ...filters, q: "", topic: String(payload.topic.id), status: "matched" };
    setFilters(nextFilters);
    setMessage(`${payload.matchedCount} matched, ${payload.evaluatedCount} evaluated`);
  }

  async function translateMissingHeadlines() {
    const payload = await fetchJson<{
      missingBefore: number;
      requestedCount: number;
      translatedCount: number;
      failedCount: number;
      remainingMissingCount: number;
    }>(endpoints.headlineTranslations, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 200 })
    });
    await loadArticles(offset, filters);
    setMessage(
      `${payload.translatedCount} translated, ${payload.failedCount} failed, ${payload.remainingMissingCount} missing remaining`
    );
  }

  async function refetchMissing(limit: number) {
    const payload = await fetchJson<{
      checkedCount: number;
      remainingMissingCount: number;
    }>(endpoints.sourceRefetch, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit })
    });
    await loadSourcesAndTopics();
    await loadArticles(0, filters);
    setMessage(`${payload.checkedCount} checked, ${payload.remainingMissingCount} missing remaining`);
  }

  async function openSourceArticles(source: Source) {
    setSelectedSource(source);
    setLoadingSourceArticles(true);
    try {
      const params = new URLSearchParams({
        source: String(source.id),
        pageSize: "100",
        offset: "0"
      });
      const payload = await fetchJson<{ articles: Article[] }>(`${endpoints.articles}?${params}`);
      setSourceArticles(payload.articles || []);
      setMessage(`${(payload.articles || []).length} articles shown for ${source.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Error loading source articles");
    } finally {
      setLoadingSourceArticles(false);
    }
  }

  async function recrawlSource(source: Source) {
    setMessage(`Recrawling ${source.name}`);
    const payload = await fetchJson<{
      result: { status: string; insertedCount?: number; updatedCount?: number; error?: string };
      source: Source | null;
    }>(`${endpoints.sources}/${source.id}/recrawl`, {
      method: "POST"
    });
    const nextSource = payload.source || source;
    setSources((current) => current.map((item) => (item.id === source.id ? nextSource : item)));
    await loadArticles(0, filters);
    if (selectedSource?.id === source.id) await openSourceArticles(nextSource);

    if (payload.result.status === "failed") {
      setMessage(`${source.name} recrawl failed: ${payload.result.error || "unknown error"}`);
    } else {
      setMessage(
        `${source.name} recrawled: ${payload.result.insertedCount || 0} new, ${payload.result.updatedCount || 0} updated`
      );
    }
  }

  async function saveSource(source: Source) {
    const payload = await fetchJson<{ source: Source }>(`${endpoints.sources}/${source.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(normalizeSourcePayload(source))
    });
    setSources((current) => current.map((item) => (item.id === source.id ? payload.source : item)));
    setMessage("Source saved");
  }

  return (
    <div className="admin-layout">
      <Sidebar
        collapsed={sidebarCollapsed}
        currentView={view}
        onToggle={() => setSidebarCollapsed((current) => !current)}
        onViewChange={setView}
      />
      <main className="content">
        <div className="topbar">
          <button
            className="icon-button mobile-menu"
            title={tooltips.mobileMenu}
            type="button"
            onClick={() => setSidebarCollapsed((current) => !current)}
          >
            {sidebarCollapsed ? <ChevronRight size={18} /> : <Menu size={18} />}
          </button>
          <div className="result-meta">{message}</div>
        </div>
        {view === "news" ? (
          <NewsView
            adminMeta={adminMeta}
            articles={articles}
            filters={filters}
            lastPageSize={lastPageSize}
            loading={loadingArticles}
            offset={offset}
            sources={sources}
            topics={topics}
            totalArticleCount={totalArticleCount}
            onApply={() => loadArticles(0, filters)}
            onFilterChange={updateFilter}
            onNext={() => loadArticles(offset + lastPageSize, filters)}
            onPrev={() => loadArticles(Math.max(0, offset - lastPageSize), filters)}
            onReset={() => {
              setFilters(emptyNewsFilters);
              if (filters === emptyNewsFilters) void loadArticles(0, emptyNewsFilters);
            }}
            onSemanticEvaluate={semanticEvaluate}
            onTranslateHeadlines={translateMissingHeadlines}
          />
        ) : (
          <SourcesView
            loading={loadingSources}
            sources={sources}
            onOpenSource={openSourceArticles}
            onReload={loadSourcesAndTopics}
            onRecrawlSource={recrawlSource}
            onRefetchMissing={refetchMissing}
            onSaveSource={saveSource}
          />
        )}
      </main>
      <SourceArticlesModal
        articles={sourceArticles}
        loading={loadingSourceArticles}
        source={selectedSource}
        onClose={() => {
          setSelectedSource(null);
          setSourceArticles([]);
        }}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
