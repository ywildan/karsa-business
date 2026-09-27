import 'package:flutter/material.dart';

import '../../state/app_controller.dart';
import '../common/bits.dart';
import '../common/pickers.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key, required this.controller});

  final AppController controller;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late final TextEditingController _name = TextEditingController(
    text: widget.controller.business?.name ?? '',
  );

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _rename() async {
    final error = await widget.controller.renameBusiness(_name.text);
    if (!mounted) return;
    say(context, error ?? 'Nama usaha diperbarui.', bad: error != null);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final controller = widget.controller;

    return Scaffold(
      appBar: AppBar(title: const Text('Pengaturan')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          const SectionTitle('Usaha'),
          LabeledField(label: 'Nama usaha', controller: _name),
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton(
              onPressed: controller.busy ? null : _rename,
              child: const Text('Ganti nama'),
            ),
          ),
          const SectionTitle('Perangkat ini'),
          _Line(
            label: 'Catatan tersimpan',
            value: '${controller.entries.length}',
          ),
          _Line(
            label: 'Menunggu sinkronisasi',
            value: '${controller.pendingCount} · versi dua',
          ),
          _Line(label: 'Identitas perangkat', value: controller.deviceId),
          const SizedBox(height: 18),
          Text(
            'Identitas perangkat dibuat saat aplikasi pertama dibuka dan tidak '
            'pernah dikirim ke mana-mana. Gunanya supaya dua hp yang mencatat '
            'berbulan-bulan tanpa internet tidak menabrak nomor catatan yang '
            'sama saat akhirnya terhubung.',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            'Karsa Business 1.0.0 · versi gratis · data hanya di hp ini',
            style: theme.textTheme.labelSmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}

class _Line extends StatelessWidget {
  const _Line({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    // Aplikasi ini hanya turun ke Android, jadi nama keluarga huruf bawaan
    // sistem aman dipakai untuk menampilkan identitas perangkat.
    final mono = value.length > 20;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text(
              label,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          const SizedBox(width: 16),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: theme.textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w700,
                fontFamily: mono ? 'monospace' : 'sans-serif',
              ),
            ),
          ),
        ],
      ),
    );
  }
}
