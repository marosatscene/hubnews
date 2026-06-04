const express = require("express");
const path = require("node:path");
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
const { createBasicAuth } = require("./lib/basicAuth");

const app = express();
const newsHubStaticPath = path.join(process.cwd(), "public/news-hub");
const newsHubAssetsPath = path.join(newsHubStaticPath, "assets");
const adminAssetsPath = path.join(process.cwd(), "public/admin/assets");
const newsHubAuth = createBasicAuth({
  username: adminUser,
  password: adminPassword,
  realm: "HubNews Admin"
});
const adminRouter = createAdminRouter({
  adminUser,
  adminPassword,
  articleRepo,
  evaluationRepo,
  sourceRepo,
  topicRepo
});

function sendNewsHubIndex(_req, res) {
  res.sendFile(path.join(newsHubStaticPath, "index.html"));
}

function readProxyPath(req) {
  const value = Array.isArray(req.query.path) ? req.query.path[0] : req.query.path;
  return typeof value === "string" ? value : "";
}

function isSafeAssetPath(assetPath) {
  return Boolean(assetPath) && !assetPath.includes("..") && !path.isAbsolute(assetPath);
}

function sendAssetFrom(rootPath) {
  return (req, res, next) => {
    const assetPath = readProxyPath(req);
    if (!isSafeAssetPath(assetPath)) return res.status(404).json({ error: "Not found" });
    return res.sendFile(path.join(rootPath, assetPath), (error) => {
      if (error) next(error);
    });
  };
}

function proxyAdminApi(req, res, next) {
  const proxyPath = readProxyPath(req);
  if (!proxyPath || proxyPath.includes("..")) {
    return res.status(404).json({ error: "Not found" });
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (key === "path") continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else if (value !== undefined) {
      params.append(key, String(value));
    }
  }

  req.url = `/api/${proxyPath}${params.size ? `?${params.toString()}` : ""}`;
  delete req._parsedUrl;
  return adminRouter(req, res, next);
}

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

app.get("/", newsHubAuth, sendNewsHubIndex);
app.get("/news-hub-root", newsHubAuth, sendNewsHubIndex);
app.get("/news-hub-asset", newsHubAuth, sendAssetFrom(newsHubAssetsPath));
app.get("/admin-asset", newsHubAuth, sendAssetFrom(adminAssetsPath));
app.use("/admin-api", proxyAdminApi);
app.use("/cron-aggregate", cronRoutes);

app.use("/health", healthRoutes);
app.use("/admin", adminRouter);
app.use(
  "/news-hub",
  newsHubAuth,
  express.static(newsHubStaticPath)
);
app.get("/news-hub/*", newsHubAuth, (_req, res) => {
  res.sendFile(path.join(newsHubStaticPath, "index.html"));
});
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
