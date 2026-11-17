# Explicit OFFLINE Static Demo Bundle

The **full native query engine is NOT included**. This is a separately
versioned, derived viewer for the **saved workbench only**, plus current CIB
and retained Iran/Vietnam corpus exploration. It is a literal hash-and-file-copy
wrapper, not a new inference backend. No extraction, aliasing, graph rebuilding,
model calls, candidate edits, rank edits, or source-body edits occur.

The expected full bundle is approximately **3.6 GB**. Allow additional disk
space for an external staging directory and a temporary copy of the original
site during verification. All stored graph objects are copied, including local
bootstrap duplicates and assets not selected by the first browser view.

This is **not new corpus certification**, independent identity accuracy,
declassification, or a new licensing decision. Original historical cutoffs,
whole-origin exclusions, source quotations, typed identity metadata, graph and
hierarchy IDs, and release declarations are preserved. Current CIB and the
original graph needed by saved guides remain separate. Iran and Vietnam retain
their legacy-not-revalidated status. New manifest rows are handled by their
literal logical keys, paths and pins, not a hard-coded asset-name list.

## Build

Run from the independent public project directory (`matryoshka_demo_site/`).
Use Python 3.10+ on macOS or Linux, with only its standard library. The input
is a local checkout with `site/`, `datasets/`, and the existing read-only
`tools/validate_publication.py` and `tools/pack_graphs.py`. Every dataset object
must already exist locally. No Git command, HTTP request, API, download, or
native builder is used. The wrapper does not certify remote availability.
The source checkers must also match the running builder's sibling checker
bytes before they are executed; an input project cannot substitute arbitrary
checker code just because its site publication pin is valid.

The full build validates the complete corpus and may take approximately half
an hour on a laptop; synthetic tests are much smaller.
The following pin identifies the approved source 6.7 publication, not a hash
to silently recalculate when something changes:

```sh
python3 tools/build_offline_bundle.py build \
  --source "$PWD" \
  --output "$HOME/matryoshka-offline-v1" \
  --source-publication-sha256 3080148d8ce3a060704bb3e4c28556bbb3b83b27ec1e7ae4f89b76e90356f492
```

That publication binds dataset manifest v2 SHA256
`f7c1f8a968fa1f3852cc5542e1fb5a78c74b08bf4664051ae93b6c6a64457967`.
The source inventory has 1,584 dataset rows: 1,576 external graph entries and
eight local bootstrap entries. A later source publication needs a newly
reviewed explicit publication SHA256, never implicit trust in the current file.

The output parent must already exist. The output and staging location must be
outside the source project; use a dedicated artifact location, not a native
research/output directory. The wrapper snapshots its scoped inputs before
validation and checks their original membership, hashes, inode metadata and
tool bytes again before installation. Unrelated project/Git files are neither
copied nor inspected as publication inputs.
Keep these scoped source inputs quiescent for the entire command.

Default behavior is no overwrite. A persistent, external
`.matryoshka-offline-v1.offline.lock` serializes cooperating builders. Do not
unlink a live lock. A private sibling temporary directory is cleaned on
failure; only that owned stage is removed. Successful installation uses an
atomic exclusive directory rename, including refusal to replace an empty
existing directory. Unsupported exclusive-rename platforms fail closed.

## Receipt And Verification

The successful build prints JSON containing `receipt_sha256`. Record that pin
from the approved build in the handoff. Verification requires the caller's
trusted completed-receipt pin; it never trusts a hash merely recomputed from
an unknown or modified bundle.

The output directory contains the copied site at its root, `datasets/`,
`offline-publication.json`, `verify_offline_bundle.py`, and `provenance/`.
The provenance directory holds byte-exact source `publication.json`, the
original API index, every original HTML file, and the two unmodified Python
checkers. There is no resealed source `public-presentation/6.7` receipt at the
bundle root. The new receipt is `offline-static-demo/1`; its SHA256 identifies
this derived artifact independently of the historical source release.

