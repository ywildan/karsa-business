package com.ywldan.karsabusiness.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.ArrowDropDown
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.Remove
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ywldan.karsabusiness.data.local.ProductEntity
import com.ywldan.karsabusiness.data.local.TransactionEntity
import com.ywldan.karsabusiness.data.local.TransactionType
import com.ywldan.karsabusiness.ui.components.PrimaryButton
import com.ywldan.karsabusiness.ui.components.formatRupiahInput
import com.ywldan.karsabusiness.ui.components.rupiah
import com.ywldan.karsabusiness.ui.theme.Blush
import com.ywldan.karsabusiness.ui.theme.Coral
import com.ywldan.karsabusiness.ui.theme.Cream
import com.ywldan.karsabusiness.ui.theme.Forest
import com.ywldan.karsabusiness.ui.theme.Karsa
import com.ywldan.karsabusiness.ui.theme.Lime
import com.ywldan.karsabusiness.ui.theme.Mint
import com.ywldan.karsabusiness.ui.theme.Muted
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val incomeCategories = listOf("Penjualan", "Jasa", "Modal", "Bonus", "Lainnya")
private val expenseCategories = listOf("Bahan baku", "Kemasan", "Transport", "Promosi", "Operasional", "Lainnya")
private val paymentMethods = listOf("Tunai", "QRIS", "Transfer")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TransactionFormScreen(
    editing: TransactionEntity?,
    busy: Boolean,
    products: List<ProductEntity>,
    onClose: () -> Unit,
    onSave: (String, Long, String, String, String, Long, String?, Long?) -> Unit,
    onDelete: (String) -> Unit,
) {
    var type by remember(editing) { mutableStateOf(editing?.type ?: TransactionType.INCOME) }
    var amountText by remember(editing) { mutableStateOf(formatRupiahInput(editing?.amount?.toString().orEmpty())) }
    var category by remember(editing, type) {
        mutableStateOf(editing?.category ?: if (type == TransactionType.INCOME) incomeCategories.first() else expenseCategories.first())
    }
    var payment by remember(editing) { mutableStateOf(editing?.paymentMethod ?: "Tunai") }
    var note by remember(editing) { mutableStateOf(editing?.note.orEmpty()) }
    var date by remember(editing) { mutableLongStateOf(editing?.transactionDate ?: System.currentTimeMillis()) }
    var showDatePicker by remember { mutableStateOf(false) }
    var selectedProductId by remember(editing) { mutableStateOf(editing?.productId) }
    var quantity by remember(editing) { mutableLongStateOf(editing?.quantity ?: 1L) }
    var productMenuExpanded by remember { mutableStateOf(false) }
    var showDeleteConfirm by remember { mutableStateOf(false) }
    val selectedProduct = products.find { it.id == selectedProductId }
    // Stock already reserved by the transaction being edited counts as available.
    val reservedQty = if (editing?.productId == selectedProduct?.id) (editing?.quantity ?: 1L) else 0L
    val availableStock = (selectedProduct?.stock ?: 0L) + reservedQty
    // Keep automatically calculated totals within the 12-digit amount field.
    val maxQuantity = minOf(availableStock, selectedProduct?.price?.takeIf { it > 0 }?.let { 999_999_999_999L / it } ?: availableStock)
    val categories = if (type == TransactionType.INCOME) incomeCategories else expenseCategories
    val accent = if (type == TransactionType.INCOME) Karsa else Coral

    Column(Modifier.fillMaxSize().background(Cream).navigationBarsPadding()) {
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState())
                .padding(horizontal = 22.dp).padding(top = 40.dp, bottom = 28.dp),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onClose, modifier = Modifier.background(Color.White, CircleShape)) {
                    Icon(Icons.Rounded.Close, "Tutup")
                }
                Column(Modifier.weight(1f).padding(start = 14.dp)) {
                    Text(if (editing == null) "Catat transaksi" else "Edit transaksi", style = MaterialTheme.typography.headlineMedium)
                    Text("Simpan pergerakan uang usahamu", color = Muted, style = MaterialTheme.typography.bodySmall)
                }
                if (editing != null) {
                    IconButton(onClick = { showDeleteConfirm = true }) {
                        Icon(Icons.Rounded.DeleteOutline, "Hapus", tint = Coral)
                    }
                }
            }

            Row(Modifier.fillMaxWidth().padding(top = 24.dp).background(Color.White, RoundedCornerShape(18.dp)).padding(4.dp)) {
                TypeOption("Pemasukan", type == TransactionType.INCOME, Karsa, Modifier.weight(1f)) {
                    type = TransactionType.INCOME
                    if (category !in incomeCategories) category = incomeCategories.first()
                }
                TypeOption("Pengeluaran", type == TransactionType.EXPENSE, Coral, Modifier.weight(1f)) {
                    type = TransactionType.EXPENSE
                    if (category !in expenseCategories) category = expenseCategories.first()
                    selectedProductId = null
                }
            }

            Text("NOMINAL", Modifier.padding(top = 28.dp), color = Muted, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodySmall)
            OutlinedTextField(
                value = amountText,
                onValueChange = { amountText = formatRupiahInput(it.filter(Char::isDigit).take(12)) },
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                prefix = { Text("Rp ", color = accent, fontWeight = FontWeight.ExtraBold) },
                textStyle = MaterialTheme.typography.headlineMedium.copy(color = Forest),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                singleLine = true,
                shape = RoundedCornerShape(18.dp),
            )
            FlowRow(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(10_000L, 25_000L, 50_000L, 100_000L).forEach { quick ->
                    Text(
                        "+${rupiah(quick)}",
                        Modifier.background(Color.White, RoundedCornerShape(100.dp)).clickable {
                            amountText = formatRupiahInput(((amountText.filter(Char::isDigit).toLongOrNull() ?: 0) + quick).toString())
                        }.padding(horizontal = 12.dp, vertical = 8.dp),
                        color = accent,
                        fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }

            if (type == TransactionType.INCOME) {
                Text("Produk (opsional)", Modifier.padding(top = 26.dp, bottom = 10.dp), fontWeight = FontWeight.ExtraBold)
                Box(Modifier.fillMaxWidth()) {
                    OutlinedTextField(
                        value = selectedProduct?.let { "${it.name} \u2022 ${rupiah(it.price)}" } ?: "Tanpa produk",
                        onValueChange = {},
                        readOnly = true,
                        modifier = Modifier.fillMaxWidth(),
                        trailingIcon = {
                            IconButton(onClick = { productMenuExpanded = true }) {
                                Icon(Icons.Rounded.ArrowDropDown, "Pilih produk")
                            }
                        },
                        shape = RoundedCornerShape(18.dp),
                    )
                    Box(Modifier.matchParentSize().clickable { productMenuExpanded = true })
                    DropdownMenu(
                        expanded = productMenuExpanded,
                        onDismissRequest = { productMenuExpanded = false },
                    ) {
                        DropdownMenuItem(
                            text = { Text("Tanpa produk") },
                            onClick = {
                                selectedProductId = null
                                productMenuExpanded = false
                            },
                        )
                        products.filter { it.stock > 0 }.forEach { product ->
                            DropdownMenuItem(
                                text = {
                                    Column {
                                        Text(product.name, fontWeight = FontWeight.Bold)
                                        Text(
                                            "${rupiah(product.price)} \u2022 Stok ${product.stock}",
                                            color = Muted,
                                            style = MaterialTheme.typography.bodySmall,
                                        )
                                    }
                                },
                                onClick = {
                                    selectedProductId = product.id
                                    quantity = 1L
                                    amountText = formatRupiahInput(product.price.toString())
                                    if (category != "Penjualan") category = "Penjualan"
                                    productMenuExpanded = false
                                },
                            )
                        }
                    }
                }
                selectedProduct?.let { product ->
                    Row(
                        Modifier.fillMaxWidth().padding(top = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("Jumlah", color = Muted, style = MaterialTheme.typography.bodySmall)
                        Spacer(Modifier.weight(1f))
                        IconButton(
                            onClick = {
                                if (quantity > 1) {
                                    quantity -= 1
                                    amountText = formatRupiahInput(((java.math.BigInteger.valueOf(product.price) * java.math.BigInteger.valueOf(quantity))).toString())
                                }
                            },
                            modifier = Modifier.background(Color.White, CircleShape).size(36.dp),
                        ) { Icon(Icons.Rounded.Remove, "Kurangi", tint = Forest) }
                        Text(
                            quantity.toString(),
                            Modifier.padding(horizontal = 10.dp),
                            fontWeight = FontWeight.ExtraBold,
                            style = MaterialTheme.typography.titleMedium,
                        )
                        IconButton(
                            onClick = {
                                if (quantity < maxQuantity) {
                                    quantity += 1
                                    amountText = formatRupiahInput(((java.math.BigInteger.valueOf(product.price) * java.math.BigInteger.valueOf(quantity))).toString())
                                }
                            },
                            modifier = Modifier.background(Color.White, CircleShape).size(36.dp),
                        ) { Icon(Icons.Rounded.Add, "Tambah", tint = Forest) }
                    }
                    Text(
                        "Stok tersedia: $availableStock \u2022 Total: ${rupiah((java.math.BigInteger.valueOf(product.price) * java.math.BigInteger.valueOf(quantity)))}",
                        color = Muted,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }

            Text("Kategori", Modifier.padding(top = 26.dp, bottom = 10.dp), fontWeight = FontWeight.ExtraBold)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                categories.forEach { item ->
                    ChoiceChip(item, category == item, accent) { category = item }
                }
            }
            Text("Metode pembayaran", Modifier.padding(top = 24.dp, bottom = 10.dp), fontWeight = FontWeight.ExtraBold)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                paymentMethods.forEach { item -> ChoiceChip(item, payment == item, Forest) { payment = item } }
            }
            Text("Tanggal", Modifier.padding(top = 24.dp, bottom = 8.dp), fontWeight = FontWeight.ExtraBold)
            Text(
                formatDate(date),
                Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(18.dp)).clickable { showDatePicker = true }
                    .padding(16.dp),
                color = Forest,
                fontWeight = FontWeight.Bold,
            )
            OutlinedTextField(
                note,
                { note = it.take(120) },
                Modifier.fillMaxWidth().padding(top = 20.dp),
                label = { Text("Catatan (opsional)") },
                placeholder = { Text("Contoh: 10 gelas es kopi") },
                minLines = 2,
                shape = RoundedCornerShape(18.dp),
            )
        }
        Surface(
            color = Cream,
            shadowElevation = 8.dp,
            modifier = Modifier.fillMaxWidth(),
        ) {
            PrimaryButton(
                if (editing == null) "Simpan transaksi" else "Simpan perubahan",
                {
                    onSave(
                        type,
                        amountText.filter(Char::isDigit).toLongOrNull() ?: 0,
                        category,
                        payment,
                        note,
                        date,
                        selectedProductId,
                        selectedProductId?.let { quantity },
                    )
                },
                busy = busy,
                modifier = Modifier.padding(horizontal = 22.dp).padding(top = 12.dp, bottom = 16.dp),
            )
        }
    }

    if (showDeleteConfirm && editing != null) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            title = { Text("Hapus transaksi?") },
            text = { Text("Transaksi ini akan dihapus dari riwayat. Stok produk yang terkait akan dikembalikan.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        showDeleteConfirm = false
                        onDelete(editing.id)
                    },
                ) { Text("Hapus", color = Coral, fontWeight = FontWeight.Bold) }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirm = false }) { Text("Batal") }
            },
        )
    }

    if (showDatePicker) {
        val picker = androidx.compose.material3.rememberDatePickerState(initialSelectedDateMillis = date)
        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                TextButton(onClick = {
                    picker.selectedDateMillis?.let { date = it }
                    showDatePicker = false
                }) { Text("Pilih") }
            },
            dismissButton = { TextButton(onClick = { showDatePicker = false }) { Text("Batal") } },
        ) { DatePicker(state = picker) }
    }
}

@Composable
private fun TypeOption(label: String, selected: Boolean, color: Color, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier.height(46.dp).background(if (selected) color else Color.Transparent, RoundedCornerShape(14.dp)).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = if (selected) Color.White else Muted, fontWeight = FontWeight.ExtraBold)
    }
}

@Composable
private fun ChoiceChip(label: String, selected: Boolean, color: Color, onClick: () -> Unit) {
    Text(
        label,
        Modifier.background(if (selected) color else Color.White, RoundedCornerShape(100.dp))
            .clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 10.dp),
        color = if (selected) Color.White else Muted,
        fontWeight = FontWeight.Bold,
        style = MaterialTheme.typography.bodySmall,
    )
}

private fun formatDate(millis: Long): String = Instant.ofEpochMilli(millis)
    .atZone(ZoneId.systemDefault()).toLocalDate()
    .format(DateTimeFormatter.ofPattern("EEEE, d MMMM yyyy", java.util.Locale("id", "ID")))

