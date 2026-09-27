import 'package:flutter/material.dart';

import '../../core/format.dart';
import '../../core/money.dart';
import '../../data/ledger_repository.dart';
import '../../domain/account.dart';
import '../../domain/ledger_engine.dart';
import '../../state/app_controller.dart';
import '../common/bits.dart';
import '../common/pickers.dart';

Future<void> openEntryForm(
  BuildContext context,
  AppController controller,
) => Navigator.push<void>(
  context,
  MaterialPageRoute(
    builder: (context) => EntryFormScreen(controller: controller),
  ),
);

/// Layar catat: sepuluh pilihan dengan bahasa pengguna, satu nominal.
///
/// Tidak ada kolom debit atau kredit di sini. Yang ditanyakan hanya apa yang
/// terjadi; [LedgerEngine] yang memutuskan sisinya, dan engine yang menolak
/// kalau hasilnya tidak seimbang.
class EntryFormScreen extends StatefulWidget {
  const EntryFormScreen({super.key, required this.controller});

  final AppController controller;

  @override
  State<EntryFormScreen> createState() => _EntryFormScreenState();
}

class _EntryFormScreenState extends State<EntryFormScreen> {
  static const String _noTarget = 'Pilih pos';
  static const String _noParty = 'Pilih pihak';

  EntryKind _kind = EntryKind.penjualanTunai;
  DateTime _date = DateTime.now();
  final TextEditingController _amount = TextEditingController();
  final TextEditingController _cost = TextEditingController();
  final TextEditingController _note = TextEditingController();
  String? _targetCode;
  String? _partyId;
  String? _cashCode;

  @override
  void dispose() {
    _amount.dispose();
    _cost.dispose();
    _note.dispose();
    super.dispose();
  }

  /// Hanya nomor 11xx: kas dan bank. Persediaan juga aset, tetapi bukan tempat
  /// uang masuk dan keluar.
  List<AccountRow> get _cashAccounts => [
    for (final account in widget.controller.accountsOfType(AccountType.asset))
      if (account.code.startsWith('11')) account,
  ];

  String? _nameOf(String? code) =>
      code == null ? null : widget.controller.accountByCode(code)?.name;

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _date.isAfter(now) ? now : _date,
      firstDate: DateTime(now.year - 5),
      lastDate: DateTime(now.year + 1),
      helpText: 'Kapan ini terjadi?',
    );
    if (picked != null) setState(() => _date = picked);
  }

  Future<void> _pickTarget(List<AccountRow> options) async {
    final picked = await pickOption(
      context,
      title: 'Pilih pos',
      labels: [for (final option in options) '${option.code} · ${option.name}'],
      values: [for (final option in options) option.code],
      selected: _targetCode,
    );
    if (picked == null || picked.isEmpty) return;
    setState(() => _targetCode = picked);
  }

  Future<void> _pickCash(List<AccountRow> options) async {
    final picked = await pickOption(
      context,
      title: 'Sumber uang',
      labels: [for (final option in options) option.name],
      values: [for (final option in options) option.code],
      selected: _cashCode ?? AccountCode.kas.code,
    );
    if (picked == null || picked.isEmpty) return;
    setState(() => _cashCode = picked);
  }

  Future<void> _pickParty() async {
    final options = widget.controller.parties;
    final picked = await pickOption(
      context,
      title: 'Pilih pihak',
      labels: [for (final option in options) option.name],
      values: [for (final option in options) option.id],
      selected: _partyId,
    );
    if (picked == null || picked.isEmpty) return;
    setState(() => _partyId = picked);
  }

  Future<void> _save() async {
    final amount = Money.tryParse(_amount.text);
    if (amount == null || !amount.isPositive) {
      say(context, 'Isi nominalnya dulu, misalnya 25.000.', bad: true);
      return;
    }
    final request = PostRequest(
      kind: _kind,
      amount: amount,
      date: _date,
      description: _note.text.trim(),
      targetAccountCode: _targetCode,
      partyId: _partyId,
      cost: LedgerEngine.hasCost(_kind) ? Money.tryParse(_cost.text) : null,
      cashAccountCode: LedgerEngine.touchesCash(_kind)
          ? (_cashCode ?? AccountCode.kas.code)
          : null,
    );
    final error = await widget.controller.post(request);
    if (!mounted) return;
    if (error != null) {
      say(context, error, bad: true);
      return;
    }
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final targetType = LedgerEngine.targetOf(_kind);
    final needsParty = LedgerEngine.usesParty(_kind);
    final touchesCash = LedgerEngine.touchesCash(_kind);
    final targetOptions = targetType == null
        ? const <AccountRow>[]
        : widget.controller.accountsOfType(targetType);
    final cashOptions = _cashAccounts;
    final cashCode = _cashCode ?? AccountCode.kas.code;

    return Scaffold(
      appBar: AppBar(title: const Text('Catat transaksi')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
        children: [
          const SectionTitle('Apa yang terjadi?'),
          SizedBox(
            height: 48,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: EntryKind.values.length,
              separatorBuilder: (context, _) => const SizedBox(width: 8),
              itemBuilder: (context, index) {
                final kind = EntryKind.values[index];
                return ChoiceChip(
                  label: Text(kind.label),
                  selected: _kind == kind,
                  onSelected: (_) => setState(() => _kind = kind),
                );
              },
            ),
          ),
          const SizedBox(height: 18),
          LabeledField(
            label: 'Nominal',
            controller: _amount,
            hint: '25.000',
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            suffixText: 'Rp',
            onSubmitted: (_) => _save(),
          ),
          PickRow(
            label: 'Terjadi pada',
            placeholder: 'Pilih tanggal',
            value: fullDate(_date),
            onTap: _pickDate,
          ),
          if (targetType != null) ...[
            const SectionTitle('Masuk ke pos mana?'),
            if (targetOptions.isEmpty)
              _Missing(
                text: 'Belum ada akun ${targetType.label}. Tambahkan dulu di '
                    'Usaha › Akun.',
              )
            else
              PickRow(
                label: 'Pos',
                placeholder: _noTarget,
                value: _nameOf(_targetCode) ?? _noTarget,
                onTap: () => _pickTarget(targetOptions),
              ),
          ],
          if (needsParty) ...[
            const SectionTitle('Dengan siapa?'),
            if (widget.controller.parties.isEmpty)
              const _Missing(
                text: 'Belum ada pihak. Tambahkan dulu di Usaha › Pihak.',
              )
            else
              PickRow(
                label: 'Pihak',
                placeholder: _noParty,
                value:
                    widget.controller.party(_partyId)?.name ?? _noParty,
                onTap: _pickParty,
              ),
          ],
          if (touchesCash && cashOptions.length > 1)
            PickRow(
              label: 'Uangnya lewat mana',
              placeholder: 'Kas',
              value: widget.controller.accountByCode(cashCode)?.name ?? 'Kas',
              onTap: () => _pickCash(cashOptions),
            ),
          if (LedgerEngine.hasCost(_kind))
            LabeledField(
              label: 'Modal barang (boleh kosong)',
              controller: _cost,
              hint: '10.000',
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              suffixText: 'Rp',
            ),
          LabeledField(
            label: 'Catatan (boleh kosong)',
            controller: _note,
            hint: 'Empat porsi, dibungkus',
            maxLines: 2,
          ),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: widget.controller.busy ? null : _save,
              child: const Text('Simpan catatan'),
            ),
          ),
        ],
      ),
    );
  }
}

class _Missing extends StatelessWidget {
  const _Missing({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(
            Icons.info_outline_rounded,
            size: 18,
            color: theme.colorScheme.onSurfaceVariant,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
