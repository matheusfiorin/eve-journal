package com.echelon.eve.corp

import com.echelon.eve.core.api.EchelonJson
import com.echelon.eve.testing.echelon
import com.echelon.eve.testing.echelonPaparazzi
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/** The /api/corp answer, built with the Worker's own worker/corp.js helpers (src/test/resources/corp-fixture.json). */
object CorpFixture {
    const val NOW = 1_795_000_000_000L
    val json = EchelonJson.parseToJsonElement(CorpFixture::class.java.getResource("/corp-fixture.json")!!.readText()) as JsonObject
    val snap = CorpSnapshot.of(json)
    val names = CorpNames(mapOf(30000142L to ("Jita" to 0.946), 30000144L to ("Perimeter" to 0.95), 30002813L to ("Tama" to 0.3)),
        mapOf(12235L to "Caldari Control Tower Medium", 35832L to "Astrahus", 587L to "Rifter", 34L to "Tritanium", 60003760L to "Jita IV - Moon 4 - Caldari Navy Assembly Plant"))
}

class CorpTest {
    private val s = CorpFixture.snap

    @Test fun readsEverySectionOfTheWorkersAnswer() {
        assertEquals(98000001L, s.corporationId); assertEquals("Fiofka", s.source)
        val t = s.starbases.value!!.single()
        assertEquals("medium", t.size); assertEquals(40.0, t.fuelHours); assertEquals(39.0, t.fuelHoursLeft); assertEquals(20.0, t.strontiumHours, 1e-9)
        val st = s.structures.value!!.single()
        assertEquals(2.0, st.fuelDaysLeft); assertEquals(18, st.reinforceHour); assertEquals("Manufacturing (Standard)", st.services.single().name)
        assertEquals(listOf(1.5e9, 2.5e8), s.wallets.value!!.map { it.balance })
        assertEquals("Industry", s.divisions.value!!.wallet[1].name)
        assertEquals(3, s.memberCount); assertNull(s.members.value!![2].second)
        assertEquals(587L, s.jobs.value!!.single().productTypeId)
        assertEquals("needs role Director", s.customs.error); assertEquals(0.02, s.customs.value!!.single().taxCorp)
        assertEquals(listOf(listOf(34L, 100000L), listOf(587L, 2L)), s.assets.value!!.places.single().types)
    }

    @Test fun jobStateLikeTheWeb() {
        val j = s.jobs.value!!.single()
        val mid = jobState(j, CorpFixture.NOW)
        assertEquals(0.5f, mid.progress, 1e-6f); assertEquals(7_200_000L, mid.remaining)
        assertTrue(jobState(j, CorpFixture.NOW + 8_000_000).ready) // ESI may still say active after the end
    }

    @Test fun placesAreValuedAtAveragePrices() {
        val a = s.assets.value!!
        val v = valuePlaces(a.places.map { it.id to ("Jita" to "place") }, { a.places.single().types.map { it[0] to it[1] } }, { 4 }, mapOf(34L to 4.0, 587L to 400_000.0))
        assertEquals(1_200_000.0, v.single().value, 1e-6)
        assertEquals(listOf(587L, 34L), v.single().top.map { it.first })
    }

    @Test fun personalAssetsFlattenContainers() {
        val place = EchelonJson.decodeFromString(AssetPlace.serializer(), """{"id":60003760,"kind":"station","name":"Jita IV","count":3,"items":[{"item_id":1,"type_id":3467,"quantity":1,"contents":[{"item_id":2,"type_id":34,"quantity":500}]},{"item_id":3,"type_id":35,"quantity":9}]}""")
        assertEquals(listOf(3467L to 1L, 34L to 500L, 35L to 9L), place.flatten())
    }

    @Test fun roleErrorsReadAsAnInstruction() {
        assertTrue(sectionProblem("needs role Director").contains("Director"))
        assertTrue(sectionProblem("needs permission: reconnect to allow it").startsWith("No connected pilot"))
    }
}

class CorpSnapshotTest {
    @get:Rule val paparazzi = echelonPaparazzi(tall = true)
    private val load = Load.Ready(CorpFixture.snap)
    private val now = CorpFixture.NOW

    @Test fun starbases() = paparazzi.echelon { StarbasesScreen(load, CorpFixture.names, now, {}, scroll = false) }
    @Test fun structures() = paparazzi.echelon { StructuresScreen(load, CorpFixture.names, now, {}, scroll = false) }
    @Test fun wallet() = paparazzi.echelon { WalletScreen(load, now, {}, scroll = false) }
    @Test fun jobs() = paparazzi.echelon { CorpJobsScreen(load, CorpFixture.names, now, {}, scroll = false) }
    @Test fun customsNeedsRole() = paparazzi.echelon { CustomsScreen(load, CorpFixture.names, now, {}, scroll = false) }
    private val mine = Load.Ready(EchelonJson.decodeFromString(MyAssets.serializer(), """{"fetchedAt":"2026-11-18T10:00:00Z","cached":true,"items":5,"locations":[
        {"id":60003760,"kind":"station","name":"Jita IV - Moon 4 - Caldari Navy Assembly Plant","count":3,"items":[{"item_id":1,"type_id":587,"quantity":2},{"item_id":2,"type_id":34,"quantity":100000}]},
        {"id":1030000000001,"kind":"structure","name":null,"count":2,"items":[{"item_id":3,"type_id":34,"quantity":5000}]}]}"""))
    @Test fun assets() = paparazzi.echelon { AssetsScreen(load, mine, com.echelon.eve.core.model.Pilot.Fiofka, mapOf(34L to 4.0, 587L to 400_000.0), CorpFixture.names, CorpFixture.names.types, now, {}, {}, scroll = false) }
    @Test fun noCorpData() = paparazzi.echelon { WalletScreen(Load.Failed("No corporation data yet. It is read about once an hour with a member who allowed corporation access.", missing = true), now, {}, scroll = false) }
}
