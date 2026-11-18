import importlib.util
import json
from pathlib import Path
import sys


TOOLS = Path(__file__).resolve().parents[1]/"tools"
sys.path.insert(0, str(TOOLS))
spec = importlib.util.spec_from_file_location("install_current_ui", TOOLS/"install_current_ui.py")
install = importlib.util.module_from_spec(spec)
spec.loader.exec_module(install)


def test_route_retirement_preserves_maps_and_only_current_workbench():
    entries = {key:{} for key in ("/data/report-v6.json", "/api/current/condition-v6?case_id=q",
        "/api/condition-v6?case_id=q", "/api/source-v6?case_id=q", "/api/cib-pdf?doc_id=d",
        "/api/graph-v4-viewer?corpus=cib", "/graph-assets-v4/cib/nodes.json.gz")}
    kept = install.retained_entries(entries)
    assert set(entries)-set(kept) == {"/api/condition-v6?case_id=q", "/api/source-v6?case_id=q"}


def test_pruning_only_generated_unreferenced_files_and_retains_dag_chunks(tmp_path):
    for path in ("data/fast/old.json.gz", "data/fast/kept.json.gz", "source.txt",
        "data/packed/chunks/one.json.gz"):
        target = tmp_path/path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"bytes")
    manifest = tmp_path/"data/packed/manifest.json"
    manifest.write_text(json.dumps(dict(chunks=[dict(path="chunks/one.json.gz")])))
    entries = dict(fast=dict(path="data/fast/kept.json.gz"), dag=dict(path="data/packed/manifest.json", encoding="fragment-dag"))
    removed = install.prune_generated(tmp_path, entries)
    assert [row["path"] for row in removed] == ["data/fast/old.json.gz"]
    assert (tmp_path/"source.txt").is_file()
    assert (tmp_path/"data/packed/chunks/one.json.gz").is_file()


def test_inventory_methods_pdf_is_documentation_not_historical_source(tmp_path):
    target = tmp_path/"docs/matryoshka-guide.pdf"
    target.parent.mkdir()
    target.write_bytes(b"%PDF-1.4")
    assert install.inventory(tmp_path)[0]["role"] == "documentation"


def test_shared_dictionary_is_read_once_not_once_per_route(tmp_path,monkeypatch):
    calls=[]
    monkeypatch.setattr(install,'read',lambda p:(calls.append(p)or dict(chunks=[dict(path='chunks/one.json.gz')])))
    entries={str(i):dict(path='data/packed/manifest.json',encoding='fragment-dag')for i in range(1000)}
    assert install.referenced_files(tmp_path,entries)=={'data/packed/manifest.json','data/packed/chunks/one.json.gz'}
    assert len(calls)==1
