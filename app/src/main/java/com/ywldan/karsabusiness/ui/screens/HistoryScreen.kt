package com.ywldan.karsabusiness.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ywldan.karsabusiness.data.local.TransactionEntity
import com.ywldan.karsabusiness.data.local.TransactionType
import com.ywldan.karsabusiness.ui.MainUiState
import com.ywldan.karsabusiness.ui.components.EmptyState
import com.ywldan.karsabusiness.ui.components.rupiah
import com.ywldan.karsabusiness.ui.theme.Cream
import com.ywldan.karsabusiness.ui.theme.Forest
import com.ywldan.karsabusiness.ui.theme.Karsa
import com.ywldan.karsabusiness.ui.theme.Muted
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

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
            Text("Semua pergerakan uang usahamu.", Modifier.padding(top = 5.dp), color = Muted)
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
        item {
            Row(
                Modifier.fillMaxWidth().background(Forest, RoundedCornerShape(22.dp)).padding(17.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                SummarySmall("Masuk", rupiah(state.summary.income))
                SummarySmall("Keluar", rupiah(state.summary.expense))
                SummarySmall("Laba", rupiah(state.summary.profit))
            }
        }
        if (visible.isEmpty()) {
            item { EmptyState("Transaksi tidak ditemukan", "Ubah pencarian atau catat transaksi baru.") }
        } else {
            grouped.forEach { (day, transactions) ->
                item { Text(day, Modifier.padding(top = 8.dp), fontWeight = FontWeight.ExtraBold, color = Forest) }
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
        Modifier.background(if (selected) Forest else Color.White, RoundedCornerShape(100.dp))
            .clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 10.dp),
        color = if (selected) Color.White else Muted,
        style = MaterialTheme.typography.bodySmall,
        fontWeight = FontWeight.Bold,
    )
}

@Composable
private fun SummarySmall(label: String, value: String) {
    Column {
        Text(label, color = Color.White.copy(alpha = .6f), style = MaterialTheme.typography.bodySmall)
        Text(value, color = Color.White, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodySmall)
    }
}

private fun dayLabel(time: Long): String = Instant.ofEpochMilli(time)
    .atZone(ZoneId.systemDefault())
    .toLocalDate()
    .format(DateTimeFormatter.ofPattern("EEEE, d MMMM yyyy", java.util.Locale("id", "ID")))

