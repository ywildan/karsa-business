package com.ywldan.karsabusiness.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowDownward
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.Insights
import androidx.compose.material.icons.rounded.NotificationsNone
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import com.ywldan.karsabusiness.ui.components.BusinessPicker
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ywldan.karsabusiness.data.local.TransactionEntity
import com.ywldan.karsabusiness.data.local.TransactionType
import com.ywldan.karsabusiness.ui.MainTab
import com.ywldan.karsabusiness.ui.MainUiState
import com.ywldan.karsabusiness.ui.components.EmptyState
import com.ywldan.karsabusiness.ui.components.SectionHeader
import com.ywldan.karsabusiness.ui.components.rupiah
import com.ywldan.karsabusiness.ui.theme.Blush
import com.ywldan.karsabusiness.ui.theme.Coral
import com.ywldan.karsabusiness.ui.theme.Forest
import com.ywldan.karsabusiness.ui.theme.Karsa
import com.ywldan.karsabusiness.ui.theme.Lime
import com.ywldan.karsabusiness.ui.theme.Mint
import com.ywldan.karsabusiness.ui.theme.Muted
import java.time.Instant
import java.time.ZoneId
import java.time.YearMonth

@Composable
fun HomeScreen(
    state: MainUiState,
    padding: PaddingValues,
    onTab: (MainTab) -> Unit,
    onAdd: (TransactionEntity?) -> Unit,
    onBusiness: () -> Unit,
) {
    val currentMonth = YearMonth.now()
    val monthlyTransactions = state.transactions.filter { transaction ->
        val date = Instant.ofEpochMilli(transaction.transactionDate)
            .atZone(ZoneId.systemDefault())
            .toLocalDate()
        YearMonth.from(date) == currentMonth
    }
    val monthlyIncome = monthlyTransactions
        .filter { it.type == TransactionType.INCOME }
        .sumOf { it.amount }
    val monthlyExpense = monthlyTransactions
        .filter { it.type == TransactionType.EXPENSE }
        .sumOf { it.amount }
    val monthlyProfit = monthlyIncome - monthlyExpense
    val monthlyMargin = if (monthlyIncome > 0) {
        monthlyProfit.toDouble() / monthlyIncome * 100
    } else {
        0.0
    }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = 20.dp,
            end = 20.dp,
            top = padding.calculateTopPadding() + 30.dp,
            bottom = padding.calculateBottomPadding() + 90.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Halo, ${state.user?.name?.substringBefore(' ') ?: "Kawan"}!", style = MaterialTheme.typography.headlineMedium)
                    BusinessPicker(state.business?.name.orEmpty(), onBusiness, Modifier.padding(top = 6.dp), enabled = !state.busy)
                }
                IconButton(onClick = {}) {
                    Icon(Icons.Rounded.NotificationsNone, "Notifikasi", tint = Forest)
                }
            }
        }
        item {
            Column(
                Modifier.fillMaxWidth().background(Forest, RoundedCornerShape(28.dp)).padding(22.dp),
            ) {
                Text("SALDO KAS", color = Color.White.copy(alpha = .65f), style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold)
                Text(rupiah(state.summary.balance), Modifier.padding(top = 6.dp), color = Color.White, style = MaterialTheme.typography.headlineLarge)
                Row(Modifier.fillMaxWidth().padding(top = 22.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    BalanceMini("Pemasukan", state.summary.income, Icons.Rounded.ArrowDownward, Lime, Modifier.weight(1f))
                    BalanceMini("Pengeluaran", state.summary.expense, Icons.Rounded.ArrowUpward, Coral, Modifier.weight(1f))
                }
            }
        }
        item {
            Column {
                SectionHeader("Insight bulan ini", "Lihat laporan") { onTab(MainTab.REPORTS) }
                Column(
                    Modifier
                        .fillMaxWidth()
                        .padding(top = 12.dp)
                        .background(Color.White, RoundedCornerShape(24.dp))
                        .clickable { onTab(MainTab.REPORTS) }
                        .padding(18.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            Modifier.size(44.dp).background(Mint, RoundedCornerShape(14.dp)),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(Icons.Rounded.Insights, null, tint = Forest)
                        }
                        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                            Text("Laba bersih", color = Muted, style = MaterialTheme.typography.bodySmall)
                            Text(
                                rupiah(monthlyProfit),
                                color = if (monthlyProfit >= 0) Karsa else Coral,
                                fontWeight = FontWeight.ExtraBold,
                                style = MaterialTheme.typography.titleLarge,
                            )
                        }
                        Icon(Icons.Rounded.ChevronRight, "Buka laporan", tint = Forest)
                    }
                    Row(
                        Modifier.fillMaxWidth().padding(top = 16.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        InsightMetric("Margin", "${"%.1f".format(monthlyMargin)}%", Modifier.weight(1f))
                        InsightMetric("Transaksi", monthlyTransactions.size.toString(), Modifier.weight(1f))
                    }
                    Text(
                        when {
                            monthlyTransactions.isEmpty() -> "Mulai catat transaksi agar kondisi usahamu dapat terbaca."
                            monthlyProfit > 0 -> "Usahamu menghasilkan laba bulan ini. Pertahankan pengeluaran tetap terkendali."
                            else -> "Pengeluaran masih menyamai atau melebihi pemasukan. Cek biaya terbesar di laporan."
                        },
                        Modifier.padding(top = 14.dp),
                        color = Muted,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
        item {
            Row(
                Modifier.fillMaxWidth().background(Mint, RoundedCornerShape(22.dp)).padding(18.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.size(44.dp).background(Lime, CircleShape), contentAlignment = Alignment.Center) {
                    Text("${state.transactions.size}", fontWeight = FontWeight.ExtraBold, color = Forest)
                }
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    Text("Catatan usaha makin rapi", fontWeight = FontWeight.Bold)
                    Text("Terus catat setiap transaksi hari ini.", color = Muted, style = MaterialTheme.typography.bodySmall)
                }
                Icon(Icons.Rounded.ChevronRight, null, tint = Forest)
            }
        }
        item { SectionHeader("Transaksi terbaru", "Lihat semua") { onTab(MainTab.HISTORY) } }
        if (state.transactions.isEmpty()) {
            item { EmptyState("Belum ada transaksi", "Tekan tombol + untuk mencatat transaksi pertama.") }
        } else {
            items(state.transactions.take(5), key = { it.id }) { transaction ->
                TransactionRow(transaction, onClick = { onAdd(transaction) })
            }
        }
    }
}

@Composable
private fun BalanceMini(label: String, amount: Long, icon: ImageVector, tint: Color, modifier: Modifier) {
    Row(modifier.background(Color.White.copy(alpha = .08f), RoundedCornerShape(16.dp)).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(30.dp).background(tint.copy(alpha = .2f), CircleShape), contentAlignment = Alignment.Center) {
            Icon(icon, null, Modifier.size(17.dp), tint = tint)
        }
        Column(Modifier.padding(start = 8.dp)) {
            Text(label, color = Color.White.copy(alpha = .6f), style = MaterialTheme.typography.bodySmall)
            Text(rupiah(amount), color = Color.White, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun InsightMetric(label: String, value: String, modifier: Modifier) {
    Column(
        modifier.background(Mint.copy(alpha = .55f), RoundedCornerShape(16.dp)).padding(12.dp),
    ) {
        Text(label, color = Muted, style = MaterialTheme.typography.bodySmall)
        Text(value, Modifier.padding(top = 2.dp), color = Forest, fontWeight = FontWeight.ExtraBold)
    }
}

@Composable
fun TransactionRow(transaction: TransactionEntity, onClick: () -> Unit) {
    val income = transaction.type == TransactionType.INCOME
    Row(
        Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(20.dp)).clickable(onClick = onClick).padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(44.dp).background(if (income) Mint else Blush, RoundedCornerShape(14.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(if (income) Icons.Rounded.ArrowDownward else Icons.Rounded.ArrowUpward, null, tint = if (income) Karsa else Coral)
        }
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Text(transaction.category, fontWeight = FontWeight.Bold)
            Text(transaction.note.ifBlank { transaction.paymentMethod }, color = Muted, style = MaterialTheme.typography.bodySmall, maxLines = 1)
        }
        Text(
            (if (income) "+" else "−") + rupiah(transaction.amount),
            color = if (income) Karsa else Coral,
            fontWeight = FontWeight.ExtraBold,
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}
