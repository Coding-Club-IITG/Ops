#!/usr/bin/env python3
"""
ops-login-collector.py
Linux login and session lifecycle collector for Ops.
"""

import os
import sys
import re
import time
import json
import sqlite3
import socket
import urllib.request
import urllib.error
import ssl
import signal
import hashlib
from datetime import datetime, timezone

DEFAULT_AUTH_LOG = os.environ.get("OPS_AUTH_LOG_PATH", "/var/log/auth.log")
STATE_DIR = (
    os.environ.get("STATE_DIRECTORY")
    or os.environ.get("OPS_SECURITY_STATE_DIR")
    or "/var/lib/ops-security"
)
SPOOL_DB_PATH = os.path.join(STATE_DIR, "spool.db")
STATE_FILE_PATH = os.path.join(STATE_DIR, "collector-state.json")
DEFAULT_INGEST_URL = os.environ.get(
    "OPS_SECURITY_INGEST_URL", "https://ops.codingclub.in/api/ingest/security"
)
HEARTBEAT_INTERVAL = int(os.environ.get("OPS_HEARTBEAT_INTERVAL", "60"))
BATCH_SIZE = int(os.environ.get("OPS_BATCH_SIZE", "50"))
MAX_RETRIES = 10

HOSTNAME = socket.gethostname()


def get_boot_id() -> str:
    try:
        with open("/proc/sys/kernel/random/boot_id", "r") as f:
            return f.read().strip()
    except Exception:
        return "unknown-boot"


BOOT_ID = get_boot_id()


def load_ingest_secret() -> str:
    secret = os.environ.get("OPS_SECURITY_INGEST_SECRET") or os.environ.get("SECURITY_INGEST_SECRET")
    if secret:
        return secret.strip().strip('"').strip("'")

    env_paths = [
        "/etc/ops/security.env",
        "/home/cc/Projects/infra/env/ops.env",
        os.path.join(os.path.dirname(__file__), "../../env/ops.env"),
    ]
    for path in env_paths:
        if os.path.isfile(path):
            try:
                with open(path, "r") as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("SECURITY_INGEST_SECRET="):
                            val = line.split("=", 1)[1].strip().strip('"').strip("'")
                            if val:
                                return val
            except Exception:
                continue
    return ""


INGEST_SECRET = load_ingest_secret()


def classify_subnet(ip: str) -> str:
    if not ip or ip in ("127.0.0.1", "::1", "localhost"):
        return "Localhost"
    if ip.startswith("172.16.101."):
        return "Server / Infra Subnet (IITG)"
    if ip.startswith("172.16."):
        return "IITG Campus Intranet"
    if ip.startswith("172.18.") or ip.startswith("172.20.") or ip.startswith("172.24."):
        return "IITG Hostels / Campus LAN"
    if ip.startswith("10.") or ip.startswith("192.168."):
        return "Private Subnet"
    return "Public Internet"


DNS_CACHE = {}


def resolve_reverse_dns(ip: str) -> str:
    if not ip or ip in ("127.0.0.1", "::1", "localhost"):
        return "localhost"
    now = time.time()
    if ip in DNS_CACHE:
        name, expiry = DNS_CACHE[ip]
        if now < expiry:
            return name
    try:
        socket.setdefaulttimeout(1.0)
        host, _, _ = socket.gethostbyaddr(ip)
        DNS_CACHE[ip] = (host, now + 3600)
        return host
    except Exception:
        DNS_CACHE[ip] = (ip, now + 1800)
        return ip


def generate_event_id(occurred_at_iso: str, event_type: str, seed: str) -> str:
    raw = f"{BOOT_ID}:{occurred_at_iso}:{event_type}:{seed}:{HOSTNAME}"
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]
    return f"sec_{digest}"


