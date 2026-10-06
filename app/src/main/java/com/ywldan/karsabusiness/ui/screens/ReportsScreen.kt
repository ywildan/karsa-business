package com.ywldan.karsabusiness.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ywldan.karsabusiness.data.local.TransactionType
import com.ywldan.karsabusiness.ui.MainUiState
import com.ywldan.karsabusiness.ui.components.rupiah
import com.ywldan.karsabusiness.ui.theme.Amber
import com.ywldan.karsabusiness.ui.theme.Card
import com.ywldan.karsabusiness.ui.theme.Coral
import com.ywldan.karsabusiness.ui.theme.Cream
import com.ywldan.karsabusiness.ui.theme.Forest
import com.ywldan.karsabusiness.ui.theme.Karsa
import com.ywldan.karsabusiness.ui.theme.Lime
import com.ywldan.karsabusiness.ui.theme.Mint
import com.ywldan.karsabusiness.ui.theme.Muted
import com.ywldan.karsabusiness.ui.theme.OnMint
import java.time.Instant
import java.time.ZoneId
import java.time.YearMonth
import java.time.format.DateTimeFormatter

@Composable
fun ReportsScreen(state: MainUiState, padding: PaddingValues) {
    val now = YearMonth.now()
    val monthly = state.transactions.filter {
        val date = Instant.ofEpochMilli(it.transactionDate).atZone(ZoneId.systemDefault()).toLocalDate()
        YearMonth.from(date) == now
    }
    val income = monthly.filter { it.type == TransactionType.INCOME }.sumOf { it.amount }
    val expense = monthly.filter { it.type == TransactionType.EXPENSE }.sumOf { it.amount }
    val profit = income - expense
    val margin = if (income > 0) profit.toDouble() / income * 100 else 0.0
    val expensesByCategory = monthly.filter { it.type == TransactionType.EXPENSE }
        .groupBy { it.category }.mapValues { (_, rows) -> rows.sumOf { it.amount } }
        .entries.sortedByDescending { it.value }.take(5)

    LazyColumn(
        Modifier.fillMaxSize().background(Cream),
        contentPadding = PaddingValues(
            start = 20.dp,
            end = 20.dp,
            top = padding.calculateTopPadding() + 28.dp,
            bottom = padding.calculateBottomPadding() + 28.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        item {
            Text("Laporan keuangan", style = MaterialTheme.typography.headlineLarge)
            Text(now.format(DateTimeFormatter.ofPattern("MMMM yyyy", java.util.Locale("id", "ID"))), color = Muted)
        }
        item {
            Column(Modifier.fillMaxWidth().background(Forest, RoundedCornerShape(28.dp)).padding(22.dp)) {
                Text("LABA BERSIH", color = Color.White.copy(alpha = .6f), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodySmall)
                Text(rupiah(profit), Modifier.padding(top = 6.dp), color = if (profit >= 0) Lime else Coral, style = MaterialTheme.typography.headlineLarge)
                Text("Margin ${"%.1f".format(margin)}%", color = Color.White.copy(alpha = .72f))
                Row(Modifier.fillMaxWidth().padding(top = 20.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                    ReportMetric("Omzet", income)
                    ReportMetric("Biaya", expense)
                    ReportMetric("Transaksi", monthly.size.toLong(), money = false)
                }
            }
        }
        item {
            Column(Modifier.fillMaxWidth().background(Card, RoundedCornerShape(24.dp)).padding(18.dp)) {
                Text("Perbandingan bulan ini", fontWeight = FontWeight.ExtraBold)
                Row(Modifier.fillMaxWidth().height(180.dp).padding(top = 18.dp), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.Bottom) {
                    ReportBar("Masuk", income, maxOf(income, expense, 1), Karsa)
                    ReportBar("Keluar", expense, maxOf(income, expense, 1), Coral)
                    ReportBar("Laba", maxOf(profit, 0), maxOf(income, expense, 1), Amber)
                }
            }
        }
        item {
            Column(Modifier.fillMaxWidth().background(Card, RoundedCornerShape(24.dp)).padding(18.dp)) {
                Text("Komposisi pengeluaran", fontWeight = FontWeight.ExtraBold)
                if (expensesByCategory.isEmpty()) {
                    Text("Belum ada pengeluaran bulan ini.", Modifier.padding(top = 12.dp), color = Muted)
                } else {
                    expensesByCategory.forEachIndexed { index, entry ->
                        val colors = listOf(Coral, Amber, Karsa, OnMint, Lime)
                        Row(Modifier.fillMaxWidth().padding(top = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(10.dp).background(colors[index], CircleShape))
                            Text(entry.key, Modifier.weight(1f).padding(start = 10.dp), color = Muted)
                            Text(rupiah(entry.value), fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
        item {
            Column(Modifier.fillMaxWidth().background(Mint, RoundedCornerShape(24.dp)).padding(18.dp)) {
                Text("Insight sederhana", color = OnMint, fontWeight = FontWeight.ExtraBold)
                Text(
                    when {
                        monthly.isEmpty() -> "Mulai catat transaksi agar Karsa bisa membaca kondisi usahamu."
                        profit > 0 -> "Usahamu menghasilkan laba bulan ini. Pertahankan biaya di bawah omzet."
                        else -> "Pengeluaran masih menyamai atau melebihi pemasukan. Periksa kategori biaya terbesar."
                    },
                    Modifier.padding(top = 6.dp),
                    color = OnMint.copy(alpha = .8f),
                )
            }
        }
    }
}

@Composable
private fun ReportMetric(label: String, value: Long, money: Boolean = true) {
    Column {
        Text(label, color = Color.White.copy(alpha = .55f), style = MaterialTheme.typography.bodySmall)
        Text(if (money) rupiah(value) else value.toString(), color = Color.White, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun ReportBar(label: String, value: Long, max: Long, color: Color) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier.size(58.dp, (120.dp * (value.toFloat() / max).coerceIn(.08f, 1f))).background(color, RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)),
        )
        Text(label, Modifier.padding(top = 8.dp), color = Muted, style = MaterialTheme.typography.bodySmall)
    }
}

