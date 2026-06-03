const express = require("express");
const { vercelCronSecret } = require("../config");
const { asyncRoute } = require("../lib/asyncRoute");
const { aggregateSources } = require("../services/aggregator");

const router = express.Router();

function isAuthorized(req) {
  if (!vercelCronSecret) return true;
  return req.get("authorization") === `Bearer ${vercelCronSecret}`;
}

router.get(
  "/aggregate",
  asyncRoute(async (req, res) => {
    if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

    const result = await aggregateSources();
    return res.json(result);
  })
);

module.exports = router;
