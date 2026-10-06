package com.ywldan.karsabusiness.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Business
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ywldan.karsabusiness.ui.MainUiState
import com.ywldan.karsabusiness.ui.theme.Cream
import com.ywldan.karsabusiness.ui.theme.Forest
import com.ywldan.karsabusiness.ui.theme.Lime
import com.ywldan.karsabusiness.ui.theme.Mint
import com.ywldan.karsabusiness.ui.theme.Muted

/** An unobtrusive business context inside the page's existing header. */
@Composable
fun BusinessPicker(name: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.widthIn(max = 280.dp).heightIn(min = 48.dp)
            .semantics { contentDescription = "Bisnis aktif: $name. Buka pilihan bisnis" },
        shape = RoundedCornerShape(100.dp),
        color = Mint,
        contentColor = Forest,
    ) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            Icon(Icons.Rounded.Business, null, Modifier.size(16.dp))
            Text(name, Modifier.weight(1f, fill = false), style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Icon(Icons.Rounded.ExpandMore, null, Modifier.size(18.dp))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BusinessSwitcherSheet(state: MainUiState, onDismiss: () -> Unit, onSelect: (String) -> Unit, onManage: () -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Cream,
        contentColor = Forest,
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
    ) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Ganti bisnis", style = MaterialTheme.typography.headlineSmall)
            Text("Pilih usaha yang ingin kamu lihat dan kelola.", color = Muted, style = MaterialTheme.typography.bodyMedium)
            state.businesses.forEach { business ->
                val active = business.id == state.business?.id
                Surface(
                    onClick = { onSelect(business.id) },
                    enabled = !state.busy,
                    modifier = Modifier.fillMaxWidth().semantics { selected = active },
                    color = if (active) Mint else Color.White,
                    contentColor = Forest,
                    shape = RoundedCornerShape(20.dp),
                ) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box(Modifier.size(40.dp).background(if (active) Lime else Cream, CircleShape),
                            contentAlignment = Alignment.Center) {
                            Icon(Icons.Rounded.Business, null, Modifier.size(20.dp))
                        }
                        Column(Modifier.weight(1f)) {
                            Text(business.name, style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(business.type + if (active) " · Sedang aktif" else "", color = Muted,
                                style = MaterialTheme.typography.bodySmall)
                        }
                        if (active) Icon(Icons.Rounded.Check, "Bisnis terpilih", Modifier.size(22.dp))
                    }
                }
            }
            TextButton(onClick = onManage, enabled = !state.busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Text("Kelola bisnis", fontWeight = FontWeight.Bold)
                Icon(Icons.Rounded.ChevronRight, null, Modifier.padding(start = 6.dp).size(18.dp))
            }
        }
    }
}
