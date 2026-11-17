#!/usr/bin/env python3
"""Read-only guard for an explicitly approved static publication.

Run: python tools/validate_publication.py --site site [--case-id approved-id ...]

publication.json contract (all paths are relative to site/):
  version, run_id, ref={run_id, sha256}, base_path='/matryoshka-demo/',
  publicness={approved:true, historical_public_sources:true,
              heldout_answers_intentionally_public:true,
              previously_public_historical_sources_only:true,
              no_private_workspace_material:true, not_a_declassification_claim:true},
  licensing={status:'approved', code:'license/basis', data:'rights summary',
             notices:['LICENSE.txt']},
  sources=[{id, publicly_released:true, provenance_url, rights_status:'approved',
            rights_basis, rights_reference}],
  case_ids=[...], cases=[{case_id, group:'presentation|bench|archive',
                         canonical_fact_family, polarity:'positive|negative|neutral|mixed'}],
  api_index='api/index.json',
  files=[{path, bytes, sha256, decoded_sha256 (required for .json.gz),
          role (optional), source_ids (required for role='source_body')}].
The inventory includes every regular file except publication.json itself.
The API index is {version:'matryoshka-public-api-index/1', entries:{
  '/api/endpoint?case_id=...&config=...':{path, sha256 (DECODED),
       wire_sha256 (required for gzip), encoding:'gzip|identity', mime}}}.
Packed entries instead use encoding='fragment-dag', path='data/packed/manifest.json',
asset=<root key>, manifest_sha256=<stored manifest hash>, sha256=<decoded root hash>.
wire_sha256 is absent/null for these entries. The sibling pack_graphs.Reader
checks the DAG. Every declared root is checked once, with only its small identity
summary retained; dictionary caches are bounded. Canonical transport hashes are
not confused with originalsha256/original_decoded_sha256 provenance hashes.
Inventory sha256 values describe stored WIRE bytes; .json.gz inventory rows
add decoded_sha256. This deliberately distinguishes the two hash contracts.
Leading '/' in logical API keys is accepted; query order is normalized.

This validates declarations, not their legal truth or semantic family assignment.
Previous public availability is not a declassification decision or a blanket
copyright license. The guard does not independently determine either.
Family IDs are supplied by curation, never inferred from names or query labels.
Source bodies remain untouched: historical SECRET/NOFORN labels are not secrets.
Generic password/path syntax is checked in metadata, not provenance-tagged source
text. Modern credential tokens/private-key blocks are rejected in any text.
No server, inference, model, credential store or network is used.

Independent full-KG datasets are outside site/: datasets/manifest.json uses
public-graph-datasets/1. validate_datasets(root, expected_manifest_sha256) and
--datasets-only verify them before a commit exists. Optional root README.md is
scanned/hashed as an ancillary notice, never a graph data URL. Dataset budgets
are <3,000,000,000 stored bytes and <95,000,000 per file, separately from Pages.
For final publication, graph_data_manifest={path:'datasets/manifest.json',sha256,
commit:<40 lowercase hex>} binds every external_url. Only exact commit-pinned
https://raw.githubusercontent.com/jimhcyang/matryoshka-demo/<commit>/datasets/
(cib|iran|vietnam)/<wire_sha256>.json.gz URLs are accepted. External entries use
encoding='gzip', mime='application/json', decoded sha256, wire_sha256, and no path.
The full checkout is verified offline; remote availability is not inferred.
Graph JSON case_ids are source provenance, not benchmark cohort membership.
DAG transport is forbidden for KG assets, condition/flow packets and graph bindings.
"""
from __future__ import annotations

import argparse
from bisect import bisect_right
import gzip
import hashlib
from functools import lru_cache
from html.parser import HTMLParser
import io
import ipaddress
import inspect
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import time
import types
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit


MAX_TOTAL_BYTES = 900_000_000
MAX_DATASET_BYTES = 3_000_000_000
MAX_FILE_BYTES = 95_000_000
MAX_DECODED_BYTES = 900_000_000
PACK_CACHE_CHUNKS = 64
METADATA_CACHE_MAXSIZE = 65536
METADATA_CACHE_MAXLEN = 2048
EXPECTED_BASE_PATH = '/matryoshka-demo/'
API_INDEX_VERSION = 'matryoshka-public-api-index/1'
DATASET_VERSION = 'public-graph-datasets/1'
DATASET_RELEASE_VERSION = 'public-graph-datasets/2'
DATASET_PROOF_VERSION = 'public-graph-dataset-privacy-pass/1'
DATASET_PATH = re.compile(r'datasets/(cib|iran|vietnam)/([a-f0-9]{64})\.json\.gz\Z')
DATASET_LOGICAL = re.compile(r'/graph-assets-v4/(cib|iran|vietnam)/[A-Za-z0-9_.-]+\.json(?:\.gz)?\Z')
DATASET_EXTERNAL = re.compile(r'https://raw\.githubusercontent\.com/jimhcyang/matryoshka-demo/'
    r'([a-f0-9]{40})/(datasets/(cib|iran|vietnam)/[a-f0-9]{64}\.json\.gz)\Z')
SUFFIXES = {'.html', '.css', '.js', '.mjs', '.json', '.svg', '.png', '.jpg',
            '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.otf',
            '.pdf', '.txt', '.md', '.xml'}
FORBIDDEN = re.compile(r'(?:^|[._-])(?:private|credentials?|receipts?|'
    r'requests|responses|logs?|manuscripts?|papers?|collab(?:orators?)?|'
    r'human[_-]?reviews?|manual[_-]?reviews?|review[_-]?queues?|adjudications?)'
    r'(?:$|[._-])', re.I)
CREDENTIAL_KEYS = {'api_key', 'apikey', 'openai_api_key', 'access_token',
    'refresh_token', 'id_token', 'authorization', 'auth_header', 'client_secret',
    'password', 'passwd', 'private_key', 'secret_key', 'aws_access_key_id',
    'aws_secret_access_key', 'aws_session_token', 'github_token'}
PRIVATE_KEYS = {'human_review', 'human_reviews', 'reviewer_email', 'reviewer_name',
                'adjudication_notes', 'collaborator_notes', 'private_notes'}
TOKEN = re.compile(r'\b(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{16,}|'
    r'gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b'
    r'|-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----'
    r'|\bBearer\s+[A-Za-z0-9_.~+/-]{16,}', re.I)
ASSIGNMENT = re.compile(r'\b(?:OPENAI_API_KEY|API_KEY|ACCESS_TOKEN|PASSWORD|'
    r'AWS_SECRET_ACCESS_KEY|CLIENT_SECRET)\s*[:=]\s*["\']?[^\s"\']+', re.I)
LOCAL_PATH = re.compile(r'(?:file://|/Users/|/home/|/private/|/var/folders/|'
                        r'[A-Za-z]:[\\/]Users[\\/])', re.I)
PRIVATE_REFERENCE = re.compile(r'(?:^|[/\\])(?:private|receipts|credentials|'
    r'manuscripts?|human[_-]?reviews?)[/\\]', re.I)
LOCAL_URL = re.compile(r'https?://(?:localhost|127(?:\.[0-9]+){0,3}|'
                       r'0\.0\.0\.0|\[::1\])(?=[:/\s]|$)', re.I)
SOURCE_TEXT = {'text', 'body', 'quote', 'raw_text', 'source_text',
               'source_wording', 'original_text'}
SOURCE_PROVENANCE = {'canonical_page_id', 'document_id', 'source_id',
                     'page_sha256', 'source_text_sha256', 'quote_sha256'}
HEX = re.compile(r'[a-f0-9]{64}\Z')
IDENTIFIER = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}\Z')
CONFIGS = {'A', 'B', 'C', 'llm_readings', 'llm_atoms', 'llm_local'}
CONFIG_ALIASES = dict(A='llm_readings', B='llm_atoms', C='llm_local')


