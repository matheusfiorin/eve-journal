package com.echelon.eve.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.echelon.eve.testing.echelon
import com.echelon.eve.testing.echelonPaparazzi
import com.echelon.eve.ui.catalog.DesignCatalog
import org.junit.Rule
import org.junit.Test

class DesignCatalogSnapshotTest {
    @get:Rule val paparazzi = echelonPaparazzi(tall = true)

    @Test fun catalog() = paparazzi.echelon { DesignCatalog(scroll = false) }
}

/** The catalog a phone screen at a time, at full resolution (the tall golden is scaled down to fit one image). */
class DesignCatalogPagesTest {
    @get:Rule val paparazzi = echelonPaparazzi()

    private fun page(n: Int) = paparazzi.echelon {
        Box(Modifier.fillMaxSize()) {
            Box(Modifier.wrapContentHeight(Alignment.Top, unbounded = true).offset(y = (-860 * n).dp)) { DesignCatalog(scroll = false) }
        }
    }

    @Test fun identity() = page(0)
    @Test fun components() = page(1)
    @Test fun states() = page(2)
}
