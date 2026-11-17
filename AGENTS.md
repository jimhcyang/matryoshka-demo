# Browser And Data Safety

Use Playwright's managed Chromium headless shell for browser checks. Never
launch installed Google Chrome, attach a personal profile, or terminate the
user's browser. Install the managed shell with
`python -m playwright install chromium --only-shell` if needed.

This is a saved, static presentation export. It must not contain model API
credentials or a live inference proxy. Preserve source quotations, hashes,
historical cutoffs and whole-origin exclusion. Do not change saved inference,
rankings or grades to improve a presentation. Label navigation and exploratory
context separately from factual support. Public availability is not a new
declassification or third-party licensing decision.

# Corpus Release Integration

Read `docs/CORPUS_RELEASES.md` before changing graph data or rerunning the
exporters. The current Corpus Map and original saved-study graph are distinct
versioned bindings. Never replace a saved guide's graph by label-based node
matching or relabel old inference as a run on the newest alias resource.
Cooperating prepare/activate writers use `.graph-refresh.lock`; unrelated UI
writers must finish before activation snapshots their files. Changes discovered
during activation fail closed rather than overwriting another editor.
