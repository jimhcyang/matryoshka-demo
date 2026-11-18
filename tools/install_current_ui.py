"""Install a finite current casebook and its UI; never run or rewrite inference."""
import argparse
from contextlib import contextmanager
from copy import deepcopy
import fcntl
import gzip
import json
from pathlib import Path
import re

from assemble_site import project_relative_html
from export_replays import atomic, encoded, read, sha


ASSETS = ("workbench-v6.html", "workbench-v6.js", "workbench-v6.css", "app-theme-v6.css",
    "flow-view-v6.js", "flow-view-v6.css", "flow-layout-v4.js", "verdict-v64.js",
    "viewport-anchor-v64.js", "local-decisions-v65.js", "postrun-review-v74.js",
    "graph-full-v6.html", "graph-full-v6.js", "graph-full-v6.css",
    "corpus-home.html", "corpus-home.css", "corpus-home.js")
GENERATED = ("data/fast", "data/packed", "data/replays", "data/bootstrap", "data/pdfs")


def retained_entries(entries):
    """Retire old active workbench routes, not the separately bound corpus maps."""
    return {key: value for key, value in entries.items() if key in {"/data/report-v6.json", "/api/health"}
        or key.startswith(("/api/current/", "/graph-assets-v4/", "/api/graph-v4-viewer?", "/api/cib-pdf?"))}


def referenced_files(site, entries):
    result = {item["path"] for item in entries.values() if item.get("path")}
    manifests = set()
    for entry in entries.values():
        if entry.get("encoding") != "fragment-dag":
            continue
        path = Path(entry["path"])
        if path in manifests:
            continue
        manifests.add(path)
        manifest = read(site/path)
        result.update((path.parent/row["path"]).as_posix() for row in manifest["chunks"])
    return result


def prune_generated(site, entries):
    keep, removed = referenced_files(site, entries), []
    for relative in GENERATED:
        folder = site/relative
        if not folder.is_dir():
            continue
        for path in sorted(folder.rglob("*")):
            if path.is_symlink():
                raise ValueError("No generated public symlink may be pruned")
            name = path.relative_to(site).as_posix()
            if path.is_file() and name not in keep:
                removed.append(dict(path=name, sha256=sha(path.read_bytes()), bytes=path.stat().st_size))
                path.unlink()
        for path in sorted(folder.rglob("*"), reverse=True):
            if path.is_dir() and not any(path.iterdir()):
                path.rmdir()
    return removed


def inventory(site):
    rows = []
    for path in sorted(site.rglob("*")):
        if not path.is_file() or path.name == "publication.json":
            continue
        if path.is_symlink():
            raise ValueError("No public symlink")
        raw = path.read_bytes()
        item = dict(path=path.relative_to(site).as_posix(), sha256=sha(raw), bytes=len(raw))
        if path.name.endswith(".json.gz"):
            item["decoded_sha256"] = sha(gzip.decompress(raw))
        if path.suffix == ".pdf":
            item["role"] = "documentation" if item["path"].startswith("docs/") else "source_body"
            if item["role"] == "source_body":
                item["source_ids"] = ["cib"]
        rows.append(item)
    return rows


