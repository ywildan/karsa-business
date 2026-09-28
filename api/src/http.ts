/**
 * Pintu masuk Worker: rute, kop, dan status. Tidak lebih.
 *
 * Semua keputusan ada di `sync.ts` dan `license.ts`; semua angka ada di
 * `ratelimit.ts`; semua kalimat ada di `sql.ts`. Handler ini hanya menerjemahkan
 * `Request` menjadi panggilan dan `Response` menjadi JSON, sehingga tidak ada
 * aturan produk yang bisa bersembunyi di sini.
 *
 * Satu kredensial untuk semuanya. Token perangkat adalah satu-satunya jalan
 * masuk: ia menentukan `owner_id`, dan pemilik itu membatasi setiap baca dan
 * setiap tulis. Dashboard web tidak punya kunci khusus — ia login dengan token
 * pemilik yang sama dan hanya memanggil rute baca. Kalau nanti ada tombol simpan
 * di web, kunci ini tidak lagi cukup dan kebijakan konflik di dokumen pandangan
 * harus dibuka ulang.
 *
 * Yang masuk tidak pernah keluar lagi: pesan `ProtocolError` menyebut nama
 * kolom dan nama tabel dari badan minta, jadi yang dikembalikan ke pengirim
 * hanya kode pendeknya.
 */

import { LIMITS, syncKey, take, verifyCodeKey, type Counters } from "./ratelimit.ts";
import {
  ProtocolError,
  parsePushBody,
  planPull,
  planPush,
  pullLimit,
  pullSince,
} from "./sync.ts";
import { planVerify, readVerifyRequest } from "./license.ts";
import type { Principal, Secrets, Store } from "./store.ts";

/** Konfigurasi yang datang dari `wrangler secret` / variabel lingkungan. */
export type Env = {
  /** Daftar asal yang boleh memanggil dari peramban, dipisah koma. */
  allowedOrigins: string;
};

export type Deps = {
  store: Store;
  secrets: Secrets;
  env: Env;
  counters: Counters;
  /** Jam dan alamat lawan bicara disuntik: keduanya tidak boleh dibaca sendiri. */
  nowMicros: () => number;
  nowSeconds: () => number;
  clientIp: () => string;
};

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(status: number, body: unknown, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...(extra as Record<string, string>) },
  });
}

function cors(origin: string | null, env: Env): HeadersInit {
  if (origin === null || env.allowedOrigins === "") return {};
  const allowed = env.allowedOrigins.split(",").map((entry) => entry.trim());
  if (!allowed.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "vary": "origin",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "600",
  };
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/** Token → siapa pemiliknya. `null` kalau tokennya bukan milik siapa pun. */
async function authenticate(
  request: Request,
  deps: Deps,
): Promise<Principal | null> {
  const token = bearer(request);
  if (token === null || token.length > 128) return null;
  return deps.store.principalByTokenHash(await deps.secrets.sha256Hex(token));
}

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 4_000_000) {
    throw new ProtocolError("too_large", "badan minta terlalu besar", 413);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProtocolError("bad_json", "badan minta bukan JSON", 400);
  }
}

/**
 * `POST /license/verify`.
 *
 * Bentuk yang bukan kode dan kode yang tidak ada dijawab persis sama:
 * `invalid`. Yang dicabut dibedakan, karena pemiliknya berhak tahu bahwa ia
 * dicabut — bukan bahwa ia salah ketik.
 */
async function verify(request: Request, deps: Deps, corsHeaders: HeadersInit): Promise<Response> {
  const body = readVerifyRequest(await readBody(request));
  const ip = deps.clientIp();
  const perIp = take(deps.counters, `verify:ip:${ip}`, LIMITS.verify_per_ip, deps.nowSeconds());
  if (!perIp.allowed) {
    return json(429, { error: "slow_down" }, { ...corsHeaders, "retry-after": String(perIp.retryAfterSeconds) });
  }
  if (body.code === null || body.deviceId === null) {
    return json(401, { error: "invalid" }, corsHeaders);
  }
  const codeHash = await deps.secrets.sha256Hex(body.code);
  const perCode = take(deps.counters, verifyCodeKey(codeHash), LIMITS.verify_per_code, deps.nowSeconds());
  if (!perCode.allowed) {
    return json(429, { error: "slow_down" }, { ...corsHeaders, "retry-after": String(perCode.retryAfterSeconds) });
  }
  const license = await deps.store.licenseByCodeHash(codeHash);
  const devices = license === null ? [] : await deps.store.devicesOf(license.owner);
  const outcome = planVerify({
    code: body.code,
    deviceId: body.deviceId,
    license,
    devices,
  });
  if (outcome.status !== "ok") {
    return json(outcome.status === "device_limit" ? 403 : 401, { error: outcome.status }, corsHeaders);
  }
  const token = deps.secrets.newToken();
  await deps.store.bindDevice({
    owner: outcome.owner,
    deviceId: outcome.deviceId,
    codeHash,
    tokenHash: await deps.secrets.sha256Hex(token),
    licensedAtMicros: outcome.licensedAtMicros ?? deps.nowMicros(),
  });
  return json(200, { token, edition: outcome.edition }, corsHeaders);
}

