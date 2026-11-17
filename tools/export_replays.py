"""Export allowlisted, saved casebook responses. Never execute inference or an API.

Run from this directory with --source-root pointing to src-demo-day. Source
checkpoints remain immutable; public transport has its own byte commitments.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from copy import deepcopy
import gzip
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
from urllib.parse import urlencode


VERSION = "public-saved-replay/1"
INDEX_VERSION = "matryoshka-public-api-index/1"
CONFIGS = ("llm_readings", "llm_atoms", "llm_local")


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(",", ":"), allow_nan=False).encode()


def read(path):
    return json.loads(Path(path).read_bytes())


def atomic(path, raw):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=".export-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(raw)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def canonical(path, **params):
    if path == "/api/flow-v6":
        params.setdefault("reading", "")
    return path + ("?" + urlencode(sorted((k, str(v)) for k, v in params.items() if v is not None)) if params else "")


def checked(root, ref):
    relative = Path(ref["path"])
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("Unsafe source reference")
    path = root / relative
    if path.resolve(strict=True) != path or sha(path.read_bytes()) != ref["sha256"]:
        raise ValueError("Changed source artifact: " + relative.as_posix())
    value = json.loads(gzip.decompress(path.read_bytes()) if path.suffix == ".gz" else path.read_bytes())
    if path.suffix == ".gz":
        if set(value) != {"payload", "sha256"} or sha(encoded(value["payload"])) != value["sha256"]:
            raise ValueError("Changed compressed source commitment")
        value = value["payload"]
    return value


_PRIVATE_ARTIFACT_PATH = re.compile(
    r"(?:file://|/Users/|/home/|/private/|/var/folders/|[A-Za-z]:[\\/]Users[\\/])"
    r"|(?:^|[/\\])(?:private|receipts|credentials|manuscripts?|human[_-]?reviews?)[/\\]", re.I)
_SOURCE_FIELDS = {"text", "body", "quote", "evidence_quote", "raw_text", "source_text", "source_wording", "original_text"}
_SOURCE_PROVENANCE = {"canonical_page_id", "document_id", "source_id", "page_sha256", "source_text_sha256", "quote_sha256"}


def public_metadata(value, source_body=False):
    """Remove workstation locations, not quotations, dates, offsets or identities."""
    if isinstance(value, dict):
        source_record = bool(_SOURCE_PROVENANCE & value.keys())
        result = {k: public_metadata(v, source_record and k in _SOURCE_FIELDS and isinstance(v, str))
                  for k, v in value.items()}
        # A content commitment can be published without disclosing its private
        # audit location or pretending that it is a downloadable public file.
        locations = [field for field in ("path", "receipt")
                     if isinstance(value.get(field), str) and _PRIVATE_ARTIFACT_PATH.search(value[field])]
        if locations and any(re.fullmatch(r"[a-f0-9]{64}", str(value.get(key, "")))
                             for key in ("sha256", "raw_sha256", "request_sha256")):
            for field in locations:
                result[field] = None
                result["publication_availability"] = "Unpublished audit artifact; content hash retained"
        return result
    if isinstance(value, list):
        return [public_metadata(v) for v in value]
    if isinstance(value, str):
        if source_body:
            return value
        # These are machine paths in metadata; no source text is paraphrased.
        return re.sub(r"/Users/[^\s\"'<>]+/IARPA(?=/|\b)", "research-workspace", value)
    return value


class Store:
    def __init__(self, site):
        self.site = site
        self.path = site / "data/api-index.json"
        self.index = read(self.path) if self.path.exists() else {"version": INDEX_VERSION, "entries": {}}

    def put(self, key, value):
        raw = encoded(public_metadata(value))
        packed = gzip.compress(raw, compresslevel=9, mtime=0)
        name = "data/replays/" + sha(packed) + ".json.gz"
        target = self.site / name
        if not target.exists():
            atomic(target, packed)
        elif target.read_bytes() != packed:
            raise ValueError("Content-addressed object changed")
        entry = dict(path=name, sha256=sha(raw), wire_sha256=sha(packed), encoding="gzip", mime="application/json")
        old = self.index["entries"].get(key)
        if old and old != entry:
            raise ValueError("Do not overwrite an already exported response: " + key)
        self.index["entries"][key] = entry

    def flush(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.with_suffix(".lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            current = read(self.path) if self.path.exists() else {"version": INDEX_VERSION, "entries": {}}
            for key, entry in self.index["entries"].items():
                if key in current["entries"] and current["entries"][key] != entry:
                    raise ValueError("Conflicting concurrent export: " + key)
                current["entries"][key] = entry
            atomic(self.path, encoded(current))
            self.index = current

    def get(self, key):
        entry = self.index["entries"].get(key)
        if entry is None:
            return None
        wire = (self.site / entry["path"]).read_bytes()
        raw = gzip.decompress(wire) if entry["encoding"] == "gzip" else wire
        if sha(wire) != entry["wire_sha256"] or sha(raw) != entry["sha256"]:
            raise ValueError("Export checkpoint object changed")
        return json.loads(raw)


def gates(root, report):
    from matryoshka_demo.io import digest
    result = {}
    pointer = read(root / "web/data/local-decision-release-v65.json")
    if pointer["report_run_id"] != report["run_id"]:
        raise ValueError("Decision release belongs to another casebook")
    for item in pointer["releases"]:
        manifest = checked(root, item["ref"])
        if manifest["identity"]["report_sha256"] != report["sha256"] or manifest["sha256"] != digest({k:v for k,v in manifest.items() if k != "sha256"}):
            raise ValueError("Decision manifest commitment changed")
        descriptors = {(d["case"]["case_id"], d["config"]): d for d in manifest["identity"]["conditions"]}
        for output in manifest["outputs"]:
            key = output["case_id"], output["config"]
            packet = checked(root, output["ref"])
            if packet["input"] != descriptors[key] or packet["sha256"] != digest({k:v for k,v in packet.items() if k != "sha256"}):
                raise ValueError("Decision packet commitment changed")
            result[key] = (packet["local_decisions_v65"], descriptors[key])
    return result


def proof_ids(value):
    found = set()
    if isinstance(value, dict):
        if (isinstance(value.get("canonical_page_id"), str)
                and isinstance(value.get("text"), str)
                and isinstance(value.get("start"), int) and isinstance(value.get("end"), int)):
            found.add(value["canonical_page_id"])
        for child in value.values():
            found.update(proof_ids(child))
    elif isinstance(value, list):
        for child in value:
            found.update(proof_ids(child))
    return found


def export(root, site, selection, only=()):
    sys.path.insert(0, str(root))
    from matryoshka_demo.io import digest
    from matryoshka_demo.corpus_explorer_v3 import _connection
    from matryoshka_demo.corpus_policy_v5 import scoped_page_view
    from matryoshka_demo_v6.flow_projection import condition as native_condition
    from matryoshka_demo_v6.flow_projection_v65 import presentation
    from matryoshka_demo_v6.server_v65 import source_only, review_index
    from matryoshka_demo_v6.reporting_decision_release_v65 import sanitize
    from matryoshka_demo_v6.reporting_decision_assessment_v65 import response_field
    from matryoshka_demo_v6.server import source_tools, PAGE_ORDER
    from matryoshka_demo_v6.server_origin_v65 import origin
    from matryoshka_demo_v6.guide_v65 import guide
    from matryoshka_demo_v6.guide_runtime_v64 import overlay
    from matryoshka_demo_v6.guide_views import request as guide_view

    report = read(root / "web/data/report-v6.json")
    if report["sha256"] != digest({k:v for k,v in report.items() if k != "sha256"}):
        raise ValueError("Source report seal changed")
    report_ref = selection.get("report_ref") or selection["inputs"]["report"]
    if report_ref["sha256"] != sha((root / "web/data/report-v6.json").read_bytes()):
        raise ValueError("Selection/report byte binding differs")
    members = {v["case_id"]: (group, v) for group in ("presentation", "bench") for v in selection[group]}
    if len(members) != sum(len(selection[g]) for g in ("presentation", "bench")):
        raise ValueError("Repeated selected case")
    families = [v[1]["family_id"] for v in members.values()]
    if len(set(families)) != len(families):
        raise ValueError("Repeated underlying fact family")
    rows = [deepcopy(row) for row in report["cases"] if row["case"]["case_id"] in members]
    if len(rows) != len(members):
        raise ValueError("Missing selected native case")
    store = Store(site)
    gate_index = gates(root, report)
    reviews = review_index(root, report)
    for row in rows:
        case = row["case"]; cid = case["case_id"]
        if only and cid not in only:
            continue
        if shutil.disk_usage(site.parent).free < 4 * 1024**3:
            raise RuntimeError("Disk guard: completed exported objects are preserved")
        completion = site.parent / ".export-checkpoints" / (cid + ".json")
        identity = dict(source_report=report["sha256"], case=case, version=VERSION)
        if completion.exists() and read(completion).get("identity") == identity:
            print("reused", cid, flush=True)
            continue
        print("exporting", cid, flush=True)
        reference = report["graph_indexes"][case["corpus"]]
        veto = report.get("handling_veto_documents", {}).get(case["corpus"], [])
        functions = source_tools(veto)
        source_ids, graph_nodes, graph_edges = set(), {}, {}
        source_guide_requests = []
        for reveal in ((False, True) if case["task"] == "redaction" else (False,)):
            store.put(canonical("/api/origin-v63", case_id=cid, reveal_focal=int(reveal)), origin(root, report, cid, reveal_focal=reveal))
        for config in CONFIGS:
            packet = native_condition(root, report, cid, config)
            saved = packet["configurations"][config]
            gate, descriptor = gate_index[cid, config]
            if digest(sanitize(saved)) != descriptor["record_sha256"] or saved["native_checksum"] != descriptor["native_checksum"]:
                raise ValueError("Exact saved condition differs from reviewed gate")
            saved["local_decisions_v65"] = deepcopy(gate)
            if reviews:
                refs = [x["ref"] for x in reviews["assessments"] if cid in x["cases"] and config in x["configurations"]]
                if len(refs) > 1:
                    raise ValueError("Ambiguous exact gate assessment")
                if refs:
                    saved["local_decision_assessment_v65"] = response_field(root, refs[0], case_id=cid, config=config, gate=gate)
            packet["presentation_pipeline_version"] = "6.5"
            source_ids.update(proof_ids(packet))
            store.put(canonical("/api/condition-v6", case_id=cid, config=config), packet)
            # This is an explicit public receipt, not the research checkpoint.
            store.put(canonical("/api/native-v6", case_id=cid, config=config), dict(
                version=VERSION, kind="PUBLIC_INFERENCE_RECEIPT_NOT_FULL_NATIVE_CHECKPOINT", case=case,
                config=config, native_checkpoint=saved["native_checkpoint"], native_checksum=saved["native_checksum"],
                source_binding_sha256=saved["source_binding_sha256"], plan=saved["plan"], result=saved["result"],
                omitted="Private machine metadata and non-display native audit arrays are not a public download."))
            readings = [x.get("reading_id") or x.get("reading", {}).get("id") for x in saved["result"].get("readings", [])] or [None]
            for rid in readings:
                params = dict(case_id=cid, config=config, limit=1024)
                if rid:
                    params["reading"] = rid
                flow = store.get(canonical("/api/flow-v6", **params))
                if flow is None:
                    flow = presentation(root, report, cid, config, reading=rid, limit=1024)
                projection = flow.get("projection", flow)
                if (projection["case_id"] != cid or projection["config"] != config
                        or projection.get("reading_id") != rid):
                    raise ValueError("Resumed display projection belongs to another condition")
                store.put(canonical("/api/flow-v6", **params), flow)
                source_ids.update(proof_ids(projection))
                for node in projection.get("nodes", []):
                    graph_nodes[node["id"]] = node
                for edge in projection.get("edges", []):
                    graph_edges[digest(edge)] = edge
                for candidate in projection.get("candidates", []):
                    routes = candidate.get("routes", candidate.get("witnesses", candidate.get("paths", [])))[:3]
                    for route_index, _ in enumerate(routes):
                        args = dict(case_id=cid, config=config, reading=rid or "", candidate_id=candidate["id"], route_index=route_index)
                        route = store.get(canonical("/api/guide-v6", **args))
                        if route is None:
                            route = guide(root, report, cid, config, candidate["id"], route_index, rid)
                        mapped = store.get(canonical("/api/guide-overlay-v64", **args))
                        if mapped is None:
                            mapped = overlay(root, reference, case, route, excluded_documents=veto)
                        store.put(canonical("/api/guide-v6", **args), route)
                        store.put(canonical("/api/guide-overlay-v64", **args), mapped)
                        source_ids.update(proof_ids(route)); source_ids.update(proof_ids(mapped))
                        for source_id in proof_ids(mapped) | proof_ids(route):
                            source_guide_requests.append((args, route, source_id))
            store.flush()
            print("  saved", config, flush=True)
        for source_id in sorted(source_ids):
            value = functions["source_page"](root, reference, case, source_id)
            db = _connection(root, reference)
            try:
                scoped_page_view(db, veto)
                pages = [json.loads(r[0]) for r in db.execute("SELECT payload FROM page WHERE doc=? AND date<? AND doc!=? ORDER BY " + PAGE_ORDER, (value["document_id"], case["date"], case["document_id"]))]
            finally:
                db.close()
            store.put(canonical("/api/source-v6", case_id=cid, source_id=source_id), dict(value, document_pages=pages, source_scope="Eligible canonical text segments; not invented PDF pages"))
        for args, route, source_id in source_guide_requests:
            key = canonical("/api/guide-view-v6", **args, phase="source", source_id=source_id)
            if key not in store.index["entries"]:
                value = guide_view(root, reference, case, route, dict(phase="source", source_id=source_id), excluded_documents=veto)
                store.put(key, value)
        # A public node drawer lists only edges present in the saved projection.
        # Full unrestricted neighborhoods remain available in the Corpus Map.
        incident = defaultdict(list)
        for edge in graph_edges.values():
            for node in set([edge.get("source"), edge.get("target")]) - {None}:
                incident[node].append(edge)
        for node_id in graph_nodes:
            store.put(canonical("/api/node-v6", case_id=cid, node_id=node_id), dict(cutoff=case["date"], whole_origin_excluded=case["document_id"],
                edges=incident[node_id], scope="SAVED_DISPLAY_PROJECTION_ONLY", note="Only connections in the saved display projection are included; this is not the full neighborhood."))
        store.flush()
        atomic(completion, encoded(dict(identity=identity, status="COMPLETE")))
    public = {k:deepcopy(report[k]) for k in ("version", "status", "run_id", "historical_policy", "control_note", "reference_limitation", "assessment_note", "presentation_version") if k in report}
    for row in rows:
        group, member = members[row["case"]["case_id"]]
        row.update(selected_demo=group == "presentation", selected_bench=group == "bench",
            presentation_selection=dict(group=group, family_id=member["family_id"], reason=member["reason"]))
    public.update(cases=rows, completed_cases=len(rows), pending_cases=0,
        source_report_ref=report_ref, public_transport=VERSION,
        curated_not_benchmark=True, native_outputs_modified=False)
    atomic(site / "data/report-v6.json", encoded(public_metadata(public)))
    store.put("/data/report-v6.json", public)
    store.flush()
    print(json.dumps(dict(status="EXPORTED", cases=len(rows), routes=len(store.index["entries"]), api_calls=0)), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--selection", type=Path, required=True)
    parser.add_argument("--site", type=Path, default=Path(__file__).resolve().parents[1] / "site")
    parser.add_argument("--case", action="append", default=[])
    parser.add_argument("--workers", type=int, choices=(1, 2, 3), default=1)
    options = parser.parse_args()
    options.site.mkdir(parents=True, exist_ok=True)
    selection = read(options.selection)
    selected = options.case or [item["case_id"] for group in ("presentation", "bench") for item in selection[group]]
    if options.workers == 1:
        export(options.source_root.resolve(), options.site.resolve(), selection, only=selected)
    else:
        groups = [selected[i::options.workers] for i in range(options.workers)]
        with ProcessPoolExecutor(max_workers=options.workers) as executor:
            futures = [executor.submit(export, options.source_root.resolve(), options.site.resolve(), selection, group) for group in groups if group]
            for future in futures:
                future.result()
