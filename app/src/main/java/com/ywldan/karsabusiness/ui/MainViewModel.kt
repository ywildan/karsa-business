package com.ywldan.karsabusiness.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.ywldan.karsabusiness.BuildConfig
import com.ywldan.karsabusiness.auth.AuthService
import com.ywldan.karsabusiness.auth.AuthUser
import com.ywldan.karsabusiness.data.local.BusinessEntity
import com.ywldan.karsabusiness.data.local.TransactionEntity
import com.ywldan.karsabusiness.data.local.TransactionType
import com.ywldan.karsabusiness.data.repository.KarsaRepository
import com.ywldan.karsabusiness.data.sync.SyncScheduler
import com.ywldan.karsabusiness.domain.FinanceSummary
import com.ywldan.karsabusiness.domain.calculateSummary
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class MainTab { HOME, HISTORY, REPORTS, PROFILE }

data class MainUiState(
    val loading: Boolean = true,
    val onboardingSeen: Boolean = false,
    val user: AuthUser? = null,
    val business: BusinessEntity? = null,
    val transactions: List<TransactionEntity> = emptyList(),
    val summary: FinanceSummary = FinanceSummary(0, 0, 0, 0),
    val selectedTab: MainTab = MainTab.HOME,
    val transactionEditor: TransactionEntity? = null,
    val showTransactionForm: Boolean = false,
    val busy: Boolean = false,
    val message: String? = null,
)

class MainViewModel(
    private val repository: KarsaRepository,
    private val auth: AuthService,
    application: Application,
) : AndroidViewModel(application) {
    private val preferences = application.getSharedPreferences("karsa_preferences", 0)
    private val _state = MutableStateFlow(MainUiState())
    val state: StateFlow<MainUiState> = _state.asStateFlow()
    private var dataJob: Job? = null

    init {
        val user = auth.currentUser()
        _state.update {
            it.copy(
                loading = user != null,
                onboardingSeen = preferences.getBoolean("onboarding_seen", false),
                user = user,
            )
        }
        if (user != null) observeUserData(user) else _state.update { it.copy(loading = false) }
    }

    fun finishOnboarding() {
        preferences.edit().putBoolean("onboarding_seen", true).apply()
        _state.update { it.copy(onboardingSeen = true) }
    }

    fun signIn(email: String, password: String) = performAuth {
        auth.signIn(email, password)
    }

    fun register(name: String, email: String, password: String) {
        viewModelScope.launch {
            setBusy(true)
            runCatching { auth.register(name, email, password) }
                .onSuccess { showMessage("Akun dibuat. Periksa email untuk verifikasi, lalu masuk.") }
                .onFailure { showMessage(it.readableMessage()) }
            setBusy(false)
        }
    }

    fun signInWithGoogle() = performAuth { auth.signInWithGoogle() }

    fun useLocalDemo() {
        if (!BuildConfig.DEBUG) return
        val user = AuthUser("local-demo", "demo@students.untidar.ac.id", "Demo Mahasiswa", true)
        _state.update { it.copy(user = user, loading = true) }
        observeUserData(user)
    }

    private fun performAuth(block: suspend () -> AuthUser) {
        viewModelScope.launch {
            setBusy(true)
            runCatching { block() }
                .onSuccess { user ->
                    _state.update { it.copy(user = user, loading = true) }
                    observeUserData(user)
                    SyncScheduler.enqueue(getApplication())
                }
                .onFailure { showMessage(it.readableMessage()) }
            setBusy(false)
        }
    }

    fun createBusiness(name: String, type: String, initialCapital: Long) {
        val user = state.value.user ?: return
        if (name.trim().length < 2) {
            showMessage("Nama usaha minimal 2 karakter")
            return
        }
        viewModelScope.launch {
            setBusy(true)
            runCatching { repository.createBusiness(user.id, name, type, initialCapital) }
                .onFailure { showMessage(it.readableMessage()) }
            setBusy(false)
        }
    }

    fun openAdd(transaction: TransactionEntity? = null) {
        _state.update { it.copy(showTransactionForm = true, transactionEditor = transaction) }
    }

    fun closeAdd() {
        _state.update { it.copy(showTransactionForm = false, transactionEditor = null) }
    }

    fun saveTransaction(
        type: String,
        amount: Long,
        category: String,
        paymentMethod: String,
        note: String,
        transactionDate: Long,
    ) {
        val current = state.value
        val user = current.user ?: return
        val business = current.business ?: return
        if (amount <= 0) {
            showMessage("Nominal transaksi harus lebih dari Rp0")
            return
        }
        viewModelScope.launch {
            setBusy(true)
            runCatching {
                repository.saveTransaction(
                    existingId = current.transactionEditor?.id,
                    ownerId = user.id,
                    businessId = business.id,
                    type = type,
                    amount = amount,
                    category = category,
                    paymentMethod = paymentMethod,
                    note = note,
                    transactionDate = transactionDate,
                )
            }.onSuccess {
                closeAdd()
                showMessage(if (current.transactionEditor == null) "Transaksi tersimpan" else "Transaksi diperbarui")
            }.onFailure { showMessage(it.readableMessage()) }
            setBusy(false)
        }
    }

    fun deleteTransaction(id: String) {
        viewModelScope.launch {
            repository.deleteTransaction(id)
            closeAdd()
            showMessage("Transaksi dipindahkan dari riwayat")
        }
    }

    fun selectTab(tab: MainTab) = _state.update { it.copy(selectedTab = tab) }

    fun syncNow() {
        SyncScheduler.enqueue(getApplication())
        showMessage("Sinkronisasi dijadwalkan")
    }

    fun signOut() {
        auth.signOut()
        dataJob?.cancel()
        _state.update {
            MainUiState(onboardingSeen = true, loading = false)
        }
    }

    fun consumeMessage() = _state.update { it.copy(message = null) }

    private fun observeUserData(user: AuthUser) {
        dataJob?.cancel()
        dataJob = viewModelScope.launch {
            combine(
                repository.observeBusiness(user.id),
                repository.observeTransactions(user.id),
            ) { business, transactions -> business to transactions }
                .collect { (business, transactions) ->
                    _state.update {
                        it.copy(
                            loading = false,
                            business = business,
                            transactions = transactions,
                            summary = calculateSummary(business?.initialCapital ?: 0, transactions),
                        )
                    }
                }
        }
    }

    private fun setBusy(value: Boolean) = _state.update { it.copy(busy = value) }
    private fun showMessage(value: String) = _state.update { it.copy(message = value) }
}

private fun Throwable.readableMessage(): String =
    message?.substringAfter(": ")?.takeIf { it.isNotBlank() } ?: "Terjadi kesalahan. Coba lagi."

class MainViewModelFactory(
    private val repository: KarsaRepository,
    private val authService: AuthService,
    private val application: Application,
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T =
        MainViewModel(repository, authService, application) as T
}
