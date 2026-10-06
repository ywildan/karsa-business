package com.ywldan.karsabusiness.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [BusinessEntity::class, TransactionEntity::class, ProductEntity::class],
    version = 3,
    exportSchema = false,
)
abstract class KarsaDatabase : RoomDatabase() {
    abstract fun karsaDao(): KarsaDao

    companion object {
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS products (
                        id TEXT NOT NULL PRIMARY KEY,
                        ownerId TEXT NOT NULL,
                        businessId TEXT NOT NULL,
                        name TEXT NOT NULL,
                        price INTEGER NOT NULL DEFAULT 0,
                        stock INTEGER NOT NULL DEFAULT 0,
                        createdAt INTEGER NOT NULL,
                        updatedAt INTEGER NOT NULL,
                        deletedAt INTEGER,
                        syncStatus TEXT NOT NULL DEFAULT 'PENDING'
                    )
                    """.trimIndent(),
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS index_products_ownerId ON products(ownerId)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_products_businessId ON products(businessId)")
                db.execSQL("ALTER TABLE transactions ADD COLUMN productId TEXT")
                db.execSQL("ALTER TABLE transactions ADD COLUMN quantity INTEGER")
            }
        }

        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("DROP INDEX IF EXISTS index_businesses_ownerId")
                db.execSQL("CREATE INDEX index_businesses_ownerId ON businesses(ownerId)")
            }
        }

        fun create(context: Context): KarsaDatabase = Room.databaseBuilder(
            context.applicationContext,
            KarsaDatabase::class.java,
            "karsa.db",
        ).addMigrations(MIGRATION_1_2, MIGRATION_2_3).build()
    }
}
