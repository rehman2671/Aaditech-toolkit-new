#!/usr/bin/env python3
"""Reject malformed, ambiguous or degraded Hostinger /healthz JSON responses.

This is a read-only local parser. It never prints the source response.
"""
import json
import pathlib
import sys

MAX_BYTES = 65536


def no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON object key")
        result[key] = value
    return result


def validated_health_json(raw):
    if isinstance(raw, bytes):
        if len(raw) > MAX_BYTES:
            raise ValueError("Health response too large")
        raw = raw.decode("utf-8")
    elif not isinstance(raw, str) or len(raw.encode("utf-8")) > MAX_BYTES:
        raise ValueError("Health response is not bounded JSON")
    result = json.loads(raw, object_pairs_hook=no_duplicates,
                        parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Invalid JSON constant")))
    if not isinstance(result, dict) or type(result.get("status")) is not str:
        raise ValueError("Health status missing or invalid")
    components = result.get("components")
    if result["status"] != "ok" or not isinstance(components, dict) or             type(components.get("database")) is not str or components["database"] != "HEALTHY":
        raise ValueError("Persistent MySQL health is not ready")
    return True


def main():
    if len(sys.argv) != 2:
        print("[hostinger-acceptance][BLOCKED] Health JSON file required", file=sys.stderr)
        return 2
    try:
        path = pathlib.Path(sys.argv[1])
        with path.open("rb") as file:
            raw = file.read(MAX_BYTES + 1)
        validated_health_json(raw)
    except (ValueError, OSError, UnicodeError, json.JSONDecodeError):
        print("[hostinger-acceptance][BLOCKED] Untrusted, malformed or degraded health JSON", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
