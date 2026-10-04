from pathlib import Path
import json

import pytest

from subsets import discovery
from subsets.manager import Manager
from subsets.storage import DeckError, Store, snapshot


def make_skill(root, name, body="Write carefully."):
    path = root / name
    path.mkdir(parents=True)
    (path / "SKILL.md").write_text(f"---\nname: {name}\ndescription: Help with {name}.\n---\n{body}\n")
    (path / "helper.sh").write_text("#!/bin/sh\nexit 0\n")
    (path / "helper.sh").chmod(0o755)
    return path


@pytest.fixture
def deck(tmp_path, monkeypatch):
    monkeypatch.delenv("CODEX_HOME", raising=False)
    monkeypatch.delenv("XDG_CONFIG_HOME", raising=False)
    home = tmp_path / "home"
    root = home / ".agents/skills"
    root.mkdir(parents=True)
    make_skill(root, "poetry")
    make_skill(root, "editing")
    make_skill(root, "database")
    manager = Manager(Store(tmp_path / "state"), home=home, plugins=False)
    return manager, root


def adopt(deck):
    manager, root = deck
    result = manager.adopt(str(root))
    return manager, root, result


def test_read_only_discovery_and_resource_modes(deck):
    manager, root = deck
    before = snapshot(root)
    roots, skills, warnings = manager.inventory()
    assert {s.name for s in skills} == {"poetry", "editing", "database"}
    assert warnings == [] and roots[0].owner == "unmanaged"
    assert snapshot(root) == before
    assert not manager.store.path.exists()


def test_adoption_preserves_current_files_and_can_undo(deck):
    manager, root = deck
    before = {p.name: snapshot(p) for p in root.iterdir()}
    result = manager.adopt(str(root))
    assert {p.name: snapshot(p) for p in root.iterdir() if not p.name.startswith(".")} == before
    assert len(result["adopted"]) == 3
    for record in manager.store.load()["skills"].values():
        assert snapshot(Path(record["source"])) == before[record["name"]]
    with manager.store.lock(allow_pending=True):
        manager.store.rollback(result["transaction"])
    assert {p.name: snapshot(p) for p in root.iterdir()} == before
    assert manager.store.load()["roots"] == {}


def test_named_selection_core_union_and_idempotency(deck):
    manager, root, _ = adopt(deck)
    manager.edit_group("create", "creative-writing", ["poetry", "editing"])
    manager.edit_group("add", "core", ["database"])
    result = manager.apply(["creative-writing"])
    assert all((root / name).is_dir() for name in ["poetry", "editing", "database"])
    assert result["groups"] == ["core", "creative-writing"]
    assert manager.apply(["creative-writing"])["changed"] == 0
    assert manager.verify()["verified"]


def test_deactivation_preserves_unknown_files_and_rollback(deck):
    manager, root, _ = adopt(deck)
    make_skill(root, "later-skill")
    (root / "notes.txt").write_text("Unmanaged notes")
    later = snapshot(root / "later-skill")
    manager.edit_group("create", "creative-writing", ["poetry"])
    before = snapshot(root / "editing")
    plan = manager.plan(["creative-writing"])
    assert (root / "editing").is_dir()  # plan is read-only
    result = manager.apply(["creative-writing"], reviewed=plan)
    assert not (root / "editing").exists()
    assert snapshot(root / "later-skill") == later
    with manager.store.lock(allow_pending=True):
        manager.store.rollback(result["transaction"])
    assert snapshot(root / "editing") == before
    assert (root / "notes.txt").read_text() == "Unmanaged notes"


def test_drift_stops_all_destinations_before_mutation(deck):
    manager, root, _ = adopt(deck)
    manager.edit_group("create", "creative-writing", ["poetry"])
    (root / "editing/SKILL.md").write_text("Changed by user")
    before = snapshot(root)
    with pytest.raises(DeckError, match="drift"):
        manager.apply(["creative-writing"])
    assert snapshot(root) == before


def test_reviewed_plan_detects_new_registry_changes(deck):
    manager, root, _ = adopt(deck)
    manager.edit_group("create", "creative-writing", ["poetry"])
    proposal = manager.plan(["creative-writing"])
    manager.edit_group("add", "creative-writing", ["editing"])
    before = snapshot(root)
    with pytest.raises(DeckError, match="Plan changed"):
        manager.apply(["creative-writing"], reviewed=proposal)
    assert snapshot(root) == before


def test_rollback_preserves_later_edits(deck):
    manager, root, _ = adopt(deck)
    manager.edit_group("create", "creative-writing", ["poetry"])
    result = manager.apply(["creative-writing"])
    (root / "poetry/SKILL.md").write_text("A later edit")
    with manager.store.lock(allow_pending=True):
        with pytest.raises(DeckError, match="later edits"):
            manager.store.rollback(result["transaction"])
    assert not (root / "editing").exists()
    assert (root / "poetry/SKILL.md").read_text() == "A later edit"


