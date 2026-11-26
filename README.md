# Matryoshka Public Demo

[Website](https://jimhcyang.github.io/matryoshka-demo/) | [Publication workflow](https://github.com/jimhcyang/matryoshka-demo/actions/workflows/pages.yml)

A source-linked analyst workbench for historical Central Intelligence Bulletins, Iran cables and Vietnam cables. Nine primary examples cover Mosaic, Hypothesis and Redaction in each corpus. Five additional authentic CIB redactions revisit historical recovery examples. One separately registered visiting-delegation input completes the fifteen-input presentation. These curated examples are not a blind accuracy benchmark or a claim that every case is solved.

| Collection | What to inspect |
| --- | --- |
| CIB / Cold War decisions | A Mosaic establishes two announced Soviet withdrawal quantities, not completed withdrawals. A separate Hypothesis retains Mao's conditional assessment of Taiwan talks. The Salvadoran redaction ranks "easily politically manipulated" first with eligible support. |
| Iran / opposition and authority | Both Tehrani Mosaic facts are established. The Shah command Hypothesis remains partial, and Yazdi ranks third contextually. |
| Vietnam / military reporting | Both March 19 Mosaic facts are established from one same-day witness. One of two Highlands Hypothesis facts is supported. The Spratly fill "UNOCCUPIED" ranks fifth in the displayed adjectival reading. |
| Additional CIB recoveries | Arias, air-force commander, Betancourt, corrupt and a Tunisian clausal fill. Displayed readings and source labels remain explicit; historical recoveries do not guarantee present factual support. |
| Visiting-delegation study | "Swedish" ranks second in the retained first-gap reading, derived from quotations in the registered source-corpus study. The withheld reference answer remains unknown. |

The workbench presents the input, facts, saved routes, matched quotations and local verdict. Known redaction references can be revealed and hidden again. Scores are deterministic terminal evidence-and-fit indices, not calibrated probabilities. A contextual candidate can rank highly without receiving an evidence-backed recommendation.

All fifteen displayed inputs have completed native executions with their own pinned code and source bindings. The release contains multiple recorded engine versions; the downloadable current engine is not retroactively attributed to older executions. These are curated results, not a matched comparison of planning methods. Unresolved findings remain visible rather than being replaced with model-assigned success labels.

The requested all-success showcase and 50-percent recovery target have not been achieved. The fixed 31-case development cohort has four whole-answer primary top-five recoveries; the shorter-window comparison has two. Aung Gyi is not in the current top ten and is archived rather than shown as a successful case. Some displayed redactions remain contextual, not evidence-backed. These are development results, not held-out benchmark accuracy.

Read the [methods and case guide](https://jimhcyang.github.io/matryoshka-demo/docs/matryoshka-guide.pdf) for retrieval, local grammar, scoring, hierarchy navigation and source requirements. Routes, graph relevance, grammatical fit and saved model summaries do not independently establish facts. Hierarchy and identity assignments are retrospective.

The [KG interaction addendum](https://jimhcyang.github.io/matryoshka-demo/docs/kg-patch-addendum.pdf) covers view-local node sizes, neighborhood rings and motion, synchronized paired controls and source-visible Redacted Slots. All 28,201 CIB slot locations are preserved; Iran and Vietnam have no observed mask markers in their bound exports. Slot links are navigation only, not hidden identities or case evidence. Historical native packets are preserved separately from the current executions.

[Download the contained code snapshot](https://jimhcyang.github.io/matryoshka-demo/downloads/matryoshka-code.zip) or open the [withheld delegation study](https://jimhcyang.github.io/matryoshka-demo/swedish-study.html). The study retrieves a registered complete later-release document and derives candidate wording from its quotations. The withheld identity remains unknown. The code snapshot preserves current and historical engine provenance separately; it excludes credentials and private Live history.

The report-bound guide above is the active methods reference. Older comparison and scoring notes are historical records, not evidence that an archived input or engine version is active.
The [registered source package](https://jimhcyang.github.io/matryoshka-demo/downloads/registered-cib-full-source.zip) contains the complete 17-page later edition, its transcripts and provenance checks.

## Static replay and provenance

The five additional CIB examples currently save document handoffs, not graph
traversals: all 37 saved paths across their fourteen readings have zero graph
hops. Their source quotations are replayed exactly. The independent Corpus Map
still supports hierarchy and neighborhood navigation, but that interface test
is not evidence that these retrieval runs traversed graph edges.

This repository contains a finite public presentation export and no provider API key. The optional Live page connects to an authenticated, separately configured private backend; GitHub Pages alone cannot execute paid inference. Completed Live queries expand into the same workbench and can be reopened from that tab's bounded session history. `site/publication.json` identifies the exact served report, public transformations, file hashes and immutable graph dataset binding. A push is not proof of deployment; the workflow must succeed and the live manifest must match.

Ordinary evidence is dated on or before the input's source date. CIB admits earlier-release or jointly visible text, including the earlier version of the source document. Iran and Vietnam admit eligible CONFIDENTIAL documents while excluding the whole SECRET origin. The separate delegation study registers its exact supplied later-edition source package and is not counted in the ordinary 31-case evaluation. Merely inspecting a later PDF does not change a case's recorded evidence policy.

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
