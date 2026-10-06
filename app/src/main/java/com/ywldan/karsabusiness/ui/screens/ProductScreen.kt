package com.ywldan.karsabusiness.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Remove
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import com.ywldan.karsabusiness.ui.components.BusinessPicker
import com.ywldan.karsabusiness.ui.components.ProductInventorySummary
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.ywldan.karsabusiness.data.local.ProductEntity
import com.ywldan.karsabusiness.domain.isLowStock
import com.ywldan.karsabusiness.ui.MainUiState
import com.ywldan.karsabusiness.ui.MainViewModel
import com.ywldan.karsabusiness.ui.components.EmptyState
import com.ywldan.karsabusiness.ui.components.rupiah
import com.ywldan.karsabusiness.ui.theme.Blush
import com.ywldan.karsabusiness.ui.theme.Butter
import com.ywldan.karsabusiness.ui.theme.Coral
import com.ywldan.karsabusiness.ui.theme.Cream
import com.ywldan.karsabusiness.ui.theme.Forest
import com.ywldan.karsabusiness.ui.theme.Karsa
import com.ywldan.karsabusiness.ui.theme.Mint
import com.ywldan.karsabusiness.ui.theme.Muted

private val DarkAmber = Color(0xFF8A5A00)

@Composable
fun ProductScreen(state: MainUiState, padding: PaddingValues, model: MainViewModel, onBusiness: () -> Unit) {
    var query by remember { mutableStateOf("") }
    var stockDialog by remember { mutableStateOf<Pair<ProductEntity, Boolean>?>(null) }
    var deleteTarget by remember { mutableStateOf<ProductEntity?>(null) }

    val filtered = remember(state.products, query) {
        if (query.isBlank()) state.products
        else state.products.filter { it.name.contains(query.trim(), ignoreCase = true) }
    }

    Column(
        Modifier.fillMaxSize().padding(padding)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 22.dp).padding(top = 28.dp, bottom = 28.dp),
    ) {
        Text("Produk", style = MaterialTheme.typography.headlineMedium)
        BusinessPicker(state.business?.name.orEmpty(), onBusiness, Modifier.padding(top = 6.dp), enabled = !state.busy)

        ProductInventorySummary(state.inventory, Modifier.padding(top = 18.dp))

        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
            placeholder = { Text("Cari produk...") },
            leadingIcon = { Icon(Icons.Rounded.Search, "Cari", tint = Muted) },
            singleLine = true,
            shape = RoundedCornerShape(18.dp),
        )

        if (filtered.isEmpty()) {
            Spacer(Modifier.height(16.dp))
            EmptyState(
                if (state.products.isEmpty()) "Belum ada produk" else "Tidak ketemu",
                if (state.products.isEmpty()) "Tambahkan produk pertamamu lewat tombol + di bawah"
                else "Coba kata kunci lain",
            )
        } else {
            filtered.forEach { product ->
                Spacer(Modifier.height(12.dp))
                ProductRow(
                    product = product,
                    onRestock = { stockDialog = product to true },
                    onDecrease = { stockDialog = product to false },
                    onEdit = { model.openProductForm(product) },
                    onDelete = { deleteTarget = product },
                )
            }
            Spacer(Modifier.height(72.dp))
        }
    }

    stockDialog?.let { (product, isRestock) ->
        StockAdjustDialog(
            product = product,
            isRestock = isRestock,
            onDismiss = { stockDialog = null },
            onConfirm = { amount ->
                model.adjustStock(product.id, if (isRestock) amount else -amount)
                stockDialog = null
            },
        )
    }

    deleteTarget?.let { product ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text("Hapus produk?") },
            text = { Text("\"${product.name}\" akan dihapus dari katalog. Riwayat transaksi tetap tersimpan.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        model.deleteProduct(product.id)
                        deleteTarget = null
                    },
                ) { Text("Hapus", color = Coral, fontWeight = FontWeight.Bold) }
            },
            dismissButton = { TextButton(onClick = { deleteTarget = null }) { Text("Batal") } },
        )
    }
}

@Composable
private fun ProductRow(
    product: ProductEntity,
    onRestock: () -> Unit,
    onDecrease: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    Column(
        Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(20.dp)).padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(product.name, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                Text(rupiah(product.price), color = Karsa, fontWeight = FontWeight.ExtraBold)
            }
            StockBadge(product.stock)
        }
        Row(
            Modifier.fillMaxWidth().padding(top = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            StockButton(Icons.Rounded.Add, "Restock", Mint, Forest, onRestock)
            StockButton(Icons.Rounded.Remove, "Kurangi", Blush, Coral, onDecrease)
            Spacer(Modifier.weight(1f))
            IconButton(
                onClick = onEdit,
                modifier = Modifier.background(Cream, CircleShape).size(38.dp),
            ) { Icon(Icons.Rounded.Edit, "Edit", tint = Forest) }
            IconButton(
                onClick = onDelete,
                modifier = Modifier.background(Cream, CircleShape).size(38.dp),
            ) { Icon(Icons.Rounded.DeleteOutline, "Hapus", tint = Coral) }
        }
    }
}

@Composable
private fun StockBadge(stock: Long) {
    val (label, bg, fg) = when {
        stock <= 0 -> Triple("Habis", Blush, Coral)
        isLowStock(stock) -> Triple("Sisa $stock", Butter, DarkAmber)
        else -> Triple("Stok $stock", Mint, Karsa)
    }
    Text(
        label,
        Modifier.background(bg, RoundedCornerShape(100.dp)).padding(horizontal = 12.dp, vertical = 6.dp),
        color = fg,
        fontWeight = FontWeight.Bold,
        style = MaterialTheme.typography.bodySmall,
    )
}

@Composable
private fun StockButton(icon: ImageVector, label: String, bg: Color, fg: Color, onClick: () -> Unit) {
    Row(
        Modifier.background(bg, RoundedCornerShape(100.dp)).clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, label, tint = fg, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(4.dp))
        Text(label, color = fg, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun StockAdjustDialog(
    product: ProductEntity,
    isRestock: Boolean,
    onDismiss: () -> Unit,
    onConfirm: (Long) -> Unit,
) {
    var amount by remember(product) { mutableStateOf("") }
    val parsed = amount.toLongOrNull() ?: 0L
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (isRestock) "Restock" else "Kurangi stok") },
        text = {
            Column {
                Text(
                    "\"${product.name}\" \u2022 Stok saat ini: ${product.stock}",
                    color = Muted,
                    style = MaterialTheme.typography.bodySmall,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = amount,
                    onValueChange = { amount = it.filter(Char::isDigit).take(9) },
                    label = { Text("Jumlah") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    shape = RoundedCornerShape(14.dp),
                )
                if (!isRestock && parsed > product.stock) {
                    Text(
                        "Melebihi stok yang tersedia",
                        color = Coral,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(parsed) },
                enabled = parsed > 0 && (isRestock || parsed <= product.stock),
            ) { Text("Simpan", fontWeight = FontWeight.Bold, color = Forest) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Batal") } },
    )
}
