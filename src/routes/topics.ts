const express = require("express");
const {
  articleRepo,
  evaluationRepo,
  topicRepo
} = require("../db/repositories");
const { asyncRoute } = require("../lib/asyncRoute");
const { filterArticlesForTopic } = require("../services/headlineFilter");
const {
  evaluationSchema,
  topicCreateSchema,
  topicUpdateSchema,
  validate
} = require("../validators");

const router = express.Router();

function parseId(value: any) {
  const id = Number.parseInt(value, 10);
  if (!Number.isFinite(id)) {
    const error: any = new Error("Invalid id");
    error.status = 400;
    throw error;
  }
  return id;
}

router.get(
  "/",
  asyncRoute(async (_req, res) => {
    res.json({ topics: await topicRepo.listTopics() });
  })
);

router.post(
  "/",
  asyncRoute(async (req, res) => {
    const input = validate(topicCreateSchema, req.body);
    const topic = await topicRepo.createTopic(input);
    res.status(201).json({ topic });
  })
);

router.get(
  "/:id",
  asyncRoute(async (req, res) => {
    const topic = await topicRepo.getTopic(parseId(req.params.id));
    if (!topic) return res.status(404).json({ error: "Topic not found" });
    return res.json({ topic });
  })
);

router.patch(
  "/:id",
  asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    if (!(await topicRepo.getTopic(id))) {
      return res.status(404).json({ error: "Topic not found" });
    }

    const input = validate(topicUpdateSchema, req.body);
    const topic = await topicRepo.updateTopic(id, input);
    return res.json({ topic });
  })
);

router.delete(
  "/:id",
  asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    if (!(await topicRepo.getTopic(id))) {
      return res.status(404).json({ error: "Topic not found" });
    }

    await topicRepo.deleteTopic(id);
    return res.status(204).send();
  })
);

router.get(
  "/:id/articles",
  asyncRoute(async (req, res) => {
    const topicId = parseId(req.params.id);
    if (!(await topicRepo.getTopic(topicId))) {
      return res.status(404).json({ error: "Topic not found" });
    }

    const articles = await articleRepo.listArticles({
      topicId,
      status: req.query.status,
      limit: req.query.limit,
      offset: req.query.offset
    });
    return res.json({ articles });
  })
);

router.post(
  "/:id/evaluations",
  asyncRoute(async (req, res) => {
    const topicId = parseId(req.params.id);
    if (!(await topicRepo.getTopic(topicId))) {
      return res.status(404).json({ error: "Topic not found" });
    }

    const input = validate(evaluationSchema, req.body);
    await evaluationRepo.upsertEvaluation({
      ...input,
      topicId
    });
    return res.status(204).send();
  })
);

router.post(
  "/:id/evaluate",
  asyncRoute(async (req, res) => {
    const topicId = parseId(req.params.id);
    const topic = await topicRepo.getTopic(topicId);
    if (!topic) return res.status(404).json({ error: "Topic not found" });

    const limit = Math.min(Number(req.body?.limit) || 50, 200);
    const articles = await articleRepo.listUnevaluatedForTopic(topicId, limit);
    const results = await filterArticlesForTopic(topic, articles);

    for (const result of results) {
      await evaluationRepo.upsertEvaluation({
        articleId: result.articleId,
        topicId,
        status: result.status,
        confidence: result.confidence,
        reason: result.reason,
        model: result.model,
        raw: result.raw
      });
    }

    return res.json({
      topic,
      evaluatedCount: results.length,
      results
    });
  })
);

module.exports = router;
