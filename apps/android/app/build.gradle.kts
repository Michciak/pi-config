plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

android {
    namespace = "pl.michalkozinski.piremote"
    compileSdk = 36

    defaultConfig {
        applicationId = "pl.michalkozinski.piremote"
        minSdk = 28
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    signingConfigs {
        create("release") {
            val store = providers.environmentVariable("PI_REMOTE_KEYSTORE").orNull
            if (store != null) {
                storeFile = file(store)
                storePassword = providers.environmentVariable("PI_REMOTE_STORE_PASSWORD").orNull
                keyAlias = providers.environmentVariable("PI_REMOTE_KEY_ALIAS").orElse("pi-remote").get()
                keyPassword = providers.environmentVariable("PI_REMOTE_KEY_PASSWORD").orNull
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (providers.environmentVariable("PI_REMOTE_KEYSTORE").isPresent) signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_21; targetCompatibility = JavaVersion.VERSION_21 }
    kotlinOptions { jvmTarget = "21" }
}

dependencies {
    implementation(platform("com.google.firebase:firebase-bom:34.5.0"))
    implementation("com.google.firebase:firebase-messaging")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.work:work-runtime-ktx:2.10.5")
}