class PublicationError(ValueError):
    """Errors name a rule, never echo candidate credentials or source text."""


def require(value, rule):
    if not value:
        raise PublicationError(rule)


def safe_path(value):
    require(isinstance(value, str) and bool(value), 'invalid relative path')
    require(re.fullmatch(r'[A-Za-z0-9_./-]+', value) is not None,
            'noncanonical path characters')
    path = PurePosixPath(value)
    require(not path.is_absolute() and path.as_posix() == value
            and all(p not in {'', '.', '..'} for p in value.split('/')),
            'path traversal or noncanonical path')
    for part in path.parts:
        require(not part.startswith('.') and not FORBIDDEN.search(part)
                and part.lower() not in {'secrets', 'secrets.json', 'secrets.txt', 'secret_keys.json'},
                'forbidden private or hidden path')
    require(not TOKEN.search(value), 'credential syntax in path')
    return value


def file_path(value):
    if value == '.nojekyll':
        return value
    safe_path(value)
    require(value.endswith('.json.gz') or PurePosixPath(value).suffix.lower() in SUFFIXES,
            'file type is not static-whitelisted')
    return value


def pairs(items):
    result = {}
    for key, value in items:
        require(key not in result, 'duplicate JSON object key')
        result[key] = value
    return result


def parse_json(raw):
    try:
        return json.loads(raw.decode('utf-8'), object_pairs_hook=pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(
                              PublicationError('nonfinite JSON number')))
    except (UnicodeError, json.JSONDecodeError, RecursionError, ValueError) as exc:
        if isinstance(exc, PublicationError):
            raise
        raise PublicationError('invalid UTF-8 JSON') from None


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read_file(path, limit):
    require(path.resolve() == path and not path.is_symlink(), 'file became symlinked')
    before = path.stat()
    require(stat.S_ISREG(before.st_mode) and before.st_size < limit, 'stored file type/size changed')
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
    with os.fdopen(os.open(path, flags), 'rb') as stream:
        opened = os.fstat(stream.fileno())
        require((opened.st_dev, opened.st_ino) == (before.st_dev, before.st_ino),
                'file changed before read')
        raw = stream.read(limit)
        after = os.fstat(stream.fileno())
    stamp = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    require(len(raw) < limit and stamp(before) == stamp(after)
            and not path.is_symlink() and stamp(path.stat()) == stamp(before), 'file changed during read')
    return raw


def identifier(value):
    return isinstance(value, str) and IDENTIFIER.fullmatch(value) is not None


def check_hash(value, expected, rule):
    require(isinstance(expected, str) and HEX.fullmatch(expected) and sha(value) == expected, rule)


def decoded(raw, compressed, limit):
    if not compressed:
        require(len(raw) < limit, 'decoded file size limit')
        return raw
    chunks, size = [], 0
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(raw)) as stream:
            while chunk := stream.read(min(1024 * 1024, limit - size)):
                size += len(chunk)
                require(size < limit, 'decoded gzip size limit')
                chunks.append(chunk)
    except (OSError, EOFError):
        raise PublicationError('invalid gzip payload') from None
    return b''.join(chunks)


def public_url(value):
    require(isinstance(value, str) and not re.search(r'[\x00-\x20\\]', value),
            'invalid public provenance URL')
    try:
        u = urlsplit(value)
        require(u.scheme in {'http', 'https'} and bool(u.hostname)
                and u.username is None and u.password is None, 'credential or nonpublic URL')
        host = u.hostname.lower()
        require(u.port is None or 0 < u.port < 65536, 'invalid public URL port')
        require(host != 'localhost' and not host.endswith(('.localhost', '.local')),
                'local URL is not public')
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            require(not re.fullmatch(r'[0-9.]+', host), 'noncanonical network address')
        else:
            require(address.is_global, 'private network URL')
    except ValueError as exc:
        if isinstance(exc, PublicationError):
            raise
        raise PublicationError('invalid public URL') from None
    return u


def _metadata_text_uncached(value, source_body=False):
    require(not TOKEN.search(value), 'credential syntax in text')
    if source_body:
        return
    for _ in range(3):
        expanded = unquote(value)
        if expanded == value:
            break
        value = expanded
    require(not LOCAL_PATH.search(value) and not PRIVATE_REFERENCE.search(value),
            'private filesystem reference in metadata')
    require(not LOCAL_URL.search(value), 'localhost URL in metadata')
    require(not ASSIGNMENT.search(value), 'credential assignment in metadata')
    if re.match(r'https?://', value, re.I):
        public_url(value)


@lru_cache(maxsize=METADATA_CACHE_MAXSIZE)
def _metadata_text_cached(value, source_body):
    return _metadata_text_uncached(value, source_body)


def metadata_text(value, source_body=False):
    # Cache only the pure literal/role predicate. Hashing, parsing, cohort and
    # sensitive-field checks remain outside this cache and always run.
    short = len(value) <= METADATA_CACHE_MAXLEN
    if short and (value.isascii() or len(value.encode('utf-8', 'surrogatepass')) <= METADATA_CACHE_MAXLEN):
        return _metadata_text_cached(value, bool(source_body))
    return _metadata_text_uncached(value, source_body)


def scan_json(value, case_ids, source_body=False):
    if isinstance(value, dict):
        source_record = bool(SOURCE_PROVENANCE & value.keys())
        for key, child in value.items():
            require(key.lower() not in CREDENTIAL_KEYS, 'credential metadata field')
            require(key.lower() not in PRIVATE_KEYS, 'private human-review metadata field')
            metadata_text(key)
            if key == 'case_id' and case_ids is not None:
                require(isinstance(child, str) and child in case_ids, 'unknown or omitted case ID')
            if key in {'case_ids', 'selected_case_ids'} and case_ids is not None:
                require(isinstance(child, list) and all(isinstance(c, str) and c in case_ids for c in child),
                        'unknown or omitted case IDs')
            scan_json(child, case_ids, source_record and key in SOURCE_TEXT and isinstance(child, str))
    elif isinstance(value, list):
        for child in value:
            scan_json(child, case_ids)
    elif isinstance(value, str):
        metadata_text(value, source_body)


def nonplaceholder(value):
    return (isinstance(value, str) and bool(value.strip()) and value.strip().lower()
            not in {'todo', 'tbd', 'unknown', 'pending', 'unreviewed', 'n/a', 'none'})