/** `POST /sync/push`. Pemilik dan perangkat berasal dari token, bukan dari isi. */
async function push(
  request: Request,
  principal: Principal,
  deps: Deps,
  corsHeaders: HeadersInit,
): Promise<Response> {
  const limit = take(
    deps.counters,
    syncKey(principal.owner),
    LIMITS.sync_per_owner,
    deps.nowSeconds(),
  );
  if (!limit.allowed) {
    return json(429, { error: "slow_down" }, { ...corsHeaders, "retry-after": String(limit.retryAfterSeconds) });
  }
  const rows = parsePushBody(await readBody(request));
  const revs = await deps.store.claimRevs(rows.length);
  const writes = planPush(rows, {
    owner: principal.owner,
    device_id: principal.deviceId,
    revs,
    now_micros: deps.nowMicros(),
  });
  await deps.store.applyWrites(writes);
  return json(200, { accepted: writes.length, head: revs.at(-1) ?? 0 }, corsHeaders);
}

/** `GET /sync/pull?since_rev=`. Halaman `limit + 1` diambil, yang dikirim `limit`. */
async function pull(
  request: Request,
  principal: Principal,
  deps: Deps,
  corsHeaders: HeadersInit,
): Promise<Response> {
  const url = new URL(request.url);
  const limit = pullLimit(url.searchParams.get("limit"));
  const since = pullSince(url.searchParams.get("since_rev"));
  const floor = await deps.store.floorRev(principal.owner);
  const rows = await deps.store.rowsSince(principal.owner, since, limit + 1);
  return json(200, planPull(rows, { owner: principal.owner, since_rev: since, limit, floor_rev: floor }), corsHeaders);
}

/** `GET /report/trial-balance?business_id=` — jalur baca dashboard. */
async function trialBalance(
  request: Request,
  principal: Principal,
  deps: Deps,
  corsHeaders: HeadersInit,
): Promise<Response> {
  const businessId = new URL(request.url).searchParams.get("business_id");
  if (businessId === null) {
    const owned = await deps.store.businessesOf(principal.owner);
    return json(200, { businesses: owned }, corsHeaders);
  }
  const rows = await deps.store.trialBalance(principal.owner, businessId);
  const drift = rows.reduce((sum, row) => sum + row.debit - row.credit, 0);
  return json(200, { business_id: businessId, balanced: drift === 0, rows }, corsHeaders);
}

/**
 * Satu fungsi, satu `Request`, satu `Response`.
 *
 * Dipanggil `index.ts` apa adanya. Karena tidak ada yang diimpor dari
 * `cloudflare:workers` atau dari pustaka mana pun, fungsi yang sama bisa diuji
 * di laptop ini dengan `node --test` — dan itu satu-satunya alasan jalur tulis
 * ke Neon bisa dipercaya sebelum Neon itu ada.
 */
export async function handle(request: Request, deps: Deps): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const corsHeaders = cors(origin, deps.env);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method === "GET" && url.pathname === "/health") {
    return json(200, { ok: true, service: "karsa-business" }, corsHeaders);
  }
  try {
    if (request.method === "POST" && url.pathname === "/license/verify") {
      return await verify(request, deps, corsHeaders);
    }
    const principal = await authenticate(request, deps);
    if (principal === null) {
      return json(401, { error: "unauthorized" }, corsHeaders);
    }
    if (request.method === "POST" && url.pathname === "/sync/push") {
      return await push(request, principal, deps, corsHeaders);
    }
    if (request.method === "GET" && url.pathname === "/sync/pull") {
      return await pull(request, principal, deps, corsHeaders);
    }
    if (request.method === "GET" && url.pathname === "/report/trial-balance") {
      return await trialBalance(request, principal, deps, corsHeaders);
    }
    return json(404, { error: "not_found" }, corsHeaders);
  } catch (problem) {
    if (problem instanceof ProtocolError) {
      return json(problem.status, { error: problem.code }, corsHeaders);
    }
    // Selain itu, yang salah ada di pihak kita: bentuk baris Neon tidak seperti
    // yang diharapkan, koneksi putus, kolom hilang. Kalimatnya dicatat di log
    // isolat tempat kamu bisa membacanya, dan tidak pernah ikut keluar — yang
    // mengetuk hanya boleh tahu bahwa kita gagal, bukan mengapa kita gagal.
    console.error(problem);
    return json(500, { error: "internal" }, corsHeaders);
  }
}