@contextmanager
def lock(package):
    with (package/".graph-refresh.lock").open("a+") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def install(root, package, *, report_sha256, cib_resource, execute=False):
    root, package = root.resolve(), package.resolve()
    site = package/"site"
    with lock(package):
        report_raw = (site/"data/report-v6.json").read_bytes()
        if sha(report_raw) != report_sha256:
            raise ValueError("Public current report changed")
        report = json.loads(report_raw)
        if report.get("version") != "current-workbench-publication/1":
            raise ValueError("Only an explicitly current report may become the active workbench")
        rows = report["cases"]
        for row in rows:
            if row.get("current_resource_execution") is not True:
                raise ValueError("A legacy result cannot be relabeled as current")
            if row["case"]["corpus"] == "cib" and row["resource_binding"]["resource_id"] != cib_resource:
                raise ValueError("Active CIB examples must use the declared canonical source-only resource")
        index_path = site/"data/api-index.json"
        index_raw = index_path.read_bytes()
        index = json.loads(index_raw)
        kept = retained_entries(index["entries"])
        for row in rows:
            if not any(key.startswith("/api/current/condition-v6?") and "case_id="+row["case"]["case_id"]+"&" in key for key in kept):
                raise ValueError("A current case has no exported native condition")
        index["entries"] = kept
        new_index = encoded(index)
        previous = read(site/"publication.json")
        identity = dict(version="current-ui-install/1", report_sha256=report_sha256,
            previous_publication_sha256=sha((site/"publication.json").read_bytes()),
            previous_api_index_sha256=sha(index_raw), resulting_api_index_sha256=sha(new_index),
            canonical_cib_resource=cib_resource)
        preview = dict(identity, cases=len(rows), retained_routes=len(kept), api_calls=0,
            execute_required=True, native_outputs_modified=False)
        if not execute:
            return preview
        history = package/".current-export"/"install"/sha(encoded(identity))
        if history.exists():
            raise ValueError("Use the completed install receipt rather than resealing an existing install")
        history.mkdir(parents=True)
        atomic(history/"previous-publication.json", (site/"publication.json").read_bytes())
        atomic(history/"previous-api-index.json", index_raw)
        lineage = []
        for name in ASSETS:
            raw = (root/"web"/name).read_bytes()
            public = raw
            if name.endswith(".html"):
                text = project_relative_html(raw.decode())
                text = re.sub(r'<script\b(?=[^>]*\bid=[\"\']showcase-selection-v66[\"\'])[^>]*>.*?</script>', "", text, flags=re.S)
                if name != "corpus-home.html":
                    hook = '<script src="runtime/public-runtime.js" data-index="data/api-index.json" data-index-sha256="'+sha(new_index)+'"></script>\n<link rel="stylesheet" href="public-transport.css">\n'
                    text = text.replace("</head>", hook+"</head>")
                    text = text.replace("connect-src 'self';", "connect-src 'self' https://raw.githubusercontent.com;")
                public = text.encode()
            atomic(site/name, public)
            lineage.append(dict(path=name, source_sha256=sha(raw), public_sha256=sha(public)))
        atomic(site/"index.html", (site/"corpus-home.html").read_bytes())
        guide = (root/"docs/demo-guide/guide.pdf").read_bytes()
        if not guide.startswith(b"%PDF-"):
            raise ValueError("Completed rendered methods guide required")
        atomic(site/"docs/matryoshka-guide.pdf", guide)
        for name in ("public-runtime.js", "replay.html", "replay.js"):
            raw = (package/"runtime"/name).read_bytes()
            if name == "replay.html":
                raw = raw.replace(b'<script src="public-runtime.js"', b'<script data-index="data/api-index.json" data-index-sha256="'+sha(new_index).encode()+b'" src="public-runtime.js"')
            atomic(site/"runtime"/name, raw)
        atomic(index_path, new_index)
        removed = prune_generated(site, kept)
        files = inventory(site)
        if sum(row["bytes"] for row in files) >= 900_000_000:
            raise ValueError("Public byte limit exceeded; inputs and install history are preserved")
        manifest = {key:deepcopy(previous[key]) for key in ("base_path", "publicness", "licensing", "sources", "graph_data_manifest")}
        manifest.update(version="public-current-casebook/1", run_id="current_public_"+sha(report_raw)[:24],
            ref=dict(run_id=report["run_id"], sha256=report_sha256), case_ids=[r["case"]["case_id"] for r in rows],
            cases=[dict(case_id=r["case"]["case_id"],group="presentation" if r.get("selected_demo") else "bench",
                canonical_fact_family=r["case"]["case_id"],polarity="neutral") for r in rows],
            api_index="data/api-index.json", files=files, ui_asset_lineage=lineage,
            canonical_cib_resource=cib_resource, native_outputs_modified=False, inference_api_calls=0,
            curation=dict(outcome_informed=True, benchmark_accuracy=False, temporary_showcase=True,
                policy="Temporary and unresolved examples retain their actual source bindings and local decisions; not benchmark accuracy."))
        atomic(site/"publication.json", encoded(manifest))
        completion = dict(preview, execute_required=False, status="INSTALLED_NOT_YET_VALIDATED_OR_DEPLOYED",
            removed_generated_files=removed, files=len(files), stored_bytes=sum(r["bytes"] for r in files),
            publication_sha256=sha(encoded(manifest)))
        atomic(history/"completion.json", encoded(completion))
        return {k:v for k,v in completion.items() if k != "removed_generated_files"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", required=True, type=Path)
    parser.add_argument("--report-sha256", required=True)
    parser.add_argument("--cib-resource", required=True)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    print(json.dumps(install(args.source_root, Path(__file__).resolve().parents[1], report_sha256=args.report_sha256,
        cib_resource=args.cib_resource, execute=args.execute), sort_keys=True))