def declarations(pub, inventory, known_case_ids, expected_base_path):
    require(nonplaceholder(pub.get('version')) and identifier(pub.get('run_id')),
            'publication version/run required')
    ref = pub.get('ref')
    require(isinstance(ref, dict) and identifier(ref.get('run_id'))
            and isinstance(ref.get('sha256'), str) and HEX.fullmatch(ref['sha256']),
            'immutable parent run/ref required')
    base = pub.get('base_path')
    require(isinstance(base, str) and base.startswith('/') and base.endswith('/'),
            'canonical base_path required')
    if base != '/':
        safe_path(base[1:-1])
    require(expected_base_path is None or base == expected_base_path,
            'publication base_path differs from approved project path')
    publicness = pub.get('publicness', {})
    require(isinstance(publicness, dict) and all(publicness.get(k) is True for k in (
        'approved', 'historical_public_sources', 'heldout_answers_intentionally_public',
        'previously_public_historical_sources_only', 'no_private_workspace_material',
        'not_a_declassification_claim')), 'explicit public-source scope declarations required')
    licensing = pub.get('licensing', {})
    require(isinstance(licensing, dict) and licensing.get('status') == 'approved'
            and all(nonplaceholder(licensing.get(k)) for k in ('code', 'data')),
            'approved code/data licensing declaration required')
    notices = licensing.get('notices')
    require(isinstance(notices, list) and bool(notices)
            and all(isinstance(n, str) and n in inventory for n in notices),
            'reviewed license/notice files required')
    sources = pub.get('sources')
    require(isinstance(sources, list) and bool(sources), 'source rights/provenance records required')
    source_ids = set()
    for row in sources:
        require(isinstance(row, dict) and identifier(row.get('id'))
                and row['id'] not in source_ids, 'duplicate/invalid source ID')
        source_ids.add(row['id'])
        require(row.get('publicly_released') is True and row.get('rights_status') == 'approved'
                and nonplaceholder(row.get('rights_basis')), 'source release/rights approval required')
        public_url(row.get('provenance_url'))
        public_url(row.get('rights_reference'))
    ids = pub.get('case_ids')
    require(isinstance(ids, list) and bool(ids) and all(identifier(c) for c in ids)
            and len(set(ids)) == len(ids), 'distinct explicit public case IDs required')
    case_ids = set(ids)
    if known_case_ids is not None:
        require(case_ids == set(known_case_ids), 'approved cohort differs from known selected IDs')
    cases = pub.get('cases')
    require(isinstance(cases, list) and len(cases) == len(ids), 'complete grouped cohort required')
    seen, families = set(), {}
    for row in cases:
        require(isinstance(row, dict) and row.get('case_id') in case_ids and row['case_id'] not in seen,
                'unknown/repeated cohort case')
        seen.add(row['case_id'])
        require(row.get('group') in {'presentation', 'bench', 'archive'}, 'unknown public case group')
        family = row.get('canonical_fact_family')
        require(identifier(family), 'canonical fact family ID required')
        polarity = row.get('polarity')
        require(polarity in {'positive', 'negative', 'neutral', 'mixed'}, 'explicit case polarity required')
        if family in families:
            mirror = {families[family], polarity} == {'positive', 'negative'}
            raise PublicationError('polarity-mirror duplicate' if mirror else 'duplicate canonical fact family')
        families[family] = polarity
    return base, case_ids, source_ids


def canonical_route(key, case_ids):
    require(isinstance(key, str) and not re.search(r'[\x00-\x20\\]', key), 'invalid API route key')
    require(not re.search(r'%(?![0-9A-Fa-f]{2})', key), 'malformed API percent encoding')
    u = urlsplit(key)
    require(not u.scheme and not u.netloc and not u.fragment, 'API route must be local and canonical')
    path = safe_path(u.path.removeprefix('/'))
    require(path.startswith(('api/', 'graph-assets-v4/', 'data/')),
            'route outside public replay namespaces')
    try:
        query = parse_qsl(u.query, keep_blank_values=True, strict_parsing=True)
    except ValueError:
        raise PublicationError('malformed API route query') from None
    require(len({k for k, v in query}) == len(query), 'duplicate API query parameter')
    for name, value in query:
        require(name.lower() not in CREDENTIAL_KEYS, 'credential API query parameter')
        metadata_text(value)
        if name in {'case_id', 'case'}:
            require(value in case_ids, 'unknown or omitted route case ID')
        if name in {'config', 'arm'}:
            require(value in CONFIGS, 'unknown route condition')
    params = dict(query)
    if 'case_id' in params and 'case' in params:
        require(params['case_id'] == params['case'], 'conflicting route case aliases')
    if 'config' in params and 'arm' in params:
        require(CONFIG_ALIASES.get(params['config'], params['config'])
                == CONFIG_ALIASES.get(params['arm'], params['arm']), 'conflicting route condition aliases')
    # Aliases must not create two names for the same logical saved request.
    if 'case' in params:
        params.setdefault('case_id', params.pop('case'))
    if 'arm' in params:
        params.setdefault('config', params.pop('arm'))
    if 'config' in params:
        params['config'] = CONFIG_ALIASES.get(params['config'], params['config'])
    return path + ('?' + urlencode(sorted(params.items())) if params else '')


def html_url(value, relative, base, files, external=False, image=False, case_ids=None):
    require(not re.search(r'[\x00-\x20\\]', value), 'unsafe HTML URL syntax')
    if value.startswith('data:'):
        require(image and (value == 'data:,' or value.startswith('data:image/')), 'unsafe data URL')
        return
    u = urlsplit(value)
    if u.scheme or u.netloc:
        require(external, 'external active asset is not whitelisted')
        public_url(value)
        return
    require(not u.path.startswith('//'), 'protocol-relative URL')
    if case_ids is not None:
        for name, case_id in parse_qsl(u.query, keep_blank_values=True):
            if name in {'case', 'case_id', 'guide_case'}:
                require(case_id in case_ids, 'HTML references an omitted case')
    if not u.path:
        return
    if u.path.startswith('/'):
        require(u.path.startswith(base), 'HTML URL escapes project base_path')
        target = u.path[len(base):]
    else:
        target = str(PurePosixPath(relative).parent / u.path)
        if target.startswith('./'):
            target = target[2:]
    if target in {'', '.'}:
        target = 'index.html'
    target = safe_path(target)
    require(target in files, 'HTML references an unpublished file')


class HTMLCheck(HTMLParser):
    def __init__(self, relative, base, files, source_body=False, case_ids=None):
        super().__init__(convert_charrefs=True)
        self.relative, self.base, self.files, self.bases, self.active = relative, base, files, 0, None
        self.source_body = source_body
        self.case_ids = case_ids

    def handle_starttag(self, tag, attrs):
        require(len({k for k, v in attrs}) == len(attrs), 'duplicate HTML attribute')
        a = dict(attrs)
        if tag == 'base':
            self.bases += 1
            require(self.bases == 1 and a.get('href') == self.base and not a.get('target'),
                    'HTML base must match publication base_path')
            return
        require('srcdoc' not in a, 'inline iframe content is not whitelisted')
        if tag == 'meta' and a.get('http-equiv', '').lower() == 'refresh':
            match = re.fullmatch(r'\s*\d+\s*;\s*url=(.+)', a.get('content', ''), re.I)
            require(match is not None, 'invalid HTML refresh')
            html_url(match[1], 'index.html' if self.bases else self.relative,
                     self.base, self.files, case_ids=self.case_ids)
        if tag in {'script', 'style'}:
            self.active = tag
        for name, value in attrs:
            if value is None:
                continue
            metadata_text(value)
            require(not name.lower().startswith('on'), 'inline event handler is not allowed')
            if name in {'src', 'href', 'action', 'formaction', 'poster', 'data'}:
                html_url(value, 'index.html' if self.bases else self.relative, self.base, self.files,
                         external=tag == 'a' and name == 'href',
                         image=tag == 'img' or tag == 'link' and a.get('rel') == 'icon', case_ids=self.case_ids)
            if name == 'srcset':
                for item in value.split(','):
                    html_url(item.strip().split()[0], 'index.html' if self.bases else self.relative,
                             self.base, self.files, image=True, case_ids=self.case_ids)

    handle_startendtag = handle_starttag

    def handle_endtag(self, tag):
        if self.active == tag:
            self.active = None

    def handle_data(self, value):
        metadata_text(value, source_body=self.source_body and not self.active)


def json_identity(obj):
    if not isinstance(obj, dict):
        return {}
    case = obj.get('case') if isinstance(obj.get('case'), dict) else {}
    configs = obj.get('configurations')
    scope, note = obj.get('scope'), obj.get('note')
    return dict(case_id=obj.get('case_id', case.get('case_id')),
                config=obj.get('config', obj.get('selected_arm')),
                configurations=list(configs) if isinstance(configs, dict) else None,
                pdf_available=obj.get('pdf_available'), scope=scope if isinstance(scope, str) else None,
                note=note[:4096] if isinstance(note, str) else None,
                graph_run_id=obj.get('graph_run_id'), hierarchy_run_id=obj.get('hierarchy_run_id'),
                source_resource=obj.get('source_resource'), asset_base=obj.get('asset_base'),
                comparison_asset=obj.get('comparison_asset'), search_asset=obj.get('search_asset'),
                comparison_sha256=obj.get('comparison_sha256'), search_sha256=obj.get('search_sha256'))


