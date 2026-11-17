# Runtime Browser CI

Run from the standalone `matryoshka_demo_site` repository root:

```sh
python -m pip install -r runtime/tests/requirements-ci.txt
python -m playwright install --with-deps chromium --only-shell
PYTHONDONTWRITEBYTECODE=1 python -B -m pytest -q -x -p no:cacheprovider \
  runtime/tests/runtime_browser_test.py \
  runtime/tests/runtime_fragment_test.py \
  runtime/tests/runtime_external_test.py \
  -o junit_family=legacy --junitxml=runtime/tests/runtime-ci.xml
```

Upload `runtime/tests/runtime-ci.xml` as a CI artifact, including on failure.
The package's `pytest tests` command does not include this runtime-local suite;
invoke it explicitly. No `PYTHONPATH` modification is required. CI needs the
managed Chromium shell and its system libraries, not installed Google Chrome.

The fixture creates a temporary plain static HTTP server on an ephemeral
loopback port under `/a-different-project/`. It does not use a source processor,
app backend, paid API, credentials, deployment server or external network.
Installation downloads are separate from the offline fixture test execution.
The small packer round trip imports the package's `tools/pack_graphs.py` and
writes generated test data only in the temporary directory.

Coverage includes canonical request defaults, base paths, gzip and integrity,
source-text preservation, fail-closed methods/routes/paths, HTTPS citation
navigation, PDF/native replay, archive-only missing PDF anchors, frame rewriting,
malformed DAGs, exact numeric-token reconstruction and cache bounds. Hybrid
checks combine a gzip condition bootstrap with DAG flow/overlay/node API JSON
and graph `.gz` responses sharing the same verified templates. Immutable external
graph checks intercept every nonlocal request and verify the exact repository,
commit/path/corpus allowlist, CORS/credential options, both hashes, no redirects
and no local fallback. They never contact GitHub or any other external host. The
70-dependency fixture references every fragment twice and asserts exactly one
descending-order chunk request per dependency, exceeding both cache limits
relevant to the original re-read failure (eight runtime slots and 64 prior
reference-reader slots).

This fixture suite is not a complete public-export or corpus-scale performance
test. After installation, separately smoke-test actual packed maps for all
three corpora, descriptor comparison/search pins, map expansion/search/source
inspection, cited PDF vs transcript-only behavior, and workbench/guide return
navigation at the real project subpath. Keep that receipt distinct from this
fixture XML; do not describe fixture passes as full-corpus publication approval.
