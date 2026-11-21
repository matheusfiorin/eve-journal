// AGP 9 compiles Kotlin itself; the Kotlin plugin is listed only to pin the compiler version AGP uses.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.paparazzi) apply false
    alias(libs.plugins.google.services) apply false
}
