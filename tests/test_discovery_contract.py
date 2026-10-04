from subsets.cli import main


def test_filtered_discovery_and_noninteractive_tui(tmp_path, monkeypatch, capsys):
    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.delenv("CODEX_HOME", raising=False)
    root = home / ".agents/skills/poetry"
    root.mkdir(parents=True)
    (root / "SKILL.md").write_text("---\nname: poetry\ndescription: Write poetry.\n---\n")
    assert main(["--state", str(tmp_path / "state"), "discover", "--filter", "no-match", "--json"]) == 0
    assert '"skills": []' in capsys.readouterr().out
    assert main(["--state", str(tmp_path / "state"), "tui", "--json"]) == 2
    assert "interactive terminal" in capsys.readouterr().err
    assert not (tmp_path / "state").exists()
