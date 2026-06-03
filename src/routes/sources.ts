const express = require("express");
const { sourceRepo } = require("../db/repositories");
const { aggregateSourceById } = require("../services/aggregator");
const { asyncRoute } = require("../lib/asyncRoute");
const {
  sourceCreateSchema,
  sourceUpdateSchema,
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
  asyncRoute(async (req, res) => {
    const enabled =
      req.query.enabled === undefined ? undefined : req.query.enabled === "true";
    const sources = await sourceRepo.listSources({ enabled });
    res.json({ sources });
  })
);

router.post(
  "/",
  asyncRoute(async (req, res) => {
    const input = validate(sourceCreateSchema, req.body);
    const source = await sourceRepo.createSource(input);
    res.status(201).json({ source });
  })
);

router.get(
  "/:id",
  asyncRoute(async (req, res) => {
    const source = await sourceRepo.getSource(parseId(req.params.id));
    if (!source) return res.status(404).json({ error: "Source not found" });
    return res.json({ source });
  })
);

router.patch(
  "/:id",
  asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    if (!(await sourceRepo.getSource(id))) {
      return res.status(404).json({ error: "Source not found" });
    }

    const input = validate(sourceUpdateSchema, req.body);
    const source = await sourceRepo.updateSource(id, input);
    return res.json({ source });
  })
);

router.delete(
  "/:id",
  asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    if (!(await sourceRepo.getSource(id))) {
      return res.status(404).json({ error: "Source not found" });
    }

    const source = await sourceRepo.disableSource(id);
    return res.json({ source });
  })
);

router.post(
  "/:id/check",
  asyncRoute(async (req, res) => {
    const result = await aggregateSourceById(parseId(req.params.id));
    res.json(result);
  })
);

module.exports = router;
