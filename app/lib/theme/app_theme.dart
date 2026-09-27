import 'package:flutter/material.dart';

/// Warna keluarga Karsa.
///
/// Oranye yang sama dipakai di seluruh ekosistem, tetapi nilainya berbeda per
/// mode: oranye bata tenggelam di layar gelap, jadi mode gelap memakai versi
/// yang lebih terang. Angka-angka ini ditulis langsung, bukan diturunkan dari
/// `ColorScheme.fromSeed`, supaya hasil di hp bisa dibandingkan dengan
/// dokumen produk.
abstract final class KarsaPalette {
  static const Color orange = Color(0xFFC65D16);
  static const Color accentLight = Color(0xFFCF6A12);
  static const Color accentDark = Color(0xFFF09227);
  static const Color cream = Color(0xFFFDFBF7);
  static const Color ink = Color(0xFF201C18);
  static const Color night = Color(0xFF07080D);

  /// Uang masuk dan uang keluar harus bisa dibedakan tanpa membaca labelnya.
  static const Color gainLight = Color(0xFF1F7A4C);
  static const Color gainDark = Color(0xFF5CC28C);
  static const Color lossLight = Color(0xFFB3321F);
  static const Color lossDark = Color(0xFFE8775F);

  static Color accent(Brightness brightness) =>
      brightness == Brightness.dark ? accentDark : accentLight;

  static Color gain(Brightness brightness) =>
      brightness == Brightness.dark ? gainDark : gainLight;

  static Color loss(Brightness brightness) =>
      brightness == Brightness.dark ? lossDark : lossLight;

  static Color background(Brightness brightness) =>
      brightness == Brightness.dark ? night : cream;
}

abstract final class KarsaTheme {
  static ThemeData light() => _build(Brightness.light);

  static ThemeData dark() => _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) {
    final scheme = ColorScheme.fromSeed(
      seedColor: KarsaPalette.orange,
      brightness: brightness,
    );
    final accent = KarsaPalette.accent(brightness);

    return ThemeData(
      colorScheme: scheme.copyWith(
        primary: accent,
        onPrimary: Colors.white,
        secondaryContainer: accent.withValues(alpha: 0.16),
      ),
      scaffoldBackgroundColor: KarsaPalette.background(brightness),
      splashFactory: InkRipple.splashFactory,
    );
  }
}

/// Isi satu kartu laporan: judul kecil di atas, angka besar di bawah.
class StatCard extends StatelessWidget {
  const StatCard({
    super.key,
    required this.label,
    required this.value,
    this.note,
    this.emphasis,
  });

  final String label;
  final String value;
  final String? note;

  /// Warna angka, dipakai untuk menandai untung atau rugi.
  final Color? emphasis;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final brightness = theme.brightness;
    return Card(
      color: theme.colorScheme.surfaceContainerLow,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(color: theme.colorScheme.outlineVariant),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              label.toUpperCase(),
              style: theme.textTheme.labelSmall?.copyWith(
                color: KarsaPalette.accent(brightness),
                letterSpacing: 0.8,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              value,
              style: theme.textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.w700,
                color: emphasis,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            if (note != null) ...[
              const SizedBox(height: 4),
              Text(
                note!,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
