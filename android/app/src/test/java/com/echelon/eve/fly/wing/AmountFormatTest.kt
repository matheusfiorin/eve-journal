package com.echelon.eve.fly.wing

import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Test

class AmountFormatTest {
    @Test fun formattedAmountsKeepTheirValueInEveryDeviceLocale() {
        val before = Locale.getDefault()
        val examples = listOf(12_500_000L to "12.5m", -12_500_000L to "-12.5m", 1_250_000_000L to "1.25b", 1_234_000L to "1.234m", 750_000L to "750k", 1234L to "1234")
        try {
            for (locale in listOf(Locale.US, Locale.forLanguageTag("pt-BR"), Locale.GERMANY, Locale.forLanguageTag("ar-EG"))) {
                Locale.setDefault(locale)
                for ((amount, expected) in examples) {
                    val text = formatAmount(amount)
                    assertEquals("$locale: $amount", expected, text)
                    assertEquals("$locale: $text", amount, parseAmount(text))
                }
            }
        } finally {
            Locale.setDefault(before)
        }
    }
}