class SpoolQueue:
    def __init__(self, db_path: str):
        self.db_path = db_path
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self.conn = sqlite3.connect(db_path, isolation_level=None, timeout=10.0)
        self.conn.execute("PRAGMA journal_mode = WAL;")
        self.conn.execute("PRAGMA synchronous = NORMAL;")
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS security_spool (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT UNIQUE NOT NULL,
                event_type TEXT NOT NULL,
                occurred_at TEXT NOT NULL,
                payload TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                created_at REAL NOT NULL
            );
            """
        )
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_spool_created ON security_spool (created_at);")

    def enqueue(self, event: dict) -> bool:
        try:
            payload = json.dumps(event)
            self.conn.execute(
                """
                INSERT OR IGNORE INTO security_spool (event_id, event_type, occurred_at, payload, created_at)
                VALUES (?, ?, ?, ?, ?);
                """,
                (event["eventId"], event["eventType"], event["occurredAt"], payload, time.time()),
            )
            return True
        except Exception as e:
            sys.stderr.write(f"Spool enqueue failed: {e}\n")
            return False

    def fetch_batch(self, limit: int = BATCH_SIZE) -> list:
        cursor = self.conn.cursor()
        cursor.execute(
            """
            SELECT id, event_id, payload, attempts
            FROM security_spool
            ORDER BY id ASC
            LIMIT ?;
            """,
            (limit,),
        )
        return cursor.fetchall()

    def mark_failed(self, ids: list):
        if not ids:
            return
        placeholders = ",".join("?" for _ in ids)
        self.conn.execute(
            f"UPDATE security_spool SET attempts = attempts + 1 WHERE id IN ({placeholders});",
            ids,
        )

    def delete_batch(self, ids: list):
        if not ids:
            return
        placeholders = ",".join("?" for _ in ids)
        self.conn.execute(
            f"DELETE FROM security_spool WHERE id IN ({placeholders});",
            ids,
        )

    def count(self) -> int:
        cursor = self.conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM security_spool;")
        row = cursor.fetchone()
        return row[0] if row else 0

    def prune_stale(self, max_records: int = 50000):
        total = self.count()
        if total > max_records:
            excess = total - max_records
            self.conn.execute(
                "DELETE FROM security_spool WHERE id IN (SELECT id FROM security_spool ORDER BY id ASC LIMIT ?);",
                (excess,),
            )


class AuthLogParser:
    RE_SSH_PUBKEY = re.compile(
        r"Accepted publickey for (?P<user>\S+) from (?P<ip>\S+) port (?P<port>\d+) ssh2:\s*(?P<key_type>\S+)\s*(?P<fingerprint>SHA256:\S+|[0-9a-fA-F:]{47,})"
    )
    RE_SSH_PASSWORD = re.compile(
        r"Accepted password for (?P<user>\S+) from (?P<ip>\S+) port (?P<port>\d+) ssh2"
    )
    RE_SSH_KBD = re.compile(
        r"Accepted keyboard-interactive/pam for (?P<user>\S+) from (?P<ip>\S+) port (?P<port>\d+) ssh2"
    )
    RE_SSH_FAILED_PASSWORD = re.compile(
        r"Failed password for (?:invalid user )?(?P<user>\S+) from (?P<ip>\S+) port (?P<port>\d+) ssh2"
    )
    RE_SSH_FAILED_PUBKEY = re.compile(
        r"Failed publickey for (?:invalid user )?(?P<user>\S+) from (?P<ip>\S+) port (?P<port>\d+) ssh2"
    )
    RE_SSH_INVALID_USER = re.compile(
        r"Invalid user (?P<user>\S+) from (?P<ip>\S+) port (?P<port>\d+)"
    )
    RE_PAM_OPEN = re.compile(
        r"pam_unix\((?P<service>sshd|sudo|su|login|cron):session\): session opened for user (?P<user>\S+)(?:\(uid=(?P<uid>\d+)\))?(?: by (?P<by_user>\S+)?(?:\(uid=(?P<by_uid>\d+)\))?)?"
    )
    RE_PAM_CLOSE = re.compile(
        r"pam_unix\((?P<service>sshd|sudo|su|login|cron):session\): session closed for user (?P<user>\S+)"
    )
    RE_SUDO_CMD = re.compile(
        r"sudo:\s+(?P<user>\S+)\s+:\s+TTY=(?P<tty>\S+)\s+;\s+PWD=(?P<pwd>[^;]+)\s+;\s+USER=(?P<target_user>\S+)\s+;\s+COMMAND=(?P<command>.+)"
    )

    RE_SYSLOG_DATE = re.compile(r"^(?P<month>[A-Za-z]{3})\s+(?P<day>\d+)\s+(?P<time>\d{2}:\d{2}:\d{2})")
    RE_ISO_DATE = re.compile(r"^(?P<iso>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:\d{2}|Z))")

    @classmethod
    def parse_timestamp(cls, line: str) -> (datetime, str):
        iso_match = cls.RE_ISO_DATE.match(line)
        if iso_match:
            iso_str = iso_match.group("iso")
            try:
                dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
                return dt.astimezone(timezone.utc), dt.isoformat()
            except Exception:
                pass

        syslog_match = cls.RE_SYSLOG_DATE.match(line)
        if syslog_match:
            try:
                now = datetime.now(timezone.utc)
                month_str = syslog_match.group("month")
                day = int(syslog_match.group("day"))
                time_str = syslog_match.group("time")
                parsed_dt = datetime.strptime(f"{now.year} {month_str} {day} {time_str}", "%Y %b %d %H:%M:%S")
                parsed_dt = parsed_dt.replace(tzinfo=timezone.utc)
                return parsed_dt, parsed_dt.isoformat()
            except Exception:
                pass

        now = datetime.now(timezone.utc)
        return now, now.isoformat()

    @classmethod
    def parse_line(cls, line: str) -> dict | None:
        line = line.strip()
        if not line:
            return None

        _, occurred_at = cls.parse_timestamp(line)

        # 1. SSH Public Key Success
        match = cls.RE_SSH_PUBKEY.search(line)
        if match:
            user = match.group("user")
            ip = match.group("ip")
            port = int(match.group("port"))
            key_type = match.group("key_type")
            fingerprint = match.group("fingerprint")
            subnet = classify_subnet(ip)
            rdns = resolve_reverse_dns(ip)
            event_id = generate_event_id(occurred_at, "login_success", f"{user}:{ip}:{port}:{fingerprint}")
            return {
                "eventId": event_id,
                "eventType": "login_success",
                "occurredAt": occurred_at,
                "account": user,
                "sourceIp": ip,
                "sourcePort": port,
                "authMethod": "publickey",
                "keyType": key_type,
                "keyFingerprint": fingerprint,
                "subnetClassification": subnet,
                "reverseDns": rdns,
                "service": "sshd",
                "result": "success",
                "summary": f"SSH public key login for {user} from {ip} ({subnet}) using {key_type} {fingerprint}",
            }

        # 2. SSH Password Success
        match = cls.RE_SSH_PASSWORD.search(line)
        if match:
            user = match.group("user")
            ip = match.group("ip")
            port = int(match.group("port"))
            subnet = classify_subnet(ip)
            rdns = resolve_reverse_dns(ip)
            event_id = generate_event_id(occurred_at, "login_success", f"{user}:{ip}:{port}:password")
            return {
                "eventId": event_id,
                "eventType": "login_success",
                "occurredAt": occurred_at,
                "account": user,
                "sourceIp": ip,
                "sourcePort": port,
                "authMethod": "password",
                "subnetClassification": subnet,
                "reverseDns": rdns,
                "service": "sshd",
                "result": "success",
                "summary": f"SSH password login for {user} from {ip} ({subnet})",
            }

        # 3. SSH Keyboard-Interactive Success
        match = cls.RE_SSH_KBD.search(line)
        if match:
            user = match.group("user")
            ip = match.group("ip")
            port = int(match.group("port"))
            subnet = classify_subnet(ip)
            rdns = resolve_reverse_dns(ip)
            event_id = generate_event_id(occurred_at, "login_success", f"{user}:{ip}:{port}:kbd")
            return {
                "eventId": event_id,
                "eventType": "login_success",
                "occurredAt": occurred_at,
                "account": user,
                "sourceIp": ip,
                "sourcePort": port,
                "authMethod": "keyboard-interactive",
                "subnetClassification": subnet,
                "reverseDns": rdns,
                "service": "sshd",
                "result": "success",
                "summary": f"SSH interactive login for {user} from {ip} ({subnet})",
            }

        # 4. SSH Failed Login
        match = cls.RE_SSH_FAILED_PASSWORD.search(line) or cls.RE_SSH_FAILED_PUBKEY.search(line) or cls.RE_SSH_INVALID_USER.search(line)
        if match:
            user = match.group("user")
            ip = match.group("ip")
            port = int(match.group("port"))
            subnet = classify_subnet(ip)
            event_id = generate_event_id(occurred_at, "login_failure", f"{user}:{ip}:{port}:{line[-10:]}")
            return {
                "eventId": event_id,
                "eventType": "login_failure",
                "occurredAt": occurred_at,
                "account": user,
                "sourceIp": ip,
                "sourcePort": port,
                "authMethod": "unknown",
                "subnetClassification": subnet,
                "service": "sshd",
                "result": "failure",
                "summary": f"Failed SSH authentication for {user} from {ip} ({subnet})",
            }

        # 5. PAM Session Opened
        match = cls.RE_PAM_OPEN.search(line)
        if match:
            service = match.group("service")
            if service == "cron":
                return None
            user = match.group("user")
            by_user = match.group("by_user") or "root"
            event_id = generate_event_id(occurred_at, "session_opened", f"{service}:{user}:{by_user}")
            return {
                "eventId": event_id,
                "eventType": "session_opened",
                "occurredAt": occurred_at,
                "account": user,
                "service": service,
                "actor": by_user,
                "result": "success",
                "summary": f"PAM session opened for user {user} via {service} by {by_user}",
            }

        # 6. PAM Session Closed
        match = cls.RE_PAM_CLOSE.search(line)
        if match:
            service = match.group("service")
            if service == "cron":
                return None
            user = match.group("user")
            event_id = generate_event_id(occurred_at, "session_closed", f"{service}:{user}")
            return {
                "eventId": event_id,
                "eventType": "session_closed",
                "occurredAt": occurred_at,
                "account": user,
                "service": service,
                "result": "success",
                "summary": f"PAM session closed for user {user} via {service}",
            }

        # 7. Sudo Command Execution
        match = cls.RE_SUDO_CMD.search(line)
        if match:
            user = match.group("user")
            tty = match.group("tty")
            pwd = match.group("pwd")
            target_user = match.group("target_user")
            command = match.group("command")
            event_id = generate_event_id(occurred_at, "sudo_escalation", f"{user}:{tty}:{command}")
            return {
                "eventId": event_id,
                "eventType": "sudo_escalation",
                "occurredAt": occurred_at,
                "account": user,
                "targetAccount": target_user,
                "tty": tty,
                "workingDirectory": pwd,
                "command": command,
                "service": "sudo",
                "result": "success",
                "summary": f"Sudo executed by {user} (as {target_user}) on {tty}: {command}",
            }

        return None


class StateManager:
    @staticmethod
    def load() -> dict:
        if os.path.isfile(STATE_FILE_PATH):
            try:
                with open(STATE_FILE_PATH, "r") as f:
                    return json.load(f)
            except Exception:
                pass
        return {"inode": 0, "offset": 0}

    @staticmethod
    def save(inode: int, offset: int):
        try:
            tmp = f"{STATE_FILE_PATH}.tmp"
            with open(tmp, "w") as f:
                json.dump({"inode": inode, "offset": offset, "updatedAt": datetime.now(timezone.utc).isoformat()}, f)
            os.replace(tmp, STATE_FILE_PATH)
        except Exception as e:
            sys.stderr.write(f"State save failed: {e}\n")


class IngestionClient:
    def __init__(self, endpoint: str, secret: str):
        self.endpoint = endpoint
        self.secret = secret

    def send_batch(self, events: list) -> bool:
        if not events:
            return True
        payload = json.dumps({"schemaVersion": 1, "events": events}).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.secret}",
            "User-Agent": f"ops-login-collector/1.0 ({HOSTNAME})",
        }
        req = urllib.request.Request(self.endpoint, data=payload, headers=headers, method="POST")
        ctx = ssl.create_default_context()
        try:
            with urllib.request.urlopen(req, context=ctx, timeout=10.0) as resp:
                return resp.status == 202
        except urllib.error.HTTPError as e:
            sys.stderr.write(f"Ingestion HTTP error {e.code}: {e.read().decode('utf-8', 'replace')}\n")
            return False
        except Exception as e:
            sys.stderr.write(f"Ingestion connection failed: {e}\n")
            return False


def run():
    print(f"Starting ops-login-collector on {HOSTNAME}")
    print(f"Auth log path: {DEFAULT_AUTH_LOG}")
    print(f"Spool DB: {SPOOL_DB_PATH}")
    print(f"Ingest URL: {DEFAULT_INGEST_URL}")

    spool = SpoolQueue(SPOOL_DB_PATH)
    client = IngestionClient(DEFAULT_INGEST_URL, INGEST_SECRET)
    state = StateManager.load()

    last_heartbeat = 0.0
    backoff = 1.0

    stop_requested = False

    def handle_signal(sig, frame):
        nonlocal stop_requested
        stop_requested = True
        print(f"Received signal {sig}, shutting down...")

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    current_file = None
    current_inode = state.get("inode", 0)
    current_offset = state.get("offset", 0)

    while not stop_requested:
        now = time.time()

        # 1. Heartbeat generator
        if now - last_heartbeat >= HEARTBEAT_INTERVAL:
            last_heartbeat = now
            q_count = spool.count()
            occurred_at = datetime.now(timezone.utc).isoformat()
            hb_id = generate_event_id(occurred_at, "collector_heartbeat", f"hb_{int(now)}")
            spool.enqueue({
                "eventId": hb_id,
                "eventType": "collector_heartbeat",
                "occurredAt": occurred_at,
                "account": "system",
                "service": "ops-login-collector",
                "queueDepth": q_count,
                "rawMetadata": {
                    "hostname": HOSTNAME,
                    "bootId": BOOT_ID,
                },
                "result": "success",
                "summary": f"Collector heartbeat on {HOSTNAME} (Queue: {q_count} pending)",
            })

        # 2. Read new log entries
        if os.path.isfile(DEFAULT_AUTH_LOG):
            try:
                st = os.stat(DEFAULT_AUTH_LOG)
                file_inode = st.st_ino

                if current_file is None or file_inode != current_inode:
                    if current_file:
                        current_file.close()
                    current_file = open(DEFAULT_AUTH_LOG, "r", encoding="utf-8", errors="replace")
                    current_inode = file_inode
                    if file_inode == state.get("inode", 0):
                        current_offset = state.get("offset", 0)
                    else:
                        current_offset = 0
                    current_file.seek(current_offset)

                if st.st_size < current_offset:
                    current_file.seek(0)
                    current_offset = 0

                while True:
                    line = current_file.readline()
                    if not line:
                        break
                    event = AuthLogParser.parse_line(line)
                    if event:
                        spool.enqueue(event)

                new_offset = current_file.tell()
                if new_offset != current_offset:
                    current_offset = new_offset
                    StateManager.save(current_inode, current_offset)

            except Exception as e:
                sys.stderr.write(f"Log reading error: {e}\n")
                if current_file:
                    try:
                        current_file.close()
                    except Exception:
                        pass
                    current_file = None

        # 3. Flush spool to Ops Ingest API
        batch_rows = spool.fetch_batch(BATCH_SIZE)
        if batch_rows:
            ids = [r[0] for r in batch_rows]
            events = [json.loads(r[2]) for r in batch_rows]
            if client.send_batch(events):
                spool.delete_batch(ids)
                backoff = 1.0
            else:
                spool.mark_failed(ids)
                time.sleep(min(backoff, 30.0))
                backoff = min(backoff * 2.0, 60.0)

        spool.prune_stale()
        time.sleep(1.0)

    if current_file:
        try:
            current_file.close()
        except Exception:
            pass
    print("ops-login-collector exited cleanly.")


if __name__ == "__main__":
    run()
