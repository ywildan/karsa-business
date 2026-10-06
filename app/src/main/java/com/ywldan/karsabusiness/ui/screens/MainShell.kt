package com.ywldan.karsabusiness.ui.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Assessment
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Inventory2
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.ReceiptLong
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import com.ywldan.karsabusiness.ui.components.BusinessSwitcherSheet
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.ywldan.karsabusiness.ui.MainTab
import com.ywldan.karsabusiness.ui.MainUiState
import com.ywldan.karsabusiness.ui.MainViewModel
import com.ywldan.karsabusiness.ui.theme.Cream
import com.ywldan.karsabusiness.ui.theme.Forest
import com.ywldan.karsabusiness.ui.theme.Lime
import com.ywldan.karsabusiness.ui.theme.Muted

private data class TabItem(val tab: MainTab, val label: String, val icon: ImageVector)
private val tabs = listOf(
    TabItem(MainTab.HOME, "Beranda", Icons.Rounded.Home),
    TabItem(MainTab.HISTORY, "Transaksi", Icons.Rounded.ReceiptLong),
    TabItem(MainTab.PRODUCTS, "Produk", Icons.Rounded.Inventory2),
    TabItem(MainTab.REPORTS, "Laporan", Icons.Rounded.Assessment),
    TabItem(MainTab.PROFILE, "Profil", Icons.Rounded.Person),
)

@Composable
fun MainShell(state: MainUiState, model: MainViewModel) {
    var showBusinessSwitcher by rememberSaveable { mutableStateOf(false) }
    val openBusinessSwitcher = { showBusinessSwitcher = true }
    val showStatus = state.businessReadOnly || state.sync.message.isNotBlank() ||
        state.pendingCount > 0 || state.sync.phase == "running"
    Scaffold(
        containerColor = Cream,
        topBar = {
            Column(if (showStatus) Modifier.statusBarsPadding() else Modifier) {
                if (state.businessReadOnly) {
                    Text("Bisnis ini hanya dapat dibaca", Modifier.fillMaxWidth().background(Lime).padding(12.dp), color = Forest)
                }
                if (state.sync.message.isNotBlank() || state.pendingCount > 0 || state.sync.phase == "running") {
                    Column(Modifier.fillMaxWidth().background(Color.White).padding(horizontal = 20.dp, vertical = 8.dp)) {
                        Text(when {
                            state.sync.phase == "running" -> "Menyinkronkan data…"
                            state.sync.message.isNotBlank() -> state.sync.message
                            else -> "${state.pendingCount} perubahan belum tersinkron. Data tersimpan di perangkat."
                        })
                        if (state.sync.phase != "running") {
                            TextButton(onClick = model::syncNow) { Text("Coba sinkronkan") }
                        }
                    }
                }
            }
        },
        bottomBar = {
            NavigationBar(containerColor = Color.White, tonalElevation = 0.dp) {
                tabs.forEach { item ->
                    NavigationBarItem(
                        selected = state.selectedTab == item.tab,
                        onClick = { model.selectTab(item.tab) },
                        icon = { Icon(item.icon, item.label) },
                        label = { Text(item.label) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = Forest,
                            selectedTextColor = Forest,
                            indicatorColor = Lime,
                            unselectedIconColor = Muted,
                            unselectedTextColor = Muted,
                        ),
                    )
                }
            }
        },
        floatingActionButton = {
            when (state.selectedTab) {
                MainTab.HOME, MainTab.HISTORY -> FloatingActionButton(
                    onClick = { model.openAdd() },
                    shape = CircleShape,
                    containerColor = Lime,
                    contentColor = Forest,
                ) { Icon(Icons.Rounded.Add, "Catat transaksi") }
                MainTab.PRODUCTS -> FloatingActionButton(
                    onClick = { model.openProductForm() },
                    shape = CircleShape,
                    containerColor = Lime,
                    contentColor = Forest,
                ) { Icon(Icons.Rounded.Add, "Tambah produk") }
                else -> Unit
            }
        },
    ) { padding ->
        AnimatedContent(state.selectedTab, label = "main-tab") { tab ->
            when (tab) {
                MainTab.HOME -> HomeScreen(state, padding, model::selectTab, model::openAdd, openBusinessSwitcher)
                MainTab.HISTORY -> HistoryScreen(state, padding, model::openAdd, openBusinessSwitcher)
                MainTab.PRODUCTS -> ProductScreen(state, padding, model, openBusinessSwitcher)
                MainTab.REPORTS -> ReportsScreen(state, padding, openBusinessSwitcher)
                MainTab.PROFILE -> ProfileScreen(state, padding, model::syncNow, model::signOut, openBusinessSwitcher, model::openBusinessManager)
            }
        }
    }
    if (showBusinessSwitcher) {
        BusinessSwitcherSheet(
            state = state,
            onDismiss = { showBusinessSwitcher = false },
            onSelect = { id -> model.selectBusiness(id); showBusinessSwitcher = false },
            onManage = { showBusinessSwitcher = false; model.openBusinessManager() },
        )
    }

}

