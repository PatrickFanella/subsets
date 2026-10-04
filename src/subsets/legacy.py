"""Bridge the existing codex-skills backend without adopting its deployments."""
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys

from .storage import DeckError, read, snapshot, text_operation
from . import discovery
from .manager import group_name


class Legacy:
    def __init__(self, source: Path):
        self.source = source.resolve()
        if not all((self.source / p).is_file() for p in
                   ["scripts/skill-profile", "scripts/optional-clients.py", "catalog/qualification.json"]):
            raise DeckError("Not a supported codex-skills authoring source: " + str(source))

    @classmethod
    def find(cls, home: Path):
        link = home / ".agents/bin/skill-profile"
        if not link.is_symlink():
            return None
        source = link.resolve().parent.parent
        try:
            return cls(source)
        except DeckError:
            return None

    def groups(self):
        return {path.stem: [line.strip() for line in path.read_text().splitlines()
                            if line.strip() and not line.lstrip().startswith("#")]
                for path in sorted((self.source / "profiles").glob("*.txt"))}

    def inventory(self):
        # Honor the canonical catalog instead of reintroducing superseded names.
        reserved = set(read(self.source / "catalog/retired-names.json", {}))
        reserved |= {row["name"] for row in read(self.source / "catalog/proposed-catalog.json", [])
                     if row.get("scope", "personal") != "optional"}
        reserved |= set(read(self.source / "catalog/local-owners.json", {}))
        for row in read(self.source / "catalog/vault-agents.json", {"files": []})["files"]:
            path = Path(row["source"])
            if path.name == "SKILL.md" and "skills" in path.parts:
                reserved.add(path.parent.name)
        system = Path.home() / ".codex/skills/.system"
        if system.is_dir():
            reserved |= {path.name for path in system.iterdir() if (path / "SKILL.md").is_file()}
        reserved |= {name for name, row in read(self.source / "catalog/qualification.json")["skills"].items()
                     if row["status"] == "blocked"}
        roots = [discovery.Root(str(self.source / "library/skills"), "shared", "optional", "codex-skills source")]
        skills, warnings = discovery.scan(roots)
        # Shared overrides have their own owner and are always included by the backend.
        shared = {p.name for p in (self.source / "shared").iterdir() if (p / "SKILL.md").is_file()}
        return roots, [s for s in skills if s.name not in reserved | shared], warnings

    def edit_group(self, store, action, name, references):
        group_name(name)
        if name == "core":
            raise DeckError("The existing core keeps its canonical shared owners; edit that source through its maintenance workflow")
        _, skills, _ = self.inventory()
        selected = set()
        for reference in references:
            matches = [skill for skill in skills if reference in {skill.id, skill.name}]
            if len(matches) != 1 or matches[0].issue:
                raise DeckError("Existing profiles accept eligible optional library skills only: " + reference)
            selected.add(matches[0].name)
        with store.lock():
            groups = self.groups()
            if action == "create" and name in groups:
                raise DeckError("Existing profile already exists: " + name)
            if action != "create" and name not in groups:
                raise DeckError("Unknown existing profile: " + name)
            path = self.source / "profiles" / (name + ".txt")
            previous = snapshot(path)
            members = set(groups.get(name, []))
            members = members - selected if action == "remove" else members | selected
            comments = [line for line in path.read_text().splitlines() if line.lstrip().startswith("#")] if path.is_file() else ["# Profile: " + name]
            payload = "\n".join(comments + sorted(members)) + "\n"
            op = text_operation(path, previous, payload, mode=previous["mode"] if previous else 0o644)
            receipt = store.transaction([op], action + " existing profile " + name)
            return {"group": name, "members": sorted(members), "backend": "codex-skills",
                    "source": str(path), "transaction": receipt}

    def command(self, script, args):
        try:
            proc = subprocess.run([sys.executable, "-B", str(self.source / "scripts" / script), *args],
                                  cwd=self.source, capture_output=True, text=True, timeout=120)
        except subprocess.TimeoutExpired:
            raise DeckError("Existing backend timed out. Inspect its state/receipts before retrying.") from None
        if proc.returncode:
            raise DeckError(f"Existing backend stopped ({script}):\n{proc.stderr.strip() or proc.stdout.strip()}")
        return proc.stdout.strip()

    def plan(self, groups):
        missing = set(groups) - self.groups().keys()
        if missing:
            raise DeckError("Unknown existing profiles: " + ", ".join(sorted(missing)))
        names = [name for name in groups if name != "core"]
        codex = json.loads(self.command("skill-profile", ["plan", *names]))
        flags = [item for name in names for item in ["--profile", name]]
        claude = json.loads(self.command("optional-clients.py", ["plan", *flags]))
        return {"backend": "codex-skills", "source": str(self.source), "groups": groups or ["core"],
                "codex": codex, "claude": claude, "restartRequired": True}

    def apply(self, groups, reviewed=None):
        proposal = self.plan(groups)
        if reviewed is not None and reviewed != proposal:
            raise DeckError("Existing backend plan changed; preview again")
        names = [name for name in groups if name != "core"]
        codex = self.command("skill-profile", ["activate", *names])
        flags = [item for name in names for item in ["--profile", name]]
        try:
            receipt = self.command("optional-clients.py", ["apply", *flags])
            verified = json.loads(self.command("optional-clients.py", ["verify", *flags]))
        except (DeckError, subprocess.TimeoutExpired) as exc:
            raise DeckError(f"Codex selection changed; Claude did not finish. Preserve the backend receipt/state.\n{exc}") from exc
        return {"backend": "codex-skills", "codex": codex, "claudeReceipt": receipt,
                "claudeVerification": verified, "restartRequired": True}

    def active_groups(self, home):
        return read(home / ".agents/.skill-profile-state.json", {}).get("profiles", ["core"])
