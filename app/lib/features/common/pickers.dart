import 'package:flutter/material.dart';

/// Pemilih satu nilai dari daftar, ditampilkan sebagai lembaran bawah.
///
/// `DropdownButton` terasa enak untuk dua-tiga pilihan dan menyakitkan untuk
/// daftar akun yang bisa panjang. Lembaran bawah memuat berapa pun jumlahnya
/// dan tetap bisa disentuh dengan satu ibu jari.
Future<String?> pickOption(
  BuildContext context, {
  required String title,
  required List<String> labels,
  required List<String> values,
  String? selected,
  String? noneLabel,
}) async {
  if (labels.length != values.length) {
    throw ArgumentError('label dan nilai harus sama banyak.');
  }
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    builder: (sheetContext) {
      final rows = <Widget>[
        for (var index = 0; index < values.length; index++)
          ListTile(
            title: Text(labels[index]),
            trailing: values[index] == selected
                ? const Icon(Icons.check_rounded)
                : null,
            onTap: () => Navigator.pop(sheetContext, values[index]),
          ),
      ];
      return SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 20, 6),
              child: Text(
                title.toUpperCase(),
                style: Theme.of(
                  sheetContext,
                ).textTheme.labelMedium?.copyWith(letterSpacing: 0.8),
              ),
            ),
            const Divider(height: 1),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                children: [
                  if (noneLabel != null)
                    ListTile(
                      title: Text(noneLabel),
                      trailing: selected == null
                          ? const Icon(Icons.check_rounded)
                          : null,
                      onTap: () => Navigator.pop(sheetContext, ''),
                    ),
                  ...rows,
                ],
              ),
            ),
          ],
        ),
      );
    },
  );
}

/// Menanyakan hal yang tidak bisa dibatalkan.
Future<bool> confirmDestructive(
  BuildContext context, {
  required String title,
  required String message,
  String action = 'Hapus',
}) async {
  final answer = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialogContext, false),
          child: const Text('Batal'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(dialogContext, true),
          child: Text(action),
        ),
      ],
    ),
  );
  return answer ?? false;
}

/// Satu baris pesan pendek. Dipakai untuk hasil simpan dan hasil gagal.
void say(BuildContext context, String message, {bool bad = false}) {
  final scheme = Theme.of(context).colorScheme;
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: bad ? scheme.errorContainer : null,
        duration: Duration(seconds: bad ? 5 : 3),
      ),
    );
}
