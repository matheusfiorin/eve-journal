package com.echelon.eve.core.wing

import com.echelon.eve.core.model.SolarSystem

/**
 * Gate jumps between two systems on the gate map (MarketData.systems' links), by breadth-first search: no planner, no
 * security preference, just the fewest jumps. 0 for the same system; null when either is unknown, not linked (a
 * wormhole) or more than [max] jumps apart.
 */
fun jumpsBetween(systems: Map<Long, SolarSystem>, from: Long?, to: Long?, max: Int = 80): Int? {
    if (from == null || to == null) return null
    if (from == to) return 0
    if (from !in systems || to !in systems) return null
    val seen = hashSetOf(from)
    var frontier = listOf(from)
    for (depth in 1..max) {
        val next = ArrayList<Long>()
        for (id in frontier) for (link in systems[id]?.links.orEmpty()) {
            if (link == to) return depth
            if (seen.add(link)) next += link
        }
        if (next.isEmpty()) return null
        frontier = next
    }
    return null
}

/** What is left of a followed [route] from [here]: the jumps after the system the pilot is in (all of it when not on it). */
fun routeLeft(route: List<Long>, here: Long?): List<Long> = route.indexOf(here).let { i -> if (i < 0) route else route.drop(i + 1) }
