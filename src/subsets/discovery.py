"""Bounded metadata discovery. No skill scripts are imported or executed."""
from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import os
from pathlib import Path
import re

import yaml

NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


@dataclass
class Root:
    path: str
    client: str
    scope: str
    owner: str = "unmanaged"

    @property
    def id(self):
        return hashlib.sha256(self.path.encode()).hexdigest()[:12]

    def record(self):
        return {**asdict(self), "id": self.id}


@dataclass
class Skill:
    id: str
    name: str
    description: str
    path: str
    root: str
    client: str
    scope: str
    owner: str
    issue: str = ""


def path_owner(path: Path) -> str:
    resolved = path.resolve()
    if any(part in {".system", "plugins", "node_modules", "site-packages"} for part in path.parts):
        return "package"
    if str(resolved).startswith(("/usr/", "/opt/", "/nix/")):
        return "package"
    if path.is_symlink():
        return "linked source"
    return "unmanaged"


def root_owner(path: Path, home: Path) -> str:
    owner = path_owner(path)
    if owner != "unmanaged":
        return owner
    for parent in [path, *list(path.parents)[:5]]:
        if (parent / "catalog/installation.json").is_file() and (parent / "scripts/skill-profile").is_file():
            return "codex-skills source"
    if (path.parent.parent / ".agent-skills.json").exists():
        return "project installer"
    if path == home / ".agents/skills" and (home / ".agents/.skill-profile-state.json").exists():
        return "skill-profile"
    codex = Path(os.environ.get("CODEX_HOME", str(home / ".codex"))).expanduser().absolute()
    if path == codex / "skills" and (codex / "skill-installations/codex-skills/installed.json").exists():
        return "codex-skills installer"
    if path == home / ".claude/skills" and (home / ".codex/skill-installations/codex-source-links/installed.json").exists():
        return "source-link installer"
    # Recognize declared owners without assuming every user has this repository.
    if path.name == "skills" and (path / ".profile-state.json").exists():
        return "skill-profile"
    if any((parent / filename).is_file() for parent in [path, path.parent, path.parent.parent]
           for filename in ["skills-lock.json", ".skills-lock.json"]):
        return "external skill installer"
    for marker in (".subsets-owner.json", ".skilldeck-owner.json"):
        if (path / marker).exists() or (path / marker).is_symlink():
            return "subsets registry"
    return "unmanaged"


def roots(home: Path | None = None, project: Path | None = None,
          extra: list[Path] | None = None, plugins: bool = True) -> list[Root]:
    home = (home or Path.home()).absolute()
    codex = Path(os.environ.get("CODEX_HOME", str(home / ".codex"))).expanduser().absolute()
    xdg = Path(os.environ.get("XDG_CONFIG_HOME", str(home / ".config"))).expanduser().absolute()
    candidates = [(codex / "skills", "codex", "user"),
                  (home / ".agents/skills", "shared", "user"),
                  (home / ".claude/skills", "claude", "user"),
                  (xdg / "opencode/skills", "opencode", "user"),
                  (home / ".opencode/skills", "opencode", "user")]
    if project:
        # Explicit project scope: inspect its ancestors, never recurse into siblings.
        for ancestor in [project.absolute(), *project.absolute().parents]:
            if ancestor in {home, Path("/")}:
                break
            for folder, client in [(".agents", "shared"), (".codex", "codex"),
                                   (".claude", "claude"), (".opencode", "opencode")]:
                candidates.append((ancestor / folder / "skills", client, "project"))
    candidates += [(p.expanduser().absolute(), "custom", "explicit") for p in extra or []]
    if (codex / "skills/.system").is_dir():
        candidates.append((codex / "skills/.system", "codex", "system"))
    if plugins:
        cache = codex / "plugins/cache"
        # Published plugin layout only, including bundled/remote variants.
        for pattern in ["*/*/*/skills", "*/*/skills"]:
            candidates += [(p, "plugin", "plugin") for p in sorted(cache.glob(pattern))[:2000]
                           if p.is_dir()]
    found = {}
    for path, client, scope in candidates:
        if path.is_dir():
            found.setdefault(str(path), Root(str(path), client, scope, root_owner(path, home)))
    return list(found.values())


def inspect(path: Path, root: Root, expected_name: str | None = None) -> Skill:
    folder_name = expected_name or path.name
    identifier = root.id + ":" + folder_name
    owner = root.owner if root.owner != "unmanaged" else path_owner(path)
    issue, name, description = "", folder_name, ""
    try:
        entry = path / "SKILL.md"
        if entry.stat().st_size > 1_048_576:
            raise ValueError("SKILL.md exceeds 1 MiB")
        content = entry.read_text()
        if not content.startswith("---\n"):
            raise ValueError("Missing YAML frontmatter")
        front, sep, _ = content[4:].partition("\n---")
        if not sep:
            raise ValueError("Unclosed YAML frontmatter")
        data = yaml.safe_load(front)
        if not isinstance(data, dict):
            raise ValueError("Frontmatter must be a mapping")
        name, description = data.get("name", ""), data.get("description", "")
        if not isinstance(name, str) or not NAME.fullmatch(name) or name != folder_name:
            raise ValueError("Folder and frontmatter name must match a lowercase skill name")
        if not isinstance(description, str) or not description.strip():
            raise ValueError("Missing description")
    except (OSError, UnicodeError, ValueError, yaml.YAMLError) as exc:
        issue = str(exc)
        name, description = folder_name, description if isinstance(description, str) else ""
    return Skill(identifier, name, description, str(path), root.path,
                 root.client, root.scope, owner, issue)


def scan(found_roots: list[Root]) -> tuple[list[Skill], list[str]]:
    skills, warnings = [], []
    for root in found_roots:
        try:
            paths = sorted(Path(root.path).iterdir())
            if len(paths) > 5000:
                warnings.append("Scan limited to 5000 entries: " + root.path)
            for path in paths[:5000]:
                if not path.name.startswith(".") and (path / "SKILL.md").is_file():
                    skills.append(inspect(path, root))
        except OSError as exc:
            warnings.append(f"{root.path}: {exc}")
    return skills, warnings
