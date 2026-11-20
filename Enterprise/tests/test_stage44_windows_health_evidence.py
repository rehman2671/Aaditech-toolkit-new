"""N44 offline release-evidence audit regression. No DNS/HTTP or real customer data."""
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "deploy" / "audit-windows-health-evidence.py"
BASE = {
    "schema": "aaditech-stage42-windows-https-v1",
    "timestamp_utc": "2026-11-20T00:00:00.0000000Z",
    "mode": "OPERATOR_CONFIRMED_LIVE",
    "https_health_probe": "PASS",
    "diagnostic_phase": "NONE",
    "certified_for_production": False,
    "physical_lost_ack": "PENDING",
    "public_publisher_signed_msi": "PENDING",
    "external_hostinger_acceptance": "PENDING",
    "independent_security_review": "PENDING",
}


class Stage44EvidenceAudit(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name)
        self.evidence = self.root / "customer.json"

    def run_audit(self, content, *, out=None):
        if isinstance(content, dict):
            content = json.dumps(content).encode()
        elif isinstance(content, str):
            content = content.encode()
        self.evidence.write_bytes(content)
        cmd = [sys.executable, str(SCRIPT), "--report", str(self.evidence)]
        if out is not None:
            cmd.extend(["--output", str(out)])
        return subprocess.run(cmd, capture_output=True, check=False)

    def test_valid_live_pass_still_rejects_production(self):
        p = self.run_audit(BASE)
        self.assertEqual(p.returncode, 3, p.stderr)
        obj = json.loads(p.stdout)
        self.assertIs(obj["production_approved"], False)
        self.assertIs(obj["evidence_format_valid"], True)
        self.assertEqual(obj["reported_https_state"], "PASS")
        self.assertGreaterEqual(len(obj["external_proof_required"]), 7)
        self.assertNotIn(str(self.evidence).encode(), p.stdout + p.stderr)
        self.assertNotIn(b"token", p.stdout + p.stderr)

    def test_offline_pending_not_production(self):
        value = {**BASE, "mode": "OFFLINE_DRY_RUN", "https_health_probe": "PENDING"}
        p = self.run_audit(value)
        self.assertEqual(p.returncode, 3, p.stderr)
        self.assertFalse(json.loads(p.stdout)["production_approved"])

    def test_live_blocked_not_production(self):
        value = {**BASE, "https_health_probe": "BLOCKED", "diagnostic_phase": "LIVE_DNS"}
        p = self.run_audit(value)
        self.assertEqual(p.returncode, 3, p.stderr)
        self.assertEqual(json.loads(p.stdout)["reported_https_state"], "BLOCKED")

    def test_invalid_reports_fail_closed(self):
        bad = [
            {**BASE, "certified_for_production": True},
            {**BASE, "certified_for_production": "false"},
            {**BASE, "external_hostinger_acceptance": "PASS"},
            {**BASE, "independent_security_review": "APPROVED"},
            {**BASE, "public_publisher_signed_msi": "PASS"},
            {**BASE, "physical_lost_ack": "PASS"},
            {**BASE, "mode": "OFFLINE_DRY_RUN"},
            {**BASE, "https_health_probe": "PENDING"},
            {**BASE, "diagnostic_phase": "LIVE_DNS"},
            {**BASE, "mode": "LIVE"},
            {**BASE, "timestamp_utc": "2026-11-20T00:00:00"},
            {**BASE, "timestamp_utc": "2026-11-20T05:30:00+05:30"},
            {**BASE, "timestamp_utc": "not-a-time"},
            {**BASE, "extra": "unspecified"},
            {k: v for k, v in BASE.items() if k != "schema"},
            [],
            None,
            "not a report",
            b"\xff\xfe",
            b"\xef\xbb\xbf" + json.dumps(BASE).encode(),
            b'{"schema":"a","schema":"b"}',
            b'{"x":NaN}',
            json.dumps(BASE).encode() + b"{}",
            b"x" * 65537,
        ]
        for i, content in enumerate(bad):
            with self.subTest(index=i):
                result = self.run_audit(content)
                self.assertEqual(result.returncode, 1, (i, result.stdout, result.stderr))
                self.assertFalse(result.stdout)
                self.assertNotIn(b"customer.json", result.stderr)
                self.assertIn(b"NOT APPROVED", result.stderr)

    def test_symlink_input_rejected(self):
        target = self.root / "source.json"
        target.write_text(json.dumps(BASE), encoding="utf-8")
        self.evidence.symlink_to(target)
        p = subprocess.run([sys.executable, str(SCRIPT), "--report", str(self.evidence)], capture_output=True)
        self.assertEqual(p.returncode, 1)
        self.assertNotIn(str(target).encode(), p.stderr)

    def test_output_is_exclusive_and_redacted(self):
        output = self.root / "audit.json"
        first = self.run_audit(BASE, out=output)
        self.assertEqual(first.returncode, 3)
        self.assertTrue(output.exists())
        self.assertIs(json.loads(output.read_text())["production_approved"], False)
        self.assertFalse(output.stat().st_mode & 0o077)
        old = output.read_bytes()
        again = self.run_audit(BASE, out=output)
        self.assertEqual(again.returncode, 1)
        self.assertEqual(old, output.read_bytes())
        self.assertFalse(again.stdout)

    def test_invalid_report_never_publishes_output(self):
        output = self.root / "audit.json"
        p = self.run_audit({**BASE, "certified_for_production": True}, out=output)
        self.assertEqual(p.returncode, 1)
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
