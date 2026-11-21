package com.echelon.eve.ui

import com.echelon.eve.testing.echelon
import com.echelon.eve.testing.echelonPaparazzi
import com.echelon.eve.ui.catalog.DesignCatalog
import org.junit.Rule
import org.junit.Test

class DesignCatalogSnapshotTest {
    @get:Rule val paparazzi = echelonPaparazzi(tall = true)

    @Test fun catalog() = paparazzi.echelon { DesignCatalog(scroll = false) }
}
