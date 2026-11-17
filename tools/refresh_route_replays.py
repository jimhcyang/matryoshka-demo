"""Refresh only display route witnesses; never rerun inference or assessment."""
from concurrent.futures import ProcessPoolExecutor
from copy import deepcopy
import argparse
import gzip
import json
from pathlib import Path
import sys
from urllib.parse import parse_qs, urlsplit

from export_replays import Store, atomic, canonical, encoded, proof_ids, read, sha

PREFIXES = ("/api/flow-v6?", "/api/guide-v6?", "/api/guide-overlay-v64?", "/api/guide-view-v6?")


def worker(root, site, case_id, source_index_sha):
    sys.path.insert(0, str(root))
    from matryoshka_demo_v6.flow_projection_v65 import presentation
    from matryoshka_demo_v6.guide_v65 import guide
    from matryoshka_demo_v6.guide_runtime_v64 import overlay
    from matryoshka_demo_v6.guide_views import request as source_view
    from matryoshka_demo_v6.guide_route_selection_v65 import VERSION
    from matryoshka_demo_v6.server import source_tools, PAGE_ORDER
    from matryoshka_demo.corpus_explorer_v3 import _connection
    from matryoshka_demo.corpus_policy_v5 import scoped_page_view
    code = root / "matryoshka_demo_v6/guide_route_selection_v65.py"
    identity = dict(source_index_sha256=source_index_sha, case_id=case_id, selector_sha256=sha(code.read_bytes()), version=VERSION)
    checkpoint = site.parent / ".route-refresh" / (case_id + ".json")
    if checkpoint.exists() and read(checkpoint).get("identity") == identity:
        return read(checkpoint)
    report = read(root / "web/data/report-v6.json")
    case = next(r["case"] for r in report["cases"] if r["case"]["case_id"] == case_id)
    reference = report["graph_indexes"][case["corpus"]]
    veto = report.get("handling_veto_documents", {}).get(case["corpus"], [])
    store = Store(site)
    keys = [k for k in store.index["entries"] if k.startswith("/api/flow-v6?") and parse_qs(urlsplit(k).query).get("case_id") == [case_id]]
    updates, changes, route_lengths = {}, [], []

    def replace(key, value):
        before = store.index["entries"].pop(key, None)
        store.put(key, value)
        updates[key] = store.index["entries"][key]
        changes.append(dict(key=key, before_sha256=before.get("sha256") if before else None, after_sha256=updates[key]["sha256"]))

    for key in keys:
        params = {k:v[0] for k,v in parse_qs(urlsplit(key).query, keep_blank_values=True).items()}
        config, rid = params["config"], params.get("reading") or None
        old = store.get(key)
        new = presentation(root, report, case_id, config, reading=rid, limit=1024)
        for field in ("case_id", "config", "reading_id", "source_case_sha256", "source_expanded_sha256", "native_snapshot_sha256", "frames", "nodes", "edges"):
            if new.get(field) != old.get(field):
                raise ValueError("Route-only observer changed non-route field: " + field)
        if [v["id"] for v in new["candidates"]] != [v["id"] for v in old["candidates"]]:
            raise ValueError("Route-only observer changed displayed candidate membership/order")
        replace(key, new)
        for candidate in new["candidates"]:
            for route_index, route in enumerate(candidate.get("routes", [])[:3]):
                args = dict(case_id=case_id, config=config, reading=rid or "", candidate_id=candidate["id"], route_index=route_index)
                packet = guide(root, report, case_id, config, candidate["id"], route_index, rid)
                if packet["route"]["nodes"] != route["nodes"]:
                    raise ValueError("Route view and map guide disagree")
                mapped = overlay(root, reference, case, packet, excluded_documents=veto)
                replace(canonical("/api/guide-v6", **args), packet)
                replace(canonical("/api/guide-overlay-v64", **args), mapped)
                for source_id in proof_ids(packet) | proof_ids(mapped):
                    source_key = canonical("/api/source-v6", case_id=case_id, source_id=source_id)
                    if source_key not in store.index["entries"]:
                        value = source_tools(veto)["source_page"](root, reference, case, source_id)
                        db = _connection(root, reference)
                        try:
                            scoped_page_view(db, veto)
                            pages = [json.loads(r[0]) for r in db.execute("SELECT payload FROM page WHERE doc=? AND date<? AND doc!=? ORDER BY " + PAGE_ORDER,
                                (value["document_id"], case["date"], case["document_id"]))]
                        finally:
                            db.close()
                        replace(source_key, dict(value, document_pages=pages, source_scope="Eligible canonical text segments; not invented PDF pages"))
                    page = source_view(root, reference, case, packet, dict(phase="source", source_id=source_id), excluded_documents=veto)
                    replace(canonical("/api/guide-view-v6", **args, phase="source", source_id=source_id), page)
                route_lengths.append(dict(config=config, reading=rid, candidate_id=candidate["id"],
                    route_index=route_index, edges=len(route.get("hops", [])), kind=route.get("route_kind"),
                    navigation_edges=sum(h.get("kind") != "SOURCE" for h in route.get("hops", [])),
                    selection=route.get("route_selection")))
        print("refreshed", case_id, config, rid or "no-slot", flush=True)
    result = dict(status="COMPLETE", identity=identity, updates=updates, changes=changes, route_lengths=route_lengths,
        native_outputs_modified=False, frames_nodes_edges_unchanged=True, candidate_order_unchanged=True, api_calls=0)
    if sha(code.read_bytes()) != identity["selector_sha256"]:
        raise ValueError("Route observer source changed during refresh; completed independent cases remain saved")
    atomic(checkpoint, encoded(result))
    return result


