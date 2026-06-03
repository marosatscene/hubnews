const express = require("express");
const { storageDriver, supabaseUrl } = require("../config");

const router = express.Router();

router.get("/", (_req, res) => {
  res.json({
    status: "ok",
    supabaseConfigured: Boolean(supabaseUrl),
    storage: storageDriver
  });
});

module.exports = router;
