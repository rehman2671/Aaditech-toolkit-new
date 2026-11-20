#!/usr/bin/env python3
"""N44 offline *format* audit for a redacted N42/N43 Windows HTTPS report.

NEVER certifies customer production. A valid report always exits 3
(NOT_APPROVED). Invalid/unsafe evidence exits 1. No network, secrets,
signing claims, or paths are included in report output.
"""
import argparse
import datetime
import json
import os
import re
import stat
import sys

MAX_REPORT_BYTES = 65536
SCHEMA = "aaditech-stage42-windows-https-v1"
FIELDS = frozenset({
    "schema", "timestamp_utc", "mode", "https_health_probe",
    "diagnostic_phase", "certified_for_production", "physical_lost_ack",
    "public_publisher_signed_msi", "external_hostinger_acceptance",
    "independent_security_review",
})
EXTERNAL = (
    "approved_live_customer_origin_and_public_dns_tls",
    "independent_human_security_review",
    "publisher_signed_installer_and_key_custody",
    "physical_windows_authenticated_ack_replay",
    "encrypted_offsite_restore",
    "real_source_to_incident_integration",
    "release_owner_production_change_authorization",
)


class EvidenceRefused(Exception):
    pass


def _unique_pairs(pairs):
    data = {}
    for key, value in pairs:
        if key in data:
            raise EvidenceRefused("Duplicate JSON keys")
        data[key] = value
    return data


def _reject_constant(_value):
    raise EvidenceRefused("Nonfinite JSON constants")


def _read_bounded_regular(path):
    # Open read-only and refuse symlinks, directories, special devices and
    # a path swap between lstat and the opened descriptor.
    if not hasattr(os, "O_NOFOLLOW"):
        # No cross-platform downgrade to an unsafe symlink-following open.
        raise EvidenceRefused("Platform lacks safe evidence-file opening")
    try:
        before = os.lstat(path)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
            raise EvidenceRefused("Not an ordinary single-link evidence file")
        flags = os.O_RDONLY
        flags |= getattr(os, "O_CLOEXEC", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(path, flags)
        try:
            opened = os.fstat(fd)
            if (
                not stat.S_ISREG(opened.st_mode)
                or opened.st_nlink != 1
                or (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino)
                or opened.st_size < 1
                or opened.st_size > MAX_REPORT_BYTES
            ):
                raise EvidenceRefused("Unsafe evidence file")
            # Must be stable across read, with no trailing extra bytes.
            body = bytearray()
            while len(body) <= MAX_REPORT_BYTES:
                chunk = os.read(fd, min(8192, MAX_REPORT_BYTES + 1 - len(body)))
                if not chunk:
                    break
                body.extend(chunk)
            after = os.fstat(fd)
            if (
                len(body) != opened.st_size
                or after.st_size != opened.st_size
                or after.st_mtime_ns != opened.st_mtime_ns
                or after.st_ctime_ns != opened.st_ctime_ns
            ):
                raise EvidenceRefused("Evidence changed during read")
            return bytes(body)
        finally:
            os.close(fd)
    except (OSError, ValueError) as exc:
        raise EvidenceRefused("Evidence cannot be read safely") from exc


def validate(path):
    raw = _read_bounded_regular(path)
    try:
        evidence = json.loads(
            raw.decode("utf-8", "strict"),
            object_pairs_hook=_unique_pairs,
            parse_constant=_reject_constant,
        )
    except (UnicodeError, ValueError, TypeError) as exc:
        raise EvidenceRefused("Invalid evidence JSON") from exc
    if type(evidence) is not dict or set(evidence) != FIELDS:
        raise EvidenceRefused("Unrecognized evidence schema")
    if evidence["schema"] != SCHEMA or type(evidence["schema"]) is not str:
        raise EvidenceRefused("Unsupported evidence version")
    if evidence["certified_for_production"] is not False:
        raise EvidenceRefused("Unsupported production certification assertion")
    for field in (
        "physical_lost_ack", "public_publisher_signed_msi",
        "external_hostinger_acceptance", "independent_security_review",
    ):
        if type(evidence[field]) is not str or evidence[field] != "PENDING":
            raise EvidenceRefused("Unsupported externally attested status")
    timestamp = evidence["timestamp_utc"]
    if type(timestamp) is not str or len(timestamp) > 40:
        raise EvidenceRefused("Invalid UTC timestamp")
    try:
        parsed = datetime.datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError as exc:
        raise EvidenceRefused("Invalid UTC timestamp") from exc
    if parsed.tzinfo is None or parsed.utcoffset() != datetime.timedelta(0):
        raise EvidenceRefused("UTC timestamp required")

    mode, state, phase = (
        evidence["mode"], evidence["https_health_probe"],
        evidence["diagnostic_phase"],
    )
    if type(mode) is not str or type(state) is not str or type(phase) is not str:
        raise EvidenceRefused("Invalid diagnostic types")
    if mode == "OFFLINE_DRY_RUN":
        if state != "PENDING" or phase != "NONE":
            raise EvidenceRefused("Offline report cannot assert a live result")
    elif mode == "OPERATOR_CONFIRMED_LIVE":
        if state == "PASS" and phase == "NONE":
            pass
        elif state == "BLOCKED" and re.fullmatch(r"[A-Z][A-Z0-9_]{0,63}", phase):
            pass
        else:
            raise EvidenceRefused("Inconsistent live diagnostic result")
    else:
        raise EvidenceRefused("Unknown diagnostic mode")

    # A PASS is self-reported by unsigned local evidence. It is not a
    # cryptographic or externally witnessed claim, let alone production proof.
    return {
        "schema": "aaditech-n44-release-evidence-audit-v1",
        "evidence_format_valid": True,
        "reported_https_state": state,
        "production_approved": False,
        "external_proof_required": list(EXTERNAL),
    }


def main():
    parser = argparse.ArgumentParser(description="Offline Windows diagnostic audit; never production approval")
    parser.add_argument("--report", required=True, help="N42/N43 redacted diagnostic JSON")
    parser.add_argument("--output", help="Optional exclusive 0600 redacted audit JSON")
    args = parser.parse_args()
    try:
        result = validate(args.report)
        body = (json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
        if args.output:
            # Exclusively publish, never overwrite/symlink-follow. Refuse
            # reports that already exist and keep the output free of paths.
            fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            try:
                with os.fdopen(fd, "wb", closefd=False) as out:
                    out.write(body)
                    out.flush()
                    os.fsync(fd)
            finally:
                os.close(fd)
        else:
            sys.stdout.buffer.write(body)
        sys.stderr.write("N44 diagnostic format valid; production NOT APPROVED.\n")
        return 3
    except (EvidenceRefused, OSError):
        sys.stderr.write("N44 evidence refused; production NOT APPROVED.\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
