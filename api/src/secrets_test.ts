import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { webSecrets } from "./secrets.ts";

/**
 * Berkas ini adalah satu-satunya alasan `webSecrets` boleh dipercaya sebagai
 * pengganti hash yang dipakai tes lain. Kalau implementasi WebCrypto dan
 * `node:crypto` berbeda satu karakter saja, kode lisensi yang tercetak di
 * `migrations/0001_init.sql` tidak akan pernah cocok dengan yang dibaca Worker.
 */
test("hash web sama persis dengan hash node", async () => {
  for (const input of ["", "KRSB-7QF2-M4XN", "KRSB-7qf2-m4xn", "🐘 neon", "a".repeat(10_000)]) {
    assert.equal(
      await webSecrets.sha256Hex(input),
      createHash("sha256").update(input).digest("hex"),
      `hash berbeda untuk ${input.slice(0, 12)}`,
    );
  }
});

test("vektor yang tertulis di dokumen keluar apa adanya", async () => {
  // Vektor publik SHA-256, dipakai sebagai jangkar supaya hash tidak cuma
  // cocok dengan dirinya sendiri.
  assert.equal(
    await webSecrets.sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("hash adalah 64 huruf kecil heksadesimal dan tidak pernah sama untuk masukan berbeda", async () => {
  const a = await webSecrets.sha256Hex("KRSB-7QF2-M4XN");
  const b = await webSecrets.sha256Hex("KRSB-7QF2-M4XD");
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
});

test("token cukup panjang, cukup acak, dan tidak pernah berulang", () => {
  const seen = new Set<string>();
  for (let index = 0; index < 2000; index++) {
    const token = webSecrets.newToken();
    assert.match(token, /^[0-9a-f]{32}$/, "token bukan 16 byte heksadesimal");
    seen.add(token);
  }
  assert.equal(seen.size, 2000, "ada token yang sama muncul dua kali");
});
