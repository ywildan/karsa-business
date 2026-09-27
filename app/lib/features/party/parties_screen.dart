import 'package:flutter/material.dart';

import '../../data/master_repository.dart';
import '../../state/app_controller.dart';
import '../common/bits.dart';
import '../common/pickers.dart';

/// Daftar nama pihak: pelanggan dan pemasok dalam satu daftar.
///
/// Yang disimpan cuma nama dan nomor telepon. Piutang dan hutang lahir dari
/// jurnal, bukan dari daftar ini, jadi menghapus sebuah nama tidak pernah
/// mengubah angka laporan.
class PartiesScreen extends StatefulWidget {
  const PartiesScreen({super.key, required this.controller});

  final AppController controller;

  @override
  State<PartiesScreen> createState() => _PartiesScreenState();
}

class _PartiesScreenState extends State<PartiesScreen> {
  final TextEditingController _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _edit({PartyRow? existing}) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetContext) => _PartySheet(
        controller: widget.controller,
        existing: existing,
      ),
    );
  }

  Future<void> _remove(PartyRow party) async {
    final sure = await confirmDestructive(
      context,
      title: 'Hapus ${party.name}?',
      message: 'Catatan yang memakai nama ini tetap terbaca; hanya namanya '
          'yang hilang dari daftar.',
    );
    if (!sure) return;
    final error = await widget.controller.removeParty(party.id);
    if (!mounted) return;
    if (error != null) say(context, error, bad: true);
  }

  @override
  Widget build(BuildContext context) {
    final query = _search.text.trim().toLowerCase();
    final parties = [
      for (final party in widget.controller.parties)
        if (query.isEmpty || party.name.toLowerCase().contains(query)) party,
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Pihak'),
        actions: [
          IconButton(
            onPressed: () => _edit(),
            icon: const Icon(Icons.person_add_alt_1_rounded),
            tooltip: 'Tambah pihak',
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
        child: Column(
          children: [
            if (widget.controller.parties.isNotEmpty)
              LabeledField(
                label: 'Cari',
                controller: _search,
                hint: 'nama',
                onChanged: (_) => setState(() {}),
              ),
            if (parties.isEmpty)
              Expanded(
                child: EmptyState(
                  title: widget.controller.parties.isEmpty
                      ? 'Belum ada pihak'
                      : 'Tidak ada yang cocok',
                  body: 'Pihak dipakai oleh penjualan kredit, penerimaan '
                      'piutang, pembelian kredit dan pembayaran hutang.',
                  action: widget.controller.parties.isEmpty
                      ? FilledButton(
                          onPressed: () => _edit(),
                          child: const Text('Tambah pihak'),
                        )
                      : null,
                ),
              )
            else
              Expanded(
                child: ListView.builder(
                  padding: const EdgeInsets.only(top: 4),
                  itemCount: parties.length,
                  itemBuilder: (context, index) {
                    final party = parties[index];
                    return ListTile(
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 8,
                      ),
                      title: Text(party.name),
                      subtitle: party.phone == null
                          ? null
                          : Text(party.phone!),
                      trailing: IconButton(
                        onPressed: () => _remove(party),
                        icon: const Icon(Icons.delete_outline_rounded),
                        tooltip: 'Hapus',
                      ),
                      onTap: () => _edit(existing: party),
                    );
                  },
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _PartySheet extends StatefulWidget {
  const _PartySheet({required this.controller, this.existing});

  final AppController controller;
  final PartyRow? existing;

  @override
  State<_PartySheet> createState() => _PartySheetState();
}

class _PartySheetState extends State<_PartySheet> {
  late final TextEditingController _name =
      TextEditingController(text: widget.existing?.name ?? '');
  late final TextEditingController _phone =
      TextEditingController(text: widget.existing?.phone ?? '');

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final error = await widget.controller.saveParty(
      id: widget.existing?.id,
      name: _name.text,
      phone: _phone.text.trim().isEmpty ? null : _phone.text.trim(),
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
            widget.existing == null ? 'Pihak baru' : widget.existing!.name,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 16),
          LabeledField(label: 'Nama', controller: _name, hint: 'Rina'),
          LabeledField(
            label: 'Nomor telepon (boleh kosong)',
            controller: _phone,
            hint: '0812…',
            keyboardType: TextInputType.phone,
          ),
          const SizedBox(height: 6),
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
