package com.ywldan.karsabusiness

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.remember
import androidx.lifecycle.viewmodel.compose.viewModel
import com.ywldan.karsabusiness.auth.AuthService
import com.ywldan.karsabusiness.ui.KarsaApp
import com.ywldan.karsabusiness.ui.MainViewModel
import com.ywldan.karsabusiness.ui.MainViewModelFactory
import com.ywldan.karsabusiness.ui.theme.KarsaTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val app = application as KarsaApplication
        setContent {
            KarsaTheme {
                val authService = remember { AuthService(this) }
                val factory = remember { MainViewModelFactory(app.repository, authService, app) }
                val model: MainViewModel = viewModel(factory = factory)
                KarsaApp(model = model, activity = this)
            }
        }
    }
}

