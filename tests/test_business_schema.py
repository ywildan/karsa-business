"""Verify the SQLite upgrade keeps existing business records and relationships."""
import re
import sqlite3
import unittest
from pathlib import Path


class BusinessSchemaMigrationTest(unittest.TestCase):
    def test_upgrade_preserves_records_and_allows_multiple_businesses(self):
        db = sqlite3.connect(':memory:')
        self.addCleanup(db.close)
        db.executescript('''
            CREATE TABLE businesses(id TEXT PRIMARY KEY, ownerId TEXT, name TEXT);
            CREATE UNIQUE INDEX index_businesses_ownerId ON businesses(ownerId);
            CREATE TABLE transactions(id TEXT PRIMARY KEY, businessId TEXT, amount INTEGER);
            CREATE TABLE products(id TEXT PRIMARY KEY, businessId TEXT, stock INTEGER);
            INSERT INTO businesses VALUES ('original', 'owner', 'Bisnis lama');
            INSERT INTO transactions VALUES ('tx', 'original', 95000);
            INSERT INTO products VALUES ('product', 'original', 10);
        ''')
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO businesses VALUES ('second', 'owner', 'Kedua')")
        path = Path(__file__).resolve().parents[1] / 'app/src/main/java/com/ywldan/karsabusiness/data/local/KarsaDatabase.kt'
        migration = path.read_text().split('val MIGRATION_2_3', 1)[1].split('fun create', 1)[0]
        statements = re.findall(r'db.execSQL\("([^\"]+)"\)', migration)
        self.assertTrue(statements)
        for sql in statements:
            db.execute(sql)
        db.execute("INSERT INTO businesses VALUES ('second', 'owner', 'Kedua')")
        self.assertEqual(db.execute('SELECT name FROM businesses WHERE id="original"').fetchone(), ('Bisnis lama',))
        self.assertEqual(db.execute('SELECT businessId, amount FROM transactions').fetchone(), ('original', 95000))
        self.assertEqual(db.execute('SELECT businessId, stock FROM products').fetchone(), ('original', 10))
        self.assertEqual(db.execute('SELECT count(*) FROM businesses WHERE ownerId="owner"').fetchone(), (2,))
