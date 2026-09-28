-- Karsa Business 0001 — cermin Neon dari skema SQLite di app/lib/data/db.dart.
--
-- Perbedaannya cuma tiga, dan ketiganya disengaja:
--
--   1. owner_id dan rev ada di sini dan tidak ada di hp. Yang pertama menentukan
--      siapa yang boleh membaca barisnya; yang kedua adalah antrean perubahan yang
--      membuat urutan tiba sama dengan urutan menang.
--   2. dirty tidak ada. Itu antrean kirim milik satu perangkat, bukan fakta.
--   3. kunci utamanya (owner_id, id), bukan id. Dua pemilik yang kebetulan memakai
--      id yang sama tidak boleh saling menimpa, dan hari salah satu dari mereka
--      mengarang id milik orang lain, tabrakannya jatuh ke baris miliknya sendiri.
--
-- Tanpa foreign key. Yang menulis hanya aplikasi, dan ia sudah menjaga strukturnya
-- di SQLite; server yang menolak baris karena urutannya berbeda justru akan
-- membuang catatan pengguna. Ini jalur data, bukan gudang laporan.
--
-- Dijalankan lewat .github/workflows/db-migrate.yml (komitmen C5), bukan lewat
-- Worker: yang mengubah struktur adalah workflow dengan kredensial migrasi, bukan
-- proses yang mengetuk per permintaan.

begin;

-- Antrean perubahan. Bukan bigint yang bisa dipakai pengguna: nilainya hanya
-- peringkat, dan ia boleh berlubang karena yang dibandingkan adalah besar-kecil.
create sequence if not exists sync_rev_seq as bigint;

-- ---------------------------------------------------------------- lisensi ----
-- Kode disimpan sebagai hash. Yang diucapkan di `psql` adalah salinan yang akan
-- dihapus orang dari riwayat shell-nya, bukan kuncinya.
create table if not exists license (
  code_hash    text primary key,
  owner_id     uuid not null default gen_random_uuid(),
  edition      text not null check (edition in ('free', 'pro')),
  max_devices  integer not null default 3 check (max_devices between 1 and 10),
  buyer        text,
  issued_at    timestamptz not null default now(),
  revoked_at   timestamptz
);

create index if not exists license_owner_idx on license (owner_id);

create table if not exists device (
  owner_id     uuid not null,
  device_id    uuid not null,
  code_hash    text not null references license (code_hash),
  -- Hash token, bukan token. Salinan tabel ini tidak menyerahkan satu pun jalur
  -- masuk, dan pemasangan ulang aplikasi mengganti barisnya.
  token_hash   text not null unique,
  licensed_at  bigint not null,
  updated_at   bigint not null,
  primary key (owner_id, device_id)
);

-- Titik terendah yang masih boleh dilayani sebuah unduhan. Naik tiap kali
-- tombstone dikompaksi; permintaan dari bawah angka ini dijawab 409 supaya
-- klien tahu ia harus unduh ulang penuh, bukan mengira sejarahnya masih utuh.
create table if not exists sync_floor (
  owner_id   uuid primary key,
  floor_rev  bigint not null default 0,
  updated_at bigint not null
);

-- ------------------------------------------------------------ baris data ----
-- Kolom sama ratanya untuk semua tabel: kunci server, lalu kolom kiriman
-- persis seperti SyncProtocol.wireColumns, lalu yang di-stempel.
-- uji_skema.ts membaca berkas ini dan membandingkannya kolom per kolom.

create table if not exists business (
  owner_id    uuid not null,
  id          uuid not null,
  rev         bigint not null,
  created_at  bigint not null,
  updated_at  bigint not null,
  deleted     integer not null default 0 check (deleted in (0, 1)),
  device_id   uuid not null,
  name        text not null,
  primary key (owner_id, id)
);
create index if not exists business_owner_rev_idx on business (owner_id, rev);

create table if not exists party (
  owner_id    uuid not null,
  id          uuid not null,
  rev         bigint not null,
  created_at  bigint not null,
  updated_at  bigint not null,
  deleted     integer not null default 0 check (deleted in (0, 1)),
  device_id   uuid not null,
  business_id uuid not null,
  name        text not null,
  phone       text,
  note        text,
  primary key (owner_id, id)
);
create index if not exists party_owner_rev_idx on party (owner_id, rev);
create index if not exists party_business_idx on party (owner_id, business_id);

create table if not exists item (
  owner_id     uuid not null,
  id           uuid not null,
  rev          bigint not null,
  created_at   bigint not null,
  updated_at   bigint not null,
  deleted      integer not null default 0 check (deleted in (0, 1)),
  device_id    uuid not null,
  business_id  uuid not null,
  name         text not null,
  unit         text not null default 'pcs',
  sale_price   bigint not null default 0,
  buy_price    bigint not null default 0,
  tracks_stock integer not null default 0 check (tracks_stock in (0, 1)),
  primary key (owner_id, id)
);
create index if not exists item_owner_rev_idx on item (owner_id, rev);
create index if not exists item_business_idx on item (owner_id, business_id);

