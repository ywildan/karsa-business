package com.ywldan.karsabusiness.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [BusinessEntity::class, TransactionEntity::class],
    version = 1,
    exportSchema = false,
)
abstract class KarsaDatabase : RoomDatabase() {
    abstract fun karsaDao(): KarsaDao

    companion object {
        fun create(context: Context): KarsaDatabase = Room.databaseBuilder(
            context.applicationContext,
            KarsaDatabase::class.java,
            "karsa.db",
        ).fallbackToDestructiveMigration(false).build()
    }
}