Only external graph index entries are localized. Each must match the exact
source logical key, approved repository, literal committed URL, dataset row,
wire SHA256 and decoded SHA256. Only its `external_url` member becomes a
relative `path` into `datasets/`. Other index bytes, including saved routes
and the eight local bootstrap entries, remain literal. The only HTML edit is
the original runtime script's `data-index-sha256` value. Its original value,
script location, index path and occurrence count must match. Runtime JavaScript,
saved packets, source bodies and compressed graph bytes remain byte-exact.

Verify anywhere, even after removing the original workspace:

```sh
python3 "$HOME/matryoshka-offline-v1/verify_offline_bundle.py" verify \
  --bundle "$HOME/matryoshka-offline-v1" \
  --receipt-sha256 PIN_FROM_APPROVED_SUCCESSFUL_BUILD
```

Verification first checks exact file/directory membership and every member's
size and wire hash against that pinned receipt. Only then are its authenticated
checker sources loaded. A temporary original-site view is reconstructed from
protected originals and copied packets, without writing into the bundle.
The existing checker performs full source inventory, decoded member hashes,
fragment-DAG root/transport, dataset manifest/row, release/hierarchy and viewer
comparison/search projection checks. All dataset records are verified, not
just assets requested by a browser. The new index and HTML are independently
rederived and compared to the exact allowed transforms. Unknown graph routes,
external URLs, revisions, missing objects, symlinks, traversal, extra members,
tampered packets and source changes fail closed. Verification is a full local
scan and may take substantial time; no cached privacy receipt substitutes for it.

To repeat a completed build, use its original source pin and add:

```sh
  --resume --receipt-sha256 PIN_FROM_APPROVED_SUCCESSFUL_BUILD
```

Completed resume is verification only. It cannot repair or reseal changed
outputs, resume an incomplete stage, or overwrite a nonmatching directory.
An independent `verify` does not need `--source` or any native workspace file.
Two fresh builds with identical scoped inputs and wrapper/checker code have
the same completed receipt hash. Immutability is verified by membership and
hashes, not by an operating-system immutable flag.

## Plain HTTP And Browser Check

Use HTTP, **not `file:`**. The unchanged browser runtime needs ordinary HTTP
fetches and browser decompression/WebCrypto support. No service worker, proxy,
credentials, special API server, or native engine is needed.

```sh
python3 -m http.server 8765 --bind 127.0.0.1 \
  --directory "$HOME/matryoshka-offline-v1"
```

Open `http://127.0.0.1:8765/`. Serve this directory itself, not the source
project's `site/`. Browser automation must use Playwright's managed Chromium
headless shell, never installed Google Chrome or a personal profile. If the
shell is missing, install it using the workspace virtual environment's
`python -m playwright install chromium --only-shell` before disconnecting.

For acceptance, deny and record every request outside the local server
origin. Do not enable browser-context offline mode, which would also block
the local HTTP server. Exercise the landing page, a saved CIB workbench guide,
the distinct current/study CIB map and hierarchy, Iran and Vietnam map/study
bindings, saved condition/flow/source/PDF replay, and an unknown route/revision.
Check that graph requests resolve under local `datasets/` or unchanged local
bootstrap paths, no raw GitHub request occurs, and unsupported saved requests
fail closed. Check desktop and narrow/mobile layouts and browser console
errors. Re-run the pinned independent verifier after the browser session.
External provenance hyperlinks remain historical references; following an
off-site link is not part of the offline saved viewer.

Synthetic regression tests (no full build or browser installation):

```sh
../.venv/bin/python -B -m pytest -q tests/test_offline_bundle.py
```

The test fixtures include all three corpora, old/current CIB releases, native
hierarchy IDs and typed source-body records. They do not certify a full corpus
or replace the lead's full-size build and managed-browser acceptance check.