def run(root, site, workers, case_ids):
    source_path = site.parent / ".route-refresh/source-api-index.json"
    current = read(site / "data/api-index.json")
    if not source_path.exists():
        atomic(source_path, encoded(current))
    source = read(source_path)
    source_sha = sha(source_path.read_bytes())
    if not case_ids:
        case_ids = [r["case"]["case_id"] for r in read(site / "data/report-v6.json")["cases"]]
    with ProcessPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(worker, root, site, cid, source_sha) for cid in case_ids]
        outputs = [future.result() for future in futures]
    selected = set(case_ids)
    current = read(site / "data/api-index.json")
    # Remove superseded route URLs, including now-unavailable route indices.
    for key in list(current["entries"]):
        if key.startswith(PREFIXES) and parse_qs(urlsplit(key).query).get("case_id", [None])[0] in selected:
            del current["entries"][key]
    for output in outputs:
        current["entries"].update(output["updates"])
    invariant_keys = [key for key in source["entries"] if key.startswith("/api/condition-v6?")]
    if any(current["entries"].get(key) != source["entries"][key] for key in invariant_keys):
        raise ValueError("An inference/grade packet changed during route refresh")
    atomic(site / "data/api-index.json", encoded(current))
    receipt = dict(status="REFRESHED", cases=len(outputs), route_views=sum(len(x["route_lengths"]) for x in outputs),
        unchanged_condition_packets=len(invariant_keys), native_outputs_modified=False, api_calls=0,
        source_api_index_sha256=source_sha, current_api_index_sha256=sha(encoded(current)),
        selector_sha256=outputs[0]["identity"]["selector_sha256"], outputs=[dict(case_id=x["identity"]["case_id"],
            edges=[r["edges"] for r in x["route_lengths"]]) for x in outputs])
    atomic(site.parent / ".route-refresh/receipt.json", encoded(receipt))
    print(json.dumps({k:v for k,v in receipt.items() if k != "outputs"}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--site", type=Path, default=Path(__file__).resolve().parents[1] / "site")
    parser.add_argument("--workers", type=int, choices=(1, 2, 3), default=3)
    parser.add_argument("--case", action="append", default=[])
    parser.add_argument("--exclude-case", action="append", default=[])
    args = parser.parse_args()
    cases = args.case or [r["case"]["case_id"] for r in read(args.site / "data/report-v6.json")["cases"]]
    run(args.source_root.resolve(), args.site.resolve(), args.workers, [cid for cid in cases if cid not in args.exclude_case])
