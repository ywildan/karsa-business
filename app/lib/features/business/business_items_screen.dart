import 'package:flutter/material.dart';

import '../../core/money.dart';
import '../../data/master_repository.dart';
import '../../state/app_controller.dart';
import '../common/bits.dart';
import '../common/pickers.dart';

/// Daftar barang dan harganya.
///
/// Versi satu tidak menghitung stok dari daftar ini: angka persediaan di
/// laporan datang dari jurnal (Dr Persediaan / Cr Kas). Daftar ini supaya
/// nominal jualan tidak perlu diingat-ingat setiap kali mencatat.
class BusinessItemsScreen extends StatefulWidget {
  const BusinessItemsScreen({super.key, required this.controller});

  final AppController controller;

  @override
  State<BusinessItemsScreen> createState() => _BusinessItemsScreenState();
}

class _BusinessItemsScreenState extends State<BusinessItemsScreen> {
  Future<void> _edit({ItemRow? existing}) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) =>
          _ItemSheet(controller: widget.controller, existing: existing),
    );
  }

  Future<void> _remove(ItemRow item) async {
    final sure = await confirmDestructive(
      context,
      title: 'Hapus ${item.name}?',
      message: 'Catatan yang sudah memakai barang ini tidak ikut berubah.',
    );
    if (!sure) return;
    final error = await widget.controller.removeItem(item.id);
    if (!mounted) return;
    if (error != null) say(context, error, bad: true);
  }

  @override
  Widget build(BuildContext context) {
    final items = widget.controller.items;
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Barang'),
        actions: [
          IconButton(
            onPressed: () => _edit(),
            icon: const Icon(Icons.add_rounded),
            tooltip: 'Tambah barang',
          ),
        ],
      ),
      body: items.isEmpty
          ? EmptyState(
              title: 'Belum ada barang',
              body: 'Tidak wajib diisi. Catatan tetap berjalan tanpa daftar '
                  'ini.',
              action: FilledButton(
                onPressed: () => _edit(),
                child: const Text('Tambah barang'),
              ),
            )
          : ListView.builder(
              padding: const EdgeInsets.fromLTRB(8, 4, 8, 24),
              itemCount: items.length,
              itemBuilder: (context, index) {
                final item = items[index];
                return ListTile(
                  title: Text(item.name),
                  subtitle: Text(
                    '${item.salePrice} / ${item.unit}',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  trailing: IconButton(
                    onPressed: () => _remove(item),
                    icon: const Icon(Icons.delete_outline_rounded),
                    tooltip: 'Hapus',
                  ),
                  onTap: () => _edit(existing: item),
                );
              },
            ),
    );
  }
}

class _ItemSheet extends StatefulWidget {
  const _ItemSheet({required this.controller, this.existing});

  final AppController controller;
  final ItemRow? existing;

  @override
  State<_ItemSheet> createState() => _ItemSheetState();
}

class _ItemSheetState extends State<_ItemSheet> {
  late final TextEditingController _name =
      TextEditingController(text: widget.existing?.name ?? '');
  late final TextEditingController _unit =
      TextEditingController(text: widget.existing?.unit ?? 'pcs');
  late final TextEditingController _sale = TextEditingController(
    text: widget.existing == null
        ? ''
        : Money.group(widget.existing!.salePrice.rupees),
  );
  late final TextEditingController _buy = TextEditingController(
    text: widget.existing == null
        ? ''
        : Money.group(widget.existing!.buyPrice.rupees),
  );

  @override
  void dispose() {
    _name.dispose();
    _unit.dispose();
    _sale.dispose();
    _buy.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final error = await widget.controller.saveItem(
      id: widget.existing?.id,
      name: _name.text,
      unit: _unit.text.trim().isEmpty ? 'pcs' : _unit.text.trim(),
      salePrice: Money.tryParse(_sale.text) ?? Money.zero,
      buyPrice: Money.tryParse(_buy.text) ?? Money.zero,
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
            widget.existing == null ? 'Barang baru' : widget.existing!.name,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 16),
          LabeledField(label: 'Nama', controller: _name, hint: 'Kopi susu 250ml'),
          LabeledField(label: 'Satuan', controller: _unit, hint: 'pcs'),
          LabeledField(
            label: 'Harga jual',
            controller: _sale,
            hint: '15.000',
            suffixText: 'Rp',
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
          ),
          LabeledField(
            label: 'Modal per satuan',
            controller: _buy,
            hint: '9.000',
            suffixText: 'Rp',
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
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
