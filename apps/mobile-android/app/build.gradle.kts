plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.compose.compiler)
  alias(libs.plugins.kotlin.serialization)
}

val releaseSigningKeys = listOf(
    "XOPC_UPLOAD_STORE_FILE",
    "XOPC_UPLOAD_STORE_PASSWORD",
    "XOPC_UPLOAD_KEY_ALIAS",
    "XOPC_UPLOAD_KEY_PASSWORD",
)
val releaseSigningValues = releaseSigningKeys.associateWith { providers.gradleProperty(it).orNull }
val releaseRequested = gradle.startParameter.taskNames.any { it.contains("release", ignoreCase = true) }
val missingReleaseSigningKeys = releaseSigningKeys.filter { releaseSigningValues[it].isNullOrBlank() }
if (releaseRequested && missingReleaseSigningKeys.isNotEmpty()) {
    throw GradleException("Missing Android release signing properties: ${missingReleaseSigningKeys.joinToString()}")
}

android {
    namespace = "ai.xopc.mobile"
    compileSdk = 36
    defaultConfig {
        applicationId = "ai.xopc.xopc"
        minSdk = 26
        targetSdk = 36
        versionCode = 81
        versionName = "0.0.81"
    }

    val releaseSigning = if (missingReleaseSigningKeys.isEmpty()) {
        signingConfigs.create("release") {
            storeFile = file(releaseSigningValues.getValue("XOPC_UPLOAD_STORE_FILE")!!)
            storePassword = releaseSigningValues.getValue("XOPC_UPLOAD_STORE_PASSWORD")
            keyAlias = releaseSigningValues.getValue("XOPC_UPLOAD_KEY_ALIAS")
            keyPassword = releaseSigningValues.getValue("XOPC_UPLOAD_KEY_PASSWORD")
        }
    } else null

    buildTypes {
        release {
            if (releaseSigning != null) signingConfig = releaseSigning
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
      compose = true
      aidl = false
      buildConfig = false
      shaders = false
    }

    packaging {
      resources {
        excludes += "/META-INF/{AL2.0,LGPL2.1}"
      }
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
  val composeBom = platform(libs.androidx.compose.bom)
  implementation(composeBom)
  androidTestImplementation(composeBom)

  // Core Android dependencies
  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.lifecycle.runtime.ktx)
  implementation(libs.androidx.activity.compose)
  // Ed25519 is only in Android's platform JCA from API 33; verify pinned Gateway keys on API 26+.
  implementation(libs.bouncycastle)
  implementation(libs.okhttp)
  implementation(libs.zxing.core)

  // Arch Components
  implementation(libs.androidx.lifecycle.runtime.compose)
  implementation(libs.androidx.lifecycle.viewmodel.compose)

  // Compose
  implementation(libs.androidx.compose.ui)
  implementation(libs.androidx.compose.animation)
  implementation(libs.androidx.compose.ui.tooling.preview)
  implementation(libs.androidx.compose.material3)
  // Tooling
  debugImplementation(libs.androidx.compose.ui.tooling)
  // Instrumented tests
  androidTestImplementation(libs.androidx.compose.ui.test.junit4)
  debugImplementation(libs.androidx.compose.ui.test.manifest)

  // Local tests: jUnit, coroutines, Android runner
  testImplementation(libs.junit)
  testImplementation(libs.kotlinx.coroutines.test)

  // Instrumented tests: jUnit rules and runners
  androidTestImplementation(libs.androidx.test.core)
  androidTestImplementation(libs.androidx.test.ext.junit)
  androidTestImplementation(libs.androidx.test.runner)
  androidTestImplementation(libs.androidx.test.espresso.core)

  // Navigation
  implementation(libs.androidx.navigation3.ui)
  implementation(libs.androidx.navigation3.runtime)
  implementation(libs.androidx.lifecycle.viewmodel.navigation3)
}
