import { rupiah, monthKey, live, summarize, monthlySeries, categories, exportTransactions } from './analytics.mjs';
import { monthlyReport, monthLabel, businessComparisons, productRevenue, exportMonthlyReport } from './monthly-report.mjs';
const $ = id => document.getElementById(id);
const state = { data: null, selected: 'all', tab: 'overview', search: '', category: null, categoryType: null, month: monthKey(Date.now()), user: null, loading: false };
let auth, sdk, saveAction, saving = false, toastTimer;
let authGeneration = 0;
const labels = { overview: ['Ringkasan usaha', 'Lihat gambaran besar, lalu tentukan langkah berikutnya.'], transactions: ['Catatan transaksi', 'Semua pergerakan uang, dalam satu tempat.'], products: ['Produk & stok', 'Jaga produk tersedia dan usaha tetap berjalan.'], analytics: ['Laporan bulanan', 'Pahami perubahan usaha dan tentukan langkah berikutnya.'] };
function node(tag, attrs = {}, ...children) { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on'))
        e.addEventListener(k.slice(2), v);
    else if (k === 'class')
        e.className = v;
    else if (k === 'text')
        e.textContent = v;
    else
        e.setAttribute(k, v);
} e.append(...children.filter(x => x != null).map(x => typeof x === 'string' ? document.createTextNode(x) : x)); return e; }
const button = (label, action, klass = 'text-button') => node('button', { type: 'button', class: klass, onclick: action }, label);
function notice(message, error = false) { clearTimeout(toastTimer); $('notice').textContent = message; $('notice').className = error ? 'error' : ''; $('notice').hidden = false; toastTimer = setTimeout(() => $('notice').hidden = true, 5500); }
function show(section) { for (const id of ['login', 'gate', 'dashboard'])
    $(id).hidden = id !== section; }
