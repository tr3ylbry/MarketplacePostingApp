"""Synthetic PTY regression only. Never attach to an owner's Terminal/clipboard."""
import json
import os
import pty
import select
import signal
import subprocess
import sys
import termios
import time

sentinel = b"MARKETPLACE POSTING ASSISTANT"
cases = ["plain", "bracketed", "command", "empty", "cancel", "eof", "oversize", "multiline", "signal"]
for case in cases:
    master, slave = pty.openpty()
    original = termios.tcgetattr(slave)
    child = subprocess.Popen([sys.argv[1], "--conditions=react-server", "--import", "tsx",
                              "scripts/ebay-capture-discovery.ts", "--rehearse-input"],
                             stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
    received = b""
    try:
        deadline = time.monotonic() + 12
        while b"(hidden): " not in received:
            if time.monotonic() >= deadline or child.poll() is not None:
                raise AssertionError("PTY prompt unavailable: " + case)
            if select.select([master], [], [], .1)[0]:
                received += os.read(master, 8192)
        assert not termios.tcgetattr(slave)[3] & termios.ECHO, "input echo enabled"
        payload = {"plain": sentinel, "bracketed": b"\x1b[200~" + sentinel + b"\x1b[201~",
                   "command": b"node accidental-command --check-session", "empty": b"",
                   "cancel": b"synthetic-hidden-input\x03", "eof": b"synthetic-hidden-input\x04",
                   "oversize": b"x" * 4097,
                   "multiline": b"\x1b[200~node accidental-command\nsecond-command\x1b[201~",
                   "signal": b"synthetic-hidden-input"}[case]
        if payload:
            os.write(master, payload)
        # A separate Enter is intentionally required; pasted newlines cannot
        # submit/release trailing shell commands. No real session is used here.
        time.sleep(.1)
        if case == "signal":
            child.send_signal(signal.SIGTERM)
        elif case not in ["cancel", "eof"]:
            os.write(master, b"\r")
        try:
            status = child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            raise AssertionError("PTY child did not exit: " + case) from None
        while select.select([master], [], [], .05)[0]:
            received += os.read(master, 8192)
        assert termios.tcgetattr(slave) == original, "terminal settings not restored: " + case
        assert sentinel not in received and b"synthetic-hidden-input" not in received
        assert b"accidental-command" not in received and b"second-command" not in received
        assert b"xxxxxxxxxxxxxxxx" not in received, "oversized input echoed"
        assert status == (0 if case in ["plain", "bracketed"] else 1), "exit: " + case
        if status == 0:
            assert b'"matched":true' in received
    finally:
        if child.poll() is None:
            child.kill()
            child.wait()
        os.close(master)
        os.close(slave)
print(json.dumps({"cases": len(cases), "noEcho": True, "restored": True}))
