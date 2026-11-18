import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from pack_current_overlays import pack
from export_replays import encoded,sha
from pack_graphs import Reader


def fixture(tmp_path):
    site=tmp_path/'site';(site/'data').mkdir(parents=True)
    entries={};values={}
    for i in range(2):
        value=dict(case_id='case',eligible_ids=['entity:'+str(j) for j in range(1000)],
            unique_details=('detail'+str(i))*1000,route=i,
            quote='literal \\u0061; no number or string normalization',mass=1.23456789e-12)
        raw=encoded(value);wire=gzip.compress(raw,mtime=0)
        name='data/'+sha(wire)+'.json.gz';(site/name).write_bytes(wire)
        key='/api/current/guide-overlay-v64?case_id=case&route_index='+str(i)
        entries[key]=dict(path=name,sha256=sha(raw),wire_sha256=sha(wire),encoding='gzip')
        values[key]=raw
    raw=encoded(dict(version='matryoshka-public-api-index/1',entries=entries))
    (site/'data/api-index.json').write_bytes(raw)
    return site,sha(raw),values


def test_overlay_dictionary_preserves_exact_bytes_and_shares_eligibility(tmp_path):
    site,pin,values=fixture(tmp_path)
    result=pack(tmp_path,pin,execute=True)
    assert result['status']=='PACKED_EXACT_BYTES'
    index=json.loads((site/'data/api-index.json').read_bytes())
    entries=list(index['entries'].values())
    assert len({e['path'] for e in entries})==1
    manifest_path=site/entries[0]['path']
    manifest=json.loads(manifest_path.read_bytes())
    assert len(manifest['chunks'])==1
    assert manifest['chunks'][0]['last_id']==3
    reader=Reader(manifest_path.parent,manifest)
    for key,entry in index['entries'].items():
        assert b''.join(reader.iter_asset(entry['asset']))==values[key]
        assert entry['sha256']==sha(values[key])
    assert all((site/path).is_file() for path in ['data/'+sha(gzip.compress(raw,mtime=0))+'.json.gz' for raw in values.values()])


def test_overlay_dry_run_is_write_free(tmp_path):
    site,pin,_=fixture(tmp_path)
    before=sorted(str(p) for p in tmp_path.rglob('*'))
    assert pack(tmp_path,pin)['status']=='DRY_RUN'
    assert sorted(str(p) for p in tmp_path.rglob('*'))==before


def test_overlay_pack_rejects_wrong_index_pin(tmp_path):
    _,_,_=fixture(tmp_path)
    with pytest.raises(ValueError,match='byte pin'):
        pack(tmp_path,'0'*64,execute=True)


def test_field_fragments_may_split_json_tokens_without_changing_root(tmp_path):
    site,pin,values=fixture(tmp_path)
    pack(tmp_path,pin,execute=True,minimum=16,chunk_bytes=37)
    index=json.loads((site/'data/api-index.json').read_bytes())
    for key,entry in index['entries'].items():
        path=site/entry['path'];reader=Reader(path.parent,json.loads(path.read_bytes()))
        assert b''.join(reader.iter_asset(entry['asset']))==values[key]


def test_changed_fragment_is_rejected_on_readout(tmp_path):
    site,pin,_=fixture(tmp_path)
    pack(tmp_path,pin,execute=True)
    index=json.loads((site/'data/api-index.json').read_bytes())
    entry=next(iter(index['entries'].values()))
    path=site/entry['path'];manifest=json.loads(path.read_bytes())
    (path.parent/manifest['chunks'][0]['path']).write_bytes(b'changed')
    with pytest.raises(ValueError,match='wire integrity'):
        b''.join(Reader(path.parent,manifest).iter_asset(entry['asset']))


def test_source_dictionary_selects_only_exact_declared_case(tmp_path):
    site,pin,values=fixture(tmp_path)
    path=site/'data/api-index.json';index=json.loads(path.read_bytes())
    old=next(iter(index['entries'].values()))
    for cid in ('case','other'):
        index['entries']['/api/current/source-v6?case_id='+cid+'&source_id=page']=old
    raw=encoded(index);path.write_bytes(raw)
    pack(tmp_path,sha(raw),execute=True,endpoints=('source-v6',),case_id='case',category='current-source-pages')
    result=json.loads(path.read_bytes())['entries']
    assert result['/api/current/source-v6?case_id=case&source_id=page']['encoding']=='fragment-dag'
    assert result['/api/current/source-v6?case_id=other&source_id=page']==old
    assert all(result[k]==index['entries'][k]for k in values)
