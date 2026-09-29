import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
}

fun config(name: String): String {
    val local = rootProject.file("local.properties")
    val properties = Properties().apply {
        if (local.exists()) local.inputStream().use(::load)
    }
    return providers.environmentVariable(name).orNull
        ?: properties.getProperty(name)
        ?: ""
}

android {
    namespace = "com.ywldan.karsabusiness"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.ywldan.karsabusiness"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = config("KARSA_VERSION_NAME").ifBlank { "0.1.0" }.removePrefix("v")

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables.useSupportLibrary = true

        buildConfigField("String", "API_BASE_URL", "\"${config("KARSA_API_BASE_URL")}\"")
        buildConfigField("String", "FIREBASE_API_KEY", "\"${config("FIREBASE_API_KEY")}\"")
        buildConfigField("String", "FIREBASE_APP_ID", "\"${config("FIREBASE_APP_ID")}\"")
        buildConfigField("String", "FIREBASE_PROJECT_ID", "\"${config("FIREBASE_PROJECT_ID")}\"")
        buildConfigField("String", "FIREBASE_WEB_CLIENT_ID", "\"${config("FIREBASE_WEB_CLIENT_ID")}\"")
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

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.09.00")
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
