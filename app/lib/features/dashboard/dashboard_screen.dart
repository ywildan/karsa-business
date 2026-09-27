import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import '../../core/format.dart';
import '../../core/money.dart';
import '../../domain/account.dart';
import '../../domain/reports.dart';
import '../../state/app_controller.dart';
import '../../theme/app_theme.dart';
import '../common/bits.dart';
import '../ledger/entry_form_screen.dart';

/// Halaman "Ringkas".
///
/// Angkanya tidak diketik ulang dan tidak ditabung di layar: semuanya dihitung
/// dari jurnal lewat [Reports], jadi apa yang kamu lihat di sini selalu sama
/// dengan yang mendasari neraca saldo.
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key, required this.controller});

  final AppController controller;

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  DateTime _month = startOfMonth(DateTime.now());

  void _shift(int direction) => setState(
    () => _month = DateTime(_month.year, _month.month + direction),
  );

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    final theme = Theme.of(context);
    final brightness = theme.brightness;
    final business = controller.business;
    final monthEntries = controller.entriesIn(_month);
    final pnl = controller.profitFor(_month);
    final topExpenses = _topExpenses(controller);

    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 110),
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    business?.name ?? 'Karsa Business',
                    style: theme.textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                IconButton(
                  onPressed: () => _shift(-1),
                  icon: const Icon(Icons.chevron_left_rounded),
                  tooltip: 'Bulan sebelumnya',
                ),
                SizedBox(
                  width: 118,
                  child: Text(
                    monthLabel(_month),
                    textAlign: TextAlign.center,
                    style: theme.textTheme.labelLarge?.copyWith(
                      color: KarsaPalette.accent(brightness),
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                IconButton(
                  onPressed: () => _shift(1),
                  icon: const Icon(Icons.chevron_right_rounded),
                  tooltip: 'Bulan berikutnya',
                ),
              ],
            ),
            if (controller.entries.isEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 40),
                child: EmptyState(
                  title: 'Belum ada satu catatan pun',
                  body: 'Mulai dari modal awal atau penjualan pertama. '
                      'Sisanya mengikuti.',
                  action: FilledButton(
                    onPressed: () => openEntryForm(context, controller),
                    child: const Text('Buat catatan pertama'),
                  ),
                ),
              )
            else ...[
              const SectionTitle('Bulan ini'),
              _cardRow([
                StatCard(
                  label: 'Pendapatan',
                  value: pnl.revenue.toString(),
                  emphasis: KarsaPalette.gain(brightness),
                ),
                StatCard(
                  label: 'Beban',
                  value: pnl.expense.toString(),
                  emphasis: KarsaPalette.loss(brightness),
                ),
              ]),
              const SizedBox(height: 12),
              _cardRow([
                StatCard(
                  label: 'Untung',
                  value: pnl.profit.toString(),
                  note: 'margin ${pnl.marginPercent}%',
                  emphasis: pnl.profit.isNegative
                      ? KarsaPalette.loss(brightness)
                      : KarsaPalette.gain(brightness),
                ),
                StatCard(
                  label: 'Saldo kas',
                  value: controller.cash.toString(),
                  note: 'semua bulan',
                ),
              ]),
              const SectionTitle('Arus kas tujuh hari'),
              _CashChart(controller: controller),
              if (monthEntries.isEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(
                    'Belum ada catatan di ${monthLabel(_month)}.',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                )
              else ...[
                const SectionTitle('Pos keluar terbesar'),
                for (final row in topExpenses)
                  _SummaryLine(
                    label: controller.accountByCode(row.accountCode)?.name ??
                        row.accountCode,
                    value: row.balance,
                    loss: true,
                  ),
                const SectionTitle('Yang belum beres'),
                _SummaryLine(
                  label: 'Piutang di tangan pelanggan',
                  value: controller.receivable,
                ),
                _SummaryLine(
                  label: 'Hutang ke pemasok',
                  value: controller.payable,
                ),
                if (!controller.inventory.isZero)
                  _SummaryLine(
                    label: 'Nilai stok di rak',
                    value: controller.inventory,
                  ),
              ],
            ],
          ],
        ),
      ),
    );
  }

  List<AccountSummary> _topExpenses(AppController controller) {
    final rows = Reports.byAccount(
      controller.entriesIn(_month),
      type: AccountType.expense,
    );
    rows.sort((a, b) => b.balance.rupees.compareTo(a.balance.rupees));
    return rows.take(4).toList();
  }

  Widget _cardRow(List<Widget> cards) {
    // Di dalam ListView tingginya tidak terbatas, jadi dua kartu harus
    // disamakan lewat IntrinsicHeight; stretch murni akan menuntut batas atas.
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (var index = 0; index < cards.length; index++) ...[
            Expanded(child: cards[index]),
            if (index < cards.length - 1) const SizedBox(width: 12),
          ],
        ],
      ),
    );
  }
}

class _SummaryLine extends StatelessWidget {
  const _SummaryLine({
    required this.label,
    required this.value,
    this.loss = false,
  });

  final String label;
  final Money value;
  final bool loss;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Text(
            value.toString(),
            style: theme.textTheme.titleSmall?.copyWith(
              fontWeight: FontWeight.w700,
              color: loss
                  ? KarsaPalette.loss(theme.brightness)
                  : null,
            ),
          ),
        ],
      ),
    );
  }
}

class _DayBar {
  const _DayBar({
    required this.day,
    required this.inflow,
    required this.outflow,
  });

  final DateTime day;
  final Money inflow;
  final Money outflow;
}

class _CashChart extends StatelessWidget {
  const _CashChart({required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final brightness = theme.brightness;
    final days = <_DayBar>[
      for (final day in lastDays(7))
        _DayBar(
          day: day,
          inflow: controller.inflowOn(day),
          outflow: controller.outflowOn(day),
        ),
    ];
    var highest = 0;
    for (final bar in days) {
      highest = bar.inflow.rupees > highest ? bar.inflow.rupees : highest;
      highest = bar.outflow.rupees > highest ? bar.outflow.rupees : highest;
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          height: 150,
          child: BarChart(
            BarChartData(
              minY: 0,
              maxY: highest == 0 ? 1 : highest.toDouble(),
              alignment: BarChartAlignment.spaceAround,
              barTouchData: BarTouchData(enabled: false),
              titlesData: const FlTitlesData(show: false),
              gridData: const FlGridData(show: false),
              borderData: FlBorderData(show: false),
              barGroups: [
                for (var index = 0; index < days.length; index++)
                  BarChartGroupData(
                    x: index,
                    barsSpace: 3,
                    barRods: [
                      BarChartRodData(
                        toY: days[index].inflow.rupees.toDouble(),
                        color: KarsaPalette.gain(brightness),
                        width: 9,
                        borderRadius: BorderRadius.circular(3),
                      ),
                      BarChartRodData(
                        toY: days[index].outflow.rupees.toDouble(),
                        color: KarsaPalette.loss(brightness),
                        width: 9,
                        borderRadius: BorderRadius.circular(3),
                      ),
                    ],
                  ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 6),
        Row(
          children: [
            for (final bar in days)
              Expanded(
                child: Text(
                  kDayShortNames[bar.day.weekday - 1],
                  textAlign: TextAlign.center,
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            _Legend(color: KarsaPalette.gain(brightness), label: 'masuk'),
            const SizedBox(width: 16),
            _Legend(color: KarsaPalette.loss(brightness), label: 'keluar'),
          ],
        ),
      ],
    );
  }
}

class _Legend extends StatelessWidget {
  const _Legend({required this.color, required this.label});

  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 9,
          height: 9,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 6),
        Text(
          label,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}
