package com.echelon.eve.fly

import com.echelon.eve.core.model.IndustryJob
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.core.wing.WingTimer
import com.echelon.eve.fly.fit.FitGroups
import com.echelon.eve.fly.fit.FitItem
import com.echelon.eve.fly.fit.FitScreen
import com.echelon.eve.fly.fit.FitUi
import com.echelon.eve.fly.jobs.JobsScreen
import com.echelon.eve.fly.jobs.JobsUi
import com.echelon.eve.fly.jobs.SlotUse
import com.echelon.eve.fly.jobs.Slots
import com.echelon.eve.fly.jobs.WingJob
import com.echelon.eve.fly.jobs.WingJobs
import com.echelon.eve.fly.live.LiveScreen
import com.echelon.eve.fly.live.LiveUi
import com.echelon.eve.fly.live.Whereabouts
import com.echelon.eve.fly.skills.QueueEntry
import com.echelon.eve.fly.skills.QueueState
import com.echelon.eve.fly.skills.SkillQueueScreen
import com.echelon.eve.fly.skills.SkillsUi
import com.echelon.eve.fly.timers.MIN
import com.echelon.eve.fly.timers.TimerActions
import com.echelon.eve.fly.timers.TimersScreen
import com.echelon.eve.testing.echelon
import com.echelon.eve.testing.echelonPaparazzi
import org.junit.Rule
import org.junit.Test

/** Fixed data for the Fly goldens: Fiofka flying, Decxus sharing with the wing. Times are fixed so goldens don't drift. */
object FlyFixtures {
    const val NOW = 1_795_000_000_000L
    val timers = listOf(
        WingTimer("a", "gas", "Ghost site", NOW - 12 * MIN, 20 * MIN, owner = Pilot.Fiofka.id),
        WingTimer("b", "mining", "Mining cycle", NOW - 2 * MIN, 3 * MIN, owner = Pilot.Fiofka.id, shared = false),
        WingTimer("c", "despawn", "Wreck in Tama", NOW - 30 * MIN, 120 * MIN, owner = Pilot.Decxus.id),
        WingTimer("d", "cyno", "Cyno", NOW - 10 * MIN, 5 * MIN, owner = Pilot.Fiofka.id),
        WingTimer("e", "generic", "Refit", NOW - 20 * MIN, 30 * MIN, pausedAt = NOW - 5 * MIN, owner = Pilot.Fiofka.id),
    )
    val live = LiveUi(
        me = Whereabouts(Pilot.Fiofka, "Perimeter", 0.95, "The Forge", "Perimeter II - Moon 1 - Tranquility Trading Tower", 32880, "Venture", "Gas runner", online = true, at = NOW - 20_000),
        wingmate = Whereabouts(Pilot.Decxus, "Tama", 0.3, "The Forge", null, 32880, "Venture", "Decxus's Venture", at = NOW - 6 * MIN),
    )
    private val names = mapOf(32880L to "Venture", 1L to "Miner II", 2L to "Gas Cloud Scoop I", 3L to "5MN Microwarpdrive I", 4L to "Mining Laser Upgrade I", 5L to "Hobgoblin I", 6L to "Fullerite-C50", 7L to "Medium Shield Extender I")
    val fit = FitUi(
        Pilot.Fiofka, 32880, "Gas runner",
        FitGroups(
            groups = mapOf("high" to listOf(FitItem(2, "HiSlot0"), FitItem(2, "HiSlot1")), "mid" to listOf(FitItem(3, "MedSlot0"), FitItem(7, "MedSlot1")),
                "low" to listOf(FitItem(4, "LoSlot0")), "drones" to listOf(FitItem(5, "DroneBay", 2)), "cargo" to listOf(FitItem(6, "Cargo", 1200))),
            counts = mapOf("high" to 2, "mid" to 2, "low" to 1, "drones" to 2, "cargo" to 1200),
            slots = listOf(listOf("high", "High slots"), listOf("mid", "Mid slots"), listOf("low", "Low slots"), listOf("rig", "Rigs"), listOf("drones", "Drone bay"), listOf("cargo", "Cargo")),
        ),
        names, eft = "[Venture, Gas runner]",
    )
    val skills = SkillsUi(Pilot.Fiofka, QueueState(
        listOf(QueueEntry(3386, 5, NOW - 3_600_000, NOW + 5_400_000), QueueEntry(25544, 3, NOW + 5_400_000, NOW + 30_000_000), QueueEntry(3436, 4, NOW + 30_000_000, NOW + 50_000_000)),
        QueueEntry(3386, 5, NOW - 3_600_000, NOW + 5_400_000), NOW + 50_000_000,
    ), mapOf(3386L to "Mining", 25544L to "Gas Cloud Harvesting", 3436L to "Drones"), totalSp = 4_215_000)
    private fun job(id: Long, product: Long, activity: Int) = IndustryJob(id, activity, 900, product, runs = 10, startDate = "2026-11-18T08:00:00Z", endDate = "2026-11-18T12:00:00Z")
    val jobs = JobsUi(
        WingJobs(
            list = listOf(
                WingJob("Fiofka", job(1, 1, 1), "Manufacturing", "build", 1.0, 0, ready = true),
                WingJob("Decxus", job(2, 2, 5), "Copying", "science", 0.4, 3 * 3_600_000, active = true),
                WingJob("Fiofka", job(3, 3, 1), "Manufacturing", "build", 0.1, 9 * 3_600_000, active = true),
            ),
            ready = 1, running = 2,
            next = WingJob("Decxus", job(2, 2, 5), "Copying", "science", 0.4, 3 * 3_600_000, active = true),
            usage = listOf(SlotUse("Fiofka", 1, 0, Slots(5, 2)), SlotUse("Decxus", 0, 1, Slots(3, 3))),
        ),
        mapOf(1L to "Hobgoblin I", 2L to "Miner II Blueprint", 3L to "Gas Cloud Scoop I"), computedAt = NOW,
    )
}

