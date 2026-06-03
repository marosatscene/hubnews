const express = require("express");
const { aggregateSources } = require("../services/aggregator");
const { asyncRoute } = require("../lib/asyncRoute");

const router = express.Router();

router.post(
  "/run",
  asyncRoute(async (req, res) => {
    const result = await aggregateSources({
      force: Boolean(req.body?.force),
      limit: req.body?.limit
    });
    res.json(result);
  })
);

module.exports = router;
