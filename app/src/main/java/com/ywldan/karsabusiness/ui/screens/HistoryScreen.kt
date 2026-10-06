package com.ywldan.karsabusiness.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowDownward
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.TrendingDown
import androidx.compose.material.icons.rounded.TrendingUp
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ywldan.karsabusiness.data.local.TransactionEntity
import com.ywldan.karsabusiness.data.local.TransactionType
import com.ywldan.karsabusiness.ui.MainUiState
import com.ywldan.karsabusiness.ui.components.EmptyState
import com.ywldan.karsabusiness.ui.components.rupiah
import com.ywldan.karsabusiness.ui.theme.Blush
import com.ywldan.karsabusiness.ui.theme.Card
import com.ywldan.karsabusiness.ui.theme.Coral
import com.ywldan.karsabusiness.ui.theme.Cream
import com.ywldan.karsabusiness.ui.theme.Forest
import com.ywldan.karsabusiness.ui.theme.Ink
import com.ywldan.karsabusiness.ui.theme.Lime
import com.ywldan.karsabusiness.ui.theme.Mint
import com.ywldan.karsabusiness.ui.theme.Muted
import com.ywldan.karsabusiness.ui.theme.OnBlush
import com.ywldan.karsabusiness.ui.theme.OnMint
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.roundToInt

private enum class HistoryFilter { ALL, INCOME, EXPENSE }

@Composable
fun HistoryScreen(state: MainUiState, padding: PaddingValues, onEdit: (TransactionEntity?) -> Unit) {
    var search by remember { mutableStateOf("") }
    var filter by remember { mutableStateOf(HistoryFilter.ALL) }
    val visible = state.transactions.filter { tx ->
        (filter == HistoryFilter.ALL || (filter == HistoryFilter.INCOME && tx.type == TransactionType.INCOME) ||
            (filter == HistoryFilter.EXPENSE && tx.type == TransactionType.EXPENSE)) &&
            (search.isBlank() || tx.category.contains(search, true) || tx.note.contains(search, true))
    }
    val grouped = visible.groupBy { dayLabel(it.transactionDate) }

    LazyColumn(
        Modifier.fillMaxSize().background(Cream),
        contentPadding = PaddingValues(
            start = 20.dp,
            end = 20.dp,
            top = padding.calculateTopPadding() + 28.dp,
            bottom = padding.calculateBottomPadding() + 90.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Text("Riwayat transaksi", style = MaterialTheme.typography.headlineLarge)
        }
        item {
            OutlinedTextField(
                search,
                { search = it },
                Modifier.fillMaxWidth().padding(top = 10.dp),
                placeholder = { Text("Cari kategori atau catatan") },
                leadingIcon = { Icon(Icons.Rounded.Search, null) },
                shape = RoundedCornerShape(18.dp),
                singleLine = true,
            )
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip("Semua", filter == HistoryFilter.ALL) { filter = HistoryFilter.ALL }
                FilterChip("Pemasukan", filter == HistoryFilter.INCOME) { filter = HistoryFilter.INCOME }
                FilterChip("Pengeluaran", filter == HistoryFilter.EXPENSE) { filter = HistoryFilter.EXPENSE }
            }
        }
        item { HistorySummaryCard(visible, filter) }
        if (visible.isEmpty()) {
            item { EmptyState("Transaksi tidak ditemukan", "Ubah pencarian atau catat transaksi baru.") }
        } else {
            grouped.forEach { (day, transactions) ->
                item { Text(day, Modifier.padding(top = 8.dp), fontWeight = FontWeight.ExtraBold, color = Ink) }
                items(transactions, key = { it.id }) { transaction ->
                    TransactionRow(transaction) { onEdit(transaction) }
                }
            }
        }
    }
}

@Composable
private fun FilterChip(label: String, selected: Boolean, onClick: () -> Unit) {
    Text(
        label,
        Modifier.background(if (selected) Forest else Card, RoundedCornerShape(100.dp))
            .clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 10.dp),
        color = if (selected) Color.White else Muted,
        style = MaterialTheme.typography.bodySmall,
        fontWeight = FontWeight.Bold,
    )
}

/**
 * Ringkasan kartu untuk hasil transaksi yang sedang tampil di layar.
 * Angka dihitung dari [visible] supaya selalu sinkron dengan daftar dan filter aktif,
 * bukan dari total sepanjang waktu.
 */
