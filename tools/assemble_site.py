"""Assemble the public UI and declarations from an explicit saved selection."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re
import shutil

from export_replays import atomic, encoded, read, sha, CONFIGS


ASSETS = ("workbench-v6.html", "workbench-v6.js", "workbench-v6.css", "app-theme-v6.css",
          "flow-view-v6.js", "flow-view-v6.css", "flow-layout-v4.js", "verdict-v64.js",
          "viewport-anchor-v64.js", "local-decisions-v65.js", "graph-full-v6.html",
          "graph-full-v6.js", "graph-full-v6.css")


def assemble(root, package, selection_path, *, finalize=False):
    selection = read(selection_path)
    selected = {item["case_id"]: (group, item) for group in ("presentation", "bench") for item in selection[group]}
    site = package / "site"
    report = read(root / "web/data/report-v6.json")
    family_spec = read(root / "experiments/presentation_v66/fact_family_spec_v01.json")
    family_members = {member["case_id"]: member for family in family_spec["families"] for member in family["members"]}
    index = read(site / "data/api-index.json")
    asset_lineage = []
    for name in ASSETS:
        raw = (root / "web" / name).read_bytes()
        text = raw.decode()
        if name.endswith(".html"):
            text = re.sub(r'<script\b(?=[^>]*\bid=[\"\']showcase-selection-v66[\"\'])[^>]*>.*?</script>', "", text, flags=re.S)
            hook = '<script src="runtime/public-runtime.js" data-index="data/api-index.json" data-index-sha256="' + sha((site / "data/api-index.json").read_bytes()) + '"></script>\n  <link rel="stylesheet" href="public-transport.css">\n'
            text = text.replace("</head>", hook + "</head>")
            text = text.replace("object-src 'none';", "frame-src 'self' blob:; object-src 'none';")
            text = text.replace("connect-src 'self';", "connect-src 'self' https://raw.githubusercontent.com;")
            text = text.replace("V6.5 Analyst Workbench", "Public Analyst Workbench")
            text = text.replace("All evaluated", "All showcase questions")
        if name == "workbench-v6.js":
            text = text.replace("Open saved native record", "Open public inference receipt")
        public = text.encode()
        atomic(site / name, public)
        asset_lineage.append(dict(path=name, source_sha256=sha(raw), public_sha256=sha(public),
            changes="Early finite static transport and public-only wording; native decisions/ranks are unchanged."))
    # The root is the actual workbench, not a refresh redirect that loses a hash.
    atomic(site / "index.html", (site / "workbench-v6.html").read_bytes())
    for name in ("public-runtime.js", "replay.html", "replay.js"):
        raw = (package / "runtime" / name).read_bytes()
        if name == "replay.html":
            raw = raw.replace(b'<script src="public-runtime.js"', b'<script data-index="data/api-index.json" data-index-sha256="' + sha((site / "data/api-index.json").read_bytes()).encode() + b'" src="public-runtime.js"')
            raw = raw.replace(b"connect-src 'self';", b"connect-src 'self' https://raw.githubusercontent.com;")
        atomic(site / "runtime" / name, raw)
    atomic(site / ".nojekyll", b"")
    if not finalize:
        print(json.dumps(dict(status="UI_ASSEMBLED", files=len(ASSETS), final_manifest=False)))
        return
    expected_keys = set()
    from export_replays import canonical
    for cid in selected:
        receipt = package / ".export-checkpoints" / (cid + ".json")
        if not receipt.exists() or read(receipt).get("status") != "COMPLETE":
            raise ValueError("Public export is unfinished: " + cid)
        for config in CONFIGS:
            expected_keys.add(canonical("/api/condition-v6", case_id=cid, config=config))
            if not any(k.startswith("/api/flow-v6?") and "case_id=" + cid + "&" in k and "config=" + config + "&" in k for k in index["entries"]):
                raise ValueError("A condition has no exported saved flow: " + cid + "/" + config)
    if not expected_keys <= index["entries"].keys():
        raise ValueError("Missing public saved conditions")
    # Only this generated transport area is pruned, never research artifacts.
    referenced = {entry["path"] for entry in index["entries"].values() if "path" in entry}
    for path in (site / "data/replays").glob("*.json.gz"):
        if path.relative_to(site).as_posix() not in referenced:
            path.unlink()
    for path in site.rglob("*.lock"):
        path.unlink()
    public_report = read(site / "data/report-v6.json")
    if {r["case"]["case_id"] for r in public_report["cases"]} != set(selected):
        raise ValueError("Public report cohort differs")
    for row in public_report["cases"]:
        group, item = selected[row["case"]["case_id"]]
        row["presentation_selection"].update(group=group, family_id=item["family_id"], reason=item["reason"])
    atomic(site / "data/report-v6.json", encoded(public_report))
    cases = []
    for cid, (group, item) in selected.items():
        member = family_members[cid]
        polarity = member.get("polarity", "neutral")
        if polarity == "analyst_negative":
            polarity = "negative"
        if polarity not in {"positive", "negative", "neutral", "mixed"}:
            polarity = "neutral"
        cases.append(dict(case_id=cid, group=group, canonical_fact_family=item["family_id"], polarity=polarity))
    inventory = []
    for path in sorted(site.rglob("*")):
        if not path.is_file() or path.name == "publication.json":
            continue
        if path.is_symlink():
            raise ValueError("No public symlinks")
        raw = path.read_bytes()
        row = dict(path=path.relative_to(site).as_posix(), bytes=len(raw), sha256=sha(raw))
        if path.name.endswith(".json.gz"):
            row["decoded_sha256"] = sha(gzip.decompress(raw))
        if path.suffix == ".pdf":
            row.update(role="source_body", source_ids=["cib"])
        inventory.append(row)
    source_report = selection.get("report_ref") or selection["inputs"]["report"]
    publication = dict(version="public-presentation/6.6", run_id="matryoshka-public-v66-" + sha(encoded(cases))[:16],
        ref=dict(run_id=report["run_id"], sha256=source_report["sha256"]), base_path="/matryoshka-demo/",
        publicness=dict(approved=True, historical_public_sources=True, heldout_answers_intentionally_public=True,
            previously_public_historical_sources_only=True, no_private_workspace_material=True, not_a_declassification_claim=True,
            note="Historical publicly distributed materials only. Original classification marks remain; this is not a new declassification decision."),
        licensing=dict(status="approved", code="Author-authorized public presentation; no additional blanket license grant.",
            data="Previously public historical U.S. government corpus excerpts; source notices and release provenance retained.", notices=["NOTICES.txt"]),
        sources=[dict(id=c, publicly_released=True, provenance_url=url, rights_status="approved",
                      rights_basis="Historical U.S. government source corpus already publicly distributed; no private collaborator material is included.", rights_reference=url)
                 for c, url in (("cib", "https://www.cia.gov/readingroom/"), ("iran", "https://wikileaks.org/plusd/"), ("vietnam", "https://wikileaks.org/plusd/"))],
        case_ids=list(selected), cases=cases, api_index="data/api-index.json", files=inventory,
        curation=dict(outcome_informed=True, benchmark_accuracy=False, unique_fact_families=len(cases),
            policy="One active representative per fact family across tasks, presentation and bench; no polarity-mirrored companions.",
            selection_sha256=sha(selection_path.read_bytes())),
        native_outputs_modified=False, inference_api_calls=0, ui_asset_lineage=asset_lineage)
    commits = {entry["external_url"].split("/")[5] for entry in index["entries"].values() if entry.get("external_url")}
    if len(commits) != 1:
        raise ValueError("Graph dataset URLs must share one immutable Git release")
    publication["graph_data_manifest"] = dict(path="datasets/manifest.json", sha256=sha((package / "datasets/manifest.json").read_bytes()), commit=next(iter(commits)))
    atomic(site / "publication.json", encoded(publication))
    print(json.dumps(dict(status="ASSEMBLED", cases=len(cases), conditions=len(expected_keys),
        files=len(inventory), bytes=sum(f["bytes"] for f in inventory))))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--selection", type=Path, required=True)
    parser.add_argument("--finalize", action="store_true")
    args = parser.parse_args()
    assemble(args.source_root.resolve(), Path(__file__).resolve().parents[1], args.selection.resolve(), finalize=args.finalize)
