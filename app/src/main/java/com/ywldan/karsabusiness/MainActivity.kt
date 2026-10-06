package com.ywldan.karsabusiness

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.lifecycle.viewmodel.compose.viewModel
import com.ywldan.karsabusiness.auth.AuthService
import com.ywldan.karsabusiness.ui.KarsaApp
import com.ywldan.karsabusiness.ui.MainViewModel
import com.ywldan.karsabusiness.ui.MainViewModelFactory
import com.ywldan.karsabusiness.ui.theme.KarsaTheme
import com.ywldan.karsabusiness.ui.theme.ThemeMode

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val app = application as KarsaApplication
        setContent {
            val authService = remember { AuthService(this) }
            val factory = remember { MainViewModelFactory(app.repository, authService, app) }
            val model: MainViewModel = viewModel(factory = factory)
            val themeMode by model.themeMode.collectAsState()
            val darkTheme = themeMode == ThemeMode.DARK ||
                (themeMode == ThemeMode.SYSTEM && isSystemInDarkTheme())
            KarsaTheme(darkTheme = darkTheme) {
                KarsaApp(model = model, activity = this)
            }
        }
    }
}
