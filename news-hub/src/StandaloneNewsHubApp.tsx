import { useEffect, useState } from "react";
import { NewsHubView, type NewsHubArticle, type NewsHubSource, type NewsHubTopic } from "./NewsHubView";

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(new URL(path, window.location.origin), {
    credentials: "same-origin"
  });
  if (!response.ok) {
    throw new Error(`Request failed with HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function StandaloneNewsHubApp() {
  const [articles, setArticles] = useState<NewsHubArticle[]>([]);
  const [sources, setSources] = useState<NewsHubSource[]>([]);
  const [topics, setTopics] = useState<NewsHubTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadNewsHubData(cancelled: () => boolean) {
    setLoading(true);
    setError(null);

    try {
      const [articlePayload, sourcePayload, topicPayload] = await Promise.all([
        fetchJson<{ articles: NewsHubArticle[] }>("/admin/api/articles?pageSize=200"),
        fetchJson<{ sources: NewsHubSource[] }>("/admin/api/sources"),
        fetchJson<{ topics: NewsHubTopic[] }>("/admin/api/topics")
      ]);

      if (cancelled()) return;
      setArticles(articlePayload.articles || []);
      setSources(sourcePayload.sources || []);
      setTopics(topicPayload.topics || []);
    } catch (loadError) {
      if (cancelled()) return;
      setArticles([]);
      setSources([]);
      setTopics([]);
      setError(
        loadError instanceof Error
          ? `Nepodarilo sa nacitat spravy z admin API: ${loadError.message}`
          : "Nepodarilo sa nacitat spravy z admin API."
      );
    } finally {
      if (!cancelled()) setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    void loadNewsHubData(() => cancelled);

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#f6f7f9] p-3 md:p-6">
      <NewsHubView
        articles={articles}
        error={error}
        loading={loading}
        sources={sources}
        topics={topics}
        onRefresh={() => loadNewsHubData(() => false)}
      />
    </div>
  );
}
