import assert from "node:assert/strict";
import test from "node:test";

import {
  ALPHABET,
  GROUP_LENGTH,
  GROUPS,
  normalizeCode,
  planVerify,
  readVerifyRequest,
} from "./license.ts";
import type { DeviceRecord, LicenseRecord } from "./store.ts";

const DEVICE = "33333333-3333-4333-8333-333333333333";
const SECOND = "66666666-6666-4666-8666-666666666666";
const THIRD = "77777777-7777-4777-8777-777777777777";

function license(overrides: Partial<LicenseRecord> = {}): LicenseRecord {
  return {
    codeHash: "hash-kode-a",
    owner: "pemilik-a",
    edition: "pro",
    revoked: false,
    maxDevices: 3,
    ...overrides,
  };
}

function device(id: string, licensedAtMicros = 1): DeviceRecord {
  return { deviceId: id, tokenHash: `token-${id}`, licensedAtMicros };
}

test("contoh dari dokumen pandangan berbentuk kanonik", () => {
  assert.equal(normalizeCode("KRSB-7QF2-M4XN"), "KRSB-7QF2-M4XN");
});

test("yang diketik pengguna dibersihkan, bukan ditolak", () => {
  for (const input of ["krsb 7qf2 m4xn", "KRSB.7QF2.M4XN", "krsb7qf2m4xn", " KRSB-7QF2-M4XN "]) {
    assert.equal(normalizeCode(input), "KRSB-7QF2-M4XN", input);
  }
  assert.equal(normalizeCode(normalizeCode("krsb-7qf2-m4xn") ?? ""), "KRSB-7QF2-M4XN");
});

test("alfabet tidak mengandung huruf yang mudah rancu", () => {
  assert.equal(ALPHABET.length, 32);
  assert.equal(new Set(ALPHABET.split("")).size, 32);
  for (const letter of ["I", "L", "O", "U"]) {
    assert.ok(!ALPHABET.includes(letter), letter);
  }
});

test("kode yang bukan kode tidak dikirim ke basis data", () => {
  for (const input of [
    "",
    "KRSB-7QFI-M4XN",
    "KRSB-7QFO-M4XN",
    "XXXX-7QF2-M4XN",
    "KRSB-7QF2-M4X",
    "KRSB-7QF2-M4XN-N3",
    "KRSB7QF2M4XNK",
  ]) {
    assert.equal(normalizeCode(input), null, input);
  }
});

test("panjang kode adalah dua kelompok empat lambang", () => {
  assert.equal(GROUPS * GROUP_LENGTH, 8);
  assert.equal(normalizeCode(`KRSB-${ALPHABET.slice(0, 4)}-${ALPHABET.slice(10, 14)}`), `KRSB-${ALPHABET.slice(0, 4)}-${ALPHABET.slice(10, 14)}`);
});

test("minta aktivasi hanya menerima bentuk yang sah", () => {
  assert.deepEqual(readVerifyRequest({ code: "krsb 7qf2 m4xn", device_id: DEVICE }), {
    code: "KRSB-7QF2-M4XN",
    deviceId: DEVICE,
  });
  assert.deepEqual(readVerifyRequest("bukan objek"), { code: null, deviceId: null });
  assert.deepEqual(readVerifyRequest({ code: "KRSB-7QF2-M4XN", device_id: "hp-saya" }), {
    code: "KRSB-7QF2-M4XN",
    deviceId: null,
  });
  assert.deepEqual(readVerifyRequest({ code: 7, device_id: null }), { code: null, deviceId: null });
});

test("kode yang sah membuka pro dan menyebut pemiliknya", () => {
  const outcome = planVerify({
    code: "KRSB-7QF2-M4XN",
    deviceId: DEVICE,
    license: license(),
    devices: [],
  });
  assert.equal(outcome.status, "ok");
  assert.ok(outcome.status === "ok");
  assert.equal(outcome.owner, "pemilik-a");
  assert.equal(outcome.edition, "pro");
  assert.equal(outcome.licensedAtMicros, null, "slot baru");
});

test("kode tak dikenal dan bentuk yang salah dijawab sama", () => {
  const wrongShape = planVerify({ code: null, deviceId: DEVICE, license: license(), devices: [] });
  const notIssued = planVerify({ code: "KRSB-7QF2-M4XN", deviceId: DEVICE, license: null, devices: [] });
  assert.deepEqual(wrongShape, { status: "invalid" });
  assert.deepEqual(notIssued, { status: "invalid" });
});

test("lisensi yang dicabut dibedakan dari salah ketik", () => {
  const outcome = planVerify({
    code: "KRSB-7QF2-M4XN",
    deviceId: DEVICE,
    license: license({ revoked: true }),
    devices: [],
  });
  assert.deepEqual(outcome, { status: "revoked" });
});

test("batas perangkat menghitung slot, bukan percobaan", () => {
  const full = planVerify({
    code: "KRSB-7QF2-M4XN",
    deviceId: THIRD,
    license: license({ maxDevices: 2 }),
    devices: [device(DEVICE), device(SECOND)],
  });
  assert.deepEqual(full, { status: "device_limit", maxDevices: 2 });

  const same = planVerify({
    code: "KRSB-7QF2-M4XN",
    deviceId: SECOND,
    license: license({ maxDevices: 2 }),
    devices: [device(DEVICE), device(SECOND, 4_000)],
  });
  assert.ok(same.status === "ok");
  assert.equal(same.licensedAtMicros, 4_000, "perangkat lama tidak makan slot baru");
});

test("satu perangkat yang sama tidak dihitung dua kali", () => {
  const outcome = planVerify({
    code: "KRSB-7QF2-M4XN",
    deviceId: DEVICE,
    license: license({ maxDevices: 1 }),
    devices: [device(DEVICE)],
  });
  assert.ok(outcome.status === "ok");
});
