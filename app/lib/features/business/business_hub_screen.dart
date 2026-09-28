import 'package:flutter/material.dart';

import '../../state/app_controller.dart';
import '../accounts/accounts_screen.dart';
import '../party/parties_screen.dart';
import '../settings/settings_screen.dart';
import 'business_items_screen.dart';

class BusinessHubScreen extends StatelessWidget {
  const BusinessHubScreen({super.key, required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final business = controller.business;

    return Scaffold(
      appBar: AppBar(title: const Text('Usaha')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(8, 4, 8, 110),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 6),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  business?.name ?? '-',
                  style: theme.textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Versi gratis. Catatannya cuma ada di hp ini.',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          _HubTile(
            icon: Icons.people_outline_rounded,
            title: 'Pihak',
            detail: '${controller.parties.length} nama',
            hint: 'Pelanggan dan pemasok yang punya catatan bersamamu.',
            onTap: () => _open(context, PartiesScreen(controller: controller)),
          ),
          _HubTile(
            icon: Icons.inventory_2_outlined,
            title: 'Barang',
            detail: '${controller.items.length} jenis',
            hint: 'Daftar harga. Stok fisik dihitung terpisah di versi dua.',
            onTap: () =>
                _open(context, BusinessItemsScreen(controller: controller)),
          ),
          _HubTile(
            icon: Icons.account_tree_outlined,
            title: 'Akun',
            detail: '${controller.accounts.length} pos',
            hint: 'Tempat angka jatuh. Tambah sub-akun untuk memisahkan beban.',
            onTap: () => _open(context, AccountsScreen(controller: controller)),
          ),
          _HubTile(
            icon: Icons.settings_outlined,
            title: 'Pengaturan',
            detail: '${controller.entries.length} catatan',
            hint:
                'Nama usaha dan identitas perangkat, termasuk yang menunggu '
                'sinkronisasi.',
            onTap: () => _open(context, SettingsScreen(controller: controller)),
          ),
        ],
      ),
    );
  }

  void _open(BuildContext context, Widget screen) {
    Navigator.push<void>(
      context,
      MaterialPageRoute(builder: (context) => screen),
    );
  }
}

class _HubTile extends StatelessWidget {
  const _HubTile({
    required this.icon,
    required this.title,
    required this.detail,
    required this.hint,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String detail;
  final String hint;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 4),
      color: theme.colorScheme.surfaceContainerLow,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: theme.colorScheme.outlineVariant),
      ),
      child: ListTile(
        onTap: onTap,
        leading: Icon(icon, color: theme.colorScheme.primary),
        title: Text(
          title,
          style: theme.textTheme.titleSmall?.copyWith(
            fontWeight: FontWeight.w700,
          ),
        ),
        subtitle: Text(
          hint,
          maxLines: 2,
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        // Lebar tetap: ListTile menuntut sisi kanannya jauh lebih sempit dari
        // seluruh baris, dan sebuah angka yang tumbuh ("128 catatan") tidak
        // boleh membuat kartu ini gagal tertata.
        trailing: SizedBox(
          width: 96,
          child: Text(
            detail,
            maxLines: 2,
            textAlign: TextAlign.end,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.labelMedium,
          ),
        ),
      ),
    );
  }
}
