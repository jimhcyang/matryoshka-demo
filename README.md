# Matryoshka Public Demo

[Website](https://jimhcyang.github.io/matryoshka-demo/) | [Publication workflow](https://github.com/jimhcyang/matryoshka-demo/actions/workflows/pages.yml)

A source-linked analyst workbench for historical Central Intelligence Bulletins, Iran cables and Vietnam cables. Nine primary examples cover Mosaic, Hypothesis and Redaction in each corpus. Five additional authentic CIB redactions preserve successful historical recoveries. A separate Swedish-delegation study provides two independently executed masked queries and an archived evidence-view comparison. These curated examples are not a blind accuracy benchmark or a claim that every case is solved.

| Collection | What to inspect |
| --- | --- |
| CIB / El Salvador | A complementary two-document Mosaic, a reported appointment Hypothesis and the rank-one evidence-backed property "easily politically manipulated". |
| Iran / opposition and authority | Two source-identified organizational roles, a source-ascribed teaching relationship and a contextual rank-one Yazdi proposal. The teaching evidence is a forwarded statement, not independently verified world truth. |
| Vietnam / military command | Two earlier command identifications, a supported historical-role Hypothesis and the rank-one contextual fill "MR IV CHIEF OF STAFF". Earlier role evidence does not establish the later action or continued tenure. |
| Additional CIB recoveries | Arias, air-force commander, Betancourt, corrupt and Aung Gyi: complete reviewed recoveries within five in their preserved historical runs, not five new evidence-backed results. |
| Swedish study | Two masked positions use later-release prior documents plus the exact origin. Both executed results remain inconclusive; hidden nationality ground truth is unknown. The earlier lexical comparison stays in a separate archive. |

The workbench presents the question, atoms, saved routes, matched quotations and local verdict. Candidate proposals appear at the results stage. The redaction reference can be revealed and hidden again. Origin documents remain excluded from eligible evidence. Ranking-position bars are ordinal display aids, not confidence or evidence-strength scores.

Seven of the nine primaries meet their source-qualified showcase checks. The Iran and Vietnam redactions recover their reference fills first but remain contextual, with explicit abstention from an evidence-backed recommendation. All fourteen saved executions are complete; these are curated arm-A results, not a matched comparison of planning methods.

Read the [illustrated methods and case guide](https://jimhcyang.github.io/matryoshka-demo/docs/matryoshka-guide.pdf) for retrieval, local grammar, scoring, hierarchy navigation and source requirements. Routes, graph relevance, grammatical fit and saved model summaries do not independently establish facts. Hierarchy and identity assignments are retrospective.

The [KG interaction addendum](https://jimhcyang.github.io/matryoshka-demo/docs/kg-patch-addendum.pdf) covers view-local node sizes, neighborhood rings and motion, synchronized paired controls, source-visible Redacted Slots and the updated Swedish study. All 28,201 CIB slot locations are preserved; Iran and Vietnam have no observed mask markers in their bound exports. Slot links are navigation only, not hidden identities or case evidence. The original fourteen ordinary outputs are unchanged.

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

Verification normally reserves 8 GiB of free disk. A bounded workstation may explicitly pass `--minimum-free-gib 3` to the integrity validator and browser smoke check; digest checks remain identical and verification stops below that reserve.

## Rights

See `site/NOTICES.txt`. Publication grants no new blanket license to underlying source documents, third-party assets or the private research corpus. Historical handling labels are preserved; public availability is not a new declassification decision.
