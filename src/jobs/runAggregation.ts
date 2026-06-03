const { aggregateSources } = require("../services/aggregator");

async function main() {
  const force = process.argv.includes("--force");
  const limitIndex = process.argv.indexOf("--limit");
  const limit = limitIndex >= 0 ? Number.parseInt(process.argv[limitIndex + 1], 10) : undefined;
  const result = await aggregateSources({ force, limit });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
