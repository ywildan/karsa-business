import { createRemoteJWKSet, jwtVerify } from "jose";
import { Pool } from "pg";
import { firebaseWebConfig } from "./firebase-auth-proxy.js";
import { createApi, identityFrom } from "./api-app.js";
import { firebaseProjectId as injectedProjectId } from "./config.js";
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || injectedProjectId;

const databaseUrl = process.env.DATABASE_URL;

if (
  !databaseUrl ||
  firebaseProjectId === "__FIREBASE_PROJECT_ID__" ||
  !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(firebaseProjectId)
) {
  throw new Error(
    "DATABASE_URL and Firebase project configuration are required",
  );
}

const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const jwks = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  ),
);

const app = createApi(pool, async (token) => {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: `https://securetoken.google.com/${firebaseProjectId}`,
    audience: firebaseProjectId,
  });
  return identityFrom(payload);
});

// Firebase identifiers are public; database credentials remain server-side.
app.get("/web-config", (c) => {
  c.header("Cache-Control", "no-store");
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey) return c.json({error:"Dashboard belum dikonfigurasi."},503);
  return c.json(firebaseWebConfig(c.req.raw, firebaseProjectId, apiKey));
});
export default app;
