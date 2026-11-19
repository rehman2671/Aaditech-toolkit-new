#!/usr/bin/env python3
"""Offline response-shape cases for /healthz; never open a socket."""
import importlib.util
import pathlib
import unittest

src = pathlib.Path(__file__).resolve().parents[1] / "deploy" / "validate-public-health.py"
spec = importlib.util.spec_from_file_location("public_health", src)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class HealthAcceptanceTests(unittest.TestCase):
    def test_genuine_server_shape(self):
        self.assertTrue(module.validated_health_json(
            b'{"status":"ok","timestamp":"2026-11-18T00:00:00Z",'
            b'"components":{"database":"HEALTHY","ingest_queue":"OPERATIONAL"}}'))

    def test_fail_closed_response_shapes(self):
        cases = [
            b'{"status":"degraded","components":{"database":"HEALTHY"}}',
            b'{"status":"ok","components":{"database":"DEGRADED"}}',
            b'{"status":"ok","components":{"database":null}}',
            b'{"status":true,"components":{"database":"HEALTHY"}}',
            b'{"status":"ok","database":"HEALTHY"}',
            b'{"status":"ok","metadata":{"database":"HEALTHY"},"components":{"database":"DEGRADED"}}',
            b'{"status":"bad","status":"ok","components":{"database":"HEALTHY"}}',
            b'{"status":"ok","components":{"database":"DEGRADED","database":"HEALTHY"}}',
            b'{"status":"ok","components":{"database":"HEALTHY"}}{"status":"ok"}',
            b'{"status":"ok","components":{"database":"HEALTHY"},"bogus":NaN}',
            b'[]',
            b'not a JSON response',
            b'{"status":',
            b'\xff\xfe\xfd',
            b' ' * (module.MAX_BYTES + 1),
            b'{"status":"ok","components":{"database":"HEALTHY"},"message":"' +
              b'a' * module.MAX_BYTES + b'"}',
        ]
        for payload in cases:
            with self.subTest(payload=payload[:50]):
                with self.assertRaises((ValueError, UnicodeError)):
                    module.validated_health_json(payload)


if __name__ == "__main__":
    unittest.main()
