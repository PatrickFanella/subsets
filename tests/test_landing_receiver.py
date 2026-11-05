"""Exercise receiver admission with isolated paths and command fixtures."""

import fcntl
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess

import pytest


REPOSITORY = Path(__file__).resolve().parents[1]
CURRENT = "a" * 40
OLD = "b" * 40


@pytest.fixture
def receiver(tmp_path):
    tools = tmp_path / "tools"
    releases = tmp_path / "releases"
    binaries = tmp_path / "bin"
    for directory in [tools, releases, binaries]:
        directory.mkdir()
    source = (REPOSITORY / "deploy/release-ssh.sh").read_text()
    # Relocate only the two fixed operator paths in this test copy. The real
    # receiver keeps fixed paths, and the test does not change the user's HOME.
    for name, directory in [("tools", tools), ("releases", releases)]:
        fixed = f'{name}="$HOME/.local/share/subsets/{"release-tools" if name == "tools" else "releases"}"'
        assert fixed in source
        source = source.replace(fixed, name + "=" + shlex.quote(str(directory)))
    script = tmp_path / "receiver.sh"
    script.write_text(source)
    log = tmp_path / "docker.log"
    (binaries / "git").write_text(
        '#!/bin/sh\n'
        'if [ -e "$RECEIVER_TEST_CHANGED" ]; then revision="$RECEIVER_TEST_NEW_MAIN"; else revision="$RECEIVER_TEST_MAIN"; fi\n'
        'printf "%s\\trefs/heads/main\\n" "$revision"\n'
    )
    (binaries / "docker").write_text(
        '#!/bin/sh\nprintf "%s\\n" "$*" >> "$RECEIVER_TEST_LOG"\n'
        'if [ "$1 $2" = "image inspect" ]; then printf "%s\\n" "$RECEIVER_TEST_LABEL"; fi\n'
        'if [ "$1 $2" = "image inspect" ] && [ "$RECEIVER_TEST_ADVANCE" = true ]; then printf changed > "$RECEIVER_TEST_CHANGED"; fi\n'
        'if [ "$1" = inspect ]; then\n'
        '  case "$3" in\n'
        '    *Config.Image*) printf "%s\\n" "$RECEIVER_TEST_RUNNING" ;;\n'
        '    "{{.Image}}") printf "%s\\n" "$RECEIVER_TEST_PREVIOUS_ID" ;;\n'
        '    *) printf "%s\\n" "$RECEIVER_TEST_LABEL" ;;\n'
        '  esac\n'
        'fi\n'
        'if [ "$1" = run ]; then printf expected-html; fi\n'
        'if [ "$1" = compose ]; then printf "compose-image=%s\\n" "$SUBSETS_IMAGE" >> "$RECEIVER_TEST_LOG"; fi\n'
    )
    (binaries / "curl").write_text("#!/bin/sh\nprintf unexpected-html\n")
    (binaries / "sleep").write_text("#!/bin/sh\nexit 0\n")
    # Exercise the real kernel lock with a short timeout in fixtures.
    flock = shlex.quote(shutil.which("flock"))
    (binaries / "flock").write_text(
        '#!/bin/sh\nif [ "$1" = -w ]; then shift; shift; '
        f'exec {flock} -w 0.1 "$@"; else exec {flock} "$@"; fi\n'
    )
    for binary in binaries.iterdir():
        binary.chmod(0o700)

    def run(command, label=CURRENT, advance_main=False):
        env = {
            **os.environ,
            "PATH": str(binaries) + os.pathsep + os.environ["PATH"],
            "SSH_ORIGINAL_COMMAND": command,
            "RECEIVER_TEST_MAIN": CURRENT,
            "RECEIVER_TEST_LABEL": label,
            "RECEIVER_TEST_LOG": str(log),
            "RECEIVER_TEST_RUNNING": "subsets-landing-main:" + CURRENT,
            "RECEIVER_TEST_PREVIOUS_ID": "sha256:" + "c" * 64,
            "RECEIVER_TEST_CHANGED": str(tmp_path / "main-changed"),
            "RECEIVER_TEST_NEW_MAIN": OLD,
            "RECEIVER_TEST_ADVANCE": str(advance_main).lower(),
        }
        result = subprocess.run(
            ["bash", str(script)], input=b"", capture_output=True, env=env, timeout=5
        )
        calls = log.read_text().splitlines() if log.exists() else []
        return result, calls

    return run, releases


@pytest.mark.parametrize("operation", ["receive-main", "deploy-main"])
def test_stale_main_refuses_before_docker(receiver, operation):
    run, _ = receiver
    result, calls = run(operation + " " + OLD)
    assert result.returncode != 0
    assert b"not current main" in result.stderr
    assert calls == []


def test_current_main_receive_checks_the_expected_image(receiver):
    run, _ = receiver
    result, calls = run("receive-main " + CURRENT)
    assert result.returncode == 0
    assert calls[0] == "load -q"
    assert calls[-1].endswith("subsets-landing-main:" + CURRENT)


def test_tag_receive_keeps_historical_release_support(receiver):
    run, _ = receiver
    result, calls = run("receive " + OLD, label=OLD)
    assert result.returncode == 0
    assert calls[0] == "load -q"


@pytest.mark.parametrize("operation", ["receive-main", "receive"])
def test_main_and_tag_operations_share_one_lock(receiver, operation):
    run, releases = receiver
    with (releases / ".deploy.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result, calls = run(operation + " " + CURRENT)
    assert result.returncode != 0
    assert b"operation is active" in result.stderr
    assert calls == []


def test_main_retry_verifies_and_rolls_back_by_image_id(receiver):
    run, releases = receiver
    result, calls = run("deploy-main " + CURRENT)
    assert result.returncode != 0
    # The running tag already matches, but main retries must still verify it.
    # A retagged candidate cannot be used as its own rollback image.
    images = [line for line in calls if line.startswith("compose-image=")]
    assert images == [
        "compose-image=subsets-landing-main:" + CURRENT,
        "compose-image=sha256:" + "c" * 64,
    ]
    receipt = json.loads((releases / CURRENT[:12] / "receipt.json").read_text())
    assert receipt["previousImageId"] == "sha256:" + "c" * 64


def test_main_change_during_preparation_neither_activates_nor_rolls_back(receiver):
    run, _ = receiver
    result, calls = run("deploy-main " + CURRENT, advance_main=True)
    assert result.returncode != 0
    assert b"not current main" in result.stderr
    assert not any(line.startswith("compose-image=") for line in calls)


@pytest.mark.parametrize("command", ["status extra", "receive-main main", "receive-main " + CURRENT + " extra"])
def test_invalid_arguments_refuse_before_docker(receiver, command):
    run, _ = receiver
    result, calls = run(command)
    assert result.returncode != 0
    assert calls == []
