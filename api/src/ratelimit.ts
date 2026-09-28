/**
 * Pembatas laju.
 *
 * Yang dituju satu hal: `/license/verify` tidak boleh menjadi mesin pencari
 * kode lisensi. Ruang kodenya 2^40, jadi menebak buta tidak pernah masuk akal;
 * yang masuk akal adalah ribuan percobaan per jam dari satu skrip, dan itu yang
 * dihambat di sini.
 *
 * Jujurnya sampai ke batas ini: hitungannya hidup di memori satu isolat Worker.
 * Ia menahan-tekan gelombang, ia tidak menghentikannya — dua permintaan yang
 * jatuh di isolat berbeda dihitung terpisah. Yang benar-benar menahan adalah
 * kombinasi kode yang panjang, jawaban yang sama kaburnya antara "salah" dan
 * "tidak dikenal", dan fakta bahwa tidak ada satu pun yang bisa dipelajari
 * dari jawaban itu.
 */

/** Jumlah minta dalam satu jendela, dan panjang jendela itu dalam detik. */
export type Limit = { requests: number; seconds: number };

export const LIMITS = {
  /** Satu alamat boleh salah ketik beberapa kali sebelum menunggu. */
  verify_per_ip: { requests: 20, seconds: 600 },
  /** Kode yang sama di banyak perangkat dalam satu hotspot kampus. */
  verify_per_code: { requests: 12, seconds: 900 },
  /** Sinkronisasi normal: beberapa push + unduh per menit sudah longgar. */
  sync_per_owner: { requests: 60, seconds: 60 },
} as const satisfies Record<string, Limit>;

export type Window = { count: number; resetAtSeconds: number };

export type Counters = Map<string, Window>;

export type Decision = { allowed: boolean; retryAfterSeconds: number };

/**
 * Mencatat satu minta pada kunci `key`.
 *
 * Jendelanya tetap, bukan meluncur: lebih murah, dan untuk ancaman yang
 * ruangnya 2^40 tidak ada yang butuh presisi lebih. `nowSeconds` masuk sebagai
 * argumen supaya batasnya bisa diuji tanpa menunggu enam ratus detik.
 */
export function take(
  counters: Counters,
  key: string,
  limit: Limit,
  nowSeconds: number,
): Decision {
  const current = counters.get(key);
  if (current === undefined || current.resetAtSeconds <= nowSeconds) {
    counters.set(key, { count: 1, resetAtSeconds: nowSeconds + limit.seconds });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (current.count >= limit.requests) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, current.resetAtSeconds - nowSeconds),
    };
  }
  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Kunci penghitung. Alamat dan kode dipisah supaya keduanya punya plafon sendiri. */
export function verifyIpKey(ip: string): string {
  return `verify:ip:${ip}`;
}

export function verifyCodeKey(codeHash: string): string {
  return `verify:code:${codeHash}`;
}

export function syncKey(owner: string): string {
  return `sync:${owner}`;
}
