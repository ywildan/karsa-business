package com.ywldan.karsabusiness.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.CloudSync
import androidx.compose.material.icons.rounded.Logout
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import com.ywldan.karsabusiness.ui.components.ActiveBusinessCard
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ywldan.karsabusiness.BuildConfig
import com.ywldan.karsabusiness.ui.MainUiState
import com.ywldan.karsabusiness.ui.components.KarsaLogo
import com.ywldan.karsabusiness.ui.theme.Card
import com.ywldan.karsabusiness.ui.theme.Cream
import com.ywldan.karsabusiness.ui.theme.Forest
import com.ywldan.karsabusiness.ui.theme.Lime
import com.ywldan.karsabusiness.ui.theme.Mint
import com.ywldan.karsabusiness.ui.theme.Muted

@Composable
fun ProfileScreen(
    state: MainUiState,
    padding: PaddingValues,
    onSync: () -> Unit,
    onLogout: () -> Unit,
    onBusiness: () -> Unit,
    onManageBusinesses: () -> Unit,
    onSettings: () -> Unit,
) {
    LazyColumn(
        Modifier.fillMaxSize().background(Cream),
        contentPadding = PaddingValues(
            start = 20.dp,
            end = 20.dp,
            top = padding.calculateTopPadding() + 28.dp,
            bottom = padding.calculateBottomPadding() + 28.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item { Text("Profil", style = MaterialTheme.typography.headlineLarge) }
        item {
            Row(
                Modifier.fillMaxWidth().background(Forest, RoundedCornerShape(28.dp)).padding(20.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                KarsaLogo(Modifier.size(62.dp))
                Column(Modifier.padding(start = 15.dp)) {
                    Text(state.user?.name.orEmpty(), color = Color.White, style = MaterialTheme.typography.titleLarge)
                    Text(state.user?.email.orEmpty(), color = Color.White.copy(alpha = .65f), style = MaterialTheme.typography.bodySmall)
                    Row(Modifier.padding(top = 8.dp).background(Lime, RoundedCornerShape(100.dp)).padding(horizontal = 10.dp, vertical = 5.dp)) {
                        Icon(Icons.Rounded.School, null, Modifier.size(15.dp), tint = Forest)
                        Text("Mahasiswa Untidar", Modifier.padding(start = 5.dp), color = Forest, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
        item {
            Row(
                Modifier.fillMaxWidth().background(Card, RoundedCornerShape(24.dp))
                    .clickable(onClick = onSettings).padding(18.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier.size(44.dp).background(Mint, CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Rounded.Settings, null, tint = Forest)
                }
                Column(Modifier.weight(1f).padding(start = 14.dp)) {
                    Text("Pengaturan", fontWeight = FontWeight.Bold)
                    Text("Tema & tampilan", color = Muted, style = MaterialTheme.typography.bodySmall)
                }
                Icon(Icons.Rounded.ChevronRight, null, tint = Muted)
            }
        }
        item {
            ActiveBusinessCard(
                name = state.business?.name.orEmpty(),
                category = state.business?.type.orEmpty(),
                premium = state.account.premium,
                businessCount = state.businesses.size,
                businessLimit = state.account.businessLimit,
                onSwitch = onBusiness,
                onManage = onManageBusinesses,
                enabled = !state.busy,
            )
        }
        item {
            Column(Modifier.fillMaxWidth().background(Card, RoundedCornerShape(24.dp)).padding(18.dp)) {
                Text("Sinkronisasi", fontWeight = FontWeight.Bold)
                Text("${state.pendingCount} perubahan menunggu", color = Muted)
                if (state.sync.message.isNotBlank()) Text(state.sync.message, color = Muted)
                if (state.sync.lastSuccess > 0) Text(
                    "Terakhir berhasil: " + java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT, java.text.DateFormat.SHORT).format(java.util.Date(state.sync.lastSuccess)),
                    color = Muted, style = MaterialTheme.typography.bodySmall,
                )
            }
        }
        item {
            OutlinedButton(onClick = onSync, Modifier.fillMaxWidth(), enabled = state.sync.phase != "running", shape = RoundedCornerShape(18.dp)) {
                Icon(Icons.Rounded.CloudSync, null)
                Text("Sinkronkan sekarang", Modifier.padding(start = 9.dp), fontWeight = FontWeight.Bold)
            }
        }
        item {
            OutlinedButton(onClick = onLogout, Modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp)) {
                Icon(Icons.Rounded.Logout, null)
                Text("Keluar dari akun", Modifier.padding(start = 9.dp), fontWeight = FontWeight.Bold)
            }
        }
        item {
            Text(
                "Karsa Business v${BuildConfig.VERSION_NAME}\nData tersimpan lokal dan disinkronkan saat internet tersedia.",
                color = Muted,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}
