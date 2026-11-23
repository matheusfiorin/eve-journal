package com.echelon.eve.ui

import com.echelon.eve.ui.motion.HapticChoreo
import com.echelon.eve.ui.motion.HapticMoment
import com.echelon.eve.ui.motion.NumberChoreo
import com.echelon.eve.ui.motion.Pulse
import com.echelon.eve.ui.motion.Roll
import com.echelon.eve.ui.motion.ScanSweep
import com.echelon.eve.ui.motion.WarpField
import com.echelon.eve.ui.motion.breathAt
import com.echelon.eve.ui.motion.developLine
import com.echelon.eve.ui.motion.heartbeatAt
import com.echelon.eve.ui.motion.parallaxFade
import com.echelon.eve.ui.motion.trailOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The motion system's pure curves and patterns: what each motion does at a given moment, and that it ends at rest. */
class MotionTest {
    @Test fun warpStreaksAreDarkAtBothEndsAndPeakEarly() {
        assertEquals(0f, WarpField.envelope(0f))
        assertEquals(0f, WarpField.envelope(1f))
        assertEquals(1f, WarpField.envelope(.22f), 1e-4f)
        assertTrue(WarpField.envelope(.1f) < 1f && WarpField.envelope(.6f) < WarpField.envelope(.3f))
    }

    @Test fun theWarpFieldIsTheSameEveryTime() {
        val a = WarpField(); val b = WarpField()
        assertTrue(a.angle.contentEquals(b.angle) && a.length.contentEquals(b.length) && a.tint.contentEquals(b.tint))
        assertTrue(a.start.all { it in 0f..1f })
    }

    @Test fun theScanRevealsTopToBottomAndEverythingOnceFinished() {
        val n = 5
        val at = (0 until n).map { ScanSweep.listAt(it, n) }
        assertEquals(listOf(0f, .2f, .4f, .6f, .8f), at)
        // Halfway through the turn the first rows are lit and the last are not yet.
        assertEquals(1f, ScanSweep.revealAt(.5f, at[0]))
        assertEquals(0f, ScanSweep.revealAt(.5f, at[4]))
        at.forEach { assertEquals(1f, ScanSweep.revealAt(1f, it)) }
        // The last result is fully in before the beam finishes fading.
        assertEquals(1f, ScanSweep.revealAt(.85f * .8f + .12f, at[4]), 1e-4f)
    }

    @Test fun theCometTrailCollapsesIntoItsHead() {
        assertEquals(.5f, trailOffset(3, 6, 0f), 1e-6f)
        assertEquals(0f, trailOffset(3, 6, 1f), 1e-6f)
        assertTrue(trailOffset(6, 6, .2f) > trailOffset(1, 6, .2f))
    }

    @Test fun theHeartbeatHasTwoBeatsThenRests() {
        val strong = heartbeatAt(.06f); val soft = heartbeatAt(.28f)
        assertTrue(strong > .9f && soft > .6f && soft < strong)
        assertTrue(heartbeatAt(.17f) < .5f)
        assertTrue(heartbeatAt(.7f) < .01f)
    }

    @Test fun theBreathStartsLowJoinsUpAndHoldsMidwayWhenStill() {
        assertEquals(0f, breathAt(0f), 1e-5f)
        assertEquals(1f, breathAt(.5f), 1e-5f)
        assertEquals(breathAt(0f), breathAt(1f, 2), 1e-4f)
        assertEquals(1f, breathAt(.25f, 2), 1e-4f)
        assertEquals(.5f, breathAt(-1f))
    }

    @Test fun developAndParallaxEndAtRest() {
        assertEquals(0f, developLine(0f)); assertEquals(1f, developLine(1f), 1e-5f); assertEquals(1f, developLine(2f), 1e-5f)
        assertEquals(1f, parallaxFade(0f, 300f)); assertEquals(0f, parallaxFade(250f, 300f)); assertEquals(.6f, parallaxFade(100f, 300f), 1e-5f)
    }

    @Test fun theCountUpEasesOutAndLandsExactly() {
        val steps = NumberChoreo.countUp(0.0, 1_750_000_000.0)
        assertEquals(NumberChoreo.COUNT_STEPS, steps.size)
        assertEquals(1_750_000_000.0, steps.last(), 0.0)
        assertTrue(steps.zipWithNext().all { (a, b) -> b >= a })
        // Ease-out: most of the way there in the first half.
        assertTrue(steps[3] > 1_750_000_000.0 * .8)
        assertEquals(Roll.Up, NumberChoreo.direction(1.0, 2.0))
        assertEquals(Roll.Down, NumberChoreo.direction(2.0, 1.0))
    }

    @Test fun eachHapticMomentHasItsOwnShortRhythm() {
        val patterns = HapticMoment.entries.associateWith { HapticChoreo.pattern(it) }
        patterns.values.forEach { assertTrue(it.isNotEmpty() && it.first().afterMs == 0L) }
        HapticMoment.entries.forEach { assertTrue("$it is short", HapticChoreo.length(it) < 500) }
        assertEquals(HapticMoment.entries.size, patterns.values.toSet().size)
        assertEquals(listOf(Pulse.Kind.Reject, Pulse.Kind.Heavy, Pulse.Kind.Heavy), patterns.getValue(HapticMoment.WarpOut).map { it.kind })
        assertEquals(listOf(Pulse.Kind.Tick, Pulse.Kind.Tick), patterns.getValue(HapticMoment.Warning).map { it.kind })
        assertEquals(listOf(Pulse.Kind.Confirm), patterns.getValue(HapticMoment.Start).map { it.kind })
    }
}
