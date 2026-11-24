"""Run the actual worker ledger SQL against real SQLite, without running commands.

Python's bundled SQLite is an independent SQL engine fixture, not the packaged
Windows sqlite3.exe or a complete installed-worker/ACK transport E2E.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import re
import sqlite3
import tempfile
import threading
from contextlib import closing
import unittest

SOURCE = (Path(__file__).resolve().parents[1] / "agent" / "Agent-Collect.ps1").read_text(encoding="utf-8")
SCHEMA = re.search(r"CREATE TABLE IF NOT EXISTS executed_commands_v2 \([\s\S]*?\n\);", SOURCE).group()
CLAIM = re.search(r'Invoke-SQLite -Query "(INSERT OR IGNORE INTO executed_commands_v2[^"]+)"', SOURCE).group(1)
FINISH = re.search(r'Invoke-SQLite -Query "(UPDATE executed_commands_v2[^"]+)"', SOURCE).group(1)
UUID = "6f8c5ad9-e52e-4ea4-a1c7-f1dc23688a9e"


def changes(conn, template, *, status="completed", output="ok", exit_code=0):
    sql = (template.replace("$([int]$Result.exit_code)", str(exit_code))
           .replace("$status", status).replace("$esc", output.replace("'", "''"))
           .replace("$id", UUID))
    statement, check = sql.split("; ", 1)
    assert check == "SELECT changes();", check
    conn.execute(statement)
    return conn.execute(check).fetchone()[0]


class LedgerSQLiteTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "agent.sqlite"
        with closing(self.connect()) as db:
            db.execute("CREATE TABLE executed_commands (command_id INTEGER PRIMARY KEY, status TEXT)")
            db.execute("INSERT INTO executed_commands VALUES (42, 'completed')")
            db.execute(SCHEMA)

    def tearDown(self):
        self.tmp.cleanup()

    def connect(self):
        # Each concurrent claimant uses an independent database connection.
        # SQLite's timeout permits lock contention to resolve; actual worker
        # CLI lock failures are fail-closed, not an authorization to execute.
        return sqlite3.connect(self.db, timeout=10, isolation_level=None)

    def test_concurrent_claim_and_terminal_immutability(self):
        barrier = threading.Barrier(8)

        def claim():
            with closing(self.connect()) as db:
                barrier.wait(timeout=10)
                return changes(db, CLAIM)

        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: claim(), range(8)))
        self.assertEqual(sorted(results), [0] * 7 + [1])
        with closing(self.connect()) as db:
            self.assertEqual(db.execute("SELECT command_id,status FROM executed_commands_v2").fetchall(),
                             [(UUID, "claimed")])
            self.assertEqual(changes(db, FINISH, output="O'Brien"), 1)
            self.assertEqual(changes(db, FINISH, status="failed", output="late", exit_code=9), 0)
            self.assertEqual(changes(db, CLAIM), 0)
            self.assertEqual(db.execute("SELECT status,output,exit_code FROM executed_commands_v2").fetchone(),
                             ("completed", "O'Brien", 0))
            self.assertEqual(db.execute("SELECT * FROM executed_commands").fetchall(), [(42, "completed")])

    def test_reopen_after_interrupted_claim(self):
        with closing(self.connect()) as db:
            self.assertEqual(changes(db, CLAIM), 1)
        # Simulate a process exiting after a committed claim and before any
        # trustworthy terminal evidence. A new connection must not win again.
        with closing(self.connect()) as db:
            self.assertEqual(changes(db, CLAIM), 0)
            self.assertEqual(db.execute("SELECT status FROM executed_commands_v2").fetchone(), ("claimed",))
        self.assertIn("uncertain prior claim; refusing re-execution", SOURCE)


if __name__ == "__main__":
    unittest.main(verbosity=2)