class GraphDatasets:
    """Offline wire/decoded/privacy checks; retain no complete decoded JSON roots."""
    def __init__(self, dataset_root, expected_manifest_sha256, *,
                 source_ids=('cib', 'iran', 'vietnam'), max_total_bytes=MAX_DATASET_BYTES,
                 max_file_bytes=MAX_FILE_BYTES, max_decoded_bytes=MAX_DECODED_BYTES):
        self.root = Path(dataset_root).absolute()
        require(self.root.is_dir() and not self.root.is_symlink() and self.root.resolve() == self.root,
                'dataset root is missing or symlinked')
        self.file_limit, self.decoded_limit = max_file_bytes, max_decoded_bytes
        self.actual, self.total, self.records, self.paths, self.verified = {}, 0, {}, {}, {}
        self._full_scan_completed = False
        self._trusted_replay_completed = False
        for directory, dirs, names in os.walk(self.root, followlinks=False):
            for name in dirs + names:
                path = Path(directory) / name
                require(not path.is_symlink(), 'dataset symlink')
                relative = path.relative_to(self.root).as_posix()
                if name in dirs:
                    require(relative in {'cib', 'iran', 'vietnam'}, 'unexpected dataset directory')
                    continue
                require(stat.S_ISREG(path.stat().st_mode), 'nonregular dataset file')
                require(relative in {'manifest.json', 'README.md'} or DATASET_PATH.fullmatch('datasets/' + relative),
                        'dataset path outside corpus/hash whitelist')
                size = path.stat().st_size
                require(size < max_file_bytes, 'individual dataset stored file size limit')
                self.total += size
                require(self.total < max_total_bytes, 'total dataset byte budget')
                self.actual[relative] = path
        require('manifest.json' in self.actual, 'dataset manifest missing')
        self.manifest_raw = read_file(self.actual['manifest.json'], max_file_bytes)
        check_hash(self.manifest_raw, expected_manifest_sha256, 'dataset manifest byte SHA256 mismatch')
        self.manifest_sha256 = expected_manifest_sha256
        self.ancillary = {}
        if 'README.md' in self.actual:
            notice = read_file(self.actual['README.md'], max_file_bytes)
            try:
                metadata_text(notice.decode('utf-8'))
            except UnicodeError:
                raise PublicationError('invalid UTF-8 dataset notice') from None
            self.ancillary['README.md'] = dict(bytes=len(notice), sha256=sha(notice))
        manifest = parse_json(self.manifest_raw)
        require(isinstance(manifest, dict) and manifest.get('version') in {DATASET_VERSION, DATASET_RELEASE_VERSION},
                'unsupported dataset manifest')
        require(manifest.get('source_bodies_modified') is False and manifest.get('original_graph_modified') is False
                and nonplaceholder(manifest.get('rights_notice')), 'dataset preservation/public-source declarations required')
        require(isinstance(manifest.get('source_binding_sha256'), str)
                and HEX.fullmatch(manifest['source_binding_sha256']), 'dataset source binding SHA256 required')
        # Graph case_ids describe source provenance, not the selected benchmark.
        scan_json(manifest, None)
        rows = manifest.get('files')
        require(isinstance(rows, list) and bool(rows), 'explicit dataset file inventory required')
        lineages = {}
        releases = manifest.get('graph_releases', {})
        versioned = manifest['version'] == DATASET_RELEASE_VERSION
        if versioned:
            require(isinstance(releases, dict) and bool(releases), 'versioned graph releases required')
            for key, release in releases.items():
                require(identifier(key) and isinstance(release, dict)
                        and release.get('corpus') in source_ids
                        and identifier(release.get('graph_id')) and identifier(release.get('hierarchy_id'))
                        and release.get('role') in {'saved-study', 'current-exploration', 'current-and-saved-study', 'archived-exploration'}
                        and nonplaceholder(release.get('alias_review_status')), 'invalid graph release declaration')
        for row in rows:
            require(isinstance(row, dict), 'invalid dataset inventory row')
            relative = row.get('path')
            match = DATASET_PATH.fullmatch(relative) if isinstance(relative, str) else None
            require(match is not None and match[1] == row.get('corpus') and row['corpus'] in source_ids,
                    'dataset corpus/path lacks public source reference')
            require(all(isinstance(row.get(k), str) and HEX.fullmatch(row[k]) for k in
                    ('wire_sha256', 'sha256decoded', 'source_wire_sha256')), 'dataset hash/source lineage pin required')
            require(match[2] == row['wire_sha256'], 'dataset filename must address wire SHA256')
            logical = row.get('logical_key')
            logical_match = DATASET_LOGICAL.fullmatch(logical) if isinstance(logical, str) else None
            require(logical_match is not None and logical_match[1] == row['corpus'], 'invalid dataset logical graph key')
            require(logical not in self.records, 'duplicate/conflicting dataset logical key')
            require(type(row.get('bytes')) is int and 0 < row['bytes'] < max_file_bytes,
                    'invalid dataset stored byte count')
            require(identifier(row.get('graph_id')) and identifier(row.get('hierarchy_id'))
                    and row.get('all_graph_objects_preserved') is True
                    and type(row.get('workstation_metadata_removed')) is bool, 'explicit dataset graph lineage required')
            lineage = row['graph_id'], row['hierarchy_id']
            lineage_key = row.get('release_key') if versioned else row['corpus']
            if versioned:
                require(lineage_key in releases, 'dataset release key is undeclared')
                declared = releases[lineage_key]
                require((declared['corpus'], declared['graph_id'], declared['hierarchy_id'])
                        == (row['corpus'], *lineage), 'dataset differs from its declared graph release')
            require(lineage_key not in lineages or lineages[lineage_key] == lineage,
                    'dataset graph/hierarchy lineage conflict')
            lineages[lineage_key] = lineage
            local = relative.removeprefix('datasets/')
            require(local in self.actual, 'declared dataset file missing')
            old = self.paths.get(local)
            if old:
                require(all(old[k] == row[k] for k in ('bytes', 'wire_sha256', 'sha256decoded', 'corpus')),
                        'conflicting shared dataset file')
            else:
                self.paths[local] = row
            self.records[logical] = row
        require(set(self.paths) == set(self.actual) - {'manifest.json', 'README.md'},
                'dataset whitelist differs from actual files')
        if versioned:
            require(set(lineages) == set(releases), 'graph release lacks an actual asset inventory')
            for corpus in source_ids:
                current = [v for v in releases.values() if v['corpus'] == corpus
                           and v['role'] in {'current-exploration', 'current-and-saved-study'}]
                require(len(current) == 1, 'exactly one current graph release per corpus required')
        self.manifest, self.lineages = manifest, lineages

    def verify(self, progress=None):
        self._full_scan_completed = False
        self._trusted_replay_completed = False
        self.verified = {}
        for number, (relative, row) in enumerate(self.paths.items(), 1):
            raw = read_file(self.actual[relative], self.file_limit)
            require(len(raw) == row['bytes'], 'dataset stored byte count mismatch')
            check_hash(raw, row['wire_sha256'], 'dataset wire SHA256 mismatch')
            payload = decoded(raw, True, self.decoded_limit)
            check_hash(payload, row['sha256decoded'], 'dataset decoded SHA256 mismatch')
            obj = parse_json(payload)
            if isinstance(obj, dict):
                for field, expected in (('graph_run_id', row['graph_id']), ('hierarchy_run_id', row['hierarchy_id'])):
                    require(field not in obj or obj[field] == expected,
                            'decoded graph asset lineage differs from its dataset declaration')
            try:
                scan_json(obj, None)
            except PublicationError as exc:
                raise PublicationError('dataset ' + relative + ': ' + str(exc)) from None
            self.verified[relative] = dict(identity=json_identity(obj), decoded_bytes=len(payload))
            del obj, payload, raw
            if progress:
                progress(number, len(self.paths), relative)
        # A physical shard may be referenced by several logical releases. Its
        # decoded identity must satisfy every declaration, not only the first.
        for row in self.records.values():
            local = row['path'].removeprefix('datasets/')
            identity = self.verified[local]['identity']
            for field, expected in (('graph_run_id', row['graph_id']), ('hierarchy_run_id', row['hierarchy_id'])):
                require(identity.get(field) is None or identity[field] == expected,
                        'shared decoded graph asset lineage differs from a logical release')
        self.unchanged()
        self._full_scan_completed = True
        return self.summary()

    def unchanged(self):
        require(read_file(self.actual['manifest.json'], self.file_limit) == self.manifest_raw,
                'dataset manifest changed during validation')
        for relative, row in self.paths.items():
            check_hash(read_file(self.actual[relative], self.file_limit), row['wire_sha256'],
                       'dataset changed during validation')
        for relative, pin in self.ancillary.items():
            check_hash(read_file(self.actual[relative], self.file_limit), pin['sha256'],
                       'dataset notice changed during validation')

    def summary(self):
        require(self._full_scan_completed or self._trusted_replay_completed,
                'a completed full dataset scan or verified receipt replay is required')
        return self._summary()

    def _summary(self):
        return dict(status='PASS', manifest_sha256=self.manifest_sha256,
            dataset_files=len(self.paths), logical_graph_assets=len(self.records), stored_bytes=self.total,
            max_stored_file_bytes=max(row['bytes'] for row in self.paths.values()),
            ancillary_notices=self.ancillary,
            source_binding_sha256=self.manifest['source_binding_sha256'], graph_lineages=self.lineages,
            bodies='No source bodies or graph objects rewritten; exporter declarations and hashes checked',
            licensing='Public-source declarations checked; not declassification or a blanket copyright license',
            network_calls=0)

    def external_entry(self, logical, entry, commit):
        value = entry.get('external_url')
        match = DATASET_EXTERNAL.fullmatch(value) if isinstance(value, str) else None
        require(match is not None and match[1] == commit, 'external dataset URL must pin approved repository/commit')
        require(entry.get('path') is None and entry.get('encoding') == 'gzip',
                'external dataset must be gzip with no local path fallback')
        mime = entry.get('mime')
        require(isinstance(mime, str) and mime.split(';')[0].strip().lower() == 'application/json',
                'external graph dataset MIME must be JSON')
        row = self.records.get('/' + logical)
        require(row is not None and row['path'] == match[2] and row['corpus'] == match[3],
                'external graph URL not bound to dataset logical/source reference')
        require(entry.get('wire_sha256') == row['wire_sha256']
                and entry.get('sha256') == row['sha256decoded'], 'external graph wire/decoded SHA256 differs')
        local = row['path'].removeprefix('datasets/')
        require(local in self.verified, 'external dataset was not verified offline')
        return self.verified[local]['identity']


