package com.ywldan.karsabusiness.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.DarkMode
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ywldan.karsabusiness.BuildConfig
import com.ywldan.karsabusiness.ui.theme.Card
import com.ywldan.karsabusiness.ui.theme.Cream
import com.ywldan.karsabusiness.ui.theme.Forest
import com.ywldan.karsabusiness.ui.theme.Lime
import com.ywldan.karsabusiness.ui.theme.Muted
import com.ywldan.karsabusiness.ui.theme.Sand
import com.ywldan.karsabusiness.ui.theme.ThemeMode

/**
 * Halaman pengaturan: overlay penuh dari Profil (bukan tab/navigasi baru).
 * Isinya sengaja ringkas — saat ini hanya tampilan/tema.
 */
@Composable
fun SettingsScreen(
    themeMode: Int,
    onThemeMode: (Int) -> Unit,
    onClose: () -> Unit,
) {
    val systemDark = isSystemInDarkTheme()
    val followSystem = themeMode == ThemeMode.SYSTEM
    val darkOn = when (themeMode) {
        ThemeMode.DARK -> true
        ThemeMode.LIGHT -> false
        else -> systemDark
    }
    Column(
        Modifier.fillMaxSize().background(Cream).statusBarsPadding().navigationBarsPadding()
            .verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onClose) { Icon(Icons.Rounded.Close, "Tutup") }
            Text("Pengaturan", style = MaterialTheme.typography.headlineMedium)
        }
        Column(Modifier.fillMaxWidth().background(Card, RoundedCornerShape(24.dp)).padding(horizontal = 18.dp, vertical = 6.dp)) {
            Row(
                Modifier.fillMaxWidth().padding(vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Rounded.DarkMode, null, tint = Forest)
                Column(Modifier.weight(1f).padding(start = 12.dp)) {
                    Text("Mode gelap", fontWeight = FontWeight.Bold)
                    Text(
                        if (followSystem) "Mengikuti tema sistem" else "Nyaman dilihat di malam hari",
                        color = Muted,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                Switch(
                    checked = darkOn,
                    onCheckedChange = { onThemeMode(if (it) ThemeMode.DARK else ThemeMode.LIGHT) },
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = Forest,
                        checkedTrackColor = Lime,
                    ),
                )
            }
            HorizontalDivider(color = Sand)
            Row(
                Modifier.fillMaxWidth().padding(vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("Ikuti tema sistem", fontWeight = FontWeight.Bold)
                    Text(
                        "Tema berubah mengikuti perangkat",
                        color = Muted,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                Switch(
                    checked = followSystem,
                    onCheckedChange = {
                        onThemeMode(
                            when {
                                it -> ThemeMode.SYSTEM
                                systemDark -> ThemeMode.DARK
                                else -> ThemeMode.LIGHT
                            },
                        )
                    },
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = Forest,
                        checkedTrackColor = Lime,
                    ),
                )
            }
        }
        Text(
            "Karsa Business v${BuildConfig.VERSION_NAME}",
            color = Muted,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}
