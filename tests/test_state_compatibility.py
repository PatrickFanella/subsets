import pytest
from subsets.storage import DeckError, Store, save


def test_default_reuses_existing_legacy_registry(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path))
    monkeypatch.delenv("SUBSETS_HOME", raising=False)
    monkeypatch.delenv("SKILLDECK_HOME", raising=False)
    assert Store().path == tmp_path / "subsets"
    legacy = tmp_path / "skilldeck"
    save(legacy / "registry.json", Store(legacy).load())
    assert Store().path == legacy
    save(tmp_path / "subsets/registry.json", Store(legacy).load())
    with pytest.raises(DeckError, match="Both"):
        Store()
    assert Store(legacy).path == legacy


def test_environment_precedence(tmp_path, monkeypatch):
    monkeypatch.setenv("SKILLDECK_HOME", str(tmp_path / "old"))
    monkeypatch.delenv("SUBSETS_HOME", raising=False)
    assert Store().path == tmp_path / "old"
    monkeypatch.setenv("SUBSETS_HOME", str(tmp_path / "new"))
    assert Store().path == tmp_path / "new"
    assert Store(tmp_path / "explicit").path == tmp_path / "explicit"
