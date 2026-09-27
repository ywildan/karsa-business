import 'package:flutter/material.dart';

import '../../core/format.dart';
import '../../core/money.dart';
import '../../domain/account.dart';
import '../../domain/ledger.dart';
import '../../domain/ledger_engine.dart';
import '../../state/app_controller.dart';
import '../../theme/app_theme.dart';
import '../common/bits.dart';
import '../common/pickers.dart';
import 'entry_form_screen.dart';

class EntriesScreen extends StatelessWidget {
  const EntriesScreen({super.key, required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    final days = _groupByDay(controller.entries);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Catatan'),
        actions: [
          IconButton(
            onPressed: () => openEntryForm(context, controller),
            icon: const Icon(Icons.add_rounded),
            tooltip: 'Catat transaksi',
          ),
        ],
      ),
      body: days.isEmpty
          ? const EmptyState(
              title: 'Daftar ini masih kosong',
              body:
                  'Setiap catatan yang kamu tulis muncul di sini, '
                  'dan setiap angkanya bisa dibongkar lagi.',
            )
          : ListView.builder(
              padding: const EdgeInsets.fromLTRB(8, 4, 8, 110),
              itemCount: days.length,
              itemBuilder: (context, index) {
                final group = days[index];
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(12, 16, 12, 4),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              _dayHeading(group.day),
                              style: Theme.of(context).textTheme.labelLarge
                                  ?.copyWith(
                                    color: KarsaPalette.accent(
                                      Theme.of(context).brightness,
                                    ),
                                    fontWeight: FontWeight.w700,
                                  ),
                            ),
                          ),
                          Text(
                            group.net.toString(),
                            style: Theme.of(context).textTheme.labelMedium
                                ?.copyWith(
                                  color: group.net.isNegative
                                      ? KarsaPalette.loss(
                                          Theme.of(context).brightness,
                                        )
                                      : KarsaPalette.gain(
                                          Theme.of(context).brightness,
                                        ),
                                  fontWeight: FontWeight.w700,
                                ),
                          ),
                        ],
                      ),
                    ),
                    for (final entry in group.entries)
                      _EntryTile(
                        controller: controller,
                        entry: entry,
                        onTap: () =>
                            openEntryDetail(context, controller, entry),
                      ),
                  ],
                );
              },
            ),
    );
  }

  static String _dayHeading(DateTime day) {
    final today = DateTime.now();
    if (isSameDay(day, today)) return 'Hari ini';
    if (isSameDay(day, DateTime(today.year, today.month, today.day - 1))) {
      return 'Kemarin';
    }
    return fullDate(day);
  }
}

class _DayGroup {
  _DayGroup({required this.day, required this.entries});

  final DateTime day;
  final List<LedgerEntry> entries;

  /// Selisih uang hari itu, bukan total catatan: penjualan kredit menambah
  /// piutang, bukan kas.
  Money get net {
    var total = 0;
    for (final entry in entries) {
      for (final line in entry.lines) {
        if (line.accountCode != AccountCode.kas.code) continue;
        total += line.debit.rupees - line.credit.rupees;
      }
    }
    return Money(total);
  }
}

List<_DayGroup> _groupByDay(List<LedgerEntry> entries) {
  final ordered = <DateTime, List<LedgerEntry>>{};
  for (final entry in entries) {
    final day = DateTime(entry.date.year, entry.date.month, entry.date.day);
    ordered.putIfAbsent(day, () => <LedgerEntry>[]).add(entry);
  }
  final days = ordered.keys.toList()..sort((a, b) => b.compareTo(a));
  return [for (final day in days) _DayGroup(day: day, entries: ordered[day]!)];
}

class _EntryTile extends StatelessWidget {
  const _EntryTile({
    required this.controller,
    required this.entry,
    required this.onTap,
  });

  final AppController controller;
  final LedgerEntry entry;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final kind = EntryKind.fromCode(entry.kindCode);
    final party = controller.party(entry.partyId);
    final subtitle = [
      if (entry.description.trim().isNotEmpty) entry.description.trim(),
      if (party != null) party.name,
    ].join(' · ');

    return Card(
      margin: const EdgeInsets.symmetric(vertical: 3, horizontal: 4),
      color: theme.colorScheme.surfaceContainerLow,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: theme.colorScheme.outlineVariant),
      ),
      child: ListTile(
        onTap: onTap,
        title: Text(
          kind?.label ?? entry.kindCode,
          style: theme.textTheme.bodyMedium?.copyWith(
            fontWeight: FontWeight.w700,
          ),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        subtitle: subtitle.isEmpty
            ? null
            : Text(
                subtitle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
        trailing: Text(
          entry.totalDebit.toString(),
          style: theme.textTheme.bodyMedium?.copyWith(
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}

/// Membuka sisi jurnal sebuah transaksi.
///
/// Double-entry disembunyikan dari layar catat, tetapi tidak disembunyikan
/// selamanya: siapa pun boleh bertanya "angka ini dari mana", dan jawabannya
/// satu sentuhan jauhnya.
Future<void> openEntryDetail(
  BuildContext context,
  AppController controller,
  LedgerEntry entry,
) {
  final theme = Theme.of(context);
  final kind = EntryKind.fromCode(entry.kindCode);
  final party = controller.party(entry.partyId);

  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (sheetContext) {
      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                kind?.label ?? entry.kindCode,
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                [
                  fullDate(entry.date),
                  if (party != null) party.name,
                  if (entry.description.trim().isNotEmpty)
                    entry.description.trim(),
                ].join(' · '),
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 16),
              for (final line in entry.lines)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 5),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          controller.accountByCode(line.accountCode)?.name ??
                              line.accountCode,
                          style: theme.textTheme.bodyMedium,
                        ),
                      ),
                      Text(
                        line.debit.isPositive
                            ? 'Debit ${line.debit}'
                            : 'Kredit ${line.credit}',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                          color: line.debit.isPositive
                              ? KarsaPalette.gain(theme.brightness)
                              : KarsaPalette.loss(theme.brightness),
                        ),
                      ),
                    ],
                  ),
                ),
              const SizedBox(height: 14),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () async {
                    final sure = await confirmDestructive(
                      sheetContext,
                      title: 'Hapus catatan ini?',
                      message:
                          'Angkanya hilang dari laporan. Kalau salah '
                          'hapus, kamu harus mengetiknya ulang.',
                    );
                    if (!sure) return;
                    final error = await controller.removeEntry(entry.id);
                    if (sheetContext.mounted) Navigator.pop(sheetContext);
                    if (error != null && context.mounted) {
                      say(context, error, bad: true);
                    }
                  },
                  icon: const Icon(Icons.delete_outline_rounded),
                  label: const Text('Hapus'),
                ),
              ),
            ],
          ),
        ),
      );
    },
  );
}