def validate_datasets(dataset_root, expected_manifest_sha256, *, source_ids=('cib', 'iran', 'vietnam'),
                      max_total_bytes=MAX_DATASET_BYTES, max_file_bytes=MAX_FILE_BYTES,
                      max_decoded_bytes=MAX_DECODED_BYTES, progress=None,
                      proof_ref=None, proof_output=None):
    """Pre-push offline verification. No commit is needed or inferred here."""
    checker = GraphDatasets(dataset_root, expected_manifest_sha256, source_ids=source_ids,
        max_total_bytes=max_total_bytes, max_file_bytes=max_file_bytes,
        max_decoded_bytes=max_decoded_bytes)
    if proof_ref is not None:
        require(proof_output is None, 'do not issue a new full-scan proof from a reused proof')
        return reuse_dataset_proof(checker, proof_ref)
    result = checker.verify(progress)
    if proof_output is not None:
        write_dataset_proof(proof_output, dataset_proof(checker, result))
    return result


def checker_policy_sha256():
    """The complete pure full-scan policy, distinct from CLI/site integration."""
    functions = (GraphDatasets.__init__, GraphDatasets.verify, GraphDatasets.unchanged,
        GraphDatasets.summary, GraphDatasets._summary,
        scan_json, metadata_text, _metadata_text_uncached, _metadata_text_cached,
        decoded, parse_json, pairs, public_url, read_file,
        require, identifier, check_hash, sha, nonplaceholder, json_identity)
    policy = dict(functions={f.__qualname__: inspect.getsource(f) for f in functions},
        regex={name: [globals()[name].pattern, globals()[name].flags] for name in
            ('DATASET_PATH', 'DATASET_LOGICAL', 'TOKEN', 'ASSIGNMENT', 'LOCAL_PATH',
             'PRIVATE_REFERENCE', 'LOCAL_URL', 'HEX', 'IDENTIFIER')},
        sets={name: sorted(globals()[name]) for name in
            ('CREDENTIAL_KEYS', 'PRIVATE_KEYS', 'SOURCE_TEXT', 'SOURCE_PROVENANCE')},
        dataset_versions=[DATASET_VERSION, DATASET_RELEASE_VERSION], limits=[MAX_DATASET_BYTES, MAX_FILE_BYTES, MAX_DECODED_BYTES])
    return sha(json.dumps(policy, sort_keys=True, separators=(',', ':')).encode())


def proof_file_pins(checker):
    return [dict(path='datasets/'+name, bytes=row['bytes'], wire_sha256=row['wire_sha256'],
                 sha256decoded=row['sha256decoded']) for name, row in sorted(checker.paths.items())]


def dataset_proof(checker, result):
    """Only issue from a completed in-memory full scan, never directory discovery."""
    require(checker._full_scan_completed and set(checker.verified) == set(checker.paths)
            and result == checker.summary(),
            'a completed full dataset scan is required to issue a pass proof')
    return dict(version=DATASET_PROOF_VERSION, status='PASS', full_privacy_scan=True,
        manifest_sha256=checker.manifest_sha256, validator_sha256=sha(Path(__file__).read_bytes()),
        checker_policy_sha256=checker_policy_sha256(), files=proof_file_pins(checker),
        ancillary_notices=checker.ancillary, result=result)


def write_dataset_proof(path, value):
    """Explicit optional QA output, outside either deployable data directory."""
    target = Path(path).absolute()
    require(target.suffix == '.json' and not target.is_symlink(), 'invalid dataset proof output')
    require('datasets' not in target.parts and 'site' not in target.parts,
            'pass proof must remain outside deployable data directories')
    target.parent.mkdir(parents=True, exist_ok=True)
    require(target.parent.resolve() == target.parent, 'symlinked proof output directory')
    raw = (json.dumps(value, sort_keys=True, indent=2) + '\n').encode()
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o444)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(raw)


def reuse_dataset_proof(checker, proof_ref):
    """An explicitly trusted receipt byte pin plus fresh hashes of EVERY input."""
    require(isinstance(proof_ref, dict) and isinstance(proof_ref.get('path'), (str, Path)),
            'explicit trusted dataset proof ref required')
    path = Path(proof_ref['path']).absolute()
    require(path.suffix == '.json', 'dataset proof must be JSON')
    raw = read_file(path, MAX_FILE_BYTES)
    check_hash(raw, proof_ref.get('sha256'), 'dataset proof byte SHA256 mismatch')
    proof = parse_json(raw)
    require(isinstance(proof, dict) and proof.get('version') == DATASET_PROOF_VERSION
            and proof.get('status') == 'PASS' and proof.get('full_privacy_scan') is True,
            'not an approved full dataset privacy pass')
    require(proof.get('validator_sha256') == sha(Path(__file__).read_bytes())
            and proof.get('checker_policy_sha256') == checker_policy_sha256(),
            'dataset proof checker/current code changed')
    require(proof.get('manifest_sha256') == checker.manifest_sha256
            and proof.get('files') == proof_file_pins(checker)
            and proof.get('ancillary_notices') == checker.ancillary,
            'dataset proof source/file membership differs')
    normalized_summary = json.loads(json.dumps(checker._summary()))
    require(proof.get('result') == normalized_summary, 'dataset proof full result differs')
    checker.unchanged()
    # External entries are graph-only: no benchmark identity is inferred from
    # graph source case_ids. No decoded roots are needed after receipt replay.
    checker.verified = {relative: dict(identity={}) for relative in checker.paths}
    checker._trusted_replay_completed = True
    return dict(checker.summary(), validation_mode='pinned-full-privacy-pass-plus-fresh-wire-hashes')


