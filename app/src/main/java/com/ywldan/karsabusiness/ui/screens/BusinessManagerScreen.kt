package com.ywldan.karsabusiness.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import com.ywldan.karsabusiness.BuildConfig
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.ywldan.karsabusiness.ui.MainUiState
import com.ywldan.karsabusiness.ui.components.PrimaryButton
import com.ywldan.karsabusiness.ui.theme.*

@Composable
fun BusinessManagerScreen(state: MainUiState, onClose: () -> Unit, onSelect: (String) -> Unit,
    onCreate: (String, String, Long) -> Unit, onChooseFree: () -> Unit) {
    val uriHandler = LocalUriHandler.current
    var showCreate by remember { mutableStateOf(false) }
    var previousCount by remember { mutableIntStateOf(state.businesses.size) }
    var name by remember { mutableStateOf("") }
    var type by remember { mutableStateOf("Lainnya") }
    var capital by remember { mutableStateOf("") }
    LaunchedEffect(state.businesses.size) {
        if (state.businesses.size > previousCount) { showCreate = false; name = ""; capital = "" }
        previousCount = state.businesses.size
    }
    Column(Modifier.fillMaxSize().background(Cream).statusBarsPadding().navigationBarsPadding()
        .verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onClose) { Icon(Icons.Rounded.Close, "Tutup") }
            Text("Bisnis usahamu", style = MaterialTheme.typography.headlineMedium)
        }
        Text("${if (state.account.premium) "Premium" else "Gratis"} · ${state.businesses.size} dari ${state.account.businessLimit} bisnis", color = Ink, fontWeight = FontWeight.Bold)
        Text("Transaksi, produk, dan stok setiap bisnis dicatat terpisah.", color = Muted)
        state.businesses.forEach { business ->
            Column(Modifier.fillMaxWidth().background(if (business.id == state.business?.id) Lime else Card, RoundedCornerShape(20.dp))
                .clickable(enabled = !state.busy) { onSelect(business.id) }.padding(18.dp)) {
                Text(business.name, fontWeight = FontWeight.ExtraBold, color = if (business.id == state.business?.id) Forest else Ink)
                Text("${business.type}${if (business.id == state.business?.id) " · Dipilih" else ""}", color = Muted)
            }
        }
        if (state.businessReadOnly) {
            Text("Premium sudah tidak aktif. Data tetap tersimpan; bisnis ini hanya dapat dibaca.", color = Ink)
            PrimaryButton("Jadikan bisnis gratis aktif", onChooseFree, busy = state.busy)
        }
        if (state.account.premium) {
            OutlinedButton(onClick = { uriHandler.openUri(BuildConfig.API_BASE_URL.trimEnd('/')) }, enabled = BuildConfig.API_BASE_URL.startsWith("https://")) { Text("Buka dashboard web") }
            Text("Aktif sampai " + java.text.DateFormat.getDateInstance().format(java.util.Date(state.account.premiumUntil)), color = Muted)
        } else Text("Premium membuka dashboard web dan pengelolaan hingga 5 bisnis. Hubungi pengelola untuk aktivasi.", color = Muted)
        if (state.businesses.size < state.account.businessLimit) {
            OutlinedButton(onClick = { showCreate = true }, enabled = !state.busy) { Text("Tambah bisnis") }
        }
        if (showCreate) {
            OutlinedTextField(name, { name = it.take(80) }, label = { Text("Nama bisnis") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            OutlinedTextField(type, { type = it.take(40) }, label = { Text("Jenis usaha") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            OutlinedTextField(capital, { capital = it.filter(Char::isDigit).take(12) }, label = { Text("Modal awal") }, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true)
            PrimaryButton("Buat bisnis", { onCreate(name, type.ifBlank { "Lainnya" }, capital.toLongOrNull() ?: 0) }, enabled = name.trim().length >= 2, busy = state.busy)
            Text("Bisnis tambahan memerlukan internet agar batas paket diperiksa.", color = Muted, style = MaterialTheme.typography.bodySmall)
        }
    }
}
