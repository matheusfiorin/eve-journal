plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.paparazzi)
}

// Firebase Cloud Messaging is optional: drop a google-services.json from the Firebase console into app/ to turn on
// background pushes from the wing room. Without it the plugin is not applied, FirebaseApp never initialises and the
// push code does nothing, so the build and the app work the same.
if (file("google-services.json").exists()) apply(plugin = "com.google.gms.google-services")

// Release signing comes from CI secrets (see .github/workflows/android.yml); without them only debug builds are signed.
val keystore = System.getenv("ANDROID_KEYSTORE_PATH")?.let(::file)?.takeIf { it.exists() }

android {
    namespace = "com.echelon.eve"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.echelon.eve"
        minSdk = 29
        targetSdk = 36
        versionCode = (System.getenv("VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("VERSION_NAME") ?: "0.1.0"
        buildConfigField("String", "API_BASE", "\"https://eve-journal-api.eve-pilots-f6933080.workers.dev\"")
        // The custom-scheme redirect the Worker sends after EVE SSO for client=android.
        manifestPlaceholders["authScheme"] = "echelon"
    }

    signingConfigs {
        if (keystore != null) create("release") {
            storeFile = keystore
            storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("ANDROID_KEY_ALIAS")
            keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
        }
    }

    buildTypes {
        debug { applicationIdSuffix = ".debug" }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    testOptions {
        unitTests.isReturnDefaultValues = true
        // Paparazzi loads layoutlib's android classes into its JVM, which makes OkHttp in a later test class pick its
        // Android platform: one JVM per test class keeps the two apart.
        unitTests.all { it.maxHeapSize = "2g"; it.forkEvery = 1 }
    }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        optIn.addAll("androidx.compose.material3.ExperimentalMaterial3Api", "androidx.compose.ui.text.ExperimentalTextApi", "androidx.compose.animation.ExperimentalSharedTransitionApi")
    }
}

// JVM unit tests can't load the Android .so files, so they run the planner bridge on quickjs-kt's desktop build,
// which has the same API and bundles a linux-x64 library.
configurations.matching { it.name.endsWith("UnitTestRuntimeClasspath") }.configureEach {
    exclude(group = "io.github.dokar3", module = "quickjs-kt-android")
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.browser)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.work.runtime)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.foundation)
    implementation(libs.compose.animation)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons.core)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.okhttp)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(libs.quickjs.android)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    implementation(libs.kotlinx.coroutines.play.services)
    debugImplementation(libs.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.androidx.work.testing)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.coil.test)
    testImplementation(libs.quickjs.jvm)
}
