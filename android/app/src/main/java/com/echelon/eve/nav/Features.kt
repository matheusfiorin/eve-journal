package com.echelon.eve.nav

import com.echelon.eve.corp.CorpFeature
import com.echelon.eve.fly.FlyFeature
import com.echelon.eve.plan.PlanFeature

/** The registration line: every feature package's entry point. Add yours here, once. */
object Features {
    val all: List<Feature> = listOf(PlanFeature, FlyFeature, CorpFeature)
}
