import { live, summarize, csvCell } from './analytics.mjs';

const monthPattern = /^[1-9]\d{3}-(0[1-9]|1[0-2])$/;
export const monthLabel = key => new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date(`${key}-01T12:00:00`));
const dateLabel = date => new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
const rangeLabel = (start, end) => `${dateLabel(start)} – ${dateLabel(new Date(end.getTime() - 1))}`;

/** Compare recorded cash flow; never infer product profit without cost data. */
export function monthlyReport(rows, selected, now = new Date()) {
    if (!monthPattern.test(selected)) throw new RangeError('Bulan laporan tidak valid.');
    const [year, month] = selected.split('-').map(Number);
    const start = new Date(year, month - 1, 1), end = new Date(year, month, 1);
    const previousStart = new Date(year, month - 2, 1);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const future = start > today, partial = !future && end > today;
    const currentEnd = partial ? new Date(year, month - 1, now.getDate() + 1) : end;
    const previousDays = new Date(year, month - 1, 0).getDate();
    const previousEnd = partial ? new Date(year, month - 2, Math.min(now.getDate(), previousDays) + 1) : start;
    const active = live(rows);
    const within = (data, a, b) => data.filter(r => r.transactionDate >= a.getTime() && r.transactionDate < b.getTime());
    const currentRows = future ? [] : within(active, start, currentEnd);
    const previousRows = future ? [] : within(active, previousStart, previousEnd);
    const current = summarize(currentRows), previous = summarize(previousRows);
    // Missing records are not proof that a business had zero cash flow.
    const comparable = !future && current.count > 0 && previous.count > 0;
    const deltas = Object.fromEntries(['income', 'expense', 'profit'].map(key => {
        const amount = current[key] - previous[key];
        return [key, { amount, percent: comparable && previous[key] > 0 ? amount / previous[key] * 100 : null }];
    }));
    function drivers(type) {
        const sums = new Map();
        for (const [data, field] of [[previousRows, 'previous'], [currentRows, 'current']]) {
            for (const r of data.filter(r => r.type === type)) {
                const label = r.category || 'Tanpa kategori';
                const entry = sums.get(label) || { label, current: 0, previous: 0 };
                entry[field] += r.amount; sums.set(label, entry);
            }
        }
        return [...sums.values()].map(r => ({ ...r, delta: r.current - r.previous }))
            .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.current - a.current || a.label.localeCompare(b.label, 'id'));
    }
    return {
        selected, previousMonth: `${previousStart.getFullYear()}-${String(previousStart.getMonth() + 1).padStart(2, '0')}`,
        partial, future, comparable, current, previous, deltas,
        currentRows, previousRows,
        currentRange: rangeLabel(start, currentEnd), previousRange: rangeLabel(previousStart, previousEnd),
        incomeDrivers: drivers('INCOME'), expenseDrivers: drivers('EXPENSE'),
    };
}

export function businessComparisons(report, businesses) {
    return businesses.map(b => {
        const current = summarize(report.currentRows.filter(r => r.businessId === b.id));
        const previous = summarize(report.previousRows.filter(r => r.businessId === b.id));
        return { ...b, current, previous, comparable: current.count > 0 && previous.count > 0, delta: current.profit - previous.profit };
    }).sort((a, b) => Number(b.current.count > 0) - Number(a.current.count > 0) || b.current.profit - a.current.profit || a.name.localeCompare(b.name, 'id'));
}

export function productRevenue(rows, products) {
    const sums = new Map();
    for (const r of live(rows).filter(r => r.type === 'INCOME' && r.productId)) {
        const entry = sums.get(r.productId) || { id: r.productId, quantity: 0, amount: 0, businessId: r.businessId };
        entry.quantity += r.quantity || 0; entry.amount += r.amount; sums.set(r.productId, entry);
    }
    return [...sums.values()].map(r => ({ ...r, name: products.find(p => p.id === r.id && p.businessId === r.businessId)?.name || 'Produk dihapus' }))
        .sort((a, b) => b.amount - a.amount || b.quantity - a.quantity);
}

export function exportMonthlyReport(report, name, businesses, products) {
    const records = [
        ['Laporan bulanan Karsa Business'], ['Bisnis', name], ['Bulan', monthLabel(report.selected)],
        ['Periode laporan', report.currentRange], ['Periode pembanding', report.previousRange],
        ['Dasar perhitungan', 'Transaksi uang masuk dan keluar yang tercatat; belum menghitung laba produk berdasarkan HPP.'],
        ['Status pembanding', report.future ? 'Periode belum dimulai' : report.comparable ? 'Tersedia' : 'Catatan salah satu periode belum tersedia'], [],
        ['Metrik', 'Periode laporan (Rp)', 'Periode pembanding (Rp)', 'Perubahan (Rp)', 'Perubahan (%)'],
        ...[['income', 'Masuk'], ['expense', 'Keluar'], ['profit', 'Laba']].map(([key, label]) => [label, report.current[key], report.previous[key], report.comparable ? report.deltas[key].amount : '', report.deltas[key].percent ?? '']), [],
        ['Kategori pengeluaran', 'Periode laporan (Rp)', 'Periode pembanding (Rp)', 'Perubahan (Rp)'],
        ...report.expenseDrivers.map(r => [r.label, r.current, r.previous, report.comparable ? r.delta : '']), [],
        ['Kategori pemasukan', 'Periode laporan (Rp)', 'Periode pembanding (Rp)', 'Perubahan (Rp)'],
        ...report.incomeDrivers.map(r => [r.label, r.current, r.previous, report.comparable ? r.delta : '']), [],
        ['Bisnis', 'Masuk (Rp)', 'Keluar (Rp)', 'Laba (Rp)', 'Perubahan laba (Rp)'],
        ...businessComparisons(report, businesses).map(r => [r.name, r.current.income, r.current.expense, r.current.profit, r.comparable ? r.delta : '']), [],
        ['Produk', 'Bisnis', 'Terjual', 'Omzet (Rp)'],
        ...productRevenue(report.currentRows, products).map(r => [r.name, businesses.find(b => b.id === r.businessId)?.name || '', r.quantity, r.amount]),
    ];
    return '\uFEFF' + records.map(r => r.map(value => typeof value === 'number' ? `"${value}"` : csvCell(value)).join(',')).join('\r\n');
}
