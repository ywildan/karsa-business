import 'package:flutter/material.dart';

import '../../state/app_controller.dart';
import '../business/business_hub_screen.dart';
import '../dashboard/dashboard_screen.dart';
import '../ledger/entries_screen.dart';
import '../ledger/entry_form_screen.dart';

class HomeShell extends StatefulWidget {
  const HomeShell({super.key, required this.controller});

  final AppController controller;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      // IndexedStack: berpindah tab tidak boleh membuang isi layar yang sedang
      // dibuka, misalnya tanggal yang sudah dipilih di daftar catatan.
      body: IndexedStack(
        index: _tab,
        children: [
          DashboardScreen(controller: widget.controller),
          EntriesScreen(controller: widget.controller),
          BusinessHubScreen(controller: widget.controller),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => openEntryForm(context, widget.controller),
        icon: const Icon(Icons.add_rounded),
        label: const Text('Catat'),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (index) => setState(() => _tab = index),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.insights_outlined),
            selectedIcon: Icon(Icons.insights_rounded),
            label: 'Ringkas',
          ),
          NavigationDestination(
            icon: Icon(Icons.receipt_long_outlined),
            selectedIcon: Icon(Icons.receipt_long_rounded),
            label: 'Catatan',
          ),
          NavigationDestination(
            icon: Icon(Icons.storefront_outlined),
            selectedIcon: Icon(Icons.storefront_rounded),
            label: 'Usaha',
          ),
        ],
      ),
    );
  }
}
