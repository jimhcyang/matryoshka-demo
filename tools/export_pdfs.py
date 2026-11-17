"""Publish only the exact CIB PDFs used by saved case/source drawers."""
import argparse
import gzip
import json
from pathlib import Path

from export_replays import Store, atomic, canonical, encoded, read, sha


def cited_documents(value):
    found = set()
    if isinstance(value, dict):
        if (isinstance(value.get("canonical_page_id"), str) and isinstance(value.get("text"), str)
                and isinstance(value.get("start"), int) and isinstance(value.get("end"), int)
                and isinstance(value.get("document_id"), str)):
            found.add(value["document_id"])
        for child in value.values():
            found.update(cited_documents(child))
    elif isinstance(value, list):
        for child in value:
            found.update(cited_documents(child))
    return found


def export(root, site):
    store = Store(site)
    report = read(site / "data/report-v6.json")
    cib_cases = {r["case"]["case_id"]: r["case"] for r in report["cases"] if r["case"]["corpus"] == "cib"}
    required = {(case["document_id"], release) for case in cib_cases.values() for release in ("earlier", "later")}
    for key, entry in store.index["entries"].items():
        if not key.startswith("/api/condition-v6?"):
            continue
        from urllib.parse import parse_qs, urlsplit
        cid = parse_qs(urlsplit(key).query)["case_id"][0]
        if cid not in cib_cases:
            continue
        value = store.get(key)
        saved = next(iter(value["configurations"].values()))
        result = saved["result"]
        documents = set()
        for reading in result.get("readings", []):
            for candidate in reading.get("candidates", [])[:5]:
                documents.update(cited_documents(candidate))
        for atom in result.get("atoms", []):
            documents.update(cited_documents(atom.get("evidence", [])))
        documents.update(cited_documents(saved.get("local_decisions_v65", {})))
        required.update((doc, "earlier") for doc in documents)
    binding = read(root / "data/bindings.json")["corpora"]["cib"]
    reference = binding["files"]["documents"]
    manifest_path = root.parent / reference["path"]
    if manifest_path.resolve(strict=True) != manifest_path or sha(manifest_path.read_bytes()) != reference["sha256"]:
        raise ValueError("CIB document manifest commitment changed")
    documents = {row["document_id"]: row for line in manifest_path.read_text().splitlines() if (row := json.loads(line))}
    original_pdf_entries = {k:v for k,v in store.index["entries"].items() if k.startswith("/api/cib-pdf?")}
    store.index["entries"] = {k:v for k,v in store.index["entries"].items() if not k.startswith("/api/cib-pdf?")}
    for doc_id, release in sorted(required):
        path = root.parent / "src-redaction" / documents[doc_id][release + "_pdf"]
        allowed = root.parent / "src-redaction/data/source/pdfs"
        if path.resolve(strict=True) != path or not path.is_relative_to(allowed):
            raise ValueError("Unbound original PDF")
        raw = path.read_bytes()
        if not raw.startswith(b"%PDF-") or len(raw) >= 95_000_000:
            raise ValueError("Invalid/oversized original PDF")
        relative = "data/pdfs/" + sha(raw) + ".pdf"
        atomic(site / relative, raw)
        key = canonical("/api/cib-pdf", doc_id=doc_id, release=release)
        entry = dict(path=relative, sha256=sha(raw), wire_sha256=sha(raw), encoding="identity", mime="application/pdf")
        if key in store.index["entries"] and store.index["entries"][key] != entry:
            raise ValueError("An original PDF changed")
        store.index["entries"][key] = entry
    # This scoped export supersedes only unpublished generated PDF copies.
    # Original corpus PDFs and all non-PDF response records remain untouched.
    atomic(store.path, encoded(store.index))
    keep = {entry["path"] for entry in store.index["entries"].values()}
    pruned = []
    for path in (site / "data/pdfs").glob("*.pdf"):
        if path.relative_to(site).as_posix() not in keep:
            pruned.append(dict(sha256=sha(path.read_bytes()), bytes=path.stat().st_size))
            path.unlink()
    atomic(site.parent / ".packing-work/pdf-export-scope.json", encoded(dict(
        scope="Curated origins plus final top-five/proposition/local-decision evidence quotations; not every diffusion context document.",
        pdfs=len(required), unused_unpublished_copies_pruned=pruned, original_corpus_pdfs_modified=False)))
    print(json.dumps(dict(status="EXPORTED", pdfs=len(required), pruned=len(pruned), scope="Curated origins and final cited evidence PDFs only; full Corpus Map transcripts remain separate.")))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", required=True, type=Path)
    parser.add_argument("--site", type=Path, default=Path(__file__).resolve().parents[1] / "site")
    args = parser.parse_args()
    export(args.source_root.resolve(), args.site.resolve())
