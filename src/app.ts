const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const aggregationRoutes = require("./routes/aggregation");
const { createAdminRouter } = require("./routes/admin");
const articlesRoutes = require("./routes/articles");
const cronRoutes = require("./routes/cron");
const healthRoutes = require("./routes/health");
const sourcesRoutes = require("./routes/sources");
const topicsRoutes = require("./routes/topics");
const { adminPassword, adminUser } = require("./config");
const { articleRepo, evaluationRepo, sourceRepo, topicRepo } = require("./db/repositories");

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

app.use("/health", healthRoutes);
app.use(
  "/admin",
  createAdminRouter({
    adminUser,
    adminPassword,
    articleRepo,
    evaluationRepo,
    sourceRepo,
    topicRepo
  })
);
app.use("/sources", sourcesRoutes);
app.use("/articles", articlesRoutes);
app.use("/topics", topicsRoutes);
app.use("/aggregation", aggregationRoutes);
app.use("/cron", cronRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  res.status(status).json({
    error: error.message || "Internal server error",
    details: error.details
  });
});

module.exports = app;
