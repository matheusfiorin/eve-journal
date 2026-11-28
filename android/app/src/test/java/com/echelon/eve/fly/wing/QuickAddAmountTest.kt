package com.echelon.eve.fly.wing

import org.junit.Assert.assertEquals
import org.junit.Test

class QuickAddAmountTest {
    @Test fun aChipCannotTurnACorrectionIntoAnUnsubmittableZero() {
        for (increment in QUICK_ADDS) {
            val text = formatAmount(-increment)
            assertEquals(text, quickAddAmount(text, increment))
            assertEquals(-increment, parseAmount(quickAddAmount(text, increment)))
        }
    }

    @Test fun aChipHonoursTheLimitIncludingTheExactBoundary() {
        for (increment in QUICK_ADDS) {
            val limit = formatAmount(MAX_ADD)
            assertEquals(limit, quickAddAmount(limit, increment))
            assertEquals(MAX_ADD, parseAmount(quickAddAmount(formatAmount(MAX_ADD - increment), increment)))
            assertEquals(-MAX_ADD + increment, parseAmount(quickAddAmount(formatAmount(-MAX_ADD), increment)))
        }
    }

    @Test fun aChipStartsAnEmptyOrInvalidFieldAndAddsToAValidAmount() {
        assertEquals("10m", quickAddAmount("", QUICK_ADDS.first()))
        assertEquals("10m", quickAddAmount("invalid", QUICK_ADDS.first()))
        assertEquals(22_500_000L, parseAmount(quickAddAmount("12.5m", QUICK_ADDS.first())))
        assertEquals("12.5m", quickAddAmount("12.5m", Long.MAX_VALUE))
    }
}
