const { createClient } = require("@supabase/supabase-js");
const { supabaseSecretKey, supabaseUrl } = require("../config");

function assertSupabaseConfig() {
  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SECRET_KEY. Set them in .env or Vercel environment variables. SUPABASE_SERVICE_ROLE_KEY is still accepted as a legacy fallback."
    );
  }
}

function createSupabaseClient() {
  assertSupabaseConfig();
  return createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

let client;

function getSupabase() {
  if (!client) client = createSupabaseClient();
  return client;
}

const supabase = new Proxy(
  {},
  {
    get(_target, property) {
      return getSupabase()[property];
    }
  }
);

function throwIfError(error) {
  if (error) {
    const wrapped: any = new Error(error.message);
    wrapped.status = error.code === "PGRST116" ? 404 : 500;
    wrapped.details = error;
    throw wrapped;
  }
}

module.exports = { getSupabase, supabase, throwIfError };
