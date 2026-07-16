/**
 * Expose Clerk publishable key to the frontend (safe to publish).
 * Uses the production publishable key committed below so deploys stay in sync
 * even if a stale Vercel env var still points at an old pk_test key.
 */
const CLERK_PUBLISHABLE_KEY =
  "pk_live_Y2xlcmsuc2Nob2xhcnBpbG90Lm5ldCQ";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const publishableKey = CLERK_PUBLISHABLE_KEY;

  return res.status(200).json({
    publishableKey,
    configured: Boolean(publishableKey),
    appId: "app_3GXapUtSBZmBqnrPP1VFnUzZwio",
  });
};
