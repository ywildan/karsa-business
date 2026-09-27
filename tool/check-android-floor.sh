#!/usr/bin/env bash
# Lantai Android dibaca dari SDK yang terpasang, bukan ditetapkan di repo.
#
# Alasannya konkret: Flutter 3.47 membawa minSdk 24, dan APK hasil AGP 9.1
# ditandatangani dengan scheme v2 saja — di artefaknya tidak ada META-INF/*.SF
# maupun *.RSA sama sekali. Scheme v2 baru dikenal Android mulai API 24, jadi
# menurunkan lantai ke 23 menghasilkan aplikasi yang menjanjikan Android 6 tapi
# tidak bisa dipasang di sana.
#
# Repo ini sengaja tidak memiliki berkas Gradle apa pun, jadi satu-satunya
# cara menjaga janji itu adalah memeriksanya dan berhenti kalau rusak.

set -euo pipefail

build_dir="${1:?pakai: check-android-floor.sh <direktori-proyek>}"
floor_required=24

flutter_root="$(dirname "$(dirname "$(readlink -f "$(command -v flutter)")")")"
extension="$flutter_root/packages/flutter_tools/gradle/src/main/kotlin/FlutterExtension.kt"

if [ ! -f "$extension" ]; then
  echo "::error::$extension tidak ada. Bentuk SDK Flutter berubah; perbaiki pembacaan di sini, jangan tambal Gradle-nya."
  exit 1
fi

floor="$(sed -nE 's/.*val minSdkVersion: Int = ([0-9]+).*/\1/p' "$extension" | head -1)"
if [ -z "$floor" ]; then
  echo "::error::minSdkVersion tidak terbaca dari $extension."
  exit 1
fi

# Polanya harus tetap merujuk flutter.minSdkVersion. Kalau template suatu hari
# menuliskan angka langsung, lantai yang kita baca di atas bukan lagi lantai
# yang dipakai build.
if ! grep -nE 'minSdk = flutter\.minSdkVersion|minSdkVersion flutter\.minSdkVersion' \
  "$build_dir"/android/app/build.gradle* | sed 's/^/  /'; then
  echo "::error::Template tidak lagi memakai flutter.minSdkVersion. Periksa dari mana lantai build ini datang."
  exit 1
fi

echo "Lantai minSdk Flutter: $floor (butuh $floor_required)"

if [ "$floor" -lt "$floor_required" ]; then
  echo "::error::minSdk $floor di bawah $floor_required, tempat tanda tangan v2 masih bisa diverifikasi. Aktifkan signing v1 lebih dulu sebelum menurunkan lantai ini."
  exit 1
fi
