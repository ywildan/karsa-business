import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
}

/**
 * Prefix untuk nilai konfigurasi yang tidak tersedia di runner CI, misalnya pull
 * request dari fork yang tidak punya akses ke repository secrets. Nilai seperti
 * ini sengaja dibuat berawalan agar [verifyReleaseConfig] bisa menolaknya.
 */
const val CI_PLACEHOLDER_PREFIX = "CI_PLACEHOLDER_"

const val DEFAULT_VERSION_NAME = "0.1.0"

/** Konfigurasi yang wajib berisi nilai nyata (bukan placeholder) untuk rilis. */
val REQUIRED_RELEASE_CONFIG = listOf(
    "KARSA_API_BASE_URL",
    "FIREBASE_API_KEY",
    "FIREBASE_APP_ID",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_WEB_CLIENT_ID",
)

val localProperties = Properties().apply {
    val local = rootProject.file("local.properties")
    if (local.exists()) local.inputStream().use(::load)
}

fun config(name: String): String =
    providers.environmentVariable(name).orNull
        ?: localProperties.getProperty(name)
        ?: ""

/**
 * Nilai untuk [android.defaultConfig.buildConfigField]. Environment variable
 * menang atas `local.properties`, dan di CI tanpa akses secret (pull request
 * dari fork) nilai kosong diganti placeholder agar build tetap bisa diverifikasi
 * tanpa diam-diam menghasilkan APK yang rusak. Placeholder ditolak oleh
 * [verifyReleaseConfig].
 */
fun buildConfigValue(name: String): String {
    val value = config(name)
    if (value.isNotBlank()) return value
    return if (providers.environmentVariable("CI").isPresent) "$CI_PLACEHOLDER_PREFIX$name" else ""
}

/**
 * Menurunkan versionCode dari nama versi (mis. "1.0.1" -> 1000001), sehingga
 * setiap tag rilis otomatis mendapat versionCode yang lebih tinggi dan kompatibel
 * dengan Play Store, alih-alih angka hardcoded.
 *
 * Android menolak instalasi dengan versionCode yang lebih rendah
 * (INSTALL_FAILED_VERSION_DOWNGRADE) sehingga pengguna harus uninstall aplikasi
 * lama - dan kehilangan seluruh data Room-nya. Karena itu rumus ini dipakai
 * oleh `verifyReleaseVersion` untuk membandingkan rilis baru dengan rilis lama.
 */
fun versionCodeOf(versionName: String): Int {
    val raw = versionName.trim().removePrefix("v").ifBlank { DEFAULT_VERSION_NAME }
    val numbers = raw.split(".").map { it.takeWhile(Char::isDigit).toIntOrNull() ?: 0 }
    val major = numbers.getOrElse(0) { 0 }.coerceIn(0, 999)
    val minor = numbers.getOrElse(1) { 0 }.coerceIn(0, 999)
    val patch = numbers.getOrElse(2) { 0 }.coerceIn(0, 999)
    return major * 1_000_000 + minor * 1_000 + patch
}

fun appVersionName(): String =
    config("KARSA_VERSION_NAME").trim().removePrefix("v").ifBlank { DEFAULT_VERSION_NAME }

fun appVersionCode(): Int = versionCodeOf(config("KARSA_VERSION_NAME"))


