import importlib.util
from pathlib import Path
from unittest.mock import patch


TOOLS = Path(__file__).resolve().parents[1] / "tools"


def load(name):
    spec = importlib.util.spec_from_file_location(name, TOOLS / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


with patch.dict("sys.modules", {"export_replays": load("export_replays")}):
    assemble = load("assemble_site")


def test_top_level_root_links_are_project_relative_and_idempotent():
    original = '<a href="/workbench-v6.html?view=home">Home</a><img src="/icon.svg"><a href="/#part">Start</a>'
    expected = '<a href="workbench-v6.html?view=home">Home</a><img src="icon.svg"><a href="index.html#part">Start</a>'
    assert assemble.project_relative_html(original) == expected
    assert assemble.project_relative_html(expected) == expected


def test_external_fragments_and_already_relative_links_are_not_changed():
    original = '<a href="https://example.org/source">Source</a><a href="#part">Part</a><a href="//cdn.example.org">CDN</a><script src="runtime/public-runtime.js"></script>'
    assert assemble.project_relative_html(original) == original
