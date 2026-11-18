"""Finite, offline export of an explicitly pinned current Viewer report.

Default is a write-free dry run. --execute stages saved responses and resumes
sealed cases; report/index are installed only after the complete closure passes.
No graph search, inference, API transport, pruning or publication is performed.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import fcntl
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from types import FunctionType, MethodType
from urllib.parse import urlencode


def _module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BASE = _module('current_export_transport', Path(__file__).with_name('export_replays.py'))
GUARD = _module('current_export_privacy', Path(__file__).with_name('validate_publication.py'))
VERSION = 'public-current-replays/1'
sha, encoded, public_metadata = BASE.sha, BASE.encoded, BASE.public_metadata
DEFAULTS = dict(max_cases=15, max_conditions=45, max_requests=100000,
    max_sources=100000, max_nodes=50000, max_new_bytes=1500000000,
    max_packet_bytes=210000000, min_free_bytes=8*1024**3)
COMMON = ('resource_id', 'registry_sha256', 'index_sha256')
ALLOWED = {'condition-v6', 'origin-v63', 'postrun-review', 'flow-v6',
    'guide-v6', 'guide-overlay-v64', 'guide-overlay-v63', 'guide-view-v6', 'source-v6', 'node-v6'}


def require(value, message):
    if not value:
        raise ValueError(message)


def path_at(root, relative):
    require(isinstance(relative, str) and relative and '\\' not in relative
        and not Path(relative).is_absolute() and all(p not in {'', '.', '..'} for p in relative.split('/')),
        'Unsafe relative export/reference path')
    path = root/relative
    require(path.resolve() == path, 'Symlink/redirected export path')
    return path


def checked(root, reference):
    raw = path_at(root, reference['path']).read_bytes()
    require(sha(raw) == reference['sha256'], 'Explicit source byte pin changed')
    return GUARD.parse_json(gzip.decompress(raw) if reference['path'].endswith('.gz') else raw)


def source_reference_path(root, relative):
    # These source-admission references explicitly use the parent workspace,
    # unlike current publication/native references. Never search both roots.
    owner = root.parent if relative.startswith(('src-redaction/', 'source_aliasing_paper/')) else root
    return path_at(owner, relative)


def write_once(path, raw):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        require(path.read_bytes() == raw, 'Immutable export artifact differs')
        return
    descriptor, name = tempfile.mkstemp(prefix='.current-export-', dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            require(path.read_bytes() == raw, 'Concurrent immutable export differs')
    finally:
        temporary.unlink(missing_ok=True)


def seal(value):
    return dict(value, sha256=sha(encoded(value)))


def read_sealed(path):
    value = GUARD.parse_json(path.read_bytes())
    require(value['sha256'] == sha(encoded({k:v for k,v in value.items() if k != 'sha256'})),
        'Export checkpoint seal changed')
    return value


def refs(value):
    if isinstance(value, dict):
        if isinstance(value.get('path'), str) and isinstance(value.get('sha256'), str):
            yield value
        for child in value.values():
            yield from refs(child)
    elif isinstance(value, list):
        for child in value:
            yield from refs(child)


def route(endpoint, params):
    require(endpoint in ALLOWED or endpoint in {'native-v6','cib-pdf'}, 'Unsupported UI endpoint')
    return '/api/current/'+endpoint+'?'+urlencode(sorted((k, str(v)) for k,v in params.items()))


def public(value):
    value = public_metadata(value)
    GUARD.scan_json(value, None)
    return value


def native_receipt(condition, config, item):
    saved = condition['configurations'][config]
    return dict(version=VERSION, kind='PUBLIC_INFERENCE_RECEIPT_NOT_FULL_NATIVE_CHECKPOINT',
        case=deepcopy(condition['case']), config=config, resource_binding=deepcopy(condition['resource_binding']),
        native_checkpoint=deepcopy(item['native_checkpoint']), native_checksum=saved['native_checksum'],
        checksum_scope='Original full native result, NOT this smaller public receipt',
        plan=deepcopy(saved.get('plan')), result=deepcopy(saved['result']),
        local_decisions_v65=deepcopy(saved.get('local_decisions_v65')),
        omitted=['Non-display native audit arrays', 'Full kernel and candidate-flow arrays',
                 'Private machine metadata and API receipt bodies'],
        full_checkpoint_exported=False, native_outputs_modified=False)


def bound_unresolved_audits(value):
    """Presentation-only samples of rejected comparisons; never signed evidence."""
    if isinstance(value,list):
        return [bound_unresolved_audits(v) for v in value]
    if not isinstance(value,dict):
        return value
    result = {}
    for key, child in value.items():
        if key == 'unresolved_checks' and isinstance(child,list) and len(child)>3:
            require(not any(isinstance(v,dict) and str(v.get('direction','')).upper() in
                {'SUPPORT','COUNTER','PARTIAL','FOR','AGAINST','SOME'} for v in child),
                'Signed evidence cannot be hidden as an unresolved-comparison audit')
            result[key] = [bound_unresolved_audits(v) for v in child[:3]]
            result['unresolved_check_audit'] = dict(total_rows=len(child),shown_rows=3,
                sha256=sha(encoded(child)),selection='First three native rows, not ranked or selected for outcome',
                note='The complete unresolved/rejected-comparison audit remains in the original native checkpoint; no decision or signed evidence is omitted by this audit-only bound.')
        else:
            result[key] = bound_unresolved_audits(child)
    return result


def display_flow(value):
    """Keep the full drawing; leave redundant non-display edge audits native."""
    result = dict(value)
    result['edges'] = [{key:deepcopy(child) for key,child in edge.items() if key != 'native_source_assertions'}
        for edge in value.get('edges', [])]
    result['public_projection'] = dict(version='current-finite-flow-display/1',
        source_payload_sha256=sha(encoded(value)), omitted_fields=['edges[].native_source_assertions'],
        masses_frames_nodes_routes_and_display_citations_unchanged=True, native_outputs_modified=False,
        note='Redundant full native edge-audit arrays remain in the original checkpoint. Displayed source citations, routes and all numerical frames are unchanged.')
    return result


def display_node(node, edges, case, binding):
    relevant = []
    for edge in edges:
        if node['id'] not in (edge['source'],edge['target']):
            continue
        row = {key:deepcopy(edge[key]) for key in ('id','source','target','kind','relation','transition') if key in edge}
        row['citations'] = deepcopy(edge.get('citations', []))
        relevant.append(row)
    return dict(node={key:deepcopy(node[key]) for key in ('id','label','type') if key in node},
        edges=relevant, cutoff=case['date'], whole_origin_excluded=case['document_id'],
        resource_binding=deepcopy(binding), scope='SAVED_DISPLAY_PROJECTION_ONLY',
        note='Only source connections and display citations in the saved projection are included. Complete native edge audits and unrestricted corpus navigation remain separate; no new factual support is inferred.')


class FlowReads:
    """Two exact saved-flow objects; no Viewer/module global is patched."""
    def __init__(self, publication, allowed):
        self.publication, self.allowed, self.cache = publication, allowed, {}

    def __getattr__(self, name):
        return getattr(self.publication, name)

    def read(self, root, ref):
        if ref['path'] not in self.allowed:
            return self.publication.read(root, ref)
        path = path_at(Path(root), ref['path'])
        stat = path.stat()
        stamp = ref['sha256'], stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_ino
        old = self.cache.get(ref['path'])
        if old is None or old[0] != stamp:
            value = self.publication.read(root, ref)
            if len(self.cache) == 2:
                self.cache.pop(next(iter(self.cache)))
            self.cache[ref['path']] = stamp, value
        return self.cache[ref['path']][1]


def viewer_for(root, report_ref):
    sys.path.insert(0, str(root))
    from matryoshka_current.server import Viewer
    import matryoshka_current.server as server
    require(Path(server.__file__).resolve() == root/'matryoshka_current/server.py',
        'Current Viewer was imported from another workspace')
    viewer = Viewer(root, report_ref, maps=None)
    allowed = {r['path'] for row in viewer.report['cases'] for item in row['configurations'].values()
        for field in ('flow_refs', 'compact_flow_refs') for r in item.get(field, {}).values()}
    namespace = dict(Viewer.api.__globals__, publication=FlowReads(server.publication, allowed))
    viewer.api = MethodType(FunctionType(Viewer.api.__code__, namespace, Viewer.api.__name__,
        Viewer.api.__defaults__, Viewer.api.__closure__), viewer)
    return viewer


class ReadoutCache:
    """Reuse immutable case membership and already verified route/source readouts."""
    def __init__(self):
        self.guides, self.overlays, self.sources, self.active = {}, {}, {}, {}
        self.source_values, self.views = {}, {}

    def close(self):
        for view in self.views.values():
            view.__exit__(None, None, None)
        self.views.clear()

    def source(self, viewer, params):
        from matryoshka_current import inspection
        row, _, _, _, native = viewer.select({k:[str(v)] for k,v in params.items()})
        context = viewer.source_context(native)
        scope = sha(encoded(dict(case=row['case'],binding=row['resource_binding'])))
        key = scope, params['source_id']
        if key not in self.source_values:
            if scope not in self.views:
                self.views[scope] = inspection._View(context,row['case'])
            view = self.views[scope]
            class BorrowedView:
                def __enter__(self): return view
                def __exit__(self, *_): pass
            original = inspection.source
            function = FunctionType(original.__code__, dict(original.__globals__,_View=lambda *_:BorrowedView()),
                original.__name__, original.__defaults__, original.__closure__)
            self.source_values[key] = function(context,row['case'],params['source_id'])
        return self.source_values[key]

    @staticmethod
    def guide_key(params):
        return tuple(params.get(k, '') for k in ('case_id','config','reading','candidate_id','route_index'))

    def overlay(self, viewer, params):
        from matryoshka_current import inspection
        row, _, _, _, native = viewer.select({k:[str(v)] for k,v in params.items()})
        context = viewer.source_context(native)
        cache = self.active
        class CachedView(inspection._View):
            @property
            def active(self):
                key = sha(encoded(dict(binding=self.binding,case=self.case)))
                if key not in cache:
                    cache[key] = frozenset(super().active)
                return cache[key]
        original = inspection.guide_overlay
        namespace = dict(original.__globals__, _View=CachedView)
        function = FunctionType(original.__code__, namespace, original.__name__, original.__defaults__,original.__closure__)
        return function(context,row['case'],self.guides[self.guide_key(params)])

    def source_view(self, params):
        overlay = self.overlays[self.guide_key(params)]
        source = self.sources[params['case_id'],params['config'],params['source_id']]
        keys = ('version','binding','resource_binding','index_ref','registry_ref','cutoff',
            'whole_origin_excluded','scope','retrospective_identities_and_hierarchy','task_support_assessed')
        return dict(**{k:deepcopy(overlay[k]) for k in keys},
            page={k:deepcopy(v) for k,v in source.items() if k != 'document_pages'},
            document_pages=deepcopy(source['document_pages']))


class Export:
    def __init__(self, root, report_ref, site, index_sha256, *, limits=None,
                 node_scope='displayed', viewer_factory=viewer_for, resume_export=None):
        self.root, self.site = Path(root).resolve(), Path(site).resolve()
        self.reference, self.index_sha = deepcopy(report_ref), index_sha256
        self.limits = dict(DEFAULTS, **(limits or {}))
        require(set(self.limits) == set(DEFAULTS) and all(type(v) is int and v > 0 for v in self.limits.values()),
            'Positive explicit export budgets required')
        require(node_scope in {'routes', 'displayed'}, 'Unknown finite node scope')
        self.node_scope = node_scope
        self.report = checked(self.root, report_ref)
        require(self.report.get('version') == 'current-workbench-publication/1'
            and self.report.get('sha256') == sha(encoded({k:v for k,v in self.report.items() if k != 'sha256'})),
            'Explicit current report seal/version differs')
        self.rows = self.report['cases']
        require(len({r['case']['case_id'] for r in self.rows}) == len(self.rows) <= self.limits['max_cases'],
            'Duplicate cases or case budget exceeded')
        require(sum(len(r['configurations']) for r in self.rows) <= self.limits['max_conditions'],
            'Condition budget exceeded')
        self.code = {str(p):sha(p.read_bytes()) for p in (Path(__file__), Path(BASE.__file__), Path(GUARD.__file__))}
        self.identity = dict(version=VERSION, source_report_ref=report_ref, before_index_sha256=index_sha256,
            limits=self.limits, node_scope=node_scope, exporter_code_sha256=sha(encoded(self.code)))
        self.resume_stage = None
        if resume_export is not None:
            require(len(resume_export)==24 and all(c in '0123456789abcdef' for c in resume_export),'Explicit sealed export ID required')
            self.resume_stage = self.site.parent/'.current-replay-export'/resume_export
            identity_raw = (self.resume_stage/'identity.json').read_bytes()
            previous = read_sealed(self.resume_stage/'identity.json')
            require(sha(encoded({k:v for k,v in previous.items() if k!='sha256'}))[:24] == resume_export,
                'Imported transport identity differs from explicit export ID')
            require(all(previous[k] == self.identity[k] for k in ('version','source_report_ref','before_index_sha256','node_scope')),
                'Imported transport belongs to another report/index/scope')
            self.identity['explicitly_trusted_transport'] = dict(export_id=resume_export,identity_sha256=sha(identity_raw),
                original_exporter_code_sha256=previous['exporter_code_sha256'])
        self.identifier = sha(encoded(self.identity))[:24]
        self.stage = self.site.parent/'.current-replay-export'/self.identifier
        self.viewer_factory, self.viewer = viewer_factory, None
        self.entries, self.unavailable = {}, []
        self.requests, self.sources, self.nodes = 0, 0, 0
        self.object_bytes = 0
        self.previous_entries = {}
        self.readouts = ReadoutCache()
        self.imported = []

    def pins(self, row):
        pins = {}
        for ref in refs(row):
            path = source_reference_path(self.root, ref['path'])
            require(path.is_file() and sha(path.read_bytes()) == ref['sha256'], 'Case input byte pin changed')
            pins[ref['path']] = ref['sha256']
        for config in row['configurations']:
            params = self.params(row, config)
            _, _, _, _, native = self.viewer.select({k:[str(v)] for k,v in params.items()})
            # Opening the explicit context verifies source/index bindings on
            # resume too; it does not reconstruct, rank, infer or call a model.
            self.viewer.source_context(native)
            for ref in (native['registry_ref'], native['index_ref']):
                path = path_at(self.root, ref['path'])
                require(sha(path.read_bytes()) == ref['sha256'], 'Current context input changed')
                pins[ref['path']] = ref['sha256']
        return pins

    @staticmethod
    def params(row, config):
        return dict(case_id=row['case']['case_id'], config=config,
            **{k:row['resource_binding'][k] for k in COMMON})

    def put(self, key, value):
        raw = encoded(public(value))
        if len(raw) > self.limits['max_packet_bytes'] and key.startswith(('/api/current/condition-v6?', '/api/current/native-v6?')):
            value = bound_unresolved_audits(value)
            value['public_audit_projection'] = dict(version='bounded-unresolved-comparison-audit/1',
                original_public_payload_sha256=sha(raw),trigger='Declared transport packet budget',
                decisions_signed_evidence_and_native_outputs_unchanged=True)
            raw = encoded(public(value))
        require(len(raw) <= self.limits['max_packet_bytes'], 'Decoded packet budget exceeded')
        wire = gzip.compress(raw, compresslevel=6, mtime=0)
        require(len(wire) < 95000000, 'Stored packet exceeds Pages file budget')
        entry = dict(path='data/replays/'+sha(wire)+'.json.gz', sha256=sha(raw),
            wire_sha256=sha(wire), encoding='gzip', mime='application/json')
        require(key not in self.entries or self.entries[key] == entry, 'Conflicting finite route key')
        target = self.stage/'objects'/Path(entry['path']).name
        exists = target.exists()
        write_once(target, wire)
        if not exists:
            self.object_bytes += len(wire)
        self.entries[key] = entry
        require(self.object_bytes <= self.limits['max_new_bytes'],
            'New transport byte budget exceeded; sealed cases retained')
        return value

    def call(self, endpoint, params):
        require(endpoint in ALLOWED, 'Unsupported UI endpoint')
        self.requests += 1
        require(self.requests <= self.limits['max_requests'], 'Finite request budget exceeded')
        if endpoint == 'guide-overlay-v64' and hasattr(self.viewer,'source_context') and self.viewer_factory is viewer_for:
            value = self.readouts.overlay(self.viewer,params)
        elif endpoint == 'guide-view-v6' and params.get('phase') == 'source' and self.viewer_factory is viewer_for:
            value = self.readouts.source_view(params)
        elif endpoint == 'source-v6' and self.viewer_factory is viewer_for:
            value = self.readouts.source(self.viewer,params)
        else:
            value = self.viewer.api(endpoint, {k:[str(v)] for k,v in params.items()})
        if endpoint == 'guide-v6':
            self.readouts.guides[self.readouts.guide_key(params)] = value
        elif endpoint == 'guide-overlay-v64':
            self.readouts.overlays[self.readouts.guide_key(params)] = value
        elif endpoint == 'source-v6':
            self.readouts.sources[params['case_id'],params['config'],params['source_id']] = value
        if endpoint == 'flow-v6':
            value = display_flow(value)
        return self.put(route(endpoint, params), value)

    def pdf_alias(self, params, document, release):
        legacy = '/api/cib-pdf?'+urlencode(sorted(dict(doc_id=document,release=release).items()))
        entry = self.previous_entries.get(legacy)
        if entry is None:
            return
        require(entry.get('mime') == 'application/pdf' and entry.get('encoding') == 'identity',
            'A PDF alias requires an original identity-encoded public PDF')
        raw = path_at(self.site, entry['path']).read_bytes()
        require(raw.startswith(b'%PDF-') and sha(raw) == entry['sha256'] == entry['wire_sha256'],
            'Existing source PDF hash changed')
        self.entries[route('cib-pdf',dict(params,doc_id=document,release=release))] = deepcopy(entry)

    def one_case(self, row):
        self.readouts.close()
        self.readouts = ReadoutCache()
        start_entries, start_unavailable = set(self.entries), len(self.unavailable)
        start_counts = self.requests, self.sources, self.nodes
        pins = self.pins(row)
        checkpoint = self.stage/'cases'/(sha(encoded(row['case']['case_id']))+'.json')
        checkpoint_stage = self.stage
        if not checkpoint.exists() and self.resume_stage is not None:
            imported = self.resume_stage/'cases'/checkpoint.name
            if imported.exists():
                checkpoint, checkpoint_stage = imported,self.resume_stage
                self.imported.append(dict(case_id=row['case']['case_id'],checkpoint_sha256=sha(imported.read_bytes()),
                    original_export_id=self.identity['explicitly_trusted_transport']['export_id'],old_seal_modified=False))
        if checkpoint.exists():
            old = read_sealed(checkpoint)
            require(old['input_pins'] == pins and old['case_sha256'] == sha(encoded(row)), 'Stale per-case export seal')
            for key, entry in old['entries'].items():
                if entry.get('mime') == 'application/pdf':
                    wire = path_at(self.site,entry['path']).read_bytes()
                    require(sha(wire) == entry['wire_sha256'] == entry['sha256'], 'Resumed source PDF changed')
                    self.entries[key] = entry
                    continue
                wire = (checkpoint_stage/'objects'/Path(entry['path']).name).read_bytes()
                require(sha(wire) == entry['wire_sha256'] and sha(gzip.decompress(wire)) == entry['sha256'],
                    'Resumed response object changed')
                if checkpoint_stage != self.stage:
                    target = self.stage/'objects'/Path(entry['path']).name
                    if not target.exists():
                        self.object_bytes += len(wire)
                    write_once(target,wire)
                    require(self.object_bytes <= self.limits['max_new_bytes'],'Imported transport exceeds byte budget')
                self.entries[key] = entry
            self.unavailable.extend(old['unavailable'])
            self.requests += old['counts'][0]; self.sources += old['counts'][1]; self.nodes += old['counts'][2]
            require(self.requests <= self.limits['max_requests'] and self.sources <= self.limits['max_sources']
                and self.nodes <= self.limits['max_nodes'], 'Resumed closure exceeds budget')
            return
        for config, item in row['configurations'].items():
            print('  exporting '+config,flush=True)
            params = self.params(row, config)
            condition = self.call('condition-v6', params)
            self.put(route('native-v6', params), native_receipt(condition, config, item))
            sources = BASE.proof_ids(condition['configurations'][config])
            nodes, guide_sources, projected = set(), [], {}
            projected_edges = {}
            origins = row.get('origin_refs', {})
            states = origins.get('by_arm', {}).get(config, {}) if 'by_arm' in origins else origins
            for state, reveal in (('masked',0), ('revealed',1)):
                if state in states:
                    self.call('origin-v63', dict(params, reveal_focal=reveal))
                    if row['case']['corpus'] == 'cib':
                        self.pdf_alias(params,row['case']['document_id'],'later' if reveal else 'earlier')
                else:
                    self.unavailable.append(dict(case_id=row['case']['case_id'], config=config,
                        endpoint='origin-v63', state=state, reason='NO_PUBLISHED_ARM_ORIGIN_REFERENCE'))
            for reveal in (0,1):
                review = self.call('postrun-review', dict(params, reveal=reveal))
                sources.update(BASE.proof_ids(review))
            for reading in item['flow_refs']:
                for limit in (256,1024,2048):
                    flow_params = dict(params, reading=reading, limit=limit)
                    flow = self.call('flow-v6', flow_params)
                    require(flow['resource_binding'] == row['resource_binding'], 'Flow resource binding changed')
                    sources.update(BASE.proof_ids(flow))
                    if self.node_scope == 'displayed':
                        for n in flow.get('nodes', []):
                            if (not n.get('layout_only') and not n.get('readout_only')
                                    and n.get('solver_state') is not False
                                    and str(n.get('type','')).lower() not in {'query','domain','theme','community'}):
                                nodes.add(n['id'])
                                projected[n['id']] = n
                        for edge in flow.get('edges', []):
                            if edge.get('kind') == 'SOURCE':
                                projected_edges[sha(encoded(edge))] = edge
                for candidate in flow.get('candidates', [])[:5]:
                    routes, seen = [], set()
                    for saved_route in candidate.get('represented_routes', candidate.get('routes', [])):
                        key = saved_route.get('route_kind'), tuple(n['id'] for n in saved_route['nodes'])
                        if key not in seen:
                            routes.append(saved_route); seen.add(key)
                        if len(routes) == 3: break
                    if not routes:
                        self.unavailable.append(dict(case_id=row['case']['case_id'], config=config,
                            reading=reading, candidate_id=candidate['id'], endpoint='guide-v6', reason='NO_SAVED_ROUTE'))
                    for route_index, saved_route in enumerate(routes):
                        args = dict(params, reading=reading, candidate_id=candidate['id'], route_index=route_index)
                        guide = self.call('guide-v6', args)
                        overlay = self.call('guide-overlay-v64', args)
                        self.entries[route('guide-overlay-v63', args)] = self.entries[route('guide-overlay-v64', args)]
                        ids = BASE.proof_ids(guide) | BASE.proof_ids(overlay)
                        sources.update(ids)
                        guide_sources.extend((args, identity) for identity in sorted(ids))
                        if saved_route.get('route_kind') != 'LEXICAL_SOURCE_READOUT':
                            nodes.update(n['id'] for n in saved_route['nodes'])
            for identity in sorted(nodes):
                self.nodes += 1
                require(self.nodes <= self.limits['max_nodes'], 'Saved displayed/route-node budget exceeded')
                node_params = dict(params, node_id=identity)
                if identity in projected:
                    value = display_node(projected[identity],projected_edges.values(),row['case'],row['resource_binding'])
                    self.put(route('node-v6', node_params), value)
                else:
                    value = self.call('node-v6', node_params)
                sources.update(BASE.proof_ids(value))
            for identity in sorted(sources):
                self.sources += 1
                require(self.sources <= self.limits['max_sources'], 'Cited source budget exceeded')
                packet = self.call('source-v6', dict(params, source_id=identity))
                if row['case']['corpus'] == 'cib':
                    self.pdf_alias(params,packet['document_id'],'earlier')
            for args, identity in guide_sources:
                self.call('guide-view-v6', dict(args, phase='source', source_id=identity))
            print('  sealed inputs for '+config+': '+str(len(sources))+' source pages; '+str(len(nodes))+' nodes',flush=True)
        require(self.pins(row) == pins, 'Case source/native inputs changed during export')
        checkpoint_value = dict(case_sha256=sha(encoded(row)), input_pins=pins,
            entries={k:v for k,v in self.entries.items() if k not in start_entries},
            unavailable=self.unavailable[start_unavailable:],
            counts=[self.requests-start_counts[0], self.sources-start_counts[1], self.nodes-start_counts[2]])
        write_once(checkpoint, encoded(seal(checkpoint_value)))

    def run(self, *, execute=False):
        index_path = path_at(self.site, 'data/api-index.json')
        before = index_path.read_bytes()
        require(sha(before) == self.index_sha, 'Explicit existing API index byte pin differs')
        index = GUARD.parse_json(before)
        require(index['version'] == BASE.INDEX_VERSION and isinstance(index['entries'], dict), 'Unsupported API index')
        self.previous_entries = index['entries']
        if not execute:
            return dict(status='DRY_RUN_NO_WRITES', version=VERSION, source_report_ref=self.reference,
                cases=len(self.rows), conditions=sum(len(r['configurations']) for r in self.rows),
                limits=self.limits, node_scope=self.node_scope, api_calls=0,
                unsupported=['Source PDFs not already in the approved finite PDF export', 'Guide graph phases other than source',
                    'Arbitrary nodes/sources outside the declared saved closure'])
        require(shutil.disk_usage(self.site.parent).free >= self.limits['min_free_bytes'], 'Disk guard: insufficient staging headroom')
        self.stage.mkdir(parents=True, exist_ok=True)
        objects = self.stage/'objects'
        self.object_bytes = sum(p.stat().st_size for p in objects.iterdir()) if objects.exists() else 0
        with (self.stage/'export.lock').open('a+') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            write_once(self.stage/'identity.json', encoded(seal(self.identity)))
            write_once(self.stage/'before-index.json', before)
            old_report_path = path_at(self.site, 'data/report-v6.json')
            old_report = old_report_path.read_bytes() if old_report_path.exists() else None
            if old_report is not None: write_once(self.stage/'before-report.json', old_report)
            self.viewer = self.viewer_factory(self.root, self.reference)
            try:
                require(self.viewer.report == self.report, 'Viewer selected another report')
                for row in self.rows:
                    print('Exporting saved case '+row['case']['case_id'], flush=True)
                    self.one_case(row)
            finally:
                self.readouts.close()
                self.viewer.close()
            require(checked(self.root, self.reference) == self.report, 'Report changed during export')
            require(all(sha(Path(name).read_bytes()) == pin for name,pin in self.code.items()), 'Exporter/helper code changed')
            report = public(self.report)
            source_seal = report.pop('sha256')
            report.update(public_transport=VERSION, seal_scope='PUBLIC_PRESENTATION_EXPORT_ONLY',
                source_report_ref=deepcopy(self.reference), source_report_sha256=source_seal,
                public_metadata_only_transformation=True, native_outputs_modified=False)
            report['sha256'] = sha(encoded(report))
            report_raw = encoded(report)
            self.put('/data/report-v6.json', report)
            versioned = 'data/current-reports/'+sha(report_raw)+'.json'
            health = dict(status='ok', service='current-resource-workbench', live_inference=False,
                static_publication=True, cases=len(self.rows), report_ref=dict(path='data/report-v6.json',sha256=sha(report_raw)),
                source_report_ref=deepcopy(self.reference), public_transport=VERSION, api_calls=0)
            self.put('/api/health', health)
            lineage = dict(version=VERSION, identity=self.identity, before_index_sha256=self.index_sha,
                previous_report_sha256=sha(old_report) if old_report is not None else None,
                source_report_ref=self.reference, public_report_ref=dict(path=versioned,sha256=sha(report_raw)),
                routes=len(self.entries), counts=dict(requests=self.requests,sources=self.sources,nodes=self.nodes),
                unavailable=self.unavailable, node_scope=self.node_scope, guide_view_phases=['source'],
                unsupported=['Source PDFs not already in the approved finite PDF export', 'Guide graph phases other than source',
                    'Arbitrary nodes/sources outside the declared saved closure'], api_calls=0,
                old_objects_deleted=False, selection_approval_asserted=False,
                imported_transport_checkpoints=self.imported,
                requires_publication_inventory_and_possible_legacy_pruning=True)
            new_index = deepcopy(index)
            for key, entry in self.entries.items():
                require(key.startswith('/api/current/') or key in {'/api/health','/data/report-v6.json'}, 'Forbidden index replacement')
                new_index['entries'][key] = entry
            write_once(self.stage/'completed.json', encoded(seal(dict(lineage=lineage, entries=self.entries))))
            # Active index/report are not touched until every case and object
            # passed. Cooperating map writers share this installation lock.
            with (self.site.parent/'.graph-refresh.lock').open('a+') as install_lock:
                fcntl.flock(install_lock, fcntl.LOCK_EX)
                require(index_path.read_bytes() == before, 'Concurrent API index update; no pointers installed')
                require((old_report_path.read_bytes() if old_report_path.exists() else None) == old_report,
                    'Concurrent active report update; no pointers installed')
                for entry in self.entries.values():
                    if entry.get('mime') == 'application/pdf':
                        raw = path_at(self.site,entry['path']).read_bytes()
                        require(sha(raw) == entry['wire_sha256'], 'Existing source PDF changed before installation')
                        continue
                    raw = (self.stage/'objects'/Path(entry['path']).name).read_bytes()
                    require(sha(raw) == entry['wire_sha256'], 'Staged object changed before installation')
                    write_once(path_at(self.site, entry['path']), raw)
                write_once(path_at(self.site, versioned), report_raw)
                write_once(path_at(self.site, 'data/current-exports/'+self.identifier+'.json'), encoded(seal(lineage)))
                BASE.atomic(old_report_path, report_raw)
                BASE.atomic(index_path, encoded(new_index))
            return dict(status='EXPORTED', source_report_ref=self.reference, public_report_ref=health['report_ref'],
                index_sha256=sha(encoded(new_index)), export_id=self.identifier, routes=len(self.entries),
                stage=str(self.stage), api_calls=0, unsupported=lineage['unsupported'])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--report', required=True)
    parser.add_argument('--report-sha256', required=True)
    parser.add_argument('--site', type=Path, required=True)
    parser.add_argument('--index-sha256', required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--dry-run', action='store_true')
    mode.add_argument('--execute', action='store_true')
    parser.add_argument('--node-scope', choices=('routes','displayed'), default='displayed')
    parser.add_argument('--resume-export-id',help='Explicit trusted sealed transport checkpoints; original seals remain unchanged')
    for name, default in DEFAULTS.items():
        parser.add_argument('--'+name.replace('_','-'), type=int, default=default)
    args = parser.parse_args(argv)
    exporter = Export(args.root, dict(path=args.report,sha256=args.report_sha256), args.site,
        args.index_sha256, limits={k:getattr(args,k) for k in DEFAULTS}, node_scope=args.node_scope,resume_export=args.resume_export_id)
    print(json.dumps(exporter.run(execute=args.execute),sort_keys=True))


if __name__ == '__main__':
    main()