def test_interrupted_apply_recovery_and_pending_guard(deck):
    manager, root, _ = adopt(deck)
    manager.edit_group("create", "creative-writing", ["poetry"])
    before = snapshot(root)
    def interrupt(_):
        raise RuntimeError("Injected interruption fixture")
    with pytest.raises(RuntimeError):
        manager.apply(["creative-writing"], fault=interrupt)
    run = manager.store.history()[0]
    assert run["status"] == "failed"
    with pytest.raises(DeckError, match="unfinished"):
        manager.apply(["creative-writing"])
    with manager.store.lock(allow_pending=True):
        manager.store.rollback(run["id"])
    assert snapshot(root) == before
    assert manager.verify()["verified"]


def test_external_owner_and_package_links_are_preserved(deck, tmp_path):
    manager, root = deck
    external = tmp_path / "external"
    make_skill(external, "os-tool")
    (root / "os-tool").symlink_to(external / "os-tool", target_is_directory=True)
    result = manager.adopt(str(root))
    assert result["preserved"] == ["os-tool"]
    manager.apply([])
    assert (root / "os-tool").is_symlink()
    assert (external / "os-tool/SKILL.md").exists()


def test_known_installer_cannot_be_adopted(deck):
    manager, root = deck
    (manager.home / ".agents/.skill-profile-state.json").write_text("{}")
    with pytest.raises(DeckError, match="skill-profile owns"):
        manager.adopt(str(root))
    assert not manager.store.registry.exists()


def test_symlink_parent_and_second_registry_are_rejected(deck, tmp_path):
    manager, root, _ = adopt(deck)
    other = Manager(Store(tmp_path / "other-state"), home=manager.home, plugins=False)
    with pytest.raises(DeckError, match="subsets registry"):
        other.adopt(str(root))
    alias = tmp_path / "alias"
    alias.symlink_to(manager.home)
    other.extra = [alias / ".agents/skills"]
    with pytest.raises(DeckError, match="symlink"):
        other.adopt(str(alias / ".agents/skills"))


def test_ambiguous_names_require_ids(deck, tmp_path):
    manager, root, _ = adopt(deck)
    second = tmp_path / "other-skills"
    make_skill(second, "poetry")
    manager.extra.append(second)
    manager.adopt(str(second))
    with pytest.raises(DeckError, match="Ambiguous"):
        manager.edit_group("create", "creative-writing", ["poetry"])


def test_import_inactive_skill_then_select(deck, tmp_path):
    manager, root, _ = adopt(deck)
    originals = tmp_path / "library"
    make_skill(originals, "storytelling")
    manager.extra.append(originals)
    result = manager.import_skill("storytelling", str(root))
    assert not (root / "storytelling").exists()
    manager.edit_group("create", "fiction", [result["skill"]])
    manager.apply(["fiction"])
    assert (root / "storytelling/SKILL.md").read_bytes() == (originals / "storytelling/SKILL.md").read_bytes()
    assert (root / "storytelling/helper.sh").stat().st_mode & 0o777 == 0o755


def test_invalid_frontmatter_is_visible_but_not_adopted(deck):
    manager, root = deck
    (root / "poetry/SKILL.md").write_text("---\nname: poetry\ndescription: [broken\n---\n")
    _, skills, _ = manager.inventory()
    assert next(s for s in skills if s.name == "poetry").issue
    result = manager.adopt(str(root))
    assert "poetry" in result["preserved"]
    manager.apply([])
    assert (root / "poetry").exists()


def test_bounded_project_and_plugin_discovery(deck, tmp_path):
    manager, _ = deck
    project = tmp_path / "project"
    make_skill(project / ".claude/skills", "project-only")
    make_skill(project / "unrelated/deep/skills", "not-discovered")
    cache = manager.home / ".codex/plugins/cache/openai-bundled/tool/1.0/skills"
    make_skill(cache, "plugin-owned")
    roots = discovery.roots(manager.home, project, plugins=True)
    skills, _ = discovery.scan(roots)
    assert "not-discovered" not in {s.name for s in skills}
    assert next(s for s in skills if s.name == "project-only").scope == "project"
    assert next(s for s in skills if s.name == "plugin-owned").owner == "package"


def test_unknown_names_do_not_expand_selection(deck):
    manager, root, _ = adopt(deck)
    with pytest.raises(DeckError, match="Unknown groups"):
        manager.apply(["creatve-writing"])
    assert (root / "editing").exists()


def test_remembered_roots_default_read_only_and_cannot_override_owner(deck, tmp_path):
    manager, _ = deck
    source = tmp_path / "skill-sources"
    make_skill(source, "storytelling")
    manager.configure_root(source)
    roots, skills, _ = manager.inventory()
    assert next(root for root in roots if root.path == str(source)).owner == "declared read-only"
    assert "storytelling" in {s.name for s in skills}
    with pytest.raises(DeckError, match="declared read-only"):
        manager.adopt(str(source))
    manager.configure_root(source, "unmanaged")
    assert manager.adopt(str(source))["adopted"]


def test_external_resource_links_are_not_copied(deck, tmp_path):
    manager, root = deck
    (tmp_path / "private.txt").write_text("Separate owner")
    (root / "poetry/external.txt").symlink_to(tmp_path / "private.txt")
    with pytest.raises(DeckError, match="External resource"):
        manager.adopt(str(root))
    assert not manager.store.registry.exists()
    assert (root / "poetry/external.txt").is_symlink()