@Composable
private fun HistorySummaryCard(visible: List<TransactionEntity>, filter: HistoryFilter) {
    val income = visible.filter { it.type == TransactionType.INCOME }.sumOf { it.amount }
    val expense = visible.filter { it.type == TransactionType.EXPENSE }.sumOf { it.amount }
    val profit = income - expense
    HistorySummary(income, expense, profit, visible.size, filter)
}

@Composable
private fun HistorySummary(income: Long, expense: Long, profit: Long, count: Int, filter: HistoryFilter) {
    val positive = profit >= 0L
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Ringkasan", color = Ink, fontWeight = FontWeight.Bold, fontSize = 14.sp)
            Spacer(Modifier.weight(1f))
            Text("$count transaksi", color = Muted, fontSize = 12.sp)
        }
        // Stack on narrow screens or with large accessibility text settings.
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            if (maxWidth < 300.dp || LocalDensity.current.fontScale > 1.2f) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    SummaryTile("Masuk", income, Icons.Rounded.ArrowDownward, OnMint, Mint, Modifier.fillMaxWidth())
                    SummaryTile("Keluar", expense, Icons.Rounded.ArrowUpward, OnBlush, Blush, Modifier.fillMaxWidth())
                }
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    SummaryTile("Masuk", income, Icons.Rounded.ArrowDownward, OnMint, Mint, Modifier.weight(1f))
                    SummaryTile("Keluar", expense, Icons.Rounded.ArrowUpward, OnBlush, Blush, Modifier.weight(1f))
                }
            }
        }
        Column(
            Modifier.fillMaxWidth().background(if (positive) Lime else Blush, RoundedCornerShape(22.dp)).padding(20.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SummaryIcon(
                    if (positive) Icons.Rounded.TrendingUp else Icons.Rounded.TrendingDown,
                    if (positive) Forest else OnBlush,
                    Color.White.copy(alpha = .6f),
                )
                Text("Laba", color = if (positive) Forest else OnBlush, fontSize = 14.sp, fontWeight = FontWeight.Bold)
            }
            Text(
                rupiah(profit),
                Modifier.padding(top = 12.dp),
                color = if (positive) Forest else OnBlush,
                fontSize = 34.sp,
                lineHeight = 40.sp,
                fontWeight = FontWeight.ExtraBold,
            )
            Text(
                when {
                    income == 0L && expense == 0L -> if (filter == HistoryFilter.ALL) "Belum ada transaksi" else "Tidak ada transaksi pada filter ini"
                    income == 0L -> "Belum ada pemasukan"
                    expense == 0L -> "Tidak ada pengeluaran"
                    else -> "Pengeluaran ${(expense * 100.0 / income).roundToInt()}% dari pemasukan"
                },
                Modifier.padding(top = 6.dp),
                color = (if (positive) Forest else OnBlush).copy(alpha = .8f),
                fontSize = 12.sp,
                lineHeight = 18.sp,
            )
        }
    }
}

@Composable
private fun SummaryIcon(icon: ImageVector, tint: Color, background: Color) {
    Box(Modifier.size(34.dp).background(background, CircleShape), contentAlignment = Alignment.Center) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(20.dp), tint = tint)
    }
}

@Composable
private fun SummaryTile(label: String, amount: Long, icon: ImageVector, tint: Color, background: Color, modifier: Modifier) {
    Column(modifier.background(Card, RoundedCornerShape(22.dp)).padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SummaryIcon(icon, tint, background)
            Text(label, color = Muted, fontSize = 13.sp, fontWeight = FontWeight.Bold)
        }
        Text(
            rupiah(amount),
            Modifier.padding(top = 14.dp),
            color = tint,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 22.sp,
            lineHeight = 28.sp,
        )
    }
}

@Preview(name = "Ringkasan · Rp 95.000 / Rp 75.000 / Rp 20.000", widthDp = 390, showBackground = true)
@Preview(name = "Ringkasan · layar kecil", widthDp = 320, showBackground = true)
@Preview(name = "Ringkasan · teks besar", widthDp = 390, fontScale = 1.5f, showBackground = true)
@Composable
private fun HistorySummaryPreview() {
    MaterialTheme {
        Column(Modifier.background(Cream).padding(20.dp)) {
            HistorySummary(95_000L, 75_000L, 20_000L, 8, HistoryFilter.ALL)
        }
    }
}

private fun dayLabel(time: Long): String = Instant.ofEpochMilli(time)
    .atZone(ZoneId.systemDefault())
    .toLocalDate()
    .format(DateTimeFormatter.ofPattern("EEEE, d MMMM yyyy", java.util.Locale("id", "ID")))

