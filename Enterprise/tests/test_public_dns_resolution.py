#!/usr/bin/env python3
"""Offline-only public DNS validation tests; no real DNS lookup or HTTP traffic."""
import importlib.util
import pathlib
import socket
import unittest

src = pathlib.Path(__file__).resolve().parents[1] / "deploy" / "resolve-public-host.py"
spec = importlib.util.spec_from_file_location("public_host", src)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def resolver_for(*addresses):
    def fake_lookup(host, port, **options):
        assert host == "console.aaditech.net"
        assert port is None
        assert options["type"] == socket.SOCK_STREAM
        return [
            (socket.AF_INET6 if ":" in addr else socket.AF_INET,
             socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (addr, 0))
            for addr in addresses
        ]
    return fake_lookup


class PublicDnsTests(unittest.TestCase):
    def test_public_ipv4_and_ipv6(self):
        self.assertEqual(module.pinned_address(
            "console.aaditech.net", resolver_for("8.8.8.8", "2606:4700:4700::1111")), "8.8.8.8")
        self.assertEqual(module.pinned_address(
            "console.aaditech.net", resolver_for("2606:4700:4700::1111")), "[2606:4700:4700::1111]")

    def test_reject_non_global_ipv4(self):
        for address in ("127.0.0.1", "10.0.0.1", "172.16.0.1",
                        "192.168.1.1", "169.254.169.254", "100.64.1.1",
                        "192.0.2.5", "192.0.0.9", "198.18.0.1",
                        "203.0.113.1", "224.0.0.1"):
            with self.subTest(address=address):
                with self.assertRaises(ValueError):
                    module.pinned_address("console.aaditech.net", resolver_for(address))

    def test_reject_non_global_ipv6(self):
        for address in ("::1", "fc00::1", "fe80::1", "ff02::1",
                        "2001:db8::1", "::ffff:127.0.0.1",
                        "2002:c0a8:0101::", "2001:0:ffff::1"):
            with self.subTest(address=address):
                with self.assertRaises(ValueError):
                    module.pinned_address("console.aaditech.net", resolver_for(address))

    def test_reject_mixed_answer_rebinding(self):
        for answers in (("8.8.8.8", "127.0.0.1"),
                        ("8.8.8.8", "::ffff:192.168.1.1"),
                        ("2606:4700:4700::1111", "fe80::1")):
            with self.subTest(answers=answers):
                with self.assertRaises(ValueError):
                    module.pinned_address("console.aaditech.net", resolver_for(*answers))

    def test_no_answers_or_ip_literals(self):
        with self.assertRaises(ValueError):
            module.pinned_address("console.aaditech.net", resolver_for())
        with self.assertRaises(ValueError):
            module.pinned_address("127.0.0.1", lambda *args, **kwargs: self.fail("No lookup expected"))
        with self.assertRaises(ValueError):
            module.pinned_address("bad\nhost", lambda *args, **kwargs: self.fail("No lookup expected"))


if __name__ == "__main__":
    unittest.main()