function errorMessage(error) { const messages = { 'auth/invalid-credential': 'Email atau kata sandi belum sesuai.', 'auth/unauthorized-domain': 'Domain dashboard belum didaftarkan di Firebase.', 'auth/invalid-auth-event': 'Login Google belum selesai. Coba kembali setelah pengaturan callback diperiksa.', 'auth/web-storage-unsupported': 'Browser belum mengizinkan penyimpanan sesi login untuk situs ini.', 'auth/network-request-failed': 'Koneksi terputus. Silakan coba lagi.', 'auth/too-many-requests': 'Terlalu banyak percobaan. Tunggu sebentar.', 'auth/user-disabled': 'Akun ini dinonaktifkan.' }; return messages[error.code] || error.message || 'Terjadi kesalahan. Silakan coba lagi.'; }
async function api(path, method = 'GET', payload) {
    const user = auth.currentUser;
    const generation = authGeneration;
    if (!user)
        throw new Error('Masuk kembali untuk melanjutkan.');
    async function send(force = false) { return fetch(path, { method, headers: { Authorization: `Bearer ${await user.getIdToken(force)}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}), cache: 'no-store' }); }
    let response = await send();
    if (response.status === 401)
        response = await send(true);
    if (auth.currentUser?.uid !== user.uid)
        throw new Error('Akun berubah. Silakan masuk kembali.');
    const body = await response.json();
    if (generation !== authGeneration || auth.currentUser?.uid !== user.uid)
        throw new Error('Akun berubah. Silakan masuk kembali.');
    if (!response.ok) {
        const error = new Error(body.error || 'Server belum dapat dihubungi.');
        error.code = body.code;
        error.status = response.status;
        throw error;
    }
    return body;
}
function lockDashboard(message) { state.data = null; $('page-content').replaceChildren(); $('gate-message').textContent = message || 'Akunmu belum memiliki Premium aktif. Catatan di HP tetap bisa digunakan.'; show('gate'); }
async function load(silent = false) {
    if (state.loading || !state.user)
        return;
    const generation = authGeneration;
    state.loading = true;
    $('refresh').disabled = true;
    $('check-premium').disabled = true;
    try {
        const info = await api('/v2/account');
        if (generation !== authGeneration) return;
        if (!info.account.premium) {
            lockDashboard();
            return;
        }
        const snapshot = await api('/v2/web/snapshot');
        if (generation !== authGeneration) return;
        state.data = snapshot;
        if (state.selected !== 'all' && !state.data.businesses.some(b => b.id === state.selected))
            state.selected = 'all';
        show('dashboard');
        render();
        $('updated-label').textContent = `Diperbarui ${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} · perubahan HP tampil setelah sinkronisasi`;
        if (!silent)
            notice('Catatan terbaru sudah dimuat.');
    }
    catch (error) {
        if (generation !== authGeneration) return;
        if (error.code === 'PREMIUM_REQUIRED')
            lockDashboard(error.message);
        else if (error.status === 401) {
            state.data = null;
            await sdk.signOut(auth);
            $('auth-error').textContent = 'Gunakan email mahasiswa yang sudah diverifikasi.';
        }
        else {
            if (!state.data)
                lockDashboard('Server belum dapat dihubungi. Periksa koneksi, lalu coba kembali.');
            notice(errorMessage(error), true);
        }
    }
    finally {
        if (generation === authGeneration) {
            state.loading = false;
            $('refresh').disabled = false;
            $('check-premium').disabled = false;
        }
    }
}
function currentBusiness() { return state.data.businesses.find(b => b.id === state.selected); }
function scopedTransactions() { return live(state.data.transactions).filter(r => state.selected === 'all' || r.businessId === state.selected); }
function monthRows() { return scopedTransactions().filter(r => monthKey(r.transactionDate) === state.month); }
function scopedProducts() { return live(state.data.products).filter(r => state.selected === 'all' || r.businessId === state.selected); }
function panel(title, subtitle, content, action) { return node('section', { class: 'panel' }, node('div', { class: 'panel-heading' }, node('div', {}, node('h2', {}, title), subtitle ? node('p', {}, subtitle) : null), action), content); }
function empty(title, copy) { return node('div', { class: 'empty' }, node('strong', {}, title), copy); }
function changeLabel(amount) { return amount === 0 ? 'Tetap' : `${amount > 0 ? 'Naik' : 'Turun'} ${rupiah(Math.abs(amount))}`; }
function comparisonBadge(report, key) {
    if (!report.comparable) return node('span', { class: 'comparison muted' }, 'Perbandingan belum tersedia');
    const delta = report.deltas[key];
    const favorable = key === 'expense' ? delta.amount < 0 : delta.amount > 0;
    return node('span', { class: `comparison ${delta.amount === 0 ? 'muted' : favorable ? 'favorable' : 'unfavorable'}` },
        changeLabel(delta.amount), delta.percent == null ? '' : ` (${delta.percent > 0 ? '+' : ''}${delta.percent.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%)`);
}
function metrics(rows, report) {
    const s = summarize(rows);
    const cards = [['income', 'Masuk', s.income, '↓', '', `${rows.filter(r => r.type === 'INCOME').length} transaksi pemasukan`],
        ['expense', 'Keluar', s.expense, '↑', 'expense', `${rows.filter(r => r.type === 'EXPENSE').length} transaksi pengeluaran`],
        ['profit', 'Laba', s.profit, '↗', 'profit', s.income > 0 ? `Margin ${s.margin.toLocaleString('id-ID', { maximumFractionDigits: 1 })}% dari pemasukan` : 'Margin belum tersedia tanpa pemasukan']];
    return node('div', { class: 'metric-grid' }, ...cards.map(([key, label, amount, icon, klass, detail]) => node('section', { class: `metric ${klass}` },
        node('div', { class: 'metric-label' }, node('span', { class: 'metric-icon', 'aria-hidden': 'true' }, icon), label),
        node('strong', {}, rupiah(amount)), report ? comparisonBadge(report, key) : null, node('small', {}, detail))));
}
function chart() {
    const series = monthlySeries(scopedTransactions(), state.month), maximum = Math.max(1, ...series.flatMap(r => [r.income, r.expense]));
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 520 220');
    svg.setAttribute('class', 'chart');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Grafik pemasukan dan pengeluaran enam bulan');
    function shape(tag, attrs, text) { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs))
        e.setAttribute(k, String(v)); if (text)
        e.textContent = text; svg.append(e); return e; }
    for (let i = 0; i < 4; i++) {
        const y = 20 + i * 52;
        shape('line', { x1: 52, x2: 512, y1: y, y2: y, stroke: '#EBE7DC', 'stroke-dasharray': '3 5' });
        shape('text', { x: 0, y: y + 4 }, new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(maximum * (3 - i) / 3));
    }
    series.forEach((r, i) => { const x = 69 + i * 74; [['income', '#1B5A45', 0], ['expense', '#EF5F4A', 23]].forEach(([key, color, offset]) => { const height = r[key] / maximum * 155; const bar = shape('rect', { x: x + offset, y: 176 - height, width: 18, height, rx: 5, fill: color, class: 'chart-bar' }); const title = document.createElementNS(ns, 'title'); title.textContent = `${r.label} ${key === 'income' ? 'Masuk' : 'Keluar'}: ${rupiah(r[key])}`; bar.append(title); }); shape('text', { x: x + 18, y: 207, 'text-anchor': 'middle' }, r.label); });
    return node('div', {}, node('div', { class: 'legend' }, node('span', {}, node('i', { class: 'income-dot' }), 'Masuk'), node('span', {}, node('i', { class: 'expense-dot' }), 'Keluar')), svg);
}
function categoryPanel() { const rows = categories(reportForScope().currentRows), total = rows.reduce((s, r) => s + r.amount, 0); return panel('Ke mana uang keluar?', 'Lima kategori biaya terbesar', rows.length ? node('div', {}, ...rows.slice(0, 5).map(r => { const fill = node('div', { class: 'expense-fill' }); fill.style.width = `${r.amount / total * 100}%`; return node('div', {}, node('div', { class: 'category-row' }, node('span', {}, r.label), node('strong', {}, rupiah(r.amount))), node('div', { class: 'expense-track' }, fill)); })) : empty('Belum ada pengeluaran', 'Kategori biaya muncul setelah kamu mencatat transaksi.')); }
function reportForScope() { return monthlyReport(scopedTransactions(), state.month); }
function reportHeadline(report) {
    if (report.future) return ['Periode belum dimulai', 'Pilih bulan berjalan atau bulan sebelumnya untuk mengevaluasi catatan usaha.'];
    if (!report.current.count) return ['Belum ada catatan pada periode ini', 'Lengkapi atau sinkronkan catatan usaha sebelum menyimpulkan perubahan laba.'];
    if (!report.previous.count) return ['Gambaran awal usahamu', 'Catatan periode sebelumnya belum tersedia. Nominal saat ini sudah bisa dilihat; perubahan belum dapat disimpulkan.'];
    const delta = report.deltas.profit.amount;
    const title = report.current.profit < 0 && report.previous.profit < 0 && delta !== 0
        ? `Rugi ${delta > 0 ? 'berkurang' : 'bertambah'} ${rupiah(Math.abs(delta))}`
        : `Laba ${delta === 0 ? 'tetap' : `${delta > 0 ? 'naik' : 'turun'} ${rupiah(Math.abs(delta))}`}`;
    return [title, `Pemasukan ${changeLabel(report.deltas.income.amount).replace(/^./, c => c.toLowerCase())}. Pengeluaran ${changeLabel(report.deltas.expense.amount).replace(/^./, c => c.toLowerCase())}. Kedua perubahan ini membentuk selisih laba yang tercatat.`];
}
function reportHero(report, compact = false) {
    const [title, copy] = reportHeadline(report);
    return node('section', { class: `report-hero ${compact ? 'compact' : ''}`, 'aria-label': 'Ringkasan laporan bulanan' },
        node('div', { class: 'report-heading' }, node('div', {}, node('span', { class: 'eyebrow' }, 'LAPORAN BULANAN · PREMIUM'), node('h2', {}, monthLabel(report.selected))),
            node('span', { class: 'report-status' }, report.future ? 'Periode mendatang' : report.partial ? 'Bulan berjalan' : 'Bulan selesai')),
        node('h3', {}, title), node('p', { class: 'report-summary' }, copy),
        node('p', { class: 'report-period' }, `${report.currentRange} · dibanding ${report.previousRange}`),
        report.partial ? node('small', { class: 'report-note' }, 'Bulan berjalan dibandingkan sampai tanggal yang setara pada bulan sebelumnya; tanggal dibatasi sampai akhir bulan pembanding.') : null,
        compact ? button('Buka laporan lengkap ↗', () => switchTab('analytics'), 'button report-link') :
            node('div', { class: 'report-actions' }, button('Unduh laporan CSV', () => exportReport(report), 'button report-link'), button('Cetak / PDF', () => window.print(), 'button report-print')));
}
function overview() {
    const report = reportForScope(), rows = report.currentRows;
    const content = node('div', {}, reportHero(report, true), metrics(rows, report),
        node('div', { class: 'section-grid' }, panel('Arah usaha enam bulan', 'Pemasukan dan pengeluaran setiap bulan', chart()), categoryPanel()));
    if (state.selected === 'all')
        content.append(node('div', { class: 'business-grid' }, ...businessComparisons(report, state.data.businesses).map(b => node('button', { type: 'button', class: 'business-card', onclick: () => { state.selected = b.id; render(); } },
            node('span', { class: 'pill' }, b.type), node('h3', {}, b.name), node('p', {}, 'Laba periode laporan'), node('strong', {}, rupiah(b.current.profit)),
            node('small', {}, b.comparable ? changeLabel(b.delta) + ' dari periode sebelumnya' : `${b.current.count} transaksi · Buka bisnis ↗`)))));
    content.append(node('div', { class: 'full-panel' }, panel('Transaksi terbaru', 'Lima catatan pada periode laporan', transactionTable([...rows].sort((a, b) => b.transactionDate - a.transactionDate).slice(0, 5), false), button('Lihat semua ↗', () => switchTab('transactions')))));
    return content;
}
function businessName(id) { return state.data.businesses.find(b => b.id === id)?.name || 'Bisnis'; }
function transactionTable(rows, editable = true) { if (!rows.length)
    return empty('Belum ada transaksi', 'Catat pemasukan atau pengeluaran pada bisnis yang dipilih.'); const table = node('table', {}, node('thead', {}, node('tr', {}, ...['Tanggal', 'Kategori / bisnis', 'Nominal', 'Pembayaran', ...(editable ? ['Tindakan'] : [])].map(x => node('th', { scope: 'col' }, x))))); const tbody = node('tbody'); for (const r of rows) {
    tbody.append(node('tr', {}, node('td', {}, new Date(r.transactionDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })), node('td', {}, r.category, node('small', {}, `${businessName(r.businessId)}${r.note ? ' · ' + r.note : ''}`)), node('td', { class: `row-money ${r.type === 'INCOME' ? 'positive' : 'negative'}` }, `${r.type === 'INCOME' ? '+' : '−'}${rupiah(r.amount)}`), node('td', {}, r.paymentMethod), editable ? node('td', {}, node('div', { class: 'row-actions' }, button('Edit', () => editTransaction(r)), button('Hapus', () => deleteRow('transactions', r)))) : null));
} table.append(tbody); return node('div', { class: 'table-wrap' }, table); }
function transactionRows() { return state.category == null ? monthRows() : reportForScope().currentRows.filter(r => r.category === state.category && r.type === state.categoryType); }
function openCategory(category, type) { state.tab = 'transactions'; state.search = ''; state.category = category; state.categoryType = type; render(); }
function exportCsv() { const blob = new Blob([exportTransactions(transactionRows(), state.data.businesses)], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob), a = node('a', { href: url, download: `Karsa-Business-${state.month}.csv` }); a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function transactions() { const input = node('input', { type: 'search', placeholder: 'Cari kategori atau catatan…', value: state.search, 'aria-label': 'Cari transaksi', oninput: event => { state.search = event.target.value; drawRows(); } }); const body = node('div'); function drawRows() { body.replaceChildren(transactionTable(transactionRows().filter(r => `${r.category} ${r.note} ${businessName(r.businessId)}`.toLocaleLowerCase('id-ID').includes(state.search.toLocaleLowerCase('id-ID'))))); } drawRows(); return node('section', { class: 'panel' }, state.category == null ? null : node('div', { class: 'category-filter' }, node('span', {}, `${state.categoryType === 'EXPENSE' ? 'Pengeluaran' : 'Pemasukan'} kategori: ${state.category}`), button('Hapus filter', () => { state.category = null; render(); }), button('Kembali ke laporan ↗', () => switchTab('analytics'))), node('div', { class: 'table-toolbar' }, input, node('div', { class: 'table-actions' }, button('Ekspor CSV', exportCsv, 'button outline'), button('+ Catat transaksi', () => editTransaction(), 'button primary'))), body); }
function products() {
    const rows = scopedProducts();
    const heading = node('div', { class: 'table-toolbar' }, node('div', {}, node('h2', {}, 'Katalog usahamu'), node('p', { class: 'eyebrow' }, `${rows.length} produk tercatat`)), button('+ Tambah produk', () => editProduct(), 'button primary'));
    const table = node('table', {}, node('thead', {}, node('tr', {}, ...['Produk', 'Bisnis', 'Harga', 'Stok', 'Tindakan'].map(x => node('th', { scope: 'col' }, x)))));
    const tbody = node('tbody');
    for (const r of rows) {
        tbody.append(node('tr', {}, node('td', {}, node('strong', {}, r.name)), node('td', {}, businessName(r.businessId)), node('td', { class: 'row-money' }, rupiah(r.price)), node('td', {}, String(r.stock), r.stock === 0 ? node('small', {}, 'Stok habis') : null), node('td', {}, node('div', { class: 'row-actions' }, button('Edit', () => editProduct(r)), button('Hapus', () => deleteRow('products', r))))));
    }
    table.append(tbody);
    return node('section', { class: 'panel' }, heading, rows.length ? node('div', { class: 'table-wrap' }, table) : empty('Produk pertama, langkah berikutnya', 'Pilih bisnis, lalu tambahkan produk dan stok awalnya.'));
}
function exportReport(report) {
    const businesses = state.selected === 'all' ? state.data.businesses : [currentBusiness()];
    const blob = new Blob([exportMonthlyReport(report, currentBusiness()?.name || 'Semua bisnis', businesses, state.data.products)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = node('a', { href: url, download: `Karsa-Laporan-Bulanan-${state.month}.csv` });
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function driverPanel(report, type) {
    const expense = type === 'expense', rows = expense ? report.expenseDrivers : report.incomeDrivers;
    const title = expense ? 'Apa yang mengubah biaya?' : 'Apa yang mengubah pemasukan?';
    const subtitle = expense ? 'Kategori dengan perubahan nominal terbesar' : 'Perubahan pemasukan menurut kategori';
    if (!report.comparable) return panel(title, subtitle, empty('Belum cukup catatan untuk membandingkan', 'Lengkapi catatan pada kedua periode agar penyebab perubahan dapat terlihat.'));
    const changed = rows.filter(r => r.delta !== 0);
    if (!changed.length) return panel(title, subtitle, empty('Nominal kategori tetap', 'Tidak ada perubahan nominal pada kategori yang tercatat.'));
    return panel(title, subtitle, node('div', {}, node('div', { class: 'driver-list' }, ...changed.slice(0, 3).map(r => {
        const favorable = expense ? r.delta < 0 : r.delta > 0;
        return node('div', { class: 'driver-item' }, node('span', { class: `driver-icon ${expense ? 'cost' : ''}`, 'aria-hidden': 'true' }, r.delta > 0 ? '↑' : '↓'),
            node('div', {}, node('h3', {}, button(r.label + ' ↗', () => openCategory(r.label, expense ? 'EXPENSE' : 'INCOME'))), node('p', {}, `${rupiah(r.previous)} → ${rupiah(r.current)}`)),
            node('strong', { class: favorable ? 'positive' : 'negative' }, changeLabel(r.delta)));
    })), node('p', { class: 'panel-note' }, expense ? 'Cocokkan perubahan biaya terbesar dengan kebutuhan usaha dan catatan pembeliannya.' : 'Buka catatan kategori yang berubah untuk melihat transaksi yang membentuk pemasukan.')));
}
function comparisonTable(headers, rows) {
    return node('div', { class: 'table-wrap' }, node('table', {}, node('thead', {}, node('tr', {}, ...headers.map(x => node('th', { scope: 'col' }, x)))), node('tbody', {}, ...rows)));
}
function expenseChanges(report) {
    const rows = report.expenseDrivers;
    return panel('Perubahan pengeluaran', 'Semua kategori, termasuk biaya yang baru muncul atau sudah berhenti tercatat', rows.length ? comparisonTable(
        ['Kategori', 'Sebelumnya', 'Periode ini', 'Perubahan'], rows.map(r => node('tr', {}, node('th', { scope: 'row' }, button(r.label + ' ↗', () => openCategory(r.label, 'EXPENSE'))), node('td', { class: 'row-money' }, rupiah(r.previous)), node('td', { class: 'row-money' }, rupiah(r.current)),
            node('td', { class: `row-money ${!report.comparable || r.delta === 0 ? '' : r.delta < 0 ? 'positive' : 'negative'}` }, report.comparable ? changeLabel(r.delta) : 'Perbandingan belum tersedia')))) : empty('Belum ada biaya tercatat', 'Kategori pengeluaran muncul setelah transaksi disinkronkan.'));
}
function businessReport(report) {
    const businesses = state.selected === 'all' ? state.data.businesses : [currentBusiness()];
    const rows = businessComparisons(report, businesses);
    return panel(state.selected === 'all' ? 'Bisnis mana yang paling sehat?' : 'Hasil bisnis pada periode ini', 'Diurutkan berdasarkan laba dari uang masuk dan keluar yang tercatat', comparisonTable(
        ['Bisnis', 'Masuk', 'Keluar', 'Laba', 'Perubahan laba'], rows.map(r => node('tr', {}, node('td', {}, state.selected === 'all' ? button(r.name + ' ↗', () => { state.selected = r.id; render(); }) : r.name,
            node('small', {}, `${r.current.count} transaksi`)), node('td', { class: 'row-money' }, rupiah(r.current.income)), node('td', { class: 'row-money' }, rupiah(r.current.expense)),
            node('td', { class: `row-money ${r.current.profit < 0 ? 'negative' : 'positive'}` }, rupiah(r.current.profit)), node('td', { class: 'row-money' }, r.comparable ? changeLabel(r.delta) : 'Perbandingan belum tersedia')))));
}
function productReport(report) {
    const rows = productRevenue(report.currentRows, state.data.products);
    const income = report.current.income, linked = rows.reduce((sum, r) => sum + r.amount, 0);
    const coverage = income > 0 ? linked / income * 100 : 0;
    return panel('Produk penyumbang omzet terbesar', 'Lima produk dengan pemasukan tertinggi dari penjualan yang terhubung', rows.length ? node('div', {}, comparisonTable(
        ['Produk / bisnis', 'Terjual', 'Omzet', 'Porsi pemasukan'], rows.slice(0, 5).map(r => node('tr', {}, node('td', {}, r.name, node('small', {}, businessName(r.businessId))), node('td', {}, String(r.quantity)),
            node('td', { class: 'row-money' }, rupiah(r.amount)), node('td', {}, `${income > 0 ? (r.amount / income * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 }) : '0'}%`)))),
        node('p', { class: 'panel-note' }, `${coverage.toLocaleString('id-ID', { maximumFractionDigits: 1 })}% pemasukan terhubung ke produk. Omzet produk belum menunjukkan laba karena harga modal/HPP belum dicatat.`)) : empty('Belum ada penjualan produk yang terhubung', 'Pilih produk saat mencatat pemasukan agar kontribusi omzetnya dapat terlihat.'));
}
function analytics() {
    const report = reportForScope();
    return node('div', { class: 'monthly-report' }, reportHero(report), metrics(report.currentRows, report),
        panel('Bagaimana laba berubah?', 'Perubahan pemasukan dikurangi perubahan pengeluaran', report.comparable ? node('div', { class: 'profit-equation' },
            ...[['Laba sebelumnya', report.previous.profit], ['Perubahan pemasukan', report.deltas.income.amount], ['Dampak perubahan biaya', -report.deltas.expense.amount], ['Laba periode ini', report.current.profit]].map(([label, amount], i) =>
                node('div', { class: i === 3 ? 'equation-result' : '' }, node('span', {}, label), node('strong', { class: amount < 0 ? 'negative' : '' }, rupiah(amount))))) : empty('Perubahan laba belum dapat disimpulkan', 'Laporan membutuhkan catatan pada periode ini dan periode pembanding.')),
        node('div', { class: 'section-grid driver-grid' }, driverPanel(report, 'income'), driverPanel(report, 'expense')),
        node('div', { class: 'full-panel' }, expenseChanges(report)),
        node('div', { class: 'full-panel' }, businessReport(report)),
        node('div', { class: 'section-grid' }, panel('Arah usaha enam bulan', 'Grafik memakai seluruh catatan pada masing-masing bulan', chart()), productReport(report)),
        node('p', { class: 'report-footnote' }, 'Laporan berdasarkan transaksi yang sudah tercatat dan disinkronkan. Laba adalah selisih pemasukan dan pengeluaran tercatat; belum memperhitungkan penyusutan, piutang, atau persediaan.'));
}
function switchTab(tab) { state.tab = tab; state.search = ''; state.category = null; render(); }
function render() { if (!state.data)
    return; const b = currentBusiness(); $('business-select').replaceChildren(node('option', { value: 'all' }, 'Semua bisnis'), ...state.data.businesses.map(b => node('option', { value: b.id }, b.name))); $('business-select').value = state.selected; $('workspace-name').textContent = (b?.name || 'SEMUA BISNIS').toLocaleUpperCase('id-ID'); $('page-title').textContent = labels[state.tab][0]; $('page-description').textContent = labels[state.tab][1]; $('plan-usage').textContent = `${state.data.businesses.length} dari 5 bisnis terpakai`; $('plan-expiry').textContent = `Aktif sampai ${new Date(state.data.account.premiumUntil).toLocaleDateString('id-ID')}`; $('user-name').textContent = state.user.displayName || state.user.email.split('@')[0]; $('user-email').textContent = state.user.email; $('avatar').textContent = ($('user-name').textContent || 'K').slice(0, 1).toLocaleUpperCase('id-ID'); $('new-business').disabled = state.data.businesses.length >= 5; $('edit-business').hidden = !b; document.querySelectorAll('[data-tab]').forEach(e => { e.classList.toggle('active', e.dataset.tab === state.tab); e.setAttribute('aria-current', e.dataset.tab === state.tab ? 'page' : 'false'); }); const view = { overview, transactions, products, analytics }; $('page-content').replaceChildren(view[state.tab]()); }
function input(name, label, type = 'text', value = '', attrs = {}) { const element = node(type === 'textarea' ? 'textarea' : 'input', { name, ...(type === 'textarea' ? {} : { type }), ...attrs }); element.value = value; return node('label', {}, label, element); }
function select(name, label, options, value) { const element = node('select', { name }, ...options.map(([id, label]) => node('option', { value: id }, label))); element.value = value; return node('label', {}, label, element); }
function openEditor(title, fields, action, label = 'Simpan') { $('editor-title').textContent = title; $('editor-fields').replaceChildren(...fields); $('editor-error').textContent = ''; $('save-editor').textContent = label; saveAction = action; $('editor').showModal(); }
function requireBusiness() { const b = currentBusiness(); if (!b) {
    notice('Pilih satu bisnis di menu Bisnis aktif terlebih dahulu.', true);
    $('business-select').focus();
} return b; }
function editBusiness(creating = false) { const b = creating ? null : requireBusiness(); if (!creating && !b)
    return; openEditor(creating ? 'Tambah bisnis' : 'Atur bisnis', [input('name', 'Nama bisnis', 'text', b?.name || '', { required: '', maxlength: 80, minlength: 2 }), input('type', 'Jenis usaha', 'text', b?.type || 'Lainnya', { required: '', maxlength: 40 }), input('initialCapital', 'Modal awal (Rp)', 'number', b?.initialCapital || 0, { min: 0, max: 9007199254740991, step: 1, required: '' })], async (values) => { const payload = { name: values.name.trim(), type: values.type.trim(), initialCapital: Number(values.initialCapital), ...(b ? { expectedUpdatedAt: b.updatedAt } : {}) }; const result = await api(b ? `/v2/businesses/${b.id}` : '/v2/businesses', b ? 'PUT' : 'POST', payload); if (b)
    state.data = result;
else {
    state.selected = result.business.id;
    state.loading = false;
    await load(true);
} }); }
function editProduct(row) { const b = row ? state.data.businesses.find(b => b.id === row.businessId) : requireBusiness(); if (!b)
    return; openEditor(row ? 'Edit produk' : 'Tambah produk', [input('name', 'Nama produk', 'text', row?.name || '', { required: '', maxlength: 80 }), node('div', { class: 'field-row' }, input('price', 'Harga (Rp)', 'number', row?.price || 0, { min: 0, max: 9007199254740991, step: 1, required: '' }), input('stock', 'Stok tersedia', 'number', row?.stock || 0, { min: 0, max: 9007199254740991, step: 1, required: '' }))], async (values) => { state.data = await api(`/v2/web/businesses/${b.id}/products`, 'POST', { name: values.name.trim(), price: Number(values.price), stock: Number(values.stock), ...(row ? { id: row.id, expectedUpdatedAt: row.updatedAt } : {}) }); }); }
function localDate(time) { const d = new Date(time); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function editTransaction(row) {
    const b = row ? state.data.businesses.find(b => b.id === row.businessId) : requireBusiness();
    if (!b)
        return;
    const list = live(state.data.products).filter(p => p.businessId === b.id);
    openEditor(row ? 'Edit transaksi' : 'Catat transaksi', [node('div', { class: 'field-row' }, select('type', 'Jenis transaksi', [['INCOME', 'Pemasukan'], ['EXPENSE', 'Pengeluaran']], row?.type || 'INCOME'), input('date', 'Tanggal', 'date', localDate(row?.transactionDate || Date.now()), { required: '' })), input('amount', 'Nominal (Rp)', 'number', row?.amount || '', { min: 1, max: 9007199254740991, step: 1, required: '' }), node('div', { class: 'field-row' }, input('category', 'Kategori', 'text', row?.category || 'Penjualan', { required: '', maxlength: 60 }), select('paymentMethod', 'Pembayaran', [['Tunai', 'Tunai'], ['QRIS', 'QRIS'], ['Transfer', 'Transfer']], row?.paymentMethod || 'Tunai')), node('div', { class: 'field-row' }, select('productId', 'Produk (opsional)', [['', 'Tanpa produk'], ...list.map(p => [p.id, `${p.name} · stok ${p.stock}`])], row?.productId || ''), input('quantity', 'Jumlah produk', 'number', row?.quantity || 1, { min: 1, max: 2147483647, step: 1, required: '' })), input('note', 'Catatan', 'textarea', row?.note || '', { maxlength: 120 })], async (values) => { const productId = values.type === 'INCOME' && values.productId ? values.productId : null; state.data = await api(`/v2/web/businesses/${b.id}/transactions`, 'POST', { type: values.type, amount: Number(values.amount), category: values.category.trim(), paymentMethod: values.paymentMethod, note: values.note.trim(), transactionDate: new Date(`${values.date}T12:00:00`).getTime(), productId, quantity: productId ? Number(values.quantity) : null, ...(row ? { id: row.id, expectedUpdatedAt: row.updatedAt } : {}) }); });
    const form = $('editor-form');
    function productChanged() { const expense = form.elements.type.value === 'EXPENSE'; if (expense)
        form.elements.productId.value = ''; form.elements.productId.disabled = expense; const p = list.find(p => p.id === form.elements.productId.value); form.elements.quantity.disabled = !p; form.elements.amount.disabled = Boolean(p); if (p)
        form.elements.amount.value = p.price * Number(form.elements.quantity.value || 1); }
    form.elements.type.addEventListener('change', productChanged);
    form.elements.productId.addEventListener('change', productChanged);
    form.elements.quantity.addEventListener('input', productChanged);
    productChanged();
}
function deleteRow(kind, row) { openEditor(kind === 'products' ? 'Hapus produk?' : 'Hapus transaksi?', [node('p', {}, kind === 'products' ? `Produk “${row.name}” akan dihapus dari katalog. Riwayat penjualannya tetap tersimpan.` : 'Transaksi dihapus dari laporan. Stok produk yang terkait akan dikembalikan.')], async () => { state.data = await api(`/v2/web/businesses/${row.businessId}/${kind}/${row.id}`, 'DELETE', { expectedUpdatedAt: row.updatedAt }); }, 'Ya, hapus'); }
$('editor-form').addEventListener('submit', async (event) => { event.preventDefault(); if (saving)
    return; saving = true; $('save-editor').disabled = true; $('cancel-editor').disabled = true; $('close-editor').disabled = true; try {
    const values = Object.fromEntries(new FormData(event.target));
    const amount = event.target.elements.amount;
    if (amount?.disabled)
        values.amount = amount.value;
    await saveAction(values);
    $('editor').close();
    render();
    notice('Perubahan tersimpan. Sinkronkan HP untuk mengambilnya.');
}
catch (error) {
    $('editor-error').textContent = errorMessage(error);
    if (error.code === 'PREMIUM_REQUIRED') {
        $('editor').close();
        lockDashboard(error.message);
    }
    if (error.code === 'STALE_RECORD')
        notice('Muat ulang dashboard untuk mengambil perubahan terbaru.', true);
}
finally {
    saving = false;
    $('save-editor').disabled = false;
    $('cancel-editor').disabled = false;
    $('close-editor').disabled = false;
} });
$('editor').addEventListener('cancel', event => { if (saving)
    event.preventDefault(); });
$('close-editor').onclick = $('cancel-editor').onclick = () => { if (!saving)
    $('editor').close(); };
$('business-select').onchange = event => { state.selected = event.target.value; state.search = ''; state.category = null; render(); };
$('month').value = state.month;
$('month').onchange = event => { if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(event.target.value))
    return; state.month = event.target.value; state.category = null; render(); };
document.querySelectorAll('[data-tab]').forEach(e => e.onclick = () => switchTab(e.dataset.tab));
$('refresh').onclick = () => load();
$('check-premium').onclick = () => load();
$('new-business').onclick = () => editBusiness(true);
$('edit-business').onclick = () => editBusiness();
async function logout() { if (auth) {
    await sdk.signOut(auth);
    state.data = null;
    state.selected = 'all';
    state.tab = 'overview';
    state.category = null;
    $('page-content').replaceChildren();
    show('login');
} }
$('logout').onclick = $('gate-logout').onclick = logout;
async function initialize() {
    try {
        const response = await fetch('/web-config', { cache: 'no-store' });
        if (!response.ok)
            throw new Error('Dashboard belum dikonfigurasi. Hubungi pengelola.');
        const config = await response.json();
        const { initializeApp } = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js');
        sdk = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js');
        auth = sdk.getAuth(initializeApp(config));
        await sdk.setPersistence(auth, sdk.browserSessionPersistence);
        $('google-login').disabled = false;
        $('login-form').querySelector('button').disabled = false;
        sdk.onAuthStateChanged(auth, async (user) => {
            authGeneration++;
            state.loading = false;
            state.user = user;
            state.data = null;
            $('page-content').replaceChildren();
            if ($('editor').open) $('editor').close();
            if (!user) {
            state.data = null;
            show('login');
            return;
        } if (!user.emailVerified || !user.email?.toLowerCase().endsWith('@students.untidar.ac.id')) {
            await sdk.signOut(auth);
            $('auth-error').textContent = 'Gunakan email @students.untidar.ac.id yang sudah diverifikasi.';
            return;
        }
        $('gate-message').textContent = 'Memeriksa akses akun…';
        show('gate');
        await load(true); });
        // Firebase restores the session from the full-page Google callback.
        await sdk.getRedirectResult(auth);
    }
    catch (error) {
        $('auth-error').textContent = errorMessage(error);
    }
}
$('login-form').onsubmit = async (event) => { event.preventDefault(); const submit = event.target.querySelector('button'); submit.disabled = true; $('auth-error').textContent = ''; try {
    await sdk.signInWithEmailAndPassword(auth, event.target.elements.email.value.trim(), event.target.elements.password.value);
    event.target.elements.password.value = '';
}
catch (error) {
    $('auth-error').textContent = errorMessage(error);
}
finally {
    submit.disabled = false;
} };
async function signInGoogle() {
    if (!auth || $('google-login').disabled) return;
    $('auth-error').textContent = '';
    $('google-login').disabled = true;
    $('google-login').textContent = 'Membuka Google…';
    try {
        await sdk.signInWithRedirect(auth, new sdk.GoogleAuthProvider());
    } catch (error) {
        $('auth-error').textContent = errorMessage(error);
        $('google-login').disabled = false;
        $('google-login').textContent = 'Masuk dengan Google';
    }
}
$('google-login').onclick = signInGoogle;
$('reset-password').onclick = async () => { if (!auth)
    return; const email = $('login-form').elements.email.value.trim(); if (!email) {
    $('auth-error').textContent = 'Isi email dahulu untuk mengirim tautan pemulihan.';
    return;
} try {
    await sdk.sendPasswordResetEmail(auth, email);
    notice('Jika email terdaftar, periksa pesan pemulihan kata sandi.');
}
catch (error) {
    $('auth-error').textContent = errorMessage(error);
} };
setInterval(() => { if (state.user && !$('editor').open && !document.hidden)
    load(true); }, 60000);
await initialize();
