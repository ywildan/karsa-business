import { createRemoteJWKSet, jwtVerify } from "jose";
import { Pool } from "pg";
import { createApi, identityFrom } from "./api-app.js";
import { firebaseProjectId } from "./config.js";

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

export default createApi(pool, async (token) => {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: `https://securetoken.google.com/${firebaseProjectId}`,
    audience: firebaseProjectId,
  });
  return identityFrom(payload);
});
