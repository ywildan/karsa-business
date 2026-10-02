package com.ywldan.karsabusiness.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.ywldan.karsabusiness.data.local.ProductEntity
import com.ywldan.karsabusiness.ui.components.PrimaryButton
import com.ywldan.karsabusiness.ui.theme.Coral
import com.ywldan.karsabusiness.ui.theme.Cream
import com.ywldan.karsabusiness.ui.theme.Forest
import com.ywldan.karsabusiness.ui.theme.Muted

@Composable
fun ProductFormScreen(
    editing: ProductEntity?,
    busy: Boolean,
    onClose: () -> Unit,
    onSave: (String, Long, Long) -> Unit,
    onDelete: (String) -> Unit,
) {
    var name by remember(editing) { mutableStateOf(editing?.name.orEmpty()) }
    var priceText by remember(editing) { mutableStateOf(editing?.price?.toString().orEmpty()) }
    var stockText by remember(editing) { mutableStateOf(editing?.stock?.toString().orEmpty()) }
    var showDeleteConfirm by remember { mutableStateOf(false) }

    Column(
        Modifier.fillMaxSize().background(Cream).verticalScroll(rememberScrollState())
            .navigationBarsPadding().padding(horizontal = 22.dp).padding(top = 40.dp, bottom = 28.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onClose, modifier = Modifier.background(Color.White, CircleShape)) {
                Icon(Icons.Rounded.Close, "Tutup")
            }
            Column(Modifier.weight(1f).padding(start = 14.dp)) {
                Text(
                    if (editing == null) "Tambah produk" else "Edit produk",
                    style = MaterialTheme.typography.headlineMedium,
                )
                Text(
                    "Stok berkurang otomatis setiap ada penjualan",
                    color = Muted,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            if (editing != null) {
                IconButton(onClick = { showDeleteConfirm = true }) {
                    Icon(Icons.Rounded.DeleteOutline, "Hapus", tint = Coral)
                }
            }
        }

        Text(
            "NAMA PRODUK",
            Modifier.padding(top = 28.dp),
            color = Muted,
            fontWeight = FontWeight.Bold,
            style = MaterialTheme.typography.bodySmall,
        )
        OutlinedTextField(
            value = name,
            onValueChange = { name = it.take(80) },
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            placeholder = { Text("Contoh: Kopi susu 250ml") },
            singleLine = true,
            shape = RoundedCornerShape(18.dp),
        )

        Text(
            "HARGA JUAL",
            Modifier.padding(top = 24.dp),
            color = Muted,
            fontWeight = FontWeight.Bold,
            style = MaterialTheme.typography.bodySmall,
        )
        OutlinedTextField(
            value = priceText,
            onValueChange = { priceText = it.filter(Char::isDigit).take(12) },
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            prefix = { Text("Rp ", color = Forest, fontWeight = FontWeight.ExtraBold) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            singleLine = true,
            shape = RoundedCornerShape(18.dp),
        )

        Text(
            "STOK",
            Modifier.padding(top = 24.dp),
            color = Muted,
            fontWeight = FontWeight.Bold,
            style = MaterialTheme.typography.bodySmall,
        )
        OutlinedTextField(
            value = stockText,
            onValueChange = { stockText = it.filter(Char::isDigit).take(9) },
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            placeholder = { Text("0") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            singleLine = true,
            shape = RoundedCornerShape(18.dp),
        )

        Spacer(Modifier.height(28.dp))
        PrimaryButton(
            if (editing == null) "Simpan produk" else "Simpan perubahan",
            { onSave(name.trim(), priceText.toLongOrNull() ?: 0L, stockText.toLongOrNull() ?: 0L) },
            busy = busy,
            enabled = name.isNotBlank(),
        )
    }

    if (showDeleteConfirm && editing != null) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            title = { Text("Hapus produk?") },
            text = { Text("\"${editing.name}\" akan dihapus dari katalog. Riwayat transaksi tetap tersimpan.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        showDeleteConfirm = false
                        onDelete(editing.id)
                    },
                ) { Text("Hapus", color = Coral, fontWeight = FontWeight.Bold) }
            },
            dismissButton = { TextButton(onClick = { showDeleteConfirm = false }) { Text("Batal") } },
        )
    }
}
