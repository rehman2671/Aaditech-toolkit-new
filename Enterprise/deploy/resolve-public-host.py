#!/usr/bin/env python3
"""Fail-closed public DNS preflight for read-only Hostinger acceptance.

Resolve every endpoint address once and pin the selected address in curl.
Never print resolved internal addresses or perform HTTP requests here.
"""
import ipaddress
import socket
import sys

# A few protocol/special ranges need an explicit deny even on Python versions
# where is_global may label a subset as publicly routable.
EXTRA_DENIED = (
    ipaddress.ip_network("192.0.0.0/24"),
    ipaddress.ip_network("192.88.99.0/24"),
    ipaddress.ip_network("224.0.0.0/4"),   # IPv4 multicast is not a single public service
    ipaddress.ip_network("ff00::/8"),     # IPv6 multicast
    ipaddress.ip_network("2001::/32"),   # Teredo / embedded IPv4
    ipaddress.ip_network("2002::/16"),  # 6to4 / embedded IPv4
)


def public_address(address):
    value = ipaddress.ip_address(address)
    effective = value.ipv4_mapped if isinstance(value, ipaddress.IPv6Address) and value.ipv4_mapped else value
    return bool(
        value.is_global
        and effective.is_global
        and not value.is_multicast
        and not effective.is_multicast
        and not value.is_reserved
        and not any(value in subnet for subnet in EXTRA_DENIED if subnet.version == value.version)
        and not any(effective in subnet for subnet in EXTRA_DENIED if subnet.version == effective.version)
    )


def pinned_address(host, resolver=socket.getaddrinfo):
    if not isinstance(host, str) or not host or any(ch.isspace() for ch in host):
        raise ValueError("Invalid DNS host")
    # Hostnames, not IP literals, are required. The Bash caller additionally
    # validates label syntax, reserved zones and confirmation for live access.
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise ValueError("IP literal is not a public DNS name")
    answers = resolver(host, None, type=socket.SOCK_STREAM)
    addresses = {row[4][0] for row in answers if row[0] in (socket.AF_INET, socket.AF_INET6)}
    if not addresses or not all(public_address(address) for address in addresses):
        raise ValueError("DNS returned an invalid, private or special-use endpoint")
    # Prefer IPv4 for general VPS compatibility, but support IPv6-only hosts.
    chosen = sorted(addresses, key=lambda s: (ipaddress.ip_address(s).version != 4, s))[0]
    return f"[{chosen}]" if ":" in chosen else chosen


def main():
    if len(sys.argv) != 2:
        print("[public-dns][BLOCKED] Public DNS hostname argument required", file=sys.stderr)
        return 2
    try:
        print(pinned_address(sys.argv[1]))
    except (OSError, ValueError, TypeError, IndexError):
        # Do not disclose private DNS answers or internal host metadata.
        print("[public-dns][BLOCKED] Public DNS resolution/endpoint validation failed", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
