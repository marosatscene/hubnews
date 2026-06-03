const app = require("./app");
const { port } = require("./config");
const { startScheduler } = require("./jobs/scheduler");

app.listen(port, () => {
  console.log(`Hub News API listening on http://localhost:${port}`);
  startScheduler();
});
