package com.ywldan.karsabusiness.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ywldan.karsabusiness.ui.theme.Forest
import com.ywldan.karsabusiness.ui.theme.Lime
import com.ywldan.karsabusiness.ui.theme.Muted
import java.text.NumberFormat
import java.util.Locale

private val Indonesian = Locale("id", "ID")

fun rupiah(amount: Long): String = NumberFormat.getCurrencyInstance(Indonesian)
    .format(amount)
    .replace(",00", "")
    .replace("Rp", "Rp ")

/** Format digit mentah untuk field input harga: "10000" -> "10.000"; "" bila kosong. */
fun formatRupiahInput(digits: String): String {
    val number = digits.toLongOrNull() ?: return ""
    return NumberFormat.getNumberInstance(Indonesian).format(number)
}

@Composable
fun KarsaLogo(modifier: Modifier = Modifier, dark: Boolean = false) {
    val background = if (dark) Forest else Lime
    val foreground = if (dark) Lime else Forest
    Surface(modifier = modifier, shape = RoundedCornerShape(16.dp), color = background) {
        Canvas(Modifier.padding(9.dp)) {
            val w = size.width
            val h = size.height
            val stem = Stroke(width = w * .091f, cap = StrokeCap.Round)
            val detail = Stroke(width = w * .084f, cap = StrokeCap.Round)
            /* Huruf "Kb" gaya stroke, sama dengan ikon launcher. */
            val stems = Path().apply {
                moveTo(w * .269f, h * .334f)
                lineTo(w * .269f, h * .666f)
                moveTo(w * .581f, h * .334f)
                lineTo(w * .581f, h * .666f)
            }
            drawPath(stems, foreground, style = stem)
            val arms = Path().apply {
                moveTo(w * .269f, h * .5f)
                lineTo(w * .469f, h * .334f)
                moveTo(w * .269f, h * .5f)
                lineTo(w * .469f, h * .666f)
            }
            drawPath(arms, foreground, style = detail)
            drawCircle(foreground, radius = w * .078f, center = Offset(w * .659f, h * .588f), style = detail)
        }
    }
}

@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    busy: Boolean = false,
) {
    Button(
        onClick = onClick,
        enabled = enabled && !busy,
        modifier = modifier.fillMaxWidth().height(54.dp),
        shape = RoundedCornerShape(18.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = Forest,
            contentColor = Color.White,
            disabledContainerColor = Forest.copy(alpha = .45f),
        ),
    ) {
        if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = Lime, strokeWidth = 2.dp)
        else Text(text, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun SectionHeader(title: String, action: String? = null, onAction: (() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, style = MaterialTheme.typography.titleLarge)
        if (action != null && onAction != null) {
            androidx.compose.material3.TextButton(onClick = onAction) {
                Text(action, color = Forest, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
fun EmptyState(title: String, description: String) {
    Box(
        Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(24.dp)).padding(28.dp),
        contentAlignment = Alignment.Center,
    ) {
        androidx.compose.foundation.layout.Column(horizontalAlignment = Alignment.CenterHorizontally) {
            KarsaLogo(Modifier.size(52.dp))
            Spacer(Modifier.height(14.dp))
            Text(title, style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(4.dp))
            Text(description, color = Muted, style = MaterialTheme.typography.bodySmall)
        }
    }
}

