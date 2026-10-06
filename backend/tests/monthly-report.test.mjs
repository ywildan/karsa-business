import assert from 'node:assert/strict';
import { test } from 'node:test';
import { monthlyReport, businessComparisons, productRevenue, exportMonthlyReport } from '../public/monthly-report.mjs';
const now = new Date(2026, 9, 6, 11);
const tx = (type, amount, month, day, extra = {}) => ({ type, amount, businessId: 'a', category: 'Penjualan', transactionDate: new Date(2026, month - 1, day, 12).getTime(), deletedAt: null, ...extra });
const business = [{id:'a',name:'Kopi Sore'},{id:'b',name:'Studio Kecil'}];
test('current month compares equivalent days, includes today and excludes future/deleted records', () => {
    const report = monthlyReport([
        tx('INCOME', 95000, 10, 6), tx('EXPENSE', 75000, 10, 1),
        tx('INCOME', 999999, 10, 7), tx('INCOME', 999999, 10, 1, {deletedAt:1}),
        tx('INCOME', 110000, 9, 6), tx('EXPENSE', 80000, 9, 1), tx('INCOME', 999999, 9, 7),
    ], '2026-10', now);
    assert.equal(report.partial, true); assert.equal(report.comparable, true);
    assert.equal(report.current.profit, 20000); assert.equal(report.previous.profit, 30000);
    assert.equal(report.deltas.profit.amount, -10000);
    assert.equal(report.deltas.profit.amount, report.deltas.income.amount - report.deltas.expense.amount);
    assert.ok(report.currentRange.includes('6 Okt')); assert.ok(report.previousRange.includes('6 Sep'));
});
test('completed months compare complete months across a year boundary', () => {
    const rows = [{...tx('INCOME', 80, 1, 31), transactionDate:new Date(2026, 0, 31).getTime()},
        {...tx('INCOME', 100, 1, 31),transactionDate:new Date(2025, 11, 31).getTime()}];
    const report = monthlyReport(rows, '2026-01', now);
    assert.equal(report.partial, false); assert.equal(report.previousMonth, '2025-12');
    assert.equal(report.current.income, 80); assert.equal(report.previous.income, 100);
    assert.equal(report.deltas.income.percent, -20);
});
test('short comparison month clamps the last day and respects leap years', () => {
    const rows = [{...tx('INCOME', 20, 3, 30),transactionDate:new Date(2024, 2, 30).getTime()},
        {...tx('INCOME', 10, 2, 28),transactionDate:new Date(2024, 1, 29, 23, 59).getTime()}];
    const report = monthlyReport(rows, '2024-03', new Date(2024, 2, 30));
    assert.equal(report.previous.income, 10);assert.ok(report.previousRange.includes('29 Feb'));
});
test('missing history and zero or negative bases never create misleading percentage growth', () => {
    const initial = monthlyReport([tx('INCOME', 100, 10, 1)], '2026-10', now);
    assert.equal(initial.comparable, false); assert.equal(initial.deltas.income.percent, null);
    const loss = monthlyReport([tx('EXPENSE',100,9,1),tx('INCOME',50,10,1)], '2026-10', now);
    assert.equal(loss.comparable, true);assert.equal(loss.deltas.profit.amount, 150);
    assert.equal(loss.deltas.profit.percent, null);assert.equal(loss.deltas.income.percent, null);
    const missingCurrent = monthlyReport([tx('INCOME',100,9,1)], '2026-10', now);
    assert.equal(missingCurrent.comparable, false);
});
test('future periods do not interpret scheduled transactions as current performance', () => {
    const report = monthlyReport([tx('INCOME',100,11,1),tx('INCOME',100,10,1)], '2026-11', now);
    assert.equal(report.future, true);assert.equal(report.comparable, false);
    assert.equal(report.current.count, 0);assert.equal(report.previous.count, 0);
    for (const month of ['2026-00','2026-13','wrong']) assert.throws(()=>monthlyReport([],month,now),RangeError);
});
test('category changes include new/discontinued costs and explain the exact expense delta', () => {
    const report = monthlyReport([
        tx('EXPENSE',100,9,1,{category:'Bahan baku'}),tx('EXPENSE',50,9,1,{category:'Sewa'}),
        tx('EXPENSE',160,10,1,{category:'Bahan baku'}),tx('EXPENSE',20,10,1,{category:'Pengiriman'}),
    ], '2026-10', now);
    assert.deepEqual(report.expenseDrivers.map(r=>[r.label,r.delta]),[['Bahan baku',60],['Sewa',-50],['Pengiriman',20]]);
    assert.equal(report.expenseDrivers.reduce((sum,r)=>sum+r.delta,0),report.deltas.expense.amount);
});
test('business comparisons retain empty businesses and reconcile with the scoped totals', () => {
    const report = monthlyReport([tx('INCOME',100,9,1),tx('INCOME',120,10,1),tx('EXPENSE',50,10,1,{businessId:'b'})], '2026-10', now);
    const result = businessComparisons(report, [...business,{id:'empty',name:'Baru'}]);
    assert.equal(result.reduce((sum,b)=>sum+b.current.profit,0), report.current.profit);
    assert.equal(result.find(b=>b.id==='b').comparable,false);
    assert.equal(result.find(b=>b.id==='empty').current.count,0);
    assert.equal(result.find(b=>b.id==='a').delta,20);assert.equal(result.at(-1).id,'empty');
});
test('product contribution ranks actual revenue and does not substitute current prices or infer profit', () => {
    const rows=[tx('INCOME',100,10,1,{productId:'p',quantity:10}),tx('INCOME',500,10,1,{productId:'q',quantity:1}),tx('INCOME',50,10,1),tx('INCOME',99999,10,1,{productId:'p',quantity:100,deletedAt:1})];
    const result=productRevenue(rows,[{id:'p',businessId:'a',name:'Kopi',price:9999}]);
    assert.equal(result[0].id,'q');assert.equal(result[0].name,'Produk dihapus');
    assert.equal(result[1].amount,100);assert.equal(result[1].name,'Kopi');assert.equal('profit' in result[1],false);
});
test('monthly CSV includes the compared periods, attribution and safely quoted user text', () => {
    const report=monthlyReport([tx('INCOME',100,9,1),tx('EXPENSE',25,10,1,{category:'=SUM(1,2)'})],'2026-10',now);
    const csv=exportMonthlyReport(report,'=BUSINESS()',business,[]);
    assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes(report.currentRange));assert.ok(csv.includes(report.previousRange));
    assert.ok(csv.includes('"\'=SUM(1,2)"'));assert.ok(csv.includes('"\'=BUSINESS()"'));assert.ok(csv.includes('Perubahan laba (Rp)'));
    assert.ok(csv.includes('\"Laba\",\"-25\",\"100\",\"-125\",\"-125\"'));
});
