package com.ywldan.karsabusiness.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * True bila dark mode aktif. Disediakan oleh [KarsaTheme]; default false (mode terang)
 * sehingga composable yang dipakai di @Preview tanpa KarsaTheme tetap aman.
 */
val LocalDarkTheme = compositionLocalOf { false }

private val isNight: Boolean
    @Composable get() = LocalDarkTheme.current

/* Aksen brand — nilainya sama di mode terang maupun gelap. */
val Forest = Color(0xFF0E3B2E)
val Pine = Color(0xFF1B5A45)
val Karsa = Color(0xFF12A36B)
val Lime = Color(0xFFD4F36B)
val Coral = Color(0xFFEF5F4A)
val Amber = Color(0xFFF2AD37)

/* Nilai mentah tiap mode; dipakai membangun ColorScheme di Theme.kt. */
internal val CreamLight = Color(0xFFF6F4EE)
internal val CreamDark = Color(0xFF0D1311)
internal val CardDark = Color(0xFF151C19)
internal val SandLight = Color(0xFFEBE7DC)
internal val SandDark = Color(0xFF232B27)
internal val InkLight = Color(0xFF10201A)
internal val InkDark = Color(0xFFEDF2EF)
internal val MutedLight = Color(0xFF6C7A73)
internal val MutedDark = Color(0xFF9DB0A6)
internal val MintLight = Color(0xFFE1F4E9)
internal val MintDark = Color(0xFF17271F)
internal val OnMintLight = Forest
internal val OnMintDark = Color(0xFFA3DDB9)
internal val BlushLight = Color(0xFFFDE8E3)
internal val BlushDark = Color(0xFF2F1E18)
internal val OnBlushLight = Coral
internal val OnBlushDark = Color(0xFFFFA08A)
internal val ButterLight = Color(0xFFFDF0D5)
internal val ButterDark = Color(0xFF2C2212)
internal val OnButterLight = Color(0xFF8A5A00)
internal val OnButterDark = Color(0xFFF0BE5F)

/* Latar & teks — otomatis mengikuti mode. */
val Cream: Color
    @Composable get() = if (isNight) CreamDark else CreamLight
val Card: Color
    @Composable get() = if (isNight) CardDark else Color.White
val Sand: Color
    @Composable get() = if (isNight) SandDark else SandLight
val Ink: Color
    @Composable get() = if (isNight) InkDark else InkLight
val Muted: Color
    @Composable get() = if (isNight) MutedDark else MutedLight

/* Wadah bernuansa + warna kontennya (ikon/teks di atasnya). */
val Mint: Color
    @Composable get() = if (isNight) MintDark else MintLight
val OnMint: Color
    @Composable get() = if (isNight) OnMintDark else OnMintLight
val Blush: Color
    @Composable get() = if (isNight) BlushDark else BlushLight
val OnBlush: Color
    @Composable get() = if (isNight) OnBlushDark else OnBlushLight
val Butter: Color
    @Composable get() = if (isNight) ButterDark else ButterLight
val OnButter: Color
    @Composable get() = if (isNight) OnButterDark else OnButterLight
