import gzip
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest


PATH = Path(__file__).resolve().parents[1]/"tools/export_current_replays.py"
SPEC = importlib.util.spec_from_file_location("export_current_replays", PATH)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


def fixture(tmp_path):
    root, site = tmp_path/"root", tmp_path/"site"
    root.mkdir(); (site/"data").mkdir(parents=True)
    raw = b'{"fixture":true}'
    (root/"bound.json").write_bytes(raw)
    ref = dict(path="bound.json", sha256=module.sha(raw))
    binding = dict(resource_id="fixture", registry_sha256="a"*64, index_sha256="b"*64)
    case = dict(case_id="q", task="hypothesis", corpus="cib", query="Mira led the council.",
        date="1960-02-01", document_id="origin")
    item = dict(config="llm_readings", native_checkpoint=ref, flow_refs={"":ref})
    row = dict(case=case, resource_binding=binding, current_resource_execution=True,
        configurations=dict(llm_readings=item))
    report = dict(version="current-workbench-publication/1", run_id="fixture_report", cases=[row])
    report["sha256"] = module.sha(module.encoded(report))
    report_raw = module.encoded(report)
    (root/"report.json").write_bytes(report_raw)
    report_ref = dict(path="report.json", sha256=module.sha(report_raw))
    index = dict(version=module.BASE.INDEX_VERSION, entries={"/api/graph-v4-viewer?corpus=cib":dict(path="data/map.json")})
    index_raw = module.encoded(index)
    (site/"data/api-index.json").write_bytes(index_raw)
    (site/"data/report-v6.json").write_bytes(b'{"old":true}')
    calls = []
    class Viewer:
        def __init__(self, *_): self.report = report
        def select(self, _): return row, "llm_readings", item, None, dict(registry_ref=ref,index_ref=ref)
        def source_context(self, _): pass
        def close(self): pass
        def api(self, endpoint, params):
            calls.append((endpoint,params))
            if endpoint == "condition-v6":
                return dict(case=case, resource_binding=binding, configurations=dict(llm_readings=dict(
                    native_checksum="checksum", result={}, plan={}, local_decisions_v65={})))
            if endpoint == "flow-v6":
                return dict(resource_binding=binding, nodes=[dict(id="entity",type="Entity",label="Mira")], edges=[], frames=[],
                    candidates=[dict(id="candidate", represented_routes=[dict(route_kind="LEXICAL_SOURCE_READOUT",nodes=[dict(id="readout")])])])
            if endpoint == "postrun-review": return dict(resource_binding=binding,available=False)
            if endpoint in {"guide-v6", "guide-overlay-v64"}: return dict(resource_binding=binding)
            raise AssertionError("Unexpected expensive/native endpoint: "+endpoint)
    exporter = module.Export(root, report_ref, site, module.sha(index_raw), viewer_factory=Viewer)
    return SimpleNamespace(root=root,site=site,report=report,exporter=exporter,calls=calls)


def test_dry_run_is_write_free_and_does_not_open_viewer(tmp_path):
    f = fixture(tmp_path)
    before = sorted(p.relative_to(tmp_path) for p in tmp_path.rglob("*") if p.is_file())
    assert f.exporter.run()["status"] == "DRY_RUN_NO_WRITES"
    assert before == sorted(p.relative_to(tmp_path) for p in tmp_path.rglob("*") if p.is_file())
    assert not f.calls


def test_finite_export_keeps_pins_all_ui_flow_sizes_and_honest_node_scope(tmp_path):
    f = fixture(tmp_path)
    result = f.exporter.run(execute=True)
    assert result["status"] == "EXPORTED"
    index = json.loads((f.site/"data/api-index.json").read_bytes())
    assert "/api/graph-v4-viewer?corpus=cib" in index["entries"]
    flow = [params for endpoint,params in f.calls if endpoint == "flow-v6"]
    assert [p["limit"][0] for p in flow] == ["256","1024","2048"]
    assert all(p["resource_id"] == ["fixture"] for p in flow)
    key = next(k for k in index["entries"] if k.startswith("/api/current/node-v6?"))
    packet = json.loads(gzip.decompress((f.site/index["entries"][key]["path"]).read_bytes()))
    assert packet["scope"] == "SAVED_DISPLAY_PROJECTION_ONLY"
    assert packet["resource_binding"]["resource_id"] == "fixture"
    health_ref = index["entries"]["/api/health"]
    health = json.loads(gzip.decompress((f.site/health_ref["path"]).read_bytes()))
    assert health["static_publication"] is True
    assert health["report_ref"]["sha256"] == module.sha((f.site/"data/report-v6.json").read_bytes())
    assert not any(p.name == module.sha(b'{"old":true}')+".json" for p in (f.site/"data/current-reports").iterdir())