def pack_module():
    """Load exact sibling source bytes, not an experiments import or stale pyc."""
    path = Path(__file__).resolve().with_name('pack_graphs.py')
    raw = read_file(path, MAX_FILE_BYTES)
    name = '_publication_graph_reader_' + sha(raw)
    if name not in sys.modules:
        module = types.ModuleType(name)
        module.__file__ = str(path)
        sys.modules[name] = module
        try:
            exec(compile(raw, str(path), 'exec'), module.__dict__)
        except BaseException:
            sys.modules.pop(name, None)
            raise
    return sys.modules[name]


class FragmentPacks:
    """Shared chunk caches, one materialized JSON root at a time, no root cache."""
    def __init__(self, root, inventory, index, case_ids, file_limit, decoded_limit):
        self.inventory, self.case_ids = inventory, case_ids
        self.file_limit, self.decoded_limit = file_limit, decoded_limit
        self.packs, self.chunks, self.verified = {}, {}, {}
        self.max_root = 0
        entries = index.get('entries')
        require(isinstance(entries, dict), 'versioned API entries index required')
        for entry in entries.values():
            require(isinstance(entry, dict), 'invalid API route row')
            if entry.get('encoding') != 'fragment-dag':
                continue
            path = safe_path(entry.get('path'))
            require(path in inventory and path.endswith('.json'), 'unpublished fragment manifest')
            expected = entry.get('manifest_sha256')
            require(isinstance(expected, str) and HEX.fullmatch(expected)
                    and expected == inventory[path].get('sha256'), 'fragment manifest SHA256 mismatch')
            require(entry.get('wire_sha256') is None, 'fragment root has no single wire SHA256')
            if path in self.packs:
                require(self.packs[path]['wire_hash'] == expected, 'conflicting fragment manifest pin')
                continue
            raw = read_file(root / path, file_limit)
            check_hash(raw, expected, 'fragment manifest SHA256 mismatch')
            manifest = parse_json(raw)
            require(isinstance(manifest, dict) and manifest.get('status') == 'COMPLETE'
                    and manifest.get('original_assets_modified') is False
                    and manifest.get('all_roots_transport_verified') is True, 'incomplete fragment pack')
            assets = manifest.get('assets')
            require(isinstance(assets, dict) and bool(assets), 'fragment pack has no roots')
            metadata = {k: v for k, v in manifest.items() if k != 'assets'}
            metadata['assets'] = {}
            for asset, record in assets.items():
                require(isinstance(record, dict), 'invalid fragment root')
                require(type(record.get('decoded_bytes')) is int
                        and 0 <= record['decoded_bytes'] < decoded_limit, 'decoded fragment root size limit')
                require(isinstance(record.get('sha256decoded'), str)
                        and HEX.fullmatch(record['sha256decoded']), 'fragment root SHA256 required')
                metadata['assets'][asset] = {k: v for k, v in record.items() if k != 'pieces'}
            scan_json(metadata, case_ids)
            try:
                reader = pack_module().Reader((root / path).parent, manifest,
                    cache_chunks=PACK_CACHE_CHUNKS, max_output_bytes=decoded_limit - 1)
            except (ValueError, KeyError, TypeError, IndexError):
                raise PublicationError('invalid fragment DAG manifest') from None
            self.packs[path] = dict(reader=reader, manifest=manifest, wire_hash=expected)
            for number, chunk in enumerate(manifest['chunks']):
                require(isinstance(chunk, dict) and all(type(chunk.get(k)) is int for k in
                    ('id', 'first_id', 'last_id', 'decoded_bytes', 'wire_bytes')), 'invalid fragment chunk metadata')
                require(0 < chunk['decoded_bytes'] < decoded_limit, 'decoded fragment chunk size limit')
                relative = safe_path(str(PurePosixPath(path).parent / safe_path(chunk.get('path'))))
                require(relative in inventory and relative.endswith('.json.gz'), 'unpublished fragment chunk')
                row = inventory[relative]
                require(row.get('sha256') == chunk.get('wire_sha256')
                        and row.get('decoded_sha256') == chunk.get('sha256decoded')
                        and row.get('bytes') == chunk['wire_bytes'], 'fragment chunk inventory pin differs')
                old = self.chunks.get(relative)
                if old:
                    require(old[2] == chunk, 'conflicting shared fragment chunk')
                else:
                    self.chunks[relative] = (reader, number, chunk)

    def check_chunk(self, relative):
        reader, number, chunk = self.chunks[relative]
        try:
            reader.chunk(number)
        except (ValueError, KeyError, TypeError, IndexError, OSError, EOFError, UnicodeError):
            raise PublicationError('fragment chunk integrity or backward-reference failure') from None
        return chunk['sha256decoded']

    @staticmethod
    def check_reachability(reader, manifest):
        pending, reached = {}, 0

        def enqueue(fragment):
            require(type(fragment) is int and fragment > 0, 'unknown fragment reference')
            number = bisect_right(reader.starts, fragment) - 1
            require(number >= 0 and fragment <= reader.chunks[number]['last_id'], 'unknown fragment reference')
            pending.setdefault(number, set()).add(fragment)

        for root in manifest['assets'].values():
            for fragment in root['pieces'][1::2]:
                enqueue(fragment)
        # Backward references make a descending scan complete. Each chunk is
        # visited once, rather than repeatedly looking up scattered old rows.
        for number in sorted(pending.keys() | set(range(len(reader.chunks))), reverse=True):
            if number not in pending:
                continue
            wanted = pending[number]
            try:
                rows = reader.chunk(number)
                first = reader.chunks[number]['first_id']
                for offset in range(len(rows) - 1, -1, -1):
                    fragment = first + offset
                    if fragment not in wanted:
                        continue
                    wanted.remove(fragment)
                    reached += 1
                    for child in rows[offset][1::2]:
                        enqueue(child)
            except PublicationError:
                raise
            except (ValueError, KeyError, TypeError, IndexError, OSError, EOFError, UnicodeError):
                raise PublicationError('fragment reachability integrity failure') from None
            require(not wanted, 'unresolved fragment reachability')
            del pending[number]
        count = reader.chunks[-1]['last_id'] if reader.chunks else 0
        require(not pending and reached == count, 'unreachable fragment lacks verified source context')

    def verify_roots(self):
        for path, pack in self.packs.items():
            reader, manifest = pack['reader'], pack['manifest']
            for asset, record in manifest['assets'].items():
                try:
                    with io.BytesIO() as output:
                        for block in reader.iter_asset(asset):
                            output.write(block)
                        raw = output.getvalue()
                        obj = parse_json(raw)
                        scan_json(obj, self.case_ids)
                        identity = json_identity(obj)
                except PublicationError:
                    raise
                except (ValueError, KeyError, TypeError, IndexError, OSError, EOFError, UnicodeError):
                    raise PublicationError('fragment root integrity or dependency failure') from None
                self.max_root = max(self.max_root, len(raw))
                self.verified[path, asset] = dict(identity=identity, sha256=record['sha256decoded'])
                del obj, raw
            # Literal dictionary pieces cannot be scanned as standalone metadata:
            # they may split a legitimate source quote. Require their source
            # context to occur in at least one fully checked assembled root.
            self.check_reachability(reader, manifest)
            reader.cache.clear()

    def entry(self, row):
        key = row['path'], row.get('asset')
        require(isinstance(key[1], str) and key in self.verified, 'unknown fragment root asset')
        value = self.verified[key]
        require(row.get('sha256') == value['sha256'], 'API decoded fragment SHA256 mismatch')
        require(isinstance(row.get('mime'), str)
                and row['mime'].split(';')[0].strip().lower() == 'application/json', 'fragment root MIME must be JSON')
        return value['identity']


