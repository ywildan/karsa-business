package com.ywldan.karsabusiness.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
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
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AccountBalanceWallet
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.Insights
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ywldan.karsabusiness.ui.components.KarsaLogo
import com.ywldan.karsabusiness.ui.components.PrimaryButton
import com.ywldan.karsabusiness.ui.theme.Amber
import com.ywldan.karsabusiness.ui.theme.Coral
import com.ywldan.karsabusiness.ui.theme.Cream
import com.ywldan.karsabusiness.ui.theme.Ink
import com.ywldan.karsabusiness.ui.theme.Karsa
import com.ywldan.karsabusiness.ui.theme.Lime
import com.ywldan.karsabusiness.ui.theme.Mint
import com.ywldan.karsabusiness.ui.theme.Muted
import kotlinx.coroutines.launch

private data class OnboardingPage(
    val icon: ImageVector,
    val title: String,
    val description: String,
    val accent: Color,
)

@Composable
fun OnboardingScreen(onFinished: () -> Unit) {
    // Dibuat di dalam composable karena aksen warna kini mengikuti mode tampilan.
    val pages = listOf(
        OnboardingPage(
            Icons.Rounded.AccountBalanceWallet,
            "Uang usaha, jangan dicampur lagi.",
            "Pisahkan kas bisnis dari uang jajan supaya kamu tahu usaha benar-benar tumbuh.",
            Lime,
        ),
        OnboardingPage(
            Icons.Rounded.Bolt,
            "Catat transaksi secepat pesan kopi.",
            "Nominal, kategori, simpan. Transaksi harian masuk hanya dalam beberapa ketukan.",
            Amber,
        ),
        OnboardingPage(
            Icons.Rounded.Insights,
            "Laba terlihat tanpa hitung manual.",
            "Karsa merangkum pemasukan, pengeluaran, saldo, dan performa usahamu.",
            Mint,
        ),
    )
    val pager = rememberPagerState(pageCount = { pages.size })
    val scope = rememberCoroutineScope()
    Column(
        Modifier.fillMaxSize().background(Cream).padding(horizontal = 24.dp).padding(top = 42.dp, bottom = 24.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            KarsaLogo(Modifier.size(46.dp))
            Text("Karsa Business", Modifier.padding(start = 12.dp), fontWeight = FontWeight.ExtraBold, fontSize = 18.sp)
        }
        HorizontalPager(state = pager, modifier = Modifier.weight(1f)) { index ->
            OnboardingPageContent(pages[index])
        }
        Row(
            Modifier.fillMaxWidth().padding(bottom = 22.dp),
            horizontalArrangement = Arrangement.Center,
        ) {
            pages.indices.forEach { index ->
                Box(
                    Modifier.padding(horizontal = 4.dp)
                        .size(if (pager.currentPage == index) 24.dp else 8.dp, 8.dp)
                        .background(if (pager.currentPage == index) Ink else Ink.copy(alpha = .18f), CircleShape),
                )
            }
        }
        PrimaryButton(
            text = if (pager.currentPage == pages.lastIndex) "Mulai kelola usaha" else "Lanjut",
            onClick = {
                if (pager.currentPage == pages.lastIndex) onFinished()
                else scope.launch { pager.animateScrollToPage(pager.currentPage + 1) }
            },
        )
    }
}

@Composable
private fun OnboardingPageContent(page: OnboardingPage) {
    Column(
        Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            Modifier.fillMaxWidth().height(290.dp).background(page.accent.copy(alpha = .55f), RoundedCornerShape(42.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Canvas(Modifier.fillMaxSize()) {
                drawCircle(Color.White.copy(alpha = .55f), size.minDimension * .31f, center)
                drawCircle(Coral.copy(alpha = .8f), 8.dp.toPx(), Offset(size.width * .17f, size.height * .2f))
                drawCircle(Karsa.copy(alpha = .8f), 6.dp.toPx(), Offset(size.width * .83f, size.height * .77f))
            }
            Icon(page.icon, null, Modifier.size(112.dp), tint = Ink)
        }
        Spacer(Modifier.height(34.dp))
        Text(
            page.title,
            style = MaterialTheme.typography.headlineLarge,
            textAlign = TextAlign.Center,
            color = Ink,
        )
        Spacer(Modifier.height(12.dp))
        Text(
            page.description,
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center,
            color = Muted,
        )
    }
}

