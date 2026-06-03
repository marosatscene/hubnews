const assert = require("node:assert/strict");
const test = require("node:test");
const { selectDueSources, selectMissingSources } = require("../src/services/aggregator");

test("selectDueSources chooses due sources oldest first and respects limit", () => {
  const now = Date.parse("2026-06-03T12:00:00.000Z");
  const originalNow = Date.now;
  Date.now = () => now;

  try {
    const sources = [
      {
        id: 1,
        enabled: true,
        lastCheckedAt: "2026-06-03T11:30:00.000Z",
        checkIntervalMinutes: 60
      },
      {
        id: 2,
        enabled: true,
        lastCheckedAt: null,
        checkIntervalMinutes: 60
      },
      {
        id: 3,
        enabled: true,
        lastCheckedAt: "2026-06-03T10:00:00.000Z",
        checkIntervalMinutes: 60
      },
      {
        id: 4,
        enabled: false,
        lastCheckedAt: null,
        checkIntervalMinutes: 60
      }
    ];

    const result = selectDueSources(sources, { limit: 2 });

    assert.equal(result.dueCount, 2);
    assert.deepEqual(
      result.selectedSources.map((source) => source.id),
      [2, 3]
    );
  } finally {
    Date.now = originalNow;
  }
});

test("selectDueSources force includes enabled sources regardless of interval", () => {
  const result = selectDueSources(
    [
      {
        id: 1,
        enabled: true,
        lastCheckedAt: "2026-06-03T11:59:00.000Z",
        checkIntervalMinutes: 60
      },
      {
        id: 2,
        enabled: false,
        lastCheckedAt: null,
        checkIntervalMinutes: 60
      }
    ],
    { force: true, limit: 10 }
  );

  assert.equal(result.dueCount, 1);
  assert.deepEqual(
    result.selectedSources.map((source) => source.id),
    [1]
  );
});

test("selectMissingSources includes enabled sources with no success, errors, or no articles", async () => {
  const sources = [
    {
      id: 1,
      enabled: true,
      name: "Never checked",
      lastCheckedAt: null,
      lastSuccessAt: null,
      lastError: null
    },
    {
      id: 2,
      enabled: true,
      name: "Failed",
      lastCheckedAt: "2026-06-03T10:00:00.000Z",
      lastSuccessAt: "2026-06-03T09:00:00.000Z",
      lastError: "HTTP 401"
    },
    {
      id: 3,
      enabled: true,
      name: "Empty",
      lastCheckedAt: "2026-06-03T11:00:00.000Z",
      lastSuccessAt: "2026-06-03T11:00:00.000Z",
      lastError: null
    },
    {
      id: 4,
      enabled: true,
      name: "Has data",
      lastCheckedAt: "2026-06-03T12:00:00.000Z",
      lastSuccessAt: "2026-06-03T12:00:00.000Z",
      lastError: null
    },
    {
      id: 5,
      enabled: false,
      name: "Disabled",
      lastCheckedAt: null,
      lastSuccessAt: null,
      lastError: null
    }
  ];

  const articleRepo = {
    async listArticles(filters) {
      return filters.sourceId === 4 ? [{ id: 100 }] : [];
    }
  };

  const result = await selectMissingSources(sources, { limit: 2 }, articleRepo);

  assert.equal(result.missingCount, 3);
  assert.deepEqual(
    result.selectedSources.map((source) => source.id),
    [1, 2]
  );
});
