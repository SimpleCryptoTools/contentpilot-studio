import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = [
    ROOT / "migrations" / "0001_generation_reservations.sql",
    ROOT / "migrations" / "0002_auth_rate_limits.sql",
]


class MigrationSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys = ON")
        # Minimal pre-existing parent table required by migration 0001.
        self.db.execute("CREATE TABLE users (id TEXT PRIMARY KEY)")
        for migration in MIGRATIONS:
            self.db.executescript(migration.read_text(encoding="utf-8"))

    def tearDown(self):
        self.db.close()

    def test_migrations_are_repeatable(self):
        for migration in MIGRATIONS:
            self.db.executescript(migration.read_text(encoding="utf-8"))
        tables = {
            row[0]
            for row in self.db.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        self.assertIn("generation_reservations", tables)
        self.assertIn("auth_rate_limits", tables)

    def test_reservation_state_and_type_constraints(self):
        self.db.execute("INSERT INTO users (id) VALUES ('user-1')")
        base = (
            "INSERT INTO generation_reservations "
            "(id,user_id,reservation_type,usage_date,status,created_at,updated_at) "
            "VALUES (?,?,?,?,?,?,?)"
        )
        self.db.execute(base, ("r1", "user-1", "free", "2026-11-16", "reserved", 1, 1))
        self.db.execute(
            "UPDATE generation_reservations SET status='consumed' WHERE id='r1'"
        )
        self.assertEqual(
            self.db.execute(
                "SELECT status FROM generation_reservations WHERE id='r1'"
            ).fetchone()[0],
            "consumed",
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                base, ("r2", "user-1", "gift", "2026-11-16", "reserved", 1, 1)
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                base, ("r3", "user-1", "credit", "2026-11-16", "pending", 1, 1)
            )

    def test_reservations_cascade_when_parent_user_is_deleted(self):
        self.db.execute("INSERT INTO users (id) VALUES ('user-2')")
        self.db.execute(
            "INSERT INTO generation_reservations "
            "(id,user_id,reservation_type,usage_date,status,created_at,updated_at) "
            "VALUES ('r-cascade','user-2','credit','2026-11-16','reserved',1,1)"
        )
        self.db.execute("DELETE FROM users WHERE id='user-2'")
        self.assertIsNone(
            self.db.execute(
                "SELECT id FROM generation_reservations WHERE id='r-cascade'"
            ).fetchone()
        )

    def test_expected_indexes_exist(self):
        indexes = {
            row[0]
            for row in self.db.execute(
                "SELECT name FROM sqlite_master WHERE type = 'index'"
            )
        }
        self.assertTrue({
            "idx_generation_reservations_user_status",
            "idx_generation_reservations_created_at",
            "idx_auth_rate_limits_window_started_at",
        }.issubset(indexes))

    def test_auth_rate_limit_key_is_unique_and_counter_default_is_zero(self):
        self.db.execute(
            "INSERT INTO auth_rate_limits (rate_key, window_started_at) VALUES ('login:ip:digest', 100)"
        )
        self.assertEqual(
            self.db.execute(
                "SELECT attempts FROM auth_rate_limits WHERE rate_key='login:ip:digest'"
            ).fetchone()[0],
            0,
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO auth_rate_limits (rate_key, window_started_at) VALUES ('login:ip:digest', 101)"
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
