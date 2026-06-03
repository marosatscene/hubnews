const { aggregatorCron, aggregatorEnabled } = require("../config");
const { aggregateSources } = require("../services/aggregator");

let running = false;
let timer = null;

function cronToIntervalMs(expression) {
  const everyMinute = expression.trim() === "* * * * *";
  if (everyMinute) return 60 * 1000;

  const stepMatch = expression.trim().match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (stepMatch) return Number(stepMatch[1]) * 60 * 1000;

  return 5 * 60 * 1000;
}

async function runOnce() {
  if (running) return;
  running = true;
  try {
    const result = await aggregateSources();
    if (result.checkedCount > 0) {
      console.log(`Aggregation checked ${result.checkedCount} source(s)`);
    }
  } catch (error) {
    console.error("Aggregation job failed", error);
  } finally {
    running = false;
  }
}

function startScheduler() {
  if (!aggregatorEnabled) {
    console.log("Aggregator scheduler disabled");
    return null;
  }

  const intervalMs = cronToIntervalMs(aggregatorCron);
  timer = setInterval(runOnce, intervalMs);

  console.log(`Aggregator scheduler polling every ${Math.round(intervalMs / 1000)}s`);
  return {
    stop() {
      clearInterval(timer);
      timer = null;
    }
  };
}

module.exports = { cronToIntervalMs, startScheduler };
