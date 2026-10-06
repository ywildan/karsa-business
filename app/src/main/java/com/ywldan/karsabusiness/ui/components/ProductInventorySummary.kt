package com.ywldan.karsabusiness.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Category
import androidx.compose.material.icons.rounded.Inventory2
import androidx.compose.material.icons.rounded.Payments
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ywldan.karsabusiness.domain.InventorySummary
import com.ywldan.karsabusiness.ui.theme.Butter
import com.ywldan.karsabusiness.ui.theme.Cream
import com.ywldan.karsabusiness.ui.theme.Forest
import com.ywldan.karsabusiness.ui.theme.Lime
import com.ywldan.karsabusiness.ui.theme.Mint
import com.ywldan.karsabusiness.ui.theme.Muted
import java.math.BigInteger
import java.text.NumberFormat
import java.util.Locale

@Composable
fun ProductInventorySummary(inventory: InventorySummary, modifier: Modifier = Modifier) {
    val numbers = NumberFormat.getIntegerInstance(Locale.forLanguageTag("id-ID"))
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        // Give the figures full width on compact screens and with enlarged text.
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val stacked = maxWidth < 300.dp || LocalDensity.current.fontScale > 1.2f
            if (stacked) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    InventoryCountCard("Jenis produk", numbers.format(inventory.totalProducts), "Dalam katalog",
                        Icons.Rounded.Category, Mint, Forest, Modifier.fillMaxWidth())
                    InventoryCountCard("Total stok", numbers.format(inventory.totalStock), "Unit tersedia",
                        Icons.Rounded.Inventory2, Butter, Color(0xFF8A5A00), Modifier.fillMaxWidth())
                }
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    InventoryCountCard("Jenis produk", numbers.format(inventory.totalProducts), "Dalam katalog",
                        Icons.Rounded.Category, Mint, Forest, Modifier.weight(1f))
                    InventoryCountCard("Total stok", numbers.format(inventory.totalStock), "Unit tersedia",
                        Icons.Rounded.Inventory2, Butter, Color(0xFF8A5A00), Modifier.weight(1f))
                }
            }
        }
        Column(
            Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}
                .background(Forest, RoundedCornerShape(24.dp)).padding(20.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                InventoryIcon(Icons.Rounded.Payments, Lime, Color.White.copy(alpha = .10f))
                Text("Nilai inventaris", color = Color.White.copy(alpha = .85f),
                    style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
            }
            Text(rupiah(inventory.inventoryValue), Modifier.padding(top = 12.dp),
                color = Lime, fontWeight = FontWeight.ExtraBold, fontSize = 32.sp, lineHeight = 39.sp)
            Text("Berdasarkan harga jual × stok tersedia", Modifier.padding(top = 6.dp),
                color = Color.White.copy(alpha = .72f), style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun InventoryCountCard(label: String, value: String, description: String,
    icon: ImageVector, iconBackground: Color, iconTint: Color, modifier: Modifier) {
    Column(modifier.semantics(mergeDescendants = true) {}
        .background(Color.White, RoundedCornerShape(22.dp)).padding(16.dp)) {
        InventoryIcon(icon, iconTint, iconBackground)
        Text(label, Modifier.padding(top = 12.dp), color = Muted,
            style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold)
        Text(value, Modifier.padding(top = 4.dp), color = Forest,
            fontWeight = FontWeight.ExtraBold, fontSize = 30.sp, lineHeight = 36.sp)
        Text(description, Modifier.padding(top = 4.dp), color = Muted, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun InventoryIcon(icon: ImageVector, tint: Color, background: Color) {
    Box(Modifier.size(34.dp).background(background, CircleShape), contentAlignment = Alignment.Center) {
        Icon(icon, null, Modifier.size(19.dp), tint = tint)
    }
}

@Preview(name = "Produk · ringkasan", widthDp = 390, showBackground = true)
@Preview(name = "Produk · layar kecil", widthDp = 320, showBackground = true)
@Preview(name = "Produk · teks besar", widthDp = 390, fontScale = 1.5f, showBackground = true)
@Composable
private fun ProductInventorySummaryPreview() {
    MaterialTheme {
        Column(Modifier.background(Cream).padding(20.dp)) {
            ProductInventorySummary(InventorySummary(12, 146L, BigInteger.valueOf(8_750_000L)))
        }
    }
}

@Preview(name = "Produk · nominal panjang", widthDp = 320, showBackground = true)
@Composable
private fun LargeInventorySummaryPreview() {
    MaterialTheme {
        Column(Modifier.background(Cream).padding(20.dp)) {
            ProductInventorySummary(InventorySummary(1234, 1_234_567_890L, BigInteger("999999999999999999999999999999")))
        }
    }
}
