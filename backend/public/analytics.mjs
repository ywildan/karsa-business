export const rupiah = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value).replace(/\s+/g, ' ');
export const monthKey = time => { const d = new Date(time); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
export const live = rows => rows.filter(row => row.deletedAt == null);
export function summarize(rows) {
    const income = rows.filter(r => r.type === 'INCOME').reduce((s, r) => s + r.amount, 0);
    const expense = rows.filter(r => r.type === 'EXPENSE').reduce((s, r) => s + r.amount, 0);
    return { income, expense, profit: income - expense, margin: income > 0 ? (income - expense) / income * 100 : 0, count: rows.length };
}
export function monthlySeries(rows, selected, length = 6) {
    const [year, month] = selected.split('-').map(Number);
    return Array.from({ length }, (_, i) => {
        const date = new Date(year, month - length + i, 1), key = monthKey(date.getTime());
        return { key, label: new Intl.DateTimeFormat('id-ID', { month: 'short' }).format(date), ...summarize(rows.filter(r => monthKey(r.transactionDate) === key)) };
    });
}
export function categories(rows) {
    const sums = new Map();
    for (const r of rows.filter(r => r.type === 'EXPENSE'))
        sums.set(r.category, (sums.get(r.category) || 0) + r.amount);
    return [...sums].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
}
export function topProducts(rows, products) {
    const sums = new Map();
    for (const r of rows.filter(r => r.type === 'INCOME' && r.productId)) {
        const current = sums.get(r.productId) || { id: r.productId, quantity: 0, amount: 0 };
        current.quantity += r.quantity || 0;
        current.amount += r.amount;
        sums.set(r.productId, current);
    }
    return [...sums.values()].map(r => ({ ...r, name: products.find(p => p.id === r.id)?.name || 'Produk dihapus' })).sort((a, b) => b.quantity - a.quantity).slice(0, 5);
}
export function csvCell(value) {
    let s = String(value ?? '');
    if (/^[\s]*[=+\-@\t\r]/.test(s))
        s = "'" + s;
    return `"${s.replaceAll('"', '""')}"`;
}
export function exportTransactions(rows, businesses) {
    const header = ['Tanggal', 'Bisnis', 'Jenis', 'Nominal', 'Kategori', 'Pembayaran', 'Catatan'];
    const records = rows.map(r => [new Date(r.transactionDate).toLocaleDateString('id-ID'), businesses.find(b => b.id === r.businessId)?.name || '', r.type === 'INCOME' ? 'Masuk' : 'Keluar', r.amount, r.category, r.paymentMethod, r.note]);
    return '\uFEFF' + [header, ...records].map(r => r.map(csvCell).join(',')).join('\r\n');
}
