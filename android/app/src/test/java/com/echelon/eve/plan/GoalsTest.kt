package com.echelon.eve.plan

import com.echelon.eve.core.api.EchelonJson
import com.echelon.eve.core.model.Pilot
import com.echelon.eve.plan.goals.Goal
import com.echelon.eve.plan.goals.GoalFields
import com.echelon.eve.plan.goals.GoalRules
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Wing goals: the web's goal form rules (ui/screens/wing.js) and journal record shape (model.js validateBackup). */
class GoalsTest {
    private val now = 1_795_000_000_000L
    private fun goal(json: String, rev: Int = 3) = Goal(EchelonJson.parseToJsonElement(json) as JsonObject, rev)
    private val saved = goal("""{"id":"g1","title":"Fly a fleet","pilot":"Fiofka","done":false,"category":"Combat","steps":[{"text":"Fit ships","done":true},{"text":"Undock","done":false}],"target":100,"result":40,"updatedAt":$now,"color":"red"}""")

    @Test fun readsTheWebsRecord() {
        assertEquals("Fly a fleet", saved.title); assertEquals(Pilot.Fiofka, saved.owner); assertEquals("Combat", saved.category)
        assertEquals(listOf(true, false), saved.steps.map { it.done }); assertEquals(100.0, saved.target); assertEquals(40.0, saved.result)
        assertNull(goal("""{"id":"x","title":"t","pilot":"Both pilots","done":false,"updatedAt":1}""").owner)
    }

    @Test fun anEditKeepsTicksAndUnknownFields() {
        val f = GoalFields.of(saved).copy(steps = "Fit ships\nWarp in\n\n", target = "", notes = "  fleet at 20:00 ")
        val r = GoalRules.apply(saved, f, now - 5_000)
        assertEquals("g1", r["id"]!!.toString().trim('"'))
        assertEquals("""[{"text":"Fit ships","done":true},{"text":"Warp in","done":false}]""", r["steps"].toString())
        assertFalse("target" in r); assertEquals("\"fleet at 20:00\"", r["notes"].toString())
        assertEquals("\"red\"", r["color"].toString()) // a newer build's field survives
        assertEquals(now + 1, r["updatedAt"].toString().toLong()) // never goes back in time
    }

    @Test fun aNewGoalAndTheFormsLimits() {
        val r = GoalRules.apply(null, GoalFields(title = " Buy a Venture ", target = "1,000,000", due = "2026-12-01"), now) { "new-id" }
        assertEquals("""{"id":"new-id","title":"Buy a Venture","pilot":"Both pilots","done":false,"due":"2026-12-01","category":"Exploration","target":1000000.0,"updatedAt":$now}""", r.toString())
        assertEquals("Give the goal a title.", GoalRules.problem(GoalFields(title = " ")))
        assertEquals("Write the target date as YYYY-MM-DD.", GoalRules.problem(GoalFields(title = "x", due = "1/12/2026")))
        assertEquals("Use at most 30 steps.", GoalRules.problem(GoalFields(title = "x", steps = (1..31).joinToString("\n") { "s$it" })))
        assertNull(GoalRules.problem(GoalFields(title = "x", result = "12.5")))
    }

    @Test fun ticksAndConflictCopies() {
        assertTrue(Goal(GoalRules.withDone(saved, true, now), 3).done)
        assertEquals(listOf(true, true), Goal(GoalRules.withStep(saved, 1, true, now), 3).steps.map { it.done })
        val copy = GoalRules.conflictCopy(saved.record, now) { "c1" }
        assertEquals("\"c1\"", copy["id"].toString()); assertEquals("\"Fly a fleet (conflict copy)\"", copy["title"].toString())
    }
}
