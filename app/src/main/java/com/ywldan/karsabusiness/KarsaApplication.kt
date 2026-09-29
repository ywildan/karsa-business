package com.ywldan.karsabusiness

import android.app.Application
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.ywldan.karsabusiness.data.local.KarsaDatabase
import com.ywldan.karsabusiness.data.repository.KarsaRepository
import com.ywldan.karsabusiness.data.sync.SyncScheduler

class KarsaApplication : Application() {
    val database by lazy { KarsaDatabase.create(this) }
    val repository by lazy { KarsaRepository(database.karsaDao(), this) }

    override fun onCreate() {
        super.onCreate()
        configureFirebase()
        SyncScheduler.schedulePeriodic(this)
    }

    private fun configureFirebase() {
        if (BuildConfig.FIREBASE_API_KEY.isBlank() ||
            BuildConfig.FIREBASE_APP_ID.isBlank() ||
            BuildConfig.FIREBASE_PROJECT_ID.isBlank()
        ) return

        if (FirebaseApp.getApps(this).isEmpty()) {
            val options = FirebaseOptions.Builder()
                .setApiKey(BuildConfig.FIREBASE_API_KEY)
                .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                .build()
            FirebaseApp.initializeApp(this, options)
        }
    }
}

