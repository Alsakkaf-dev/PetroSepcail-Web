// Moved to packages/auth-shared (S04) — services/realtime needs the same
// verification logic (the Caddyfile proxies /realtime* straight to that
// container, bypassing this api gateway entirely) and duplicating a
// security-critical JWT verifier across services was the wrong tradeoff.
// Re-exported here so every existing `../security/jwt.js` / `./jwt.js`
// import in this workspace keeps working unchanged.
export * from "@petrospecial/auth-shared";
