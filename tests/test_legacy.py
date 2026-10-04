import json

import pytest

from subsets.legacy import Legacy
from subsets.storage import DeckError, Store
from test_manager import make_skill


def test_existing_profile_authoring_filters_retired_and_is_recoverable(tmp_path):
    source = tmp_path / "source"
    (source / "scripts").mkdir(parents=True)
    for name in ["skill-profile", "optional-clients.py"]:
        (source / "scripts" / name).write_text("# fixture; not executed")
    (source / "catalog").mkdir()
    (source / "catalog/qualification.json").write_text(json.dumps({"skills": {"blocked": {"status": "blocked"}}}))
    (source / "catalog/retired-names.json").write_text(json.dumps({"old-poetry": "poetry"}))
    (source / "profiles").mkdir()
    (source / "profiles/core.txt").write_text("# Always active\n")
    (source / "shared").mkdir()
    for name in ["poetry", "old-poetry", "blocked"]:
        make_skill(source / "library/skills", name)
    legacy = Legacy(source)
    _, skills, _ = legacy.inventory()
    assert [skill.name for skill in skills] == ["poetry"]
    store = Store(tmp_path / "state")
    result = legacy.edit_group(store, "create", "creative-writing", [skills[0].id])
    assert legacy.groups()["creative-writing"] == ["poetry"]
    with pytest.raises(DeckError, match="eligible"):
        legacy.edit_group(store, "add", "creative-writing", ["old-poetry"])
    with pytest.raises(DeckError, match="canonical shared"):
        legacy.edit_group(store, "add", "core", ["poetry"])
    with store.lock(allow_pending=True):
        store.rollback(result["transaction"])
    assert "creative-writing" not in legacy.groups()