class FlySnapshotTest {
    @get:Rule val paparazzi = echelonPaparazzi(tall = true)
    private val now = FlyFixtures.NOW

    @Test fun timers() = paparazzi.echelon { TimersScreen(Pilot.Fiofka, FlyFixtures.timers, now, TimerActions(), scroll = false) }
    @Test fun timersEmpty() = paparazzi.echelon { TimersScreen(Pilot.Fiofka, emptyList(), now, TimerActions(), scroll = false) }
    @Test fun live() = paparazzi.echelon { LiveScreen(Pilot.Fiofka, FlyFixtures.live, now, {}, scroll = false) }
    @Test fun liveNotConnected() = paparazzi.echelon { LiveScreen(Pilot.Fiofka, LiveUi(problem = "Fiofka is not connected on this phone. Connect them in Settings.", wingmateNote = "Decxus shares their skills only, not where they are."), now, {}, scroll = false) }
    @Test fun fit() = paparazzi.echelon { FitScreen(FlyFixtures.fit, Pilot.Fiofka, {}, {}, scroll = false) }
    @Test fun fitMissing() = paparazzi.echelon { FitScreen(FitUi(Pilot.Decxus, note = "Decxus shares with the wing, but not their fit."), Pilot.Fiofka, {}, {}, scroll = false) }
    @Test fun skills() = paparazzi.echelon { SkillQueueScreen(FlyFixtures.skills, now, {}, scroll = false) }
    @Test fun jobs() = paparazzi.echelon { JobsScreen(FlyFixtures.jobs, now, scroll = false) }
    @Test fun wing() = paparazzi.echelon {
        val pings = listOf(com.echelon.eve.core.wing.WingEvent(Pilot.Decxus, now - 4 * MIN, com.echelon.eve.core.wing.WingPing("omw", system = 30000144), "p1"),
            com.echelon.eve.core.wing.WingEvent(Pilot.Fiofka, now - 9 * MIN, com.echelon.eve.core.wing.WingPing("custom", "Gas site in Tama, bring a scoop"), "p2"))
        val plans = listOf(com.echelon.eve.core.wing.WingEvent(Pilot.Decxus, now - 30 * MIN, com.echelon.eve.core.wing.SharedPlan("haul", "Jita → Amarr", "45 jumps, 0.8% risk, Deep space transport", listOf(30000142, 30000144, 30003504, 30002187)), "s1"))
        com.echelon.eve.fly.wing.WingScreen(com.echelon.eve.fly.wing.WingUi(Pilot.Fiofka, com.echelon.eve.core.wing.WingChannel.Status.Connected,
            mapOf(Pilot.Decxus.id to com.echelon.eve.core.wing.Presence(Pilot.Decxus.id, true, 2)), com.echelon.eve.fly.wing.feed(pings, plans), here = "Perimeter",
            systemName = mapOf(30000142L to "Jita", 30000144L to "Perimeter", 30003504L to "Niarja", 30002187L to "Amarr")::get, canSend = true), now, com.echelon.eve.fly.wing.WingActions(), scroll = false)
    }
}
