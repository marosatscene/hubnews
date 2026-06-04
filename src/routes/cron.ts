const express = require("express");
const { vercelCronSecret } = require("../config");
const { asyncRoute } = require("../lib/asyncRoute");
const { aggregateSources } = require("../services/aggregator");

const router = express.Router();

function isAuthorized(req) {
  if (!vercelCronSecret) return true;
  return req.get("authorization") === `Bearer ${vercelCronSecret}`;
}

const runAggregation = asyncRoute(async (req, res) => {
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

  const result = await aggregateSources();
  return res.json(result);
});

router.get("/", runAggregation);
router.get("/aggregate", runAggregation);

module.exports = router;
