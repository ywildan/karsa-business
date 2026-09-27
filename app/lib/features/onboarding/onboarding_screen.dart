import 'package:flutter/material.dart';

import '../../state/app_controller.dart';
import '../../theme/app_theme.dart';
import '../common/bits.dart';
import '../common/pickers.dart';

/// Layar pertama: satu pertanyaan, satu tombol.
///
/// Nama usaha diminta lebih dulu karena seluruh catatan menempel padanya, dan
/// karena tulisan "Warung Kopi Sore" di kepala laporan jauh lebih menenangkan
/// daripada "Bisnis 1".
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key, required this.controller});

  final AppController controller;

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final TextEditingController _name = TextEditingController();

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    final error = await widget.controller.createBusinessNamed(_name.text);
    if (!mounted) return;
    if (error != null) say(context, error, bad: true);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final accent = KarsaPalette.accent(theme.brightness);

    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 40, 24, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'KARSA BUSINESS',
                style: theme.textTheme.labelMedium?.copyWith(
                  color: accent,
                  letterSpacing: 1.6,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 18),
              Text(
                'Catat usahamu tanpa perlu paham akuntansi.',
                style: theme.textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                  height: 1.25,
                ),
              ),
              const SizedBox(height: 14),
              Text(
                'Kamu menulis "jualan 25 ribu, belum dibayar Rina". '
                'Yang mengubahnya jadi debit dan kredit sistem ini, '
                'dan yang menjaga neracanya tetap seimbang juga.',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                  height: 1.5,
                ),
              ),
              const SizedBox(height: 40),
              LabeledField(
                label: 'Nama usaha',
                controller: _name,
                hint: 'Warung Kopi Sore',
                onSubmitted: (_) => _start(),
              ),
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: widget.controller.busy ? null : _start,
                  child: const Text('Mulai mencatat'),
                ),
              ),
              const SizedBox(height: 22),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.phone_android_rounded,
                    size: 18,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Semua catatan tersimpan di hp ini. Versi gratis tidak '
                      'mengirim apa pun ke internet.',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                        height: 1.45,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
