// Where the app finds its backend.
//
// Sync is on only for the deployed site, so local previews never touch staging. For local work
// or tests, localStorage can point the app elsewhere (then reload):
//   langroll:api       API base URL, e.g. http://127.0.0.1:8787
//   langroll:supabase  Supabase URL. Tests use a fake host so they can never create real users.
const CONFIG = (() => {
  let apiUrl = location.hostname === "jengawiz.github.io" ? "https://langroll-api-staging.fly.dev" : null;
  let supabaseUrl = "https://drlhfpjnynpajxnqmzjb.supabase.co";
  try {
    apiUrl = localStorage.getItem("langroll:api") || apiUrl;
    supabaseUrl = localStorage.getItem("langroll:supabase") || supabaseUrl;
  } catch (e) { /* storage blocked */ }
  return {
    apiUrl,
    supabaseUrl,
    // Public by design: Supabase's publishable key only allows what the API and auth rules allow.
    supabaseKey: "sb_publishable_X8apOCTINuI9O4psILn73A_U-2ACvY-",
  };
})();
