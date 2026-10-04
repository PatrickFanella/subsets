import json

from subsets.cli import main
from test_manager import make_skill


def test_real_cli_workflow_dynamic_flag_and_exit_codes(tmp_path, monkeypatch, capsys):
    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.delenv("CODEX_HOME", raising=False)
    monkeypatch.delenv("XDG_CONFIG_HOME", raising=False)
    root = home / ".agents/skills"
    make_skill(root, "poetry"); make_skill(root, "database")
    options = ["--state", str(tmp_path / "state"), "--project", str(home), "--no-plugins", "--json"]
    assert main([*options, "roots"]) == 0
    identifier = json.loads(capsys.readouterr().out)["roots"][0]["id"]
    assert main([*options, "adopt", identifier]) == 0
    capsys.readouterr()
    assert main([*options, "group", "create", "creative-writing", "poetry"]) == 0
    capsys.readouterr()
    assert main([*options, "apply", "--creative-writing", "--dry-run"]) == 0
    assert (root / "database").exists()
    assert json.loads(capsys.readouterr().out)["selected"] == [identifier + ":poetry"]
    assert main([*options, "apply", "--creative-writing"]) == 0
    receipt = json.loads(capsys.readouterr().out)["transaction"]
    assert not (root / "database").exists()
    assert main([*options, "apply", "--creatve-writing"]) == 2
    assert "Unknown option/group" in json.loads(capsys.readouterr().err)["error"]
    assert main([*options, "rollback", receipt]) == 0
    assert (root / "database").exists()


def test_json_after_command_and_unknown_options(tmp_path, capsys):
    assert main(["--state", str(tmp_path / "state"), "groups", "--json"]) == 0
    assert "groups" in json.loads(capsys.readouterr().out)
    assert main(["--state", str(tmp_path / "state"), "apply", "--dryrun"]) == 2
    assert "Unknown option/group" in capsys.readouterr().err