android {
    namespace = "com.ywldan.karsabusiness"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.ywldan.karsabusiness"
        minSdk = 26
        targetSdk = 36
        versionCode = appVersionCode()
        versionName = appVersionName()

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables.useSupportLibrary = true

        buildConfigField("String", "API_BASE_URL", "\"${buildConfigValue("KARSA_API_BASE_URL")}\"")
        buildConfigField("String", "FIREBASE_API_KEY", "\"${buildConfigValue("FIREBASE_API_KEY")}\"")
        buildConfigField("String", "FIREBASE_APP_ID", "\"${buildConfigValue("FIREBASE_APP_ID")}\"")
        buildConfigField("String", "FIREBASE_PROJECT_ID", "\"${buildConfigValue("FIREBASE_PROJECT_ID")}\"")
        buildConfigField("String", "FIREBASE_WEB_CLIENT_ID", "\"${buildConfigValue("FIREBASE_WEB_CLIENT_ID")}\"")
    }

    signingConfigs {
        val path = config("ANDROID_KEYSTORE_PATH")
        if (path.isNotBlank()) {
            create("release") {
                storeFile = file(path)
                storePassword = config("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = config("ANDROID_KEY_ALIAS")
                keyPassword = config("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            if (signingConfigs.names.contains("release")) {
                signingConfig = signingConfigs.getByName("release")
            }
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

    packaging.resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
}

// ---------------------------------------------------------------------------
// Guard rilis
//
// Tiga hal di bawah sengaja dibuat sebagai task terpisah supaya bisa dijalankan
// CI sebelum build mahal dilakukan, dan supaya kegagalan memberi pesan yang
// jelas alih-alih build unsigned atau downgrade yang lolos tanpa suara.
// ---------------------------------------------------------------------------

/** Dipakai workflow untuk membaca nomor versi hasil hitungan, bukan mengulang rumusnya. */
val releaseVersionDir = layout.buildDirectory.dir("release-guard")

val verifyReleaseVersion = tasks.register("verifyReleaseVersion") {
    group = "verification"
    description = "Menolak rilis dengan versionCode lebih rendah dari versi sebelumnya, lalu menulis nomor versi untuk CI."
    val currentName = providers.gradleProperty("currentVersionName").orNull ?: appVersionName()
    val previousName = providers.gradleProperty("previousVersionName").orNull
    val outputDir = releaseVersionDir
    doLast {
        val currentCode = versionCodeOf(currentName)
        val versionFile = outputDir.get().file("version.txt").asFile
        versionFile.parentFile.mkdirs()
        versionFile.writeText("$currentName\n$currentCode\n")
        logger.lifecycle("Versi rilis: $currentName (versionCode $currentCode)")

        if (previousName.isNullOrBlank()) {
            logger.lifecycle("Tidak ada versi sebelumnya yang diberikan; guard version dilewati.")
            return@doLast
        }
        val previousCode = versionCodeOf(previousName)
        // Equal diizinkan agar rilis yang sama bisa dibangun ulang (--clobber),
        // turun atau ulang akan ditolak.
        if (currentCode < previousCode) {
            throw GradleException(
                "Rilis ditolak: versionCode $currentCode ($currentName) lebih rendah dari " +
                    "rilis sebelumnya $previousCode ($previousName). Android akan menolak " +
                    "instalasi dengan INSTALL_FAILED_VERSION_DOWNGRADE sehingga pengguna harus " +
                    "uninstall aplikasi lama. Naikkan nomor versi, contoh v1.0.1 -> v1.0.2.",
            )
        }
    }
}

val verifyReleaseConfig = tasks.register("verifyReleaseConfig") {
    group = "verification"
    description = "Memastikan konfigurasi build release lengkap dan keystore benar-benar ditambahkan."
    val values = REQUIRED_RELEASE_CONFIG.map { it to buildConfigValue(it) }
    val keystorePath = config("ANDROID_KEYSTORE_PATH")
    val keyAlias = config("ANDROID_KEY_ALIAS")
    doLast {
        val problems = mutableListOf<String>()
        values.filter { (_, value) -> value.startsWith(CI_PLACEHOLDER_PREFIX) }
            .forEach { (name, _) -> problems += "$name tidak tersedia (placeholder CI)." }
        values.filter { (_, value) -> value.isBlank() }
            .forEach { (name, _) -> problems += "$name kosong." }
        if (keystorePath.isBlank()) {
            problems += "ANDROID_KEYSTORE_PATH kosong, APK release akan dibangun tanpa tanda tangan."
        }
        if (keyAlias.isBlank()) {
            problems += "ANDROID_KEY_ALIAS kosong."
        }
        if (problems.isNotEmpty()) {
            throw GradleException("Build release ditolak:\n - " + problems.joinToString("\n - "))
        }
    }
}

// Lazy + aman terhadap kapan pun AGP membuat task varian.
tasks.matching { it.name == "assembleRelease" }.configureEach {
    dependsOn(verifyReleaseConfig)
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.04.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.activity:activity-compose:1.12.4")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.10.0")

    implementation("androidx.room:room-runtime:2.8.1")
    implementation("androidx.room:room-ktx:2.8.1")
    ksp("androidx.room:room-compiler:2.8.1")
    implementation("androidx.work:work-runtime-ktx:2.11.0")

    implementation(platform("com.google.firebase:firebase-bom:34.18.0"))
    implementation("com.google.firebase:firebase-auth")
    implementation("androidx.credentials:credentials:1.3.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.3.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.10.2")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
