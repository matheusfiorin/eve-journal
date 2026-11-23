package com.echelon.eve.corp

import com.echelon.eve.ui.format.duration

// Local corporation alerts: what is worth a notification and when it may fire again. Pure (no Android), so the
// thresholds and the de-duplication are tested directly; CorpAlertWork.kt runs it hourly.

/** The three alert types, each with its own switch in Settings. */
enum class AlertKind(val id: String, val label: String, val summary: String) {
    TowerFuel("tower-fuel", "Tower fuel", "A tower has under 24 hours of fuel"),
    StructureFuel("structure-fuel", "Structure fuel", "A structure has under 3 days of fuel"),
    Reinforced("reinforced", "Reinforced or under attack", "A tower or structure went into reinforcement"),
}

/**
 * One thing worth telling the pilot. [key] names the item and the condition: the same key never fires twice while the
 * condition holds, and it is forgotten once the condition clears (a refuel), so the next dry spell is a new alert.
 * [route] is the deep link a tap opens, "Corp/starbases/<id>" or "Corp/structures/<id>".
 */
data class CorpAlert(val kind: AlertKind, val key: String, val title: String, val body: String, val route: String, val critical: Boolean)

/** The fired keys carry their bucket as a prefix, so a bucket can be replaced as a whole. */
private fun bucket(kind: AlertKind, corp: Long) = "${kind.id}:$corp:"

/** The names the messages use; each may be unknown. */
class AlertNames(val type: (Long) -> String? = { null }, val system: (Long) -> String? = { null })

/** The state of the alerts after a run: what to tell now, and the keys that now count as told. */
data class AlertRun(val alerts: List<CorpAlert>, val fired: Set<String>)

private fun hours(h: Double): String {
    val n = Math.round(h).coerceAtLeast(0)
    return if (n < 1) "under an hour" else if (n < 48) "about $n h" else "about ${Math.round(n / 24.0)} d"
}

private fun place(system: Long, names: AlertNames) = names.system(system)?.let { " in $it" } ?: ""

/** Every alert the snapshot holds right now, per kind (a section that was not read yields null for its kinds). */
fun conditions(snap: CorpSnapshot, names: AlertNames = AlertNames()): Map<AlertKind, List<CorpAlert>?> {
    val corp = snap.corporationId
    val towers = snap.starbases.value
    val structures = snap.structures.value
    val towerFuel = towers?.filter { it.isLowFuel() }?.map { t ->
        CorpAlert(AlertKind.TowerFuel, "${bucket(AlertKind.TowerFuel, corp)}${t.id}", "Tower low on fuel",
            "${names.type(t.type) ?: "A tower"}${place(t.system, names)}: ${hours(t.fuelHoursLeft ?: 0.0)} of fuel left.", "Corp/starbases/${t.id}", critical = true)
    }
    val structureFuel = structures?.filter { it.isLowFuel() }?.map { s ->
        val left = s.fuelDaysLeft ?: 0.0
        CorpAlert(AlertKind.StructureFuel, "${bucket(AlertKind.StructureFuel, corp)}${s.id}", "Structure low on fuel",
            "${s.name ?: names.type(s.type) ?: "A structure"}${if (s.name == null) place(s.system, names) else ""}: ${if (left <= 0) "out of fuel" else "${duration(left * 86400)} of fuel left"}.",
            "Corp/structures/${s.id}", critical = left < 1)
    }
    val reinforced = if (towers == null && structures == null) null else
        towers.orEmpty().filter { it.isReinforced() }.map { t ->
            CorpAlert(AlertKind.Reinforced, "${bucket(AlertKind.Reinforced, corp)}tower:${t.id}", "Tower reinforced",
                "${names.type(t.type) ?: "A tower"}${place(t.system, names)} is reinforced, possibly under attack.", "Corp/starbases/${t.id}", critical = true)
        } + structures.orEmpty().filter { it.isReinforced() }.map { s ->
            CorpAlert(AlertKind.Reinforced, "${bucket(AlertKind.Reinforced, corp)}structure:${s.id}:${s.state}", "Structure reinforced",
                "${s.name ?: names.type(s.type) ?: "A structure"}${if (s.name == null) place(s.system, names) else ""} is in ${if (s.state == "hull_reinforce") "hull" else "armor"} reinforcement, possibly under attack.",
                "Corp/structures/${s.id}", critical = true)
        }
    return mapOf(AlertKind.TowerFuel to towerFuel, AlertKind.StructureFuel to structureFuel, AlertKind.Reinforced to reinforced)
}

/**
 * One alert run over the snapshots just read. For every (kind, corporation) that is switched on and was read:
 * conditions not in [fired] are new alerts; the new fired set is exactly the conditions that still hold, so an item
 * that is refuelled (or repaired) drops out and is armed again. A bucket that is switched off or could not be read
 * keeps what it had, so neither a toggle nor an outage re-arms or re-fires anything. Several pilots in one corporation
 * share a snapshot: pass each corporation once ([snapshots] is de-duplicated by id here too).
 */
fun evaluateAlerts(snapshots: List<CorpSnapshot>, enabled: Set<AlertKind>, fired: Set<String>, names: AlertNames = AlertNames()): AlertRun {
    val alerts = mutableListOf<CorpAlert>()
    var next = fired
    for (snap in snapshots.distinctBy { it.corporationId }) {
        for ((kind, list) in conditions(snap, names)) {
            if (kind !in enabled || list == null) continue
            val prefix = bucket(kind, snap.corporationId)
            alerts += list.filter { it.key !in fired }
            next = next.filterNot { it.startsWith(prefix) }.toSet() + list.map { it.key }
        }
    }
    return AlertRun(alerts, next)
}
