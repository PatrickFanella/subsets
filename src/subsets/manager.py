"""Folder ownership, canonical imports, groups, and desired-state plans."""
from __future__ import annotations

from dataclasses import asdict
import hashlib
import os
from pathlib import Path
import re

from . import discovery
from .storage import DeckError, Store, copy, payload_operation, read, safe_parents, snapshot


def group_name(name: str):
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", name):
        raise DeckError("Group names use lowercase letters, digits and hyphens (1–64 characters)")
    if name in {"group", "dry-run", "json", "help", "version", "state", "project", "root", "no-plugins", "backend"}:
        raise DeckError("Group name conflicts with a CLI option: " + name)


class Manager:
    def __init__(self, store: Store | None = None, home: Path | None = None,
                 project: Path | None = None, extra=None, plugins=True):
        self.store = store or Store()
        self.home = (home or Path.home()).absolute()
        self.project = project
        self.extra = extra or []
        self.plugins = plugins

    def inventory(self):
        data = self.store.load()
        configured = data.get("searchRoots", {})
        roots = discovery.roots(self.home, self.project,
                                self.extra + [Path(path) for path in configured], self.plugins)
        known = {r.path for r in roots}
        for record in data["roots"].values():
            if record["path"] not in known:
                roots.append(discovery.Root(record["path"], record["client"], record["scope"]))
        for root in roots:
            if configured.get(root.path) == "readonly" and root.owner == "unmanaged":
                root.owner = "declared read-only"
            if root.id in data["roots"]:
                root.owner = "subsets"
        skills, warnings = discovery.scan(roots)
        # Imported inactive skills remain visible, with their canonical library paths.
        visible = {s.id for s in skills}
        for identifier, record in data["skills"].items():
            if identifier not in visible:
                root = data["roots"][record["rootId"]]
                skills.append(discovery.Skill(identifier, record["name"], record["description"],
                              record["source"], root["path"], root["client"], root["scope"], "subsets"))
        return roots, skills, warnings

    def configure_root(self, path: Path, owner="readonly"):
        path = path.expanduser().absolute()
        if not path.is_dir():
            raise DeckError("Search root must be an existing skill directory")
        with self.store.lock():
            data = self.store.load()
            if any(row["path"] == str(path) for row in data["roots"].values()):
                raise DeckError("This folder is already managed; preserve its registered ownership")
            data.setdefault("searchRoots", {})[str(path)] = owner
            receipt = self.store.transaction([payload_operation(self.store.registry,
                        snapshot(self.store.registry), data)], "register search root " + str(path))
            return {"path": str(path), "owner": owner, "transaction": receipt}

    def find_root(self, reference: str):
        roots, _, _ = self.inventory()
        matches = [r for r in roots if reference in {r.id, r.path}]
        if len(matches) != 1:
            raise DeckError("Unknown skill root. Use `subsets roots` or pass --root PATH to discover it.")
        return matches[0]

    def _canonical_copy(self, skill: discovery.Skill):
        if skill.issue:
            raise DeckError("Cannot import invalid skill: " + skill.issue)
        source = Path(skill.path)
        if source.is_symlink():
            raise DeckError("A linked skill retains its source owner; discover its authoring folder explicitly")
        # Internal relative resources keep their references after copying. External
        # links need deliberate adaptation by their author instead of broken copies.
        for path in source.rglob("*"):
            if path.is_symlink():
                if os.path.isabs(os.readlink(path)) or not path.resolve().is_relative_to(source.resolve()):
                    raise DeckError("External resource symlink requires author review: " + str(path))
        before = snapshot(source)
        digest = hashlib.sha256(__import__("json").dumps(before, sort_keys=True).encode()).hexdigest()
        canonical = self.store.path / "library" / skill.id / digest
        if not canonical.exists():
            canonical.parent.mkdir(parents=True, exist_ok=True)
            copy(source, canonical)
        if snapshot(source) != before or snapshot(canonical) != before:
            raise DeckError("Source changed while importing: " + skill.path)
        return str(canonical), before

    def adopt(self, reference: str):
        with self.store.lock():
            root = self.find_root(reference)
            data = self.store.load()
            if root.id in data["roots"]:
                self.validate_root(data["roots"][root.id])
                return {"root": root.id, "alreadyManaged": True}
            safe_parents(Path(root.path))
            if root.owner != "unmanaged":
                raise DeckError(f"{root.owner} owns {root.path}; use its backend, not adoption")
            path = Path(root.path)
            safe_parents(path)
            if self.store.path.is_relative_to(path) or path.is_relative_to(self.store.path):
                raise DeckError("Skill root and private state must not overlap")
            for other in data["roots"].values():
                old = Path(other["path"])
                if path.is_relative_to(old) or old.is_relative_to(path):
                    raise DeckError("Managed roots must not overlap")
            marker = path / ".subsets-owner.json"
            if marker.exists() or marker.is_symlink():
                raise DeckError("Folder already has an ownership marker; use its original registry")
            skills, warnings = discovery.scan([root])
            adopted, protected, baseline = [], {}, {}
            for skill in skills:
                if skill.owner != "unmanaged" or skill.issue:
                    protected[skill.name] = snapshot(Path(skill.path))
                    warnings.append(f"Preserved {skill.name}: {skill.issue or skill.owner}")
                    continue
                source, tree = self._canonical_copy(skill)
                data["skills"][skill.id] = {"name": skill.name, "description": skill.description,
                    "rootId": root.id, "source": source, "origin": skill.path}
                adopted.append(skill.id)
                baseline[skill.name] = tree
            owner = {"version": 1, "store": str(self.store.path), "root": root.id}
            owner_op = payload_operation(marker, None, owner)
            data["roots"][root.id] = {**root.record(), "owner": "subsets", "baseline": baseline,
                                      "protected": protected, "marker": owner_op["desired"], "markerName": marker.name}
            current = "current-" + root.id
            if current in data["groups"]:
                raise DeckError("Adoption group name is already in use: " + current)
            data["groups"][current] = adopted
            data["activeGroups"] = sorted(set(data["activeGroups"]) | {current})
            operations = [owner_op, payload_operation(self.store.registry, snapshot(self.store.registry), data)]
            # Skills are untouched on adoption; guard the captured baseline too.
            for name, expected in baseline.items():
                if snapshot(path / name) != expected:
                    raise DeckError("Skill changed during adoption: " + name)
            receipt = self.store.transaction(operations, "adopt " + root.path)
            return {"root": root.id, "adopted": adopted, "preserved": sorted(protected),
                    "warnings": warnings, "transaction": receipt}

    def validate_root(self, root):
        path = Path(root["path"])
        safe_parents(path)
        if snapshot(path / root.get("markerName", ".skilldeck-owner.json")) != root["marker"]:
            raise DeckError("Ownership marker changed: " + root["path"])
        if discovery.root_owner(path, self.home) not in {"unmanaged", "subsets", "subsets registry"}:
            raise DeckError("Another installer has claimed this folder: " + root["path"])
        for name, expected in {**root["baseline"], **root["protected"]}.items():
            if snapshot(path / name) != expected:
                raise DeckError("Skill drift; preserve edits before applying: " + str(path / name))

    def resolve(self, reference: str, managed=True):
        if managed:
            matches = [(identifier, record) for identifier, record in self.store.load()["skills"].items()
                       if reference in {identifier, record["name"]}]
            if len(matches) == 1:
                return matches[0][0]
        else:
            _, skills, _ = self.inventory()
            matches = [s for s in skills if reference in {s.id, s.name}]
            if len(matches) == 1:
                return matches[0]
        if len(matches) > 1:
            raise DeckError("Ambiguous skill name; use its root-qualified ID: " + reference)
        raise DeckError("Unknown skill: " + reference)

    def import_skill(self, reference: str, target: str):
        with self.store.lock():
            skill = self.resolve(reference, managed=False)
            root = self.find_root(target)
            data = self.store.load()
            if root.id not in data["roots"]:
                raise DeckError("Adopt the target root before importing into it")
            self.validate_root(data["roots"][root.id])
            if skill.owner in {"package", "plugin"} or skill.scope in {"plugin", "system"}:
                raise DeckError("Package/plugin skills keep their owners; do not import their caches")
            identifier = root.id + ":" + skill.name
            if identifier in data["skills"]:
                raise DeckError("A managed skill with this name already exists in the target root")
            if snapshot(Path(root.path) / skill.name) is not None:
                raise DeckError("Unmanaged destination exists: " + skill.name)
            source, _ = self._canonical_copy(skill)
            data["skills"][identifier] = {"name": skill.name, "description": skill.description,
                                        "rootId": root.id, "source": source, "origin": skill.path}
            data["roots"][root.id]["baseline"][skill.name] = None
            receipt = self.store.transaction([payload_operation(self.store.registry,
                         snapshot(self.store.registry), data)], "import " + identifier)
            return {"skill": identifier, "transaction": receipt, "active": False}

    def edit_group(self, action: str, name: str, references: list[str]):
        group_name(name)
        with self.store.lock():
            data = self.store.load()
            if action == "create" and name in data["groups"]:
                raise DeckError("Group already exists: " + name)
            if action != "create" and name not in data["groups"]:
                raise DeckError("Unknown group: " + name)
            identifiers = {self.resolve(ref) for ref in references}
            members = set(data["groups"].get(name, []))
            members = members - identifiers if action == "remove" else members | identifiers
            data["groups"][name] = sorted(members)
            receipt = self.store.transaction([payload_operation(self.store.registry,
                       snapshot(self.store.registry), data)], action + " group " + name)
            return {"group": name, "members": sorted(members), "transaction": receipt}

    def plan(self, groups: list[str]):
        data = self.store.load()
        if not data["roots"]:
            raise DeckError("No managed roots. Run `subsets roots`, then `subsets adopt ROOT_ID`.")
        requested = sorted(set(groups) | {"core"})
        missing = set(requested) - data["groups"].keys()
        if missing:
            raise DeckError("Unknown groups: " + ", ".join(sorted(missing)))
        selected = {identifier for name in requested for identifier in data["groups"][name]}
        if selected - data["skills"].keys():
            raise DeckError("Group references missing managed skills")
        operations = []
        for root in data["roots"].values():
            self.validate_root(root)
        for identifier, skill in sorted(data["skills"].items()):
            root = data["roots"][skill["rootId"]]
            source = Path(skill["source"])
            if not source.is_relative_to(self.store.path / "library"):
                raise DeckError("Canonical source escapes Subsets library")
            checked = discovery.inspect(source, discovery.Root(str(source.parent), root["client"], root["scope"]),
                                        expected_name=skill["name"])
            if checked.issue:
                raise DeckError("Canonical source needs repair: " + checked.issue)
            desired = snapshot(source) if identifier in selected else None
            if desired is None and not source.exists():
                raise DeckError("Canonical source is missing: " + str(source))
            destination = Path(root["path"]) / skill["name"]
            expected = root["baseline"].get(skill["name"])
            action = "unchanged" if desired == expected else "deactivate" if desired is None else "activate"
            operations.append({"path": str(destination), "source": str(source),
                               "expected": expected, "desired": desired, "action": action, "skill": identifier})
            if desired is None:
                operations[-1].pop("source")
            root["baseline"][skill["name"]] = desired
        data["activeGroups"] = requested
        operations.append(payload_operation(self.store.registry, snapshot(self.store.registry), data))
        return {"groups": requested, "selected": sorted(selected), "operations": operations,
                "restartRequired": True}

    def apply(self, groups: list[str], reviewed=None, fault=None):
        with self.store.lock():
            proposal = self.plan(groups)
            if reviewed is not None and proposal != reviewed:
                raise DeckError("Plan changed since preview; review it again")
            if all(op["expected"] == op["desired"] for op in proposal["operations"]):
                return {"changed": 0, "groups": proposal["groups"], "restartRequired": True}
            receipt = self.store.transaction(proposal["operations"], "apply " + ",".join(groups), fault)
            return {"transaction": receipt, "groups": proposal["groups"],
                    "changed": sum(op.get("action") not in {None, "unchanged"} for op in proposal["operations"]),
                    "restartRequired": True}

    def verify(self):
        data = self.store.load()
        for root in data["roots"].values():
            self.validate_root(root)
        return {"roots": len(data["roots"]), "skills": len(data["skills"]),
                "activeGroups": data["activeGroups"], "verified": True}
