import 'package:flutter/material.dart';

import '../../core/money.dart';
import '../../data/ledger_repository.dart';
import '../../domain/account.dart';
import '../../domain/reports.dart';
import '../../state/app_controller.dart';
import '../../theme/app_theme.dart';
import '../common/bits.dart';
import '../common/pickers.dart';

/// Bagan akun usaha ini.
///
/// Sembilan pos pertama ditaburkan bersama usaha dan tidak bisa dihapus:
/// laporan membaca angka dari sana. Yang boleh kamu tambah hanyalah sub-akan,
/// misalnya `6200.01 Bahan baku`, dan jenisnya dibaca dari digit pertama
/// nomornya.
class AccountsScreen extends StatefulWidget {
  const AccountsScreen({super.key, required this.controller});

  final AppController controller;

  @override
  State<AccountsScreen> createState() => _AccountsScreenState();
}

class _AccountsScreenState extends State<AccountsScreen> {
  static const List<AccountType> _order = [
    AccountType.asset,
    AccountType.liability,
    AccountType.equity,
    AccountType.revenue,
    AccountType.expense,
  ];

  Future<void> _add() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _AccountSheet(controller: widget.controller),
    );
  }

  Future<void> _remove(AccountRow account) async {
    final sure = await confirmDestructive(
      context,
      title: 'Hapus ${account.code}?',
      message: 'Catatan yang sudah memakai nomor ini tetap terbaca. '
          'Nomor yang sama bisa dipakai lagi untuk pos baru.',
    );
    if (!sure) return;
    final error = await widget.controller.removeAccount(account.id);
    if (!mounted) return;
    if (error != null) say(context, error, bad: true);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final accounts = widget.controller.accounts;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Akun'),
        actions: [
          IconButton(
            onPressed: _add,
            icon: const Icon(Icons.add_rounded),
            tooltip: 'Tambah sub-akan',
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
        children: [
          for (final type in _order) ...[
            if (accounts.any((account) => account.type == type))
              SectionTitle(_heading(type)),
            for (final account in accounts.where((a) => a.type == type))
              _AccountLine(
                account: account,
                balance: Reports.balanceOfCode(
                  widget.controller.entries,
                  account.code,
                ),
                loss: type == AccountType.expense,
                onRemove: ChartOfAccounts.isSeeded(account.code)
                    ? null
                    : () => _remove(account),
              ),
          ],
          const SizedBox(height: 16),
          Text(
            'Angka di kolom kanan adalah saldo per hari ini, dihitung dari '
            'seluruh jurnal.',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }

  static String _heading(AccountType type) => switch (type) {
    AccountType.asset => 'Uang dan harta',
    AccountType.liability => 'Hutang',
    AccountType.equity => 'Modal pemilik',
    AccountType.revenue => 'Pendapatan',
    AccountType.expense => 'Beban',
  };
}

class _AccountLine extends StatelessWidget {
  const _AccountLine({
    required this.account,
    required this.balance,
    required this.loss,
    required this.onRemove,
  });

  final AccountRow account;
  final Money balance;
  final bool loss;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          SizedBox(
            width: 62,
            child: Text(
              account.code,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          Expanded(
            child: Text(
              account.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.bodyMedium,
            ),
          ),
          Text(
            balance.toString(),
            style: theme.textTheme.bodyMedium?.copyWith(
              fontWeight: FontWeight.w700,
              color: loss ? KarsaPalette.loss(theme.brightness) : null,
            ),
          ),
          SizedBox(
            width: 34,
            child: onRemove == null
                ? null
                : IconButton(
                    padding: EdgeInsets.zero,
                    onPressed: onRemove,
                    icon: const Icon(Icons.remove_circle_outline_rounded),
                    iconSize: 18,
                    tooltip: 'Hapus pos',
                  ),
          ),
        ],
      ),
    );
  }
}

class _AccountSheet extends StatefulWidget {
  const _AccountSheet({required this.controller});

  final AppController controller;

  @override
  State<_AccountSheet> createState() => _AccountSheetState();
}

class _AccountSheetState extends State<_AccountSheet> {
  final TextEditingController _code = TextEditingController();
  final TextEditingController _name = TextEditingController();

  @override
  void dispose() {
    _code.dispose();
    _name.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final error = await widget.controller.addAccount(
      code: _code.text,
      name: _name.text.trim().isEmpty ? _code.text.trim() : _name.text,
    );
    if (!mounted) return;
    if (error != null) {
      say(context, error, bad: true);
      return;
    }
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.viewInsetsOf(context).bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 4, 20, 20 + bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Sub-akan baru',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Mulai dengan 1 (aset), 2 (hutang), 3 (modal), 5 (pendapatan) '
            'atau 6 (beban). Titik memisahkan sub-akan: 6200.01.',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
              height: 1.4,
            ),
          ),
          const SizedBox(height: 16),
          LabeledField(
            label: 'Nomor akun',
            controller: _code,
            hint: '6200.01',
            keyboardType: TextInputType.number,
          ),
          LabeledField(
            label: 'Nama pos',
            controller: _name,
            hint: 'Bahan baku',
            onSubmitted: (_) => _save(),
          ),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: widget.controller.busy ? null : _save,
              child: const Text('Simpan'),
            ),
          ),
        ],
      ),
    );
  }
}
