# Matryoshka Public Demo

[Website](https://jimhcyang.github.io/matryoshka-demo/) | [Publication workflow](https://github.com/jimhcyang/matryoshka-demo/actions/workflows/pages.yml)

A source-linked analyst workbench for historical Central Intelligence Bulletins, Iran cables and Vietnam cables. Nine primary examples cover Mosaic, Hypothesis and Redaction in each corpus. Five additional authentic CIB redactions preserve successful historical recoveries. A separate Swedish-delegation study compares three explicitly different evidence views. These curated examples are not a blind accuracy benchmark or a claim that every case is solved.

| Collection | What to inspect |
| --- | --- |
| CIB / El Salvador | A complementary two-document Mosaic, a reported appointment Hypothesis and the rank-one evidence-backed property "easily politically manipulated". |
| Iran / opposition and authority | Two source-identified organizational roles, teaching relationships and a contextual Yazdi proposal. The Hypothesis has a separately recorded attribution-scope review hold. |
| Vietnam / military command | Two earlier command identifications, a regiment/division Hypothesis and a concealed participant. Unresolved evidence and missed targets remain visible. |
| Additional CIB recoveries | Arias, air-force commander, Betancourt, corrupt and Aung Gyi: complete reviewed recoveries within five in their preserved historical runs, not five new evidence-backed results. |
| Swedish comparison | Strict-prior earlier release, strict-prior later release, and later release plus the exact origin. The final view is a disclosed exception; hidden nationality ground truth is unknown. |

The workbench presents the question, atoms, saved routes, matched quotations and local verdict. Candidate proposals appear at the results stage. The redaction reference can be revealed and hidden again. Origin documents remain excluded from eligible evidence. Ranking-position bars are ordinal display aids, not confidence or evidence-strength scores.

Read the [illustrated methods and case guide](https://jimhcyang.github.io/matryoshka-demo/docs/matryoshka-guide.pdf) for retrieval, local grammar, scoring, hierarchy navigation and source requirements. Routes, graph relevance, grammatical fit and saved model summaries do not independently establish facts. Hierarchy and identity assignments are retrospective.

[Download the contained code snapshot](https://jimhcyang.github.io/matryoshka-demo/downloads/matryoshka-code.zip) or open the [Swedish evidence-view comparison](https://jimhcyang.github.io/matryoshka-demo/swedish-study.html). The code snapshot records the saved engines and viewing tools; it does not bundle the private research workspace or silently replace historical executions with the current engine.

## Static replay and provenance

This repository contains a finite public presentation export. There is no model API key, inference proxy or paid browser action. `site/publication.json` identifies the exact served report, public transformations, file hashes and immutable graph dataset binding. A push is not proof of deployment; the workflow must succeed and the live manifest must match.

Original inference checkpoints and ranks are preserved in the research workspace. Public inference receipts are explicitly limited records, not complete native checkpoint downloads. Private review notes, answer-aware curation packets and API logs are excluded from the site.

The CIB map uses source-reviewed resource `cib_resource_623c60e1e128944377f0`, aliases `alias_sense_fa9fe8608add36db785f`, graph `graph_2e1f8d6c2443987c` and hierarchy `hierarchy_dcfb5058b0e6e571`. Iran and Vietnam retain their usable incumbent maps and are not labeled as newly certified under the source-only CIB identity workflow. See [the release protocol](docs/CORPUS_RELEASES.md).

Large graph datasets remain in this repository's `datasets/` directory, outside the Pages artifact. The public website loads their exact immutable Git URLs and checks compressed and decoded hashes. The local server reads the same files from this checkout without an inference service or network fetch. This is a self-contained repository, not an offline-only Pages artifact.

## Run locally

```sh
python3 release-tools/serve_static.py --port 8080
```

Open `http://127.0.0.1:8080/matryoshka-demo/` in a modern browser with Web Crypto and gzip decompression support. Python 3.11 or later is sufficient for saved viewing. Do not open HTML directly as a local file. The server and datasets use only paths inside this checkout.

## Maintainer checks

```sh
python3 -m pip install -r requirements-dev.txt
python3 -m playwright install chromium --only-shell
python3 -m pytest -q runtime/tests/runtime_browser_test.py runtime/tests/runtime_fragment_test.py runtime/tests/runtime_external_test.py
python3 -m unittest discover -s release-tools/ci -p 'test_*.py'
python3 release-tools/ci/validate_manifest.py --site site --scratch /tmp/matryoshka-check --output /tmp/matryoshka-check.json
python3 release-tools/ci/browser_smoke.py --site site --output /tmp/matryoshka-browser-check
```

CI verifies the new presentation, native-result bindings and every graph dataset hash before deployment. A fresh manifest-bound publication authorization is required; a former release's approval is not reused for changed case data. Browser checks use Playwright's managed Chromium headless shell, never a personal Chrome installation. Legacy producer/export scripts remain provenance tools, not the active release validator.

## Rights

See `site/NOTICES.txt`. Publication grants no new blanket license to underlying source documents, third-party assets or the private research corpus. Historical handling labels are preserved; public availability is not a new declassification decision.