def validate_publication(site, *, known_case_ids=None, max_total_bytes=MAX_TOTAL_BYTES,
                         max_file_bytes=MAX_FILE_BYTES, max_decoded_bytes=MAX_DECODED_BYTES,
                         expected_base_path=EXPECTED_BASE_PATH, dataset_root=None,
                         max_dataset_bytes=MAX_DATASET_BYTES, dataset_progress=None,
                         dataset_proof_ref=None):
    root = Path(site).absolute()
    require(root.is_dir() and not root.is_symlink() and root.resolve() == root,
            'site root is missing or symlinked')
    actual, total = {}, 0
    for directory, dirs, names in os.walk(root, followlinks=False):
        for name in dirs + names:
            p = Path(directory) / name
            require(not p.is_symlink(), 'symlink in publication')
            rel = p.relative_to(root).as_posix()
            if name in dirs:
                safe_path(rel)
                continue
            require(stat.S_ISREG(p.stat().st_mode), 'nonregular publication file')
            file_path(rel)
            size = p.stat().st_size
            require(rel != '.nojekyll' or size == 0, '.nojekyll must be empty')
            require(size < max_file_bytes, 'individual stored file size limit')
            total += size
            require(total < max_total_bytes, 'total publication byte budget')
            require(rel.casefold() not in {n.casefold() for n in actual}, 'case-folded path collision')
            actual[rel] = p
    require('publication.json' in actual and 'index.html' in actual, 'publication.json and index.html required')
    manifest_raw = read_file(actual['publication.json'], max_file_bytes)
    pub = parse_json(manifest_raw)
    require(isinstance(pub, dict), 'publication manifest must be an object')
    rows = pub.get('files')
    require(isinstance(rows, list), 'explicit file whitelist required')
    inventory = {}
    for row in rows:
        require(isinstance(row, dict), 'invalid file whitelist row')
        rel = file_path(row.get('path'))
        require(rel != 'publication.json' and rel not in inventory, 'duplicate/self-referential file whitelist')
        inventory[rel] = row
    require(set(inventory) == set(actual) - {'publication.json'}, 'file whitelist differs from actual publication')
    base, case_ids, source_ids = declarations(pub, inventory, known_case_ids, expected_base_path)
    scan_json(pub, case_ids)
    index_path = safe_path(pub.get('api_index'))
    require(index_path in inventory and index_path.endswith(('.json', '.json.gz')), 'unpublished API index')
    index_raw = read_file(actual[index_path], max_file_bytes)
    check_hash(index_raw, inventory[index_path].get('sha256'), 'API index wire SHA256 mismatch')
    index = parse_json(decoded(index_raw, index_path.endswith('.gz'), max_decoded_bytes))
    require(isinstance(index, dict) and index.get('version') == API_INDEX_VERSION
            and isinstance(index.get('entries'), dict) and bool(index['entries']),
            'versioned API entries index required')
    graph_paths, study_paths = set(), set()
    has_external = False
    for supplied, entry in index['entries'].items():
        require(isinstance(entry, dict), 'invalid API route row')
        logical = canonical_route(supplied, case_ids)
        endpoint = logical.split('?')[0]
        graph = endpoint.startswith('graph-assets-v4/') or endpoint == 'api/graph-v4-viewer'
        if entry.get('encoding') == 'fragment-dag':
            require(endpoint.startswith('api/') and endpoint not in {
                'api/condition-v6', 'api/flow-v6', 'api/graph-v4-viewer'},
                'DAG transport is forbidden for full KG and fast condition/flow requests')
        if 'external_url' in entry:
            require(endpoint.startswith('graph-assets-v4/'), 'external data is restricted to full KG assets')
            has_external = True
        elif isinstance(entry.get('path'), str):
            (graph_paths if graph else study_paths).add(entry['path'])
    graph_data = pub.get('graph_data_manifest')
    datasets, dataset_commit = None, None
    if graph_data is not None or has_external:
        require(isinstance(graph_data, dict) and graph_data.get('path') == 'datasets/manifest.json'
                and isinstance(graph_data.get('sha256'), str) and HEX.fullmatch(graph_data['sha256']),
                'explicit graph_data_manifest path/hash required')
        dataset_commit = graph_data.get('commit')
        require(isinstance(dataset_commit, str) and re.fullmatch(r'[a-f0-9]{40}', dataset_commit),
                'final graph dataset commit must be 40 lowercase hex')
        datasets = GraphDatasets(dataset_root or root.parent / 'datasets', graph_data['sha256'],
            source_ids=source_ids, max_total_bytes=max_dataset_bytes,
            max_file_bytes=max_file_bytes, max_decoded_bytes=max_decoded_bytes)
        if dataset_proof_ref is not None:
            reuse_dataset_proof(datasets, dataset_proof_ref)
        else:
            datasets.verify(dataset_progress)
    packs = FragmentPacks(root, inventory, index, case_ids, max_file_bytes, max_decoded_bytes)
    payloads, decoded_hashes, identities, wire_hashes = {}, {}, {}, {}
    for rel, row in inventory.items():
        raw = read_file(actual[rel], max_file_bytes)
        require(type(row.get('bytes')) is int and row['bytes'] == len(raw), 'stored byte count mismatch')
        check_hash(raw, row.get('sha256'), 'wire SHA256 mismatch')
        wire_hashes[rel] = row['sha256']
        if rel in packs.chunks:
            decoded_hashes[rel] = packs.check_chunk(rel)
            continue
        compressed = rel.endswith('.json.gz')
        payload = decoded(raw, compressed, max_decoded_bytes)
        if compressed or 'decoded_sha256' in row:
            check_hash(payload, row.get('decoded_sha256'), 'decoded SHA256 mismatch')
        decoded_hashes[rel] = sha(payload)
        role = row.get('role', 'data')
        require(role in {'asset', 'data', 'documentation', 'license', 'source_body'}, 'unapproved publication file role')
        if 'source_ids' in row or role == 'source_body':
            require(isinstance(row.get('source_ids'), list) and bool(row['source_ids'])
                    and all(s in source_ids for s in row['source_ids']), 'file source rights reference missing')
        if rel.endswith(('.json', '.json.gz')):
            obj = parse_json(payload)
            if rel not in packs.packs:
                scan_json(obj, None if rel in graph_paths and rel not in study_paths else case_ids)
            if isinstance(obj, dict):
                identities[rel] = json_identity(obj)
            if rel == pub.get('api_index'):
                payloads[rel] = obj
            del obj
        elif rel.endswith(('.html', '.css', '.js', '.mjs', '.svg', '.xml', '.txt', '.md')):
            try:
                text = payload.decode('utf-8')
            except UnicodeError:
                raise PublicationError('invalid UTF-8 static text') from None
            if rel.endswith('.html'):
                checker = HTMLCheck(rel, base, actual, source_body=role == 'source_body', case_ids=case_ids)
                checker.feed(text)
                checker.close()
                require(not TOKEN.search(text), 'credential syntax in HTML')
            else:
                metadata_text(text, source_body=role == 'source_body')
            del text
        del raw, payload
    packs.verify_roots()
    index = payloads.get(index_path)
    require(isinstance(index, dict) and index.get('version') == API_INDEX_VERSION
            and isinstance(index.get('entries'), dict) and bool(index['entries']),
            'versioned API entries index required')
    canonical_entries = {canonical_route(k, case_ids):v for k,v in index['entries'].items()}
    routes = set()
    for supplied_key, row in index['entries'].items():
        require(isinstance(row, dict), 'invalid API route row')
        key = canonical_route(supplied_key, case_ids)
        require(key not in routes, 'duplicate/conflicting canonical API route')
        routes.add(key)
        if 'external_url' in row:
            require(datasets is not None, 'external graph datasets missing')
            identity = datasets.external_entry(key, row, dataset_commit)
        elif row.get('encoding') == 'fragment-dag':
            safe_path(row.get('path'))
            identity = packs.entry(row)
        else:
            target = safe_path(row.get('path'))
            require(target in inventory and target.endswith(('.json', '.json.gz', '.pdf')),
                    'unpublished API payload path')
            compressed = target.endswith('.json.gz')
            require(row.get('encoding') == ('gzip' if compressed else 'identity'),
                    'API encoding differs from stored payload')
            mime = row.get('mime')
            expected_mime = 'application/pdf' if target.endswith('.pdf') else 'application/json'
            require(isinstance(mime, str) and mime.split(';')[0].strip().lower() == expected_mime,
                    'API MIME differs from payload type')
            require(row.get('sha256') == decoded_hashes[target], 'API decoded SHA256 mismatch')
            if compressed or 'wire_sha256' in row:
                require(row.get('wire_sha256') == inventory[target]['sha256'], 'API wire SHA256 mismatch')
            identity = identities.get(target, {})
        query = dict(parse_qsl(urlsplit(key).query))
        if query.get('case_id') and identity.get('case_id'):
            require(query['case_id'] == identity['case_id'], 'API response belongs to another case')
        if key.split('?')[0] == 'api/condition-v6':
            require(identity.get('case_id') == query.get('case_id') and bool(query.get('case_id')),
                    'condition response case binding missing')
        if query.get('config'):
            expected = query['config']
            if identity.get('config'):
                require(CONFIG_ALIASES.get(identity['config'], identity['config']) == expected,
                        'API response belongs to another condition')
            if isinstance(identity.get('configurations'), list):
                require(expected in identity['configurations'], 'API response condition absent')
        if key.split('?')[0] == 'api/graph-v4-viewer':
            require(identity.get('pdf_available') is False, 'full graph bulk-PDF availability must be false')
            require(query.get('revision') in {None, 'study'}, 'unknown graph revision selector')
            if datasets and datasets.manifest['version'] == DATASET_RELEASE_VERSION:
                matching = [r for r in datasets.manifest['graph_releases'].values()
                            if (r['corpus'], r['graph_id'], r['hierarchy_id']) ==
                            (query.get('corpus'), identity.get('graph_run_id'), identity.get('hierarchy_run_id'))]
                role = 'saved-study' if query.get('revision') == 'study' else 'current-exploration'
                require(len(matching) == 1 and matching[0]['role'] in {role, 'current-and-saved-study'},
                        'viewer binding differs from its current or saved graph release')
                require(identity.get('source_resource') == matching[0].get('source_resource'),
                        'viewer source-resource commitment differs from its graph release')
                corpus = query.get('corpus')
                asset_base = '/graph-assets-v4/' + str(corpus) + '/'
                require(identity.get('asset_base') == asset_base, 'viewer asset base differs from its corpus')
                for kind in ('comparison', 'search'):
                    name = identity.get(kind + '_asset')
                    require(isinstance(name, str) and re.fullmatch(r'[A-Za-z0-9_.-]+\.json(?:\.gz)?', name),
                            'viewer requires a literal comparison/search asset filename')
                    logical = asset_base + name
                    asset = datasets.records.get(logical)
                    require(asset is not None and (asset['corpus'], asset['graph_id'], asset['hierarchy_id']) ==
                            (corpus, identity['graph_run_id'], identity['hierarchy_run_id']),
                            'viewer requested asset belongs to another graph release or is missing')
                    target = canonical_entries.get(logical.removeprefix('/'))
                    require(isinstance(target, dict) and target.get('sha256') == asset['sha256decoded'],
                            'viewer requested asset is absent from transport or has another decoded commitment')
                    required_hash = identity.get(kind + '_sha256')
                    require((kind == 'search' and required_hash is None
                             and matching[0]['alias_review_status'] == 'legacy-not-revalidated')
                            or required_hash == asset['sha256decoded'],
                            'viewer comparison/search checksum differs from its graph asset')
        if key.split('?')[0] == 'api/node-v6':
            require(identity.get('scope') == 'SAVED_DISPLAY_PROJECTION_ONLY'
                    and nonplaceholder(identity.get('note')), 'saved node scope disclosure required')
    require(read_file(actual['publication.json'], max_file_bytes) == manifest_raw,
            'publication manifest changed during validation')
    for rel, expected in wire_hashes.items():
        check_hash(read_file(actual[rel], max_file_bytes), expected, 'publication file changed during validation')
    if datasets:
        datasets.unchanged()
    return dict(status='PASS', version=pub['version'], run_id=pub['run_id'], base_path=base,
                files=len(actual), stored_bytes=total, api_routes=len(routes), cases=len(case_ids),
                fact_families=len(pub['cases']), sources=len(source_ids),
                fragment_dag_packs=len(packs.packs), fragment_dag_roots_verified=len(packs.verified),
                max_decoded_fragment_root_bytes=packs.max_root,
                datasets=datasets.summary() if datasets else None, dataset_commit=dataset_commit,
                dataset_validation_mode=('pinned-full-privacy-pass-plus-fresh-wire-hashes'
                    if datasets and dataset_proof_ref else 'full-json-privacy-scan' if datasets else None),
                licensing='Declarations checked; not legal clearance, declassification, or a blanket copyright license',
                bodies='Source bodies were not rewritten', network_calls=0)


