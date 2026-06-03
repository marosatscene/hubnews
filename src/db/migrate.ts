const path = require("node:path");

function migrate() {
  const schemaPath = path.resolve(__dirname, "..", "..", "supabase", "schema.sql");
  console.log(`Apply the Supabase schema from: ${schemaPath}`);
  console.log("Use the Supabase SQL editor or run: supabase db push");
}

if (require.main === module) {
  migrate();
}

module.exports = { migrate };