create table if not exists account (
  owner_id    uuid not null,
  id          uuid not null,
  rev         bigint not null,
  created_at  bigint not null,
  updated_at  bigint not null,
  deleted     integer not null default 0 check (deleted in (0, 1)),
  device_id   uuid not null,
  business_id uuid not null,
  code        text not null check (code ~ '^[0-9]{4}(\.[0-9]{1,4})?$'),
  name        text not null,
  primary key (owner_id, id)
);
-- Akun semaian diturunkan dari isinya, jadi dua perangkat milik pemilik yang
-- sama menabur id yang sama dan upsert tetap diam.
create unique index if not exists account_owner_business_code_key
  on account (owner_id, business_id, code);
create index if not exists account_owner_rev_idx on account (owner_id, rev);

create table if not exists ledger_entry (
  owner_id          uuid not null,
  id                uuid not null,
  rev               bigint not null,
  created_at        bigint not null,
  updated_at        bigint not null,
  deleted           integer not null default 0 check (deleted in (0, 1)),
  device_id         uuid not null,
  business_id       uuid not null,
  entered_on        bigint not null,
  posted_at         bigint not null,
  kind              text not null,
  description       text not null default '',
  party_id          uuid,
  item_id           uuid,
  quantity          bigint,
  unit_price        bigint,
  cash_account_code text not null default '1100',
  primary key (owner_id, id)
);
create index if not exists ledger_entry_owner_rev_idx on ledger_entry (owner_id, rev);
create index if not exists ledger_entry_business_date_idx
  on ledger_entry (owner_id, business_id, entered_on);

create table if not exists ledger_line (
  owner_id     uuid not null,
  id           uuid not null,
  rev          bigint not null,
  created_at   bigint not null,
  updated_at   bigint not null,
  deleted      integer not null default 0 check (deleted in (0, 1)),
  device_id    uuid not null,
  entry_id     uuid not null,
  business_id  uuid not null,
  account_code text not null check (account_code ~ '^[0-9]{4}(\.[0-9]{1,4})?$'),
  debit        bigint not null default 0 check (debit >= 0),
  credit       bigint not null default 0 check (credit >= 0),
  primary key (owner_id, id),
  -- Satu sisi saja. Inilah yang membuat neraca saldo selalu tertutup, dan satu-
  -- satunya invarian pembukuan yang ditegakkan di dua tempat: di SQLite supaya
  -- penggunanya tidak bisa menyimpan yang salah, di sini supaya yang sampai
  -- lewat jalur API tidak bisa mengarang.
  check ((debit > 0) <> (credit > 0))
);
create index if not exists ledger_line_owner_rev_idx on ledger_line (owner_id, rev);
create index if not exists ledger_line_entry_idx on ledger_line (owner_id, entry_id);
create index if not exists ledger_line_account_idx
  on ledger_line (owner_id, business_id, account_code);

create table if not exists stock_movement (
  owner_id    uuid not null,
  id          uuid not null,
  rev         bigint not null,
  created_at  bigint not null,
  updated_at  bigint not null,
  deleted     integer not null default 0 check (deleted in (0, 1)),
  device_id   uuid not null,
  business_id uuid not null,
  item_id     uuid not null,
  entered_on  bigint not null,
  direction   integer not null check (direction in (1, -1)),
  quantity    bigint not null check (quantity > 0),
  unit_cost   bigint not null default 0,
  entry_id    uuid,
  primary key (owner_id, id)
);
create index if not exists stock_movement_owner_rev_idx on stock_movement (owner_id, rev);
create index if not exists stock_movement_item_idx
  on stock_movement (owner_id, item_id, entered_on);

commit;

-- ------------------------------------------------------------------ akses ----
-- Peran aplikasi cukup schema public, dan hanya lewat kolom yang benar-benar
-- dipakai jalur sync. Jalan-nya di Neon: buat peran terpisah, jangan pakai
-- peran pemilik database.
--
--   create role karsa_api login password '...';
--   grant usage on schema public to karsa_api;
--   grant select, insert, update on business, party, item, account,
--         ledger_entry, ledger_line, stock_movement to karsa_api;
--   grant select, insert, update on device, sync_floor to karsa_api;
--   grant select, usage on sequence sync_rev_seq to karsa_api;
--   revoke all on license from karsa_api;
--
-- `license` tidak boleh bisa dibaca peran itu: Worker tidak pernah perlu
-- mendaftar kodenya, hanya mencari hash yang sudah ia punya.
--
-- Penerbitan kode (blok 08 dokumen pandangan) tetap manual, dari psql:
--
--   insert into license (code_hash, edition, buyer)
--   values (encode(sha256('KRSB-7QF2-M4XN'::bytea), 'hex'), 'pro', 'Rina');
--
-- `sha256(...)` di atas harus memberi hasil yang sama dengan
-- Secrets.sha256Hex di Worker: hex kecil, tanpa pemisah, atas bentuk kanonik
-- kode — huruf besar dan bergaris tengah.