validate = validate_publication


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site', type=Path, default=Path(__file__).resolve().parents[1] / 'site')
    parser.add_argument('--case-id', action='append', help='Independent exact approved cohort; repeat per ID')
    parser.add_argument('--base-path', default=EXPECTED_BASE_PATH, help='Approved deployed project prefix')
    parser.add_argument('--datasets-only', action='store_true', help='Verify the independent datasets before any push')
    parser.add_argument('--dataset-root', type=Path, help='Default: site.parent/datasets')
    parser.add_argument('--dataset-manifest-sha256', help='Explicit byte pin, required by --datasets-only')
    parser.add_argument('--dataset-proof', type=Path, help='Explicit previously approved full-scan JSON receipt')
    parser.add_argument('--dataset-proof-sha256', help='Required byte pin for --dataset-proof; never auto-discovered')
    parser.add_argument('--write-dataset-proof', type=Path, help='With full --datasets-only, create a new immutable QA proof')
    args = parser.parse_args(argv)
    try:
        require(bool(args.dataset_proof) == bool(args.dataset_proof_sha256), 'dataset proof path and byte pin required together')
        proof_ref = dict(path=args.dataset_proof, sha256=args.dataset_proof_sha256) if args.dataset_proof else None
        if args.datasets_only:
            require(args.dataset_manifest_sha256 is not None, 'explicit dataset manifest byte pin required')
            started = time.monotonic()
            def progress(done, total, relative):
                if done == 1 or done % 100 == 0 or done == total:
                    print(json.dumps(dict(status='CHECKING_DATASETS', checked=done, files=total,
                        elapsed_seconds=round(time.monotonic()-started, 2),
                        metadata_cache=_metadata_text_cached.cache_info()._asdict())), file=sys.stderr, flush=True)
            result = validate_datasets(args.dataset_root or args.site.parent / 'datasets',
                args.dataset_manifest_sha256, progress=progress,
                proof_ref=proof_ref, proof_output=args.write_dataset_proof)
        else:
            require(args.write_dataset_proof is None, 'write-dataset-proof requires a full datasets-only scan')
            result = validate_publication(args.site, known_case_ids=args.case_id,
                expected_base_path=args.base_path, dataset_root=args.dataset_root, dataset_proof_ref=proof_ref)
    except (PublicationError, OSError, TypeError, KeyError, ValueError, IndexError) as exc:
        error = str(exc) if isinstance(exc, PublicationError) else 'unreadable/malformed publication input'
        print(json.dumps(dict(status='FAIL', error=error)), file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
