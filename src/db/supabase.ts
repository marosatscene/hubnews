const { createClient } = require("@supabase/supabase-js");
const { supabaseServiceRoleKey, supabaseUrl } = require("../config");

function assertSupabaseConfig() {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in .env or Vercel environment variables."
    );
  }
}

function createSupabaseClient() {
  assertSupabaseConfig();
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
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
