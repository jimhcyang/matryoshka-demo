"""Prepare a complete, source-pinned public graph transport input list.

Only unreachable cable current_reveal variants are omitted. Graph objects,
memberships, edges and source text are not filtered or recomputed. Workstation
metadata in comparison bootstraps is replaced in a separately hashed derivative.
"""
import argparse
import gzip
import json
from pathlib import Path

from export_replays import Store, atomic, canonical, encoded, public_metadata, read, sha


def prepare(workspace, output):
    root = workspace / "src-demo-day"
    binding_path = root / "data/full_graph_bindings_v4.json"
    binding = read(binding_path)
    if binding["sha256"] != sha(encoded({k:v for k,v in binding.items() if k != "sha256"})):
        raise ValueError("Original graph binding changed")
    selected, lineage, api = [], {}, {}
    original_bytes = 0
    for corpus, bound in binding["corpora"].items():
        active = ("current_earlier", "current_later") if corpus == "cib" else ("current_redaction", "current_later")
        bootstrap_names = {bound["comparison"], bound["search"]}
        comparison_hash = None
        for name, ref in bound["assets"].items():
            if name not in bootstrap_names and not any("." + view + "." in name for view in active):
                continue
            path = workspace / ref["path"]
            raw = path.read_bytes()
            if path.resolve(strict=True) != path or len(raw) != ref["bytes"] or sha(raw) != ref["sha256"]:
                raise ValueError("An original graph file changed: " + name)
            payload = gzip.decompress(raw) if name.endswith(".gz") else raw
            prepared_ref = dict(ref)
            if name == bound["comparison"] or b"/Users/" in payload or b"/home/" in payload:
                value = public_metadata(json.loads(payload))
                public = encoded(value)
                if b"/Users/" in public or b"/home/" in public:
                    raise ValueError("An unhandled machine location remains")
                target = output / "prepared" / corpus / name
                wire = gzip.compress(public, compresslevel=9, mtime=0) if name.endswith(".gz") else public
                atomic(target, wire)
                prepared_ref = dict(path=target.relative_to(workspace).as_posix(), sha256=sha(wire), bytes=len(wire))
                if name == bound["comparison"]:
                    comparison_hash = sha(public)
            logical = "/graph-assets-v4/" + corpus + "/" + name
            selected.append(dict(name=logical, corpus=corpus, category="graph", ref=prepared_ref))
            lineage[logical] = dict(original=dict(ref), prepared=dict(prepared_ref), original_graph_id=bound["graph_id"],
                original_hierarchy_id=bound["hierarchy_id"], all_graph_objects_preserved=True)
            original_bytes += ref["bytes"]
        if comparison_hash is None:
            raise ValueError("Missing comparison bootstrap")
        packet = dict(asset_base="/graph-assets-v4/" + corpus + "/", comparison_asset=bound["comparison"],
            search_asset=bound["search"], graph_run_id=bound["graph_id"], hierarchy_run_id=bound["hierarchy_id"],
            study_graph_id=bound["study_graph_id"], study_hierarchy_id=bound["study_hierarchy_id"],
            comparison_sha256=comparison_hash, source_comparison_sha256=bound["source_export_sha256"],
            scope_note=bound["scope"] + " " + bound["layout_note"] + " Full transcript exploration is retained. Bulk PDF browsing remains local; curated workbench PDFs are separately exported.",
            pdf_available=False, public_transport="Separate canonical transport hash; graph semantics unchanged.")
        api[corpus] = packet
    if len(selected) != 1188 or original_bytes != 2821618199:
        raise ValueError("Reachability closure differs from the independently audited six-view population")
    result = dict(version="public-graph-inputs/1", selected=selected, lineage=lineage, graph_bindings=api,
        source_binding_sha256=sha(binding_path.read_bytes()), reachable_original_bytes=original_bytes,
        excluded="394 unreachable cable current_reveal transport files; no current GUI view uses them.")
    atomic(output / "graph-inputs.json", encoded(result))
    print(json.dumps(dict(status="PREPARED", assets=len(selected), original_bytes=original_bytes,
        upstream_modified=False, source_binding_sha256=result["source_binding_sha256"])))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / ".packing-work/graphs")
    args = parser.parse_args()
    prepare(args.workspace.resolve(), args.output.resolve())
