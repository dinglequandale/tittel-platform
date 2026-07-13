// Local dev: load variables from .env into process.env (Node's built-in loader,
// no dependency). In production (Render) the platform injects env vars and there
// is no .env file, so this is best-effort and silently does nothing when absent.
try {
  process.loadEnvFile()
} catch {
  /* no .env file present — rely on the real environment */
}
