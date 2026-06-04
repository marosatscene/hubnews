import { useState } from "react";

export type NewsHubPreferences = Readonly<{
  topicIds: readonly string[];
  regionIds: readonly string[];
  digestTime: string;
  digestChannel: "email" | "push" | "both";
  breakingAlerts: boolean;
  sourceBalance: "fastest" | "balanced" | "diverse";
}>;

export type UseNewsHubInteractionsParams = Readonly<{
  initialTopicId: string;
  initialTopicIds: readonly string[];
  initialRegionIds: readonly string[];
  initialDigestTime: string;
}>;

export function useNewsHubInteractions({
  initialTopicId,
  initialTopicIds,
  initialRegionIds,
  initialDigestTime
}: UseNewsHubInteractionsParams) {
  const [selectedTopicId, setSelectedTopicId] = useState(initialTopicId);
  const [expandedArticleIds, setExpandedArticleIds] = useState<ReadonlySet<number>>(new Set());
  const [savedArticleIds, setSavedArticleIds] = useState<ReadonlySet<number>>(new Set());
  const [preferences, setPreferences] = useState<NewsHubPreferences>({
    topicIds: initialTopicIds,
    regionIds: initialRegionIds,
    digestTime: initialDigestTime,
    digestChannel: "both",
    breakingAlerts: true,
    sourceBalance: "balanced"
  });

  function toggleExpandedArticle(articleId: number) {
    setExpandedArticleIds((current) => {
      const next = new Set(current);
      if (next.has(articleId)) {
        next.delete(articleId);
      } else {
        next.add(articleId);
      }
      return next;
    });
  }

  function toggleSavedArticle(articleId: number) {
    setSavedArticleIds((current) => {
      const next = new Set(current);
      if (next.has(articleId)) {
        next.delete(articleId);
      } else {
        next.add(articleId);
      }
      return next;
    });
  }

  function togglePreferenceTopic(topicId: string) {
    setPreferences((current) => {
      if (topicId === "all") return { ...current, topicIds: ["all"] };

      const nextTopicIds = current.topicIds.includes(topicId)
        ? current.topicIds.filter((id) => id !== topicId)
        : [...current.topicIds.filter((id) => id !== "all"), topicId];
      return { ...current, topicIds: nextTopicIds.length ? nextTopicIds : ["all"] };
    });
  }

  function togglePreferenceRegion(regionId: string) {
    setPreferences((current) => {
      const nextRegionIds = current.regionIds.includes(regionId)
        ? current.regionIds.filter((id) => id !== regionId)
        : [...current.regionIds, regionId];
      return { ...current, regionIds: nextRegionIds };
    });
  }

  function setDigestTime(digestTime: string) {
    setPreferences((current) => ({ ...current, digestTime }));
  }

  function setDigestChannel(digestChannel: NewsHubPreferences["digestChannel"]) {
    setPreferences((current) => ({ ...current, digestChannel }));
  }

  function setSourceBalance(sourceBalance: NewsHubPreferences["sourceBalance"]) {
    setPreferences((current) => ({ ...current, sourceBalance }));
  }

  function toggleBreakingAlerts() {
    setPreferences((current) => ({ ...current, breakingAlerts: !current.breakingAlerts }));
  }

  return {
    expandedArticleIds,
    preferences,
    savedArticleIds,
    selectedTopicId,
    setDigestChannel,
    setDigestTime,
    setSelectedTopicId,
    setSourceBalance,
    toggleBreakingAlerts,
    toggleExpandedArticle,
    togglePreferenceRegion,
    togglePreferenceTopic,
    toggleSavedArticle
  };
}