def test_missing_or_changed_report_and_index_fail_closed(tmp_path):
    f = fixture(tmp_path)
    (f.site/"data/api-index.json").write_bytes(b'{}')
    with pytest.raises(ValueError, match="index byte pin"):
        f.exporter.run(execute=True)
    assert not f.calls


def test_public_metadata_removes_private_artifact_location_not_raw_quote():
    value = dict(reference=dict(path="experiments/private/source.json",sha256="a"*64),
        citation=dict(document_id="public-doc",text="Literal /private/source notation."))
    out = module.public(value)
    assert out["reference"]["path"] is None
    assert out["citation"] == value["citation"]


def test_flow_projection_only_omits_redundant_audits_and_does_not_modify_native():
    from copy import deepcopy
    flow = dict(nodes=[dict(id="n",label="Mira")],frames=[dict(weights=[.25])],candidates=[dict(id="c",routes=[])],
        edges=[dict(source="n",target="q",transition=.2,citations=[dict(text="Exact quote")],native_source_assertions=[dict(text="Full native audit")])])
    before = deepcopy(flow)
    out = module.display_flow(flow)
    assert flow == before
    for key in ("nodes","frames","candidates"):
        assert out[key] == flow[key]
    assert out["edges"][0] == {k:v for k,v in flow["edges"][0].items() if k != "native_source_assertions"}
    assert out["public_projection"]["native_outputs_modified"] is False


def test_unresolved_audit_bound_preserves_signed_evidence_and_verdicts():
    from copy import deepcopy
    value=dict(status='UNRESOLVED',evidence=[dict(direction='PARTIAL',text='Exact signed evidence')],
        unresolved_checks=[dict(direction='UNRESOLVED',citation=dict(text=str(i))) for i in range(9)])
    before=deepcopy(value);out=module.bound_unresolved_audits(value)
    assert value==before and out['status']==value['status'] and out['evidence']==value['evidence']
    assert out['unresolved_checks']==value['unresolved_checks'][:3]
    assert out['unresolved_check_audit']['total_rows']==9
    assert out['unresolved_check_audit']['sha256']==module.sha(module.encoded(value['unresolved_checks']))
    value['unresolved_checks'][5]['direction']='SUPPORT'
    with pytest.raises(ValueError,match='Signed evidence'):
        module.bound_unresolved_audits(value)


def test_explicit_transport_resume_keeps_original_seals_and_does_not_recall_api(tmp_path):
    f=fixture(tmp_path);first=f.exporter.run(execute=True)
    stage=Path(first['stage']);old_checkpoint=next((stage/'cases').glob('*.json'))
    old_bytes=old_checkpoint.read_bytes()
    before=(stage/'before-index.json').read_bytes();(f.site/'data/api-index.json').write_bytes(before)
    (f.site/'data/report-v6.json').write_bytes(b'{"old":true}')
    calls=len(f.calls)
    second=module.Export(f.root,f.exporter.reference,f.site,module.sha(before),
        viewer_factory=f.exporter.viewer_factory,resume_export=first['export_id'])
    result=second.run(execute=True)
    assert result['status']=='EXPORTED' and len(f.calls)==calls
    assert old_checkpoint.read_bytes()==old_bytes
    assert second.imported[0]['checkpoint_sha256']==module.sha(old_bytes)


def test_imported_transport_object_tampering_is_rejected(tmp_path):
    f=fixture(tmp_path);first=f.exporter.run(execute=True);stage=Path(first['stage'])
    before=(stage/'before-index.json').read_bytes();(f.site/'data/api-index.json').write_bytes(before)
    checkpoint=module.read_sealed(next((stage/'cases').glob('*.json')))
    entry=next(v for k,v in checkpoint['entries'].items()if k.startswith('/api/current/condition-v6?'))
    (stage/'objects'/Path(entry['path']).name).write_bytes(b'changed')
    second=module.Export(f.root,f.exporter.reference,f.site,module.sha(before),
        viewer_factory=f.exporter.viewer_factory,resume_export=first['export_id'])
    with pytest.raises(ValueError,match='Resumed response object'):
        second.run(execute=True)
