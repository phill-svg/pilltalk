package com.bitchat.android.ui.theme

import android.app.Activity
import android.os.Build
import android.view.View
import android.view.WindowInsetsController
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp

// Liquid-glass theme -- matches the PillTalk iOS/web look: light gradient
// backdrop, translucent glass cards, blue accent, orange for "self".
private val DarkColorScheme = darkColorScheme(
    primary = Color(0xFF0A84FF),        // iOS dark-mode blue accent
    onPrimary = Color.White,
    secondary = Color(0xFFFF9F0A),      // Orange, reserved for "self"
    onSecondary = Color.Black,
    background = Color(0xFF15131F),     // Deep blue-purple backdrop base
    onBackground = Color(0xFFF2F2F7),
    surface = Color(0xFF1C1C1E),        // Glass card base (alpha applied at call sites)
    onSurface = Color(0xFFF2F2F7),
    surfaceVariant = Color(0xFF2C2C2E),
    error = Color(0xFFFF453A),
    onError = Color.White
)

private val LightColorScheme = lightColorScheme(
    primary = Color(0xFF007AFF),        // iOS blue accent
    onPrimary = Color.White,
    secondary = Color(0xFFFF9500),      // Orange, reserved for "self"
    onSecondary = Color.White,
    background = Color(0xFFEDF2FF),     // Light gradient backdrop base
    onBackground = Color(0xFF1C1C1E),
    surface = Color(0xFFFFFFFF),        // Glass card base (alpha applied at call sites)
    onSurface = Color(0xFF1C1C1E),
    surfaceVariant = Color(0xFFF2F2F7),
    error = Color(0xFFFF3B30),
    onError = Color.White
)

// Rounded, "liquid glass" corners matching the web/iOS redesign (18dp panels).
private val AppShapes = Shapes(
    extraSmall = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
    small = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
    medium = androidx.compose.foundation.shape.RoundedCornerShape(18.dp),
    large = androidx.compose.foundation.shape.RoundedCornerShape(18.dp),
    extraLarge = androidx.compose.foundation.shape.RoundedCornerShape(24.dp)
)

private val lightGradient = Brush.verticalGradient(
    colors = listOf(Color(0xFFEDF2FF), Color(0xFFFAF7FC))
)

private val darkGradient = Brush.verticalGradient(
    colors = listOf(Color(0xFF15131F), Color(0xFF0E0E14))
)

/**
 * Full-bleed gradient backdrop behind the app content, matching iOS's
 * ThemedRootBackground / the web app's radial-gradient page background.
 */
@Composable
fun LiquidGlassBackground(darkTheme: Boolean? = null, content: @Composable () -> Unit) {
    val isDark = darkTheme ?: isSystemInDarkTheme()
    androidx.compose.foundation.layout.Box(
        modifier = Modifier
            .fillMaxSize()
            .background(if (isDark) darkGradient else lightGradient)
    ) {
        content()
    }
}

@Composable
fun BitchatTheme(
    darkTheme: Boolean? = null,
    content: @Composable () -> Unit
) {
    // App-level override from ThemePreferenceManager
    val themePref by ThemePreferenceManager.themeFlow.collectAsState(initial = ThemePreference.System)
    val shouldUseDark = when (darkTheme) {
        true -> true
        false -> false
        null -> when (themePref) {
            ThemePreference.Dark -> true
            ThemePreference.Light -> false
            ThemePreference.System -> isSystemInDarkTheme()
        }
    }

    val colorScheme = if (shouldUseDark) DarkColorScheme else LightColorScheme

    val view = LocalView.current
    SideEffect {
        (view.context as? Activity)?.window?.let { window ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                window.insetsController?.setSystemBarsAppearance(
                    if (!shouldUseDark) WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS else 0,
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                )
            } else {
                @Suppress("DEPRECATION")
                window.decorView.systemUiVisibility = if (!shouldUseDark) {
                    View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                } else 0
            }
            window.navigationBarColor = colorScheme.background.toArgb()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                window.isNavigationBarContrastEnforced = false
            }
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        shapes = AppShapes
    ) {
        LiquidGlassBackground(darkTheme = shouldUseDark, content = content)
    }
}
