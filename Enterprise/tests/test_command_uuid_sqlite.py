"""Actual worker SQL using Python SQLite; not the packaged Windows CLI."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
import json
import re
import sqlite3
import tempfile
import threading
import unittest

SOURCE = (Path(__file__).resolve().parents[1] / "agent" / "Agent-Collect.ps1").read_text(encoding="utf-8")
V2 = re.search(r"CREATE TABLE IF NOT EXISTS executed_commands_v2 \([\s\S]*?\n\);", SOURCE).group()
SCHEMA = re.search(r"CREATE TABLE IF NOT EXISTS command_results_v3 \([\s\S]*?\n\);", SOURCE).group()
def extract(prefix):
    return re.search(r'Invoke-SQLite -Query "(' + re.escape(prefix) + r'[^"]+)"', SOURCE).group(1)
CLAIM = extract("INSERT OR IGNORE INTO command_results_v3")
FINISH = extract("UPDATE command_results_v3 SET status=")
ACK = extract("UPDATE command_results_v3 SET delivery='acknowledged'")
UUID = "6f8c5ad9-e52e-4ea4-a1c7-f1dc23688a9e"
BINDING = "1" * 64
BODY = json.dumps({"status": "completed", "output": "O'Brien", "exit_code": 0}, separators=(",", ":"))

def changes(db, template, *, binding=BINDING, status="completed", body=BODY):
    sql = (template.replace("$bodyHex", body.encode().hex()).replace("$status", status)
           .replace("$Binding", binding).replace("$binding", binding).replace("$id", UUID))
    statement, check = sql.split("; ", 1)
    assert check == "SELECT changes();", check
    db.execute(statement)
    return db.execute(check).fetchone()[0]

class LedgerSQLiteTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "agent.sqlite"
        with closing(self.connect()) as db:
            db.execute("CREATE TABLE executed_commands (command_id INTEGER PRIMARY KEY,status TEXT)")
            db.execute("INSERT INTO executed_commands VALUES (42,'completed')")
            db.execute(V2)
            db.execute(SCHEMA)
    def tearDown(self):
        self.tmp.cleanup()
    def connect(self):
        return sqlite3.connect(self.db, timeout=10, isolation_level=None)
    def test_concurrent_claim_and_immutable_pending_result(self):
        barrier = threading.Barrier(8)
        def claim():
            with closing(self.connect()) as db:
                barrier.wait(timeout=10)
                return changes(db, CLAIM)
        with ThreadPoolExecutor(max_workers=8) as pool:
            self.assertEqual(sorted(pool.map(lambda _: claim(), range(8))), [0]*7+[1])
        with closing(self.connect()) as db:
            self.assertEqual(changes(db, FINISH, binding="2"*64), 0)
            self.assertEqual(changes(db, FINISH), 1)
            self.assertEqual(changes(db, FINISH, status="failed", body="changed"), 0)
            self.assertEqual(changes(db, ACK, binding="2"*64), 0)
            self.assertEqual(db.execute("SELECT body,delivery FROM command_results_v3").fetchone(), (BODY,"pending"))
        with closing(self.connect()) as db:
            self.assertEqual(db.execute("SELECT body,delivery FROM command_results_v3").fetchone(), (BODY,"pending"))
            self.assertEqual(changes(db, ACK), 1)
            self.assertEqual(changes(db, ACK), 0)
            self.assertEqual(changes(db, CLAIM), 0)
            self.assertEqual(db.execute("SELECT body,delivery FROM command_results_v3").fetchone(), (BODY,"acknowledged"))
            self.assertEqual(db.execute("SELECT * FROM executed_commands").fetchall(), [(42,"completed")])
    def test_interrupted_claim_and_old_unbound_rows(self):
        with closing(self.connect()) as db:
            db.execute("INSERT INTO executed_commands_v2(command_id,status) VALUES (?, 'completed')", (UUID,))
            self.assertEqual(changes(db, CLAIM), 0)
            self.assertEqual(db.execute("SELECT count(*) FROM command_results_v3").fetchone(), (0,))
            db.execute("DELETE FROM executed_commands_v2")
            self.assertEqual(changes(db, CLAIM), 1)
        with closing(self.connect()) as db:
            self.assertEqual(changes(db, CLAIM, binding="2"*64), 0)
            self.assertEqual(db.execute("SELECT status,delivery,body FROM command_results_v3").fetchone(), ("claimed","none",""))
        self.assertIn("uncertain prior claim; refusing re-execution", SOURCE)
if __name__ == "__main__":
    unittest.main(verbosity=2)
