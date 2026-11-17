# Matryoshka Public Demo

[Website (Deployment Pending)](https://jimhcyang.github.io/matryoshka-demo/) |
[Publication workflow](https://github.com/jimhcyang/matryoshka-demo/actions/workflows/pages.yml)

The repository and pinned datasets are published. The website awaits a
successful deployment workflow; use the local instructions below meanwhile.

An inspectable, saved analyst workbench for historical Iran cables, Vietnam
cables and paired-release Central Intelligence Bulletins. Tasks are hypothesis
assessment, reconstruction and redaction recovery.

This repository is the **public presentation export**, not the private research
workspace. It contains no API keys, model-call service, collaborator manuscripts,
human-review notes or complete research execution logs. Opening the website
cannot spend API credits or submit a new inference request.

## What The Demo Shows

- Eighteen curated questions representing eighteen distinct fact families.
- Three saved planning conditions per question, with their original results.
- Source quotations, explicit evidence judgments, candidate rankings and saved
  graph-relevance flow. A route or a grammatical fit does not establish a fact.
- Separate hypothesis and reconstruction examples: neither a polarity-flipped
  question nor a task-switched repetition is another presentation example.
- Partial, unsupported and contradictory outcomes remain visible. These are
  outcome-informed development examples, **not a benchmark accuracy estimate**.

The single retained Haeri hypothesis is an analyst-authored negative proposition
that the eligible evidence can oppose. Its affirmative and reconstruction
companions remain in the local research archive, not this public casebook.

## Run Locally

Use a modern browser with Web Crypto and gzip decompression support. Serve the
`site` directory over HTTP rather than opening HTML files directly:

```sh
python3 -m http.server 8080 --directory site
```

Open the server's printed URL. The same files are deployed using GitHub Pages;
project-relative URLs work without a Python backend. Do not put credentials into
the static site or add an API proxy to the public transport.
Full-map data still requires an internet connection to the pinned GitHub files;
the browser never calls a paid model API.

The full graph datasets live in `datasets/`, outside the Pages artifact. They
are independently compressed and fetched from this repository at one immutable
Git commit, with wire and decoded hashes checked in the browser. This avoids
large shared-dictionary downloads during map exploration. No GitHub API token
is needed. A full clone includes these data files and is much larger than the UI.

## Provenance And Reproducibility

`site/publication.json` lists the exported file hashes, source release basis,
case families, parent report commitment and public transport transformations.
The API index maps finite, canonical saved requests to verified data files.
Missing or changed packets fail closed; no other condition is substituted.

Original inference checkpoints, grades, source extraction, aliases and hierarchy
are not changed by export. The public transport has new hashes rather than
pretending an edited public file is the original sealed research artifact.
An inference receipt is explicitly not the complete native checkpoint download.

Route cards prefer distinct, straightforward three- or four-edge witnesses
where available, with no repeated states or community re-entry and at most one
hierarchy rise/fall. Longer simple source chains remain possible. This is a
bounded presentation choice over the saved graph, not a retrieval improvement
or new factual proof. Short paths are retained honestly where appropriate.

Evidence uses strict query-date cutoffs and whole-origin-document exclusion.
CIB evidence is earlier-visible; cable evidence follows the saved historical
classification/handling policy. The separate Corpus Map has its own declared
exploration scope. Entity identities and hierarchy are retrospective.

## Maintainer Checks

```sh
python3 -m pip install -r requirements-dev.txt
python3 -m pytest -q tests
python3 tools/validate_publication.py --site site --base-path /matryoshka-demo/
```

The exporter requires the original local source workspace and its pinned saved
artifacts. It does not rerun extraction, aliasing, retrieval, ranking or grading.
Publication checks verify declarations and bytes; they are not a legal opinion,
independent historical identity audit or proof of model generalization.

Managed-browser fixture checks are documented in `runtime/tests/README.md`.
Use the managed Chromium headless shell, never a personal Chrome profile.

## Rights

See `site/NOTICES.txt`. This public demo does not grant a new blanket license to
underlying source documents, third-party assets or the private research corpus.
Historical source classification labels are preserved; public availability is
not represented as a new declassification decision by this project.
