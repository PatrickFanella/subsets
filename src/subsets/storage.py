"""Private state and journaled filesystem changes with drift-safe rollback."""
from __future__ import annotations

from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import tempfile
import uuid


class DeckError(Exception):
    pass


def read(path: Path, default=None):
    return json.loads(path.read_text()) if path.exists() else default


def save(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as handle:
        json.dump(value, handle, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
        temporary = handle.name
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def snapshot(path: Path, budget=None, depth=0):
    budget = budget if budget is not None else [0]
    budget[0] += 1
    if budget[0] > 20_000 or depth > 64:
        raise DeckError("Tree exceeds 20000 entries or 64 levels: " + str(path))
    if path.is_symlink():
        return {"type": "link", "target": os.readlink(path), "mode": stat.S_IMODE(path.lstat().st_mode)}
    if path.is_file():
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            while block := handle.read(1024 * 1024):
                digest.update(block)
        return {"type": "file", "sha256": digest.hexdigest(), "mode": stat.S_IMODE(path.stat().st_mode)}
    if path.is_dir():
        return {"type": "directory", "mode": stat.S_IMODE(path.stat().st_mode),
                "entries": {p.name: snapshot(p, budget, depth + 1) for p in sorted(path.iterdir())}}
    if path.exists():
        raise DeckError("Unsupported file type: " + str(path))
    return None


def safe_parents(path: Path):
    if any(p.is_symlink() for p in [path, *path.parents]):
        raise DeckError("Refusing a symlink destination or parent: " + str(path))


def copy(source: Path, target: Path):
    if source.is_symlink():
        target.symlink_to(os.readlink(source))
    elif source.is_dir():
        shutil.copytree(source, target, symlinks=True)
    else:
        shutil.copy2(source, target)


def remove(path: Path):
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.is_dir():
        shutil.rmtree(path)


def payload_operation(path: Path, expected, value):
    payload = json.dumps(value, indent=2) + "\n"
    return text_operation(path, expected, payload, mode=0o600)


def text_operation(path: Path, expected, payload: str, mode=0o644):
    desired = {"type": "file", "sha256": hashlib.sha256(payload.encode()).hexdigest(), "mode": mode}
    return {"path": str(path), "expected": expected, "desired": desired, "payload": payload}


class Store:
    def __init__(self, path: Path | None = None):
        default = Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local/share"))) / "subsets"
        self.path = Path(path or os.environ.get("SUBSETS_HOME", str(default))).expanduser().absolute()
        self.registry = self.path / "registry.json"

    def load(self):
        if self.registry.is_symlink():
            raise DeckError("The registry must be a private regular file, not a symlink")
        data = read(self.registry, {"version": 1, "roots": {}, "skills": {},
                                    "groups": {"core": []}, "activeGroups": []})
        if data.get("version") != 1:
            raise DeckError("Unsupported Subsets registry version")
        return data

    @contextmanager
    def lock(self, allow_pending=False):
        safe_parents(self.path)
        self.path.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path.chmod(0o700)
        with (self.path / "lock").open("a") as handle:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise DeckError("Another Subsets operation is running") from None
            if not allow_pending:
                for journal in self.path.glob("transactions/*/journal.json"):
                    if read(journal)["status"] in {"applying", "rolling-back", "failed"}:
                        raise DeckError("Recover the unfinished transaction with rollback: " + journal.parent.name)
            yield

    def transaction(self, operations: list[dict], label: str, fault=None):
        # Caller holds the store lock. Check all destinations and sources before any writes.
        for op in operations:
            path = Path(op["path"])
            safe_parents(path.parent)
            if snapshot(path) != op["expected"]:
                raise DeckError("Destination changed; preserve edits: " + str(path))
            if op.get("source") and snapshot(Path(op["source"])) != op["desired"]:
                raise DeckError("Source changed: " + op["source"])
        identifier = uuid.uuid4().hex
        run = self.path / "transactions" / identifier
        run.mkdir(parents=True)
        journal = {"id": identifier, "label": label, "status": "applying", "operations": operations}
        save(run / "journal.json", journal)
        try:
            for index, op in enumerate(operations):
                path = Path(op["path"])
                backup = run / "backups" / str(index)
                backup.parent.mkdir(exist_ok=True)
                if snapshot(path) != op["expected"]:
                    raise DeckError("Destination changed during apply: " + str(path))
                if op["expected"] is not None:
                    copy(path, backup)
                if snapshot(backup) != op["expected"]:
                    raise DeckError("Backup verification failed: " + str(path))
                op["phase"] = "backed-up"
                save(run / "journal.json", journal)
                if op["desired"] != op["expected"]:
                    stage = path.parent / (".subsets-stage-" + identifier + "-" + str(index))
                    path.parent.mkdir(parents=True, exist_ok=True)
                    if stage.exists() or stage.is_symlink():
                        raise DeckError("Unexpected staging path: " + str(stage))
                    if op["desired"] is not None:
                        if "payload" in op:
                            stage.write_text(op["payload"])
                            stage.chmod(op["desired"]["mode"])
                        else:
                            copy(Path(op["source"]), stage)
                        if snapshot(stage) != op["desired"]:
                            raise DeckError("Staged source changed: " + str(path))
                    if snapshot(path) != op["expected"]:
                        raise DeckError("Destination changed before replacement: " + str(path))
                    op["stage"] = str(stage)
                    op["phase"] = "replacing"
                    save(run / "journal.json", journal)
                    remove(path)
                    if fault:
                        fault(index)
                    if op["desired"] is not None:
                        os.replace(stage, path)
                if snapshot(path) != op["desired"]:
                    raise DeckError("Installation verification failed: " + str(path))
                op["phase"] = "complete"
                save(run / "journal.json", journal)
            journal["status"] = "complete"
            save(run / "journal.json", journal)
            return identifier
        except BaseException:
            journal["status"] = "failed"
            save(run / "journal.json", journal)
            raise

    def rollback(self, identifier: str):
        if not isinstance(identifier, str) or not __import__("re").fullmatch(r"[a-f0-9]{32}", identifier):
            raise DeckError("Use the transaction ID printed by apply or shown by history")
        run = self.path / "transactions" / identifier
        journal = read(run / "journal.json")
        if journal is None:
            raise DeckError("Unknown transaction: " + identifier)
        if journal["status"] == "rolled-back":
            return identifier
        operations = journal["operations"]
        # All-path preflight keeps later user changes intact, including registry edits.
        for index, op in enumerate(operations):
            if "phase" not in op:
                continue
            path = Path(op["path"])
            safe_parents(path.parent)
            permitted = [op["expected"], op["desired"]]
            if op["phase"] in {"replacing", "restoring"}:
                permitted.append(None)
            if snapshot(path) not in permitted:
                raise DeckError("Rollback preserves later edits at " + str(path))
            if snapshot(run / "backups" / str(index)) != op["expected"]:
                raise DeckError("Rollback backup changed: " + str(path))
        journal["status"] = "rolling-back"
        save(run / "journal.json", journal)
        for index in reversed(range(len(operations))):
            op = operations[index]
            if "phase" not in op:
                continue
            path = Path(op["path"])
            if snapshot(path) != op["expected"]:
                stage = path.parent / (".subsets-restore-" + identifier + "-" + str(index))
                if op["expected"] is not None and not stage.exists():
                    copy(run / "backups" / str(index), stage)
                if op["expected"] is not None and snapshot(stage) != op["expected"]:
                    raise DeckError("Rollback staging changed: " + str(path))
                op["phase"] = "restoring"
                save(run / "journal.json", journal)
                remove(path)
                if op["expected"] is not None:
                    os.replace(stage, path)
            if snapshot(path) != op["expected"]:
                raise DeckError("Rollback verification failed: " + str(path))
            if op.get("stage"):
                stage = Path(op["stage"])
                if snapshot(stage) == op["desired"]:
                    remove(stage)
        journal["status"] = "rolled-back"
        save(run / "journal.json", journal)
        return identifier

    def history(self):
        return [read(p) for p in sorted(self.path.glob("transactions/*/journal.json"),
                                       key=lambda p: p.stat().st_mtime, reverse=True)]
