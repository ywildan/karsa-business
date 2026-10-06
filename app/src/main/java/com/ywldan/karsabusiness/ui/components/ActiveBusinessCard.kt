package com.ywldan.karsabusiness.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.Storefront
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ywldan.karsabusiness.ui.theme.Cream
import com.ywldan.karsabusiness.ui.theme.Forest
import com.ywldan.karsabusiness.ui.theme.Lime
import com.ywldan.karsabusiness.ui.theme.Mint
import com.ywldan.karsabusiness.ui.theme.Muted
import com.ywldan.karsabusiness.ui.theme.Sand

@Composable
fun ActiveBusinessCard(
    name: String,
    category: String,
    premium: Boolean,
    businessCount: Int,
    businessLimit: Int,
    onSwitch: () -> Unit,
    onManage: () -> Unit,
    enabled: Boolean = true,
    modifier: Modifier = Modifier,
) {
    val initial = name.trim().let {
        if (it.isEmpty()) "K" else String(Character.toChars(it.codePointAt(0))).uppercase(java.util.Locale.forLanguageTag("id-ID"))
    }
    Column(modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(24.dp)).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Surface(
            onClick = onSwitch,
            enabled = enabled,
            modifier = Modifier.fillMaxWidth().semantics {
                contentDescription = "Ganti bisnis aktif: $name, kategori $category"
            },
            shape = RoundedCornerShape(18.dp),
            color = Color.White,
            contentColor = Forest,
        ) {
            Column(Modifier.padding(vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Bisnis aktif", color = Muted, style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.Bold)
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                        Text("Ganti", color = Forest, fontWeight = FontWeight.Bold,
                            style = MaterialTheme.typography.bodySmall)
                        Box(Modifier.size(32.dp).background(Mint, CircleShape), contentAlignment = Alignment.Center) {
                            Icon(Icons.Rounded.ChevronRight, null, Modifier.size(20.dp), tint = Forest)
                        }
                    }
                }
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Box(Modifier.size(56.dp).background(Lime, CircleShape), contentAlignment = Alignment.Center) {
                        Text(initial, color = Forest, fontWeight = FontWeight.ExtraBold, fontSize = 26.sp)
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                        Text(name, color = Forest, fontWeight = FontWeight.ExtraBold, fontSize = 26.sp,
                            lineHeight = 32.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(category.ifBlank { "Lainnya" },
                            Modifier.background(Mint, RoundedCornerShape(100.dp)).padding(horizontal = 10.dp, vertical = 5.dp),
                            color = Forest, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(Cream))
        Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
            Text("Paket ${if (premium) "Premium" else "gratis"} · $businessCount dari $businessLimit bisnis",
                color = Muted, style = MaterialTheme.typography.bodySmall)
            Row(Modifier.fillMaxWidth().semantics {
                contentDescription = "$businessCount dari $businessLimit slot bisnis terpakai"
            }, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                repeat(businessLimit.coerceIn(1, 5)) { slot ->
                    Box(Modifier.weight(1f).height(5.dp)
                        .background(if (slot < businessCount) Forest else Cream, RoundedCornerShape(100.dp)))
                }
            }
        }
        OutlinedButton(
            onClick = onManage,
            enabled = enabled,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
            border = BorderStroke(1.dp, Sand),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = Forest),
        ) {
            Icon(Icons.Rounded.Storefront, null, Modifier.size(19.dp))
            Text("Kelola bisnis", Modifier.padding(start = 9.dp), fontWeight = FontWeight.Bold)
        }
    }
}

@androidx.compose.ui.tooling.preview.Preview(name = "Profil · bisnis aktif", widthDp = 390, showBackground = true)
@androidx.compose.ui.tooling.preview.Preview(name = "Profil · teks besar", widthDp = 320, fontScale = 1.5f, showBackground = true)
@Composable
private fun ActiveBusinessCardPreview() {
    MaterialTheme {
        Column(Modifier.background(Cream).padding(20.dp)) {
            ActiveBusinessCard(
                name = "kentang", category = "Makanan", premium = true,
                businessCount = 1, businessLimit = 5, onSwitch = {}, onManage = {},
            )
        }
    }
}
