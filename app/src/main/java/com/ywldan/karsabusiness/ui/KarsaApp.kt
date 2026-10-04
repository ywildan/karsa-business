package com.ywldan.karsabusiness.ui

import android.app.Activity
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.ui.unit.dp
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.ywldan.karsabusiness.ui.screens.AuthScreen
import com.ywldan.karsabusiness.ui.screens.MainShell
import com.ywldan.karsabusiness.ui.screens.OnboardingScreen
import com.ywldan.karsabusiness.ui.screens.ProductFormScreen
import com.ywldan.karsabusiness.ui.screens.SetupBusinessScreen
import com.ywldan.karsabusiness.ui.screens.TransactionFormScreen
import com.ywldan.karsabusiness.ui.components.KarsaSnackbar
import com.ywldan.karsabusiness.ui.theme.Cream
import com.ywldan.karsabusiness.ui.theme.Forest

private enum class AppStage { LOADING, ONBOARDING, AUTH, SETUP, MAIN }

@Composable
fun KarsaApp(model: MainViewModel, activity: Activity) {
    val state by model.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    val stage = when {
        state.loading -> AppStage.LOADING
        !state.onboardingSeen -> AppStage.ONBOARDING
        state.user == null -> AppStage.AUTH
        state.business == null -> AppStage.SETUP
        else -> AppStage.MAIN
    }

    LaunchedEffect(state.message) {
        state.message?.let {
            snackbar.showSnackbar(it)
            model.consumeMessage()
        }
    }

    Box(Modifier.fillMaxSize().background(Cream)) {
        AnimatedContent(targetState = stage, label = "app-stage") { current ->
            when (current) {
                AppStage.LOADING -> Box(
                    Modifier.fillMaxSize().background(Forest),
                    contentAlignment = Alignment.Center,
                ) { CircularProgressIndicator(color = MaterialTheme.colorScheme.secondaryContainer) }
                AppStage.ONBOARDING -> OnboardingScreen(model::finishOnboarding)
                AppStage.AUTH -> AuthScreen(
                    busy = state.busy,
                    firebaseConfigured = com.ywldan.karsabusiness.BuildConfig.FIREBASE_API_KEY.isNotBlank(),
                    onSignIn = model::signIn,
                    onRegister = model::register,
                    onGoogle = model::signInWithGoogle,
                    onLocalDemo = model::useLocalDemo,
                )
                AppStage.SETUP -> SetupBusinessScreen(state.busy, model::createBusiness)
                AppStage.MAIN -> MainShell(state, model)
            }
        }

        AnimatedVisibility(
            visible = state.showTransactionForm,
            enter = slideInVertically { it } + fadeIn(),
            exit = slideOutVertically { it } + fadeOut(),
        ) {
            TransactionFormScreen(
                editing = state.transactionEditor,
                busy = state.busy,
                products = state.products,
                onClose = model::closeAdd,
                onSave = model::saveTransaction,
                onDelete = model::deleteTransaction,
            )
        }

        AnimatedVisibility(
            visible = state.showProductForm,
            enter = slideInVertically { it } + fadeIn(),
            exit = slideOutVertically { it } + fadeOut(),
        ) {
            ProductFormScreen(
                editing = state.productEditor,
                busy = state.busy,
                onClose = model::closeProductForm,
                onSave = model::saveProduct,
                onDelete = model::deleteProduct,
            )
        }

        SnackbarHost(
            hostState = snackbar,
            modifier = Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(top = 12.dp),
        ) { data -> KarsaSnackbar(data) }
    }
}

