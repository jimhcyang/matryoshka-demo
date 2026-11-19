# Matryoshka Public Demo

[Website](https://jimhcyang.github.io/matryoshka-demo/) | [Publication workflow](https://github.com/jimhcyang/matryoshka-demo/actions/workflows/pages.yml)

A saved analyst workbench for historical Central Intelligence Bulletins, Iran cables and Vietnam cables. The current release contains the first independently reviewed three-task CIB bench narrative, **Salvadoran political vulnerability**. The existing corpus maps remain available for all three collections.

The 23-case target is partially complete: **3 released, 20 pending** (starter 0/9, bench 3/9, additional authentic CIB redactions 0/5). This curated development release is not a benchmark accuracy estimate or completion of the collection-wide quality quotas.

| Task | Saved result | Scope |
| --- | --- | --- |
| Mosaic | Evidence-backed reconstruction, 2/2 components | Two complementary earlier documents establish announced organizing plans and a reported journey; no causal join is asserted. |
| Hypothesis | Supported, 1/1 component | A source reports Colonel Alberto Escamilla's appointment as minister of interior. The question preserves “reportedly”; it does not establish actual implementation or continuing tenure. This earlier October report is a disclosed source-aware addition to the January story. |
| Redaction | Rank-one equivalent recovery; contextual, not evidence-backed | The selected adjective reading proposes “easily politically manipulated”. Three readings remain selectable; the general determiner reading is not modeled and generated no fills. Rank is not correctness. |

Opening a saved result reveals its recorded local verdict, candidate order, source-bound trace and saved model interpretation. Full story sources and the comparison reveal require completing the story attempts or explicitly revealing all story answers. Introduction text appears before source bindings are opened. Source quotations, historical cutoffs, whole-origin exclusion and exact masked/revealed coordinates remain inspectable.

Read the [walkthrough and methods guide](https://jimhcyang.github.io/matryoshka-demo/docs/matryoshka-guide.pdf) for the released cases, local requirements, retrieval, hierarchy navigation and limits. Routes, graph relevance, grammatical fit and saved model summaries do not independently establish facts. Hierarchy is retrospective navigation.

## Static replay and provenance

This repository contains a finite public presentation export. There is no model API key, inference proxy or paid browser action. `site/publication.json` identifies the exact served report, public transformations, file hashes and immutable graph dataset binding. A push is not proof of deployment; the workflow must succeed and the live manifest must match.

Original inference checkpoints and ranks are preserved in the research workspace. Public inference receipts are explicitly limited records, not complete native checkpoint downloads. Private review notes, answer-aware curation packets and API logs are excluded from the site.

The CIB map uses source-reviewed resource `cib_resource_623c60e1e128944377f0`, aliases `alias_sense_fa9fe8608add36db785f`, graph `graph_2e1f8d6c2443987c` and hierarchy `hierarchy_dcfb5058b0e6e571`. Iran and Vietnam retain their usable legacy maps and are not labeled as newly certified under the source-only CIB identity workflow. See [the release protocol](docs/CORPUS_RELEASES.md).

Large graph datasets remain outside the Pages artifact and load from one immutable Git commit with wire and decoded hashes checked in the browser. The website needs network access for those datasets. The [offline bundle builder](docs/OFFLINE_BUNDLE.md) can produce a separate fully local saved viewer.

## Run locally

```sh
python3 -m http.server 8080 --directory site
```

Open the printed HTTP URL in a modern browser with Web Crypto and gzip decompression support. Do not open HTML directly as a local file.

## Maintainer checks

```sh
python3 -m pip install -r requirements-dev.txt
python3 -m pytest -q tests
python3 tools/validate_publication.py --site site --base-path /matryoshka-demo/
```

CI verifies the full new presentation and every graph dataset hash. Its pinned full dataset privacy scan is reusable only while validator policy, notices and dataset bytes remain unchanged. Release-specific managed Chromium checks separately verify the actual three cases, source gates, readings, maps, PDF and project-relative transport.

## Rights

See `site/NOTICES.txt`. Publication grants no new blanket license to underlying source documents, third-party assets or the private research corpus. Historical handling labels are preserved; public availability is not a new declassification decision.
