const express = require("express");
const { articleRepo } = require("../db/repositories");
const { asyncRoute } = require("../lib/asyncRoute");

const router = express.Router();

function parsePositiveInt(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

router.get(
  "/",
  asyncRoute(async (req, res) => {
    const articles = await articleRepo.listArticles({
      sourceId: req.query.sourceId ? Number.parseInt(req.query.sourceId, 10) : undefined,
      topicId: req.query.topicId ? Number.parseInt(req.query.topicId, 10) : undefined,
      status: req.query.status,
      q: req.query.q,
      from: req.query.from,
      to: req.query.to,
      limit: parsePositiveInt(req.query.limit, 50),
      offset: Number.parseInt(req.query.offset || "0", 10)
    });
    res.json({ articles });
  })
);

router.get(
  "/:id",
  asyncRoute(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const article = await articleRepo.getArticle(id);
    if (!article) return res.status(404).json({ error: "Article not found" });
    return res.json({ article });
  })
);

module.exports = router;
