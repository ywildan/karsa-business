package com.ywldan.karsabusiness.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.ywldan.karsabusiness.ui.components.PrimaryButton
import com.ywldan.karsabusiness.ui.theme.Card
import com.ywldan.karsabusiness.ui.theme.Cream
import com.ywldan.karsabusiness.ui.theme.Forest
import com.ywldan.karsabusiness.ui.theme.Ink
import com.ywldan.karsabusiness.ui.theme.Lime
import com.ywldan.karsabusiness.ui.theme.Muted

private val businessTypes = listOf("Makanan", "Minuman", "Jasa", "Fashion", "Kerajinan", "Lainnya")

@Composable
fun SetupBusinessScreen(busy: Boolean, onCreate: (String, String, Long) -> Unit) {
    var name by remember { mutableStateOf("") }
    var type by remember { mutableStateOf("Makanan") }
    var capital by remember { mutableStateOf("") }
    Column(
        Modifier.fillMaxSize().background(Cream).verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp).padding(top = 52.dp, bottom = 28.dp),
    ) {
        Text("LANGKAH 2 DARI 3", color = Ink, fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.bodySmall)
        LinearProgressIndicator(
            progress = { .66f },
            Modifier.fillMaxWidth().padding(top = 10.dp).height(7.dp),
            color = Ink,
            trackColor = Ink.copy(alpha = .12f),
        )
        Text("Ceritakan sedikit tentang usahamu.", Modifier.padding(top = 30.dp), style = MaterialTheme.typography.headlineLarge)
        Text("Informasi ini dipakai untuk menyiapkan pencatatan pertama.", Modifier.padding(top = 8.dp), color = Muted)
        OutlinedTextField(
            name,
            { name = it },
            Modifier.fillMaxWidth().padding(top = 28.dp),
            label = { Text("Nama usaha") },
            placeholder = { Text("Contoh: Kopi Sore Kampus") },
            shape = RoundedCornerShape(18.dp),
            singleLine = true,
        )
        Text("Jenis usaha", Modifier.padding(top = 24.dp, bottom = 10.dp), fontWeight = FontWeight.Bold)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            businessTypes.forEach { item ->
                Text(
                    item,
                    Modifier.background(if (type == item) Forest else Card, RoundedCornerShape(14.dp))
                        .clickable { type = item }.padding(horizontal = 15.dp, vertical = 11.dp),
                    color = if (type == item) Lime else Ink,
                    fontWeight = FontWeight.Bold,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
        OutlinedTextField(
            capital,
            { capital = it.filter(Char::isDigit) },
            Modifier.fillMaxWidth().padding(top = 24.dp),
            label = { Text("Modal awal (opsional)") },
            prefix = { Text("Rp ") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            shape = RoundedCornerShape(18.dp),
            singleLine = true,
        )
        Spacer(Modifier.height(34.dp))
        PrimaryButton("Siapkan usaha", { onCreate(name, type, capital.toLongOrNull() ?: 0) }, busy = busy)
        Text(
            "Paket gratis mengizinkan satu bisnis untuk setiap akun.",
            Modifier.fillMaxWidth().padding(top = 14.dp),
            color = Muted,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}
