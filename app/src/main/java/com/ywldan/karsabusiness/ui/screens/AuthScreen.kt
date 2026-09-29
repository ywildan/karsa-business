package com.ywldan.karsabusiness.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Email
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.ywldan.karsabusiness.BuildConfig
import com.ywldan.karsabusiness.ui.components.KarsaLogo
import com.ywldan.karsabusiness.ui.components.PrimaryButton
import com.ywldan.karsabusiness.ui.theme.Cream
import com.ywldan.karsabusiness.ui.theme.Forest
import com.ywldan.karsabusiness.ui.theme.Lime
import com.ywldan.karsabusiness.ui.theme.Muted

@Composable
fun AuthScreen(
    busy: Boolean,
    firebaseConfigured: Boolean,
    onSignIn: (String, String) -> Unit,
    onRegister: (String, String, String) -> Unit,
    onGoogle: () -> Unit,
    onLocalDemo: () -> Unit,
) {
    var isRegister by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    Column(
        Modifier.fillMaxSize().background(Cream).verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp).padding(top = 48.dp, bottom = 32.dp),
    ) {
        KarsaLogo(Modifier.size(56.dp))
        Spacer(Modifier.height(22.dp))
        Text(if (isRegister) "Mulai usahamu." else "Selamat datang kembali.", style = MaterialTheme.typography.headlineLarge)
        Text(
            if (isRegister) "Daftar dengan email mahasiswa Untidar." else "Catatan usahamu siap dilanjutkan.",
            Modifier.padding(top = 8.dp),
            color = Muted,
        )

        Row(
            Modifier.fillMaxWidth().padding(top = 28.dp).background(Color.White, RoundedCornerShape(16.dp)).padding(4.dp),
        ) {
            AuthTab("Masuk", !isRegister, Modifier.weight(1f)) { isRegister = false }
            AuthTab("Daftar", isRegister, Modifier.weight(1f)) { isRegister = true }
        }

        if (isRegister) {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                modifier = Modifier.fillMaxWidth().padding(top = 20.dp),
                label = { Text("Nama lengkap") },
                leadingIcon = { Icon(Icons.Rounded.Person, null) },
                singleLine = true,
                shape = RoundedCornerShape(18.dp),
            )
        }
        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            modifier = Modifier.fillMaxWidth().padding(top = if (isRegister) 12.dp else 20.dp),
            label = { Text("Email mahasiswa") },
            placeholder = { Text("nama@students.untidar.ac.id") },
            leadingIcon = { Icon(Icons.Rounded.Email, null) },
            singleLine = true,
            shape = RoundedCornerShape(18.dp),
        )
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
            label = { Text("Kata sandi") },
            leadingIcon = { Icon(Icons.Rounded.Lock, null) },
            visualTransformation = PasswordVisualTransformation(),
            singleLine = true,
            shape = RoundedCornerShape(18.dp),
        )
        PrimaryButton(
            text = if (isRegister) "Buat akun" else "Masuk",
            onClick = { if (isRegister) onRegister(name, email, password) else onSignIn(email, password) },
            modifier = Modifier.padding(top = 20.dp),
            enabled = firebaseConfigured,
            busy = busy,
        )

        Row(Modifier.fillMaxWidth().padding(vertical = 20.dp), verticalAlignment = Alignment.CenterVertically) {
            HorizontalDivider(Modifier.weight(1f))
            Text("atau", Modifier.padding(horizontal = 12.dp), color = Muted, style = MaterialTheme.typography.bodySmall)
            HorizontalDivider(Modifier.weight(1f))
        }
        OutlinedButton(
            onClick = onGoogle,
            enabled = firebaseConfigured && !busy,
            modifier = Modifier.fillMaxWidth().height(54.dp),
            shape = RoundedCornerShape(18.dp),
        ) {
            Box(Modifier.size(24.dp).background(Lime, RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) {
                Text("G", color = Forest, fontWeight = FontWeight.ExtraBold)
            }
            Text("Lanjutkan dengan Google", Modifier.padding(start = 10.dp), color = Forest, fontWeight = FontWeight.Bold)
        }

        if (!firebaseConfigured) {
            Text(
                "Firebase belum aktif pada build ini. Tambahkan GitHub Secrets untuk mengaktifkan login.",
                Modifier.padding(top = 18.dp),
                color = Muted,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        if (BuildConfig.DEBUG) {
            TextButton(onClick = onLocalDemo, modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 6.dp)) {
                Text("Coba mode lokal (debug)")
            }
        }
        Text(
            "Khusus mahasiswa dengan domain @students.untidar.ac.id",
            Modifier.fillMaxWidth().padding(top = 18.dp),
            color = Muted,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

@Composable
private fun AuthTab(text: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier.height(42.dp).background(if (selected) Forest else Color.Transparent, RoundedCornerShape(13.dp)).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = if (selected) Color.White else Muted, fontWeight = FontWeight.Bold)
    }
}

