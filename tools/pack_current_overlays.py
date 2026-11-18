"""Lossless field sharing for explicitly pinned current replay responses."""
import argparse
from copy import deepcopy
import fcntl
import gzip
import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from export_replays import atomic, encoded, sha
from pack_graphs import Reader, encoded as pack_encoded


def pack(package, index_sha256, *, execute=False, minimum=4096, chunk_bytes=4*1024**2,
         endpoints=('guide-overlay-v63','guide-overlay-v64'),case_id=None,category='current-route-overlay'):
    package = Path(package).resolve()
    site = package/'site'
    index_path = site/'data/api-index.json'
    before = index_path.read_bytes()
    if sha(before) != index_sha256:
        raise ValueError('Explicit API index byte pin differs')
    index = json.loads(before)
    selected = {k:v for k,v in index['entries'].items()
        if urlsplit(k).path in {'/api/current/'+e for e in endpoints}
        and (case_id is None or parse_qs(urlsplit(k).query).get('case_id')==[case_id])}
    if not selected or any(v.get('encoding') != 'gzip' for v in selected.values()):
        raise ValueError('Expected a fresh finite gzip current-overlay population')
    if not execute:
        return dict(status='DRY_RUN',routes=len(selected),api_calls=0)
    identity = sha(encoded(dict(index_sha256=index_sha256,minimum=minimum,chunk_bytes=chunk_bytes,
        endpoints=endpoints,case_id=case_id,category=category,
        code_sha256=sha(Path(__file__).read_bytes()))))
    directory = 'data/packed/current-overlays-'+identity[:16]
    stage = package/'.current-export'/'overlay-pack'/identity
    stage.mkdir(parents=True,exist_ok=False)
    chunks, interned, roots, aliases, inputs = [], {}, {}, {}, {}
    pending, pending_bytes, next_id, fragment_chunks = [],0,1,{}

    def flush():
        nonlocal pending,pending_bytes
        if not pending:return
        first=next_id-len(pending)
        raw=encoded(dict(version='graph-fragment-dag-chunk/1',first_id=first,fragments=pending))
        if len(raw)>=16*1024**2:raise ValueError('Replay fragment exceeds browser chunk budget')
        wire=gzip.compress(raw,compresslevel=6,mtime=0)
        relative='chunks/'+sha(wire)+'.json.gz'
        atomic(stage/relative,wire)
        chunks.append(dict(id=len(chunks),first_id=first,last_id=next_id-1,
            path=relative,encoding='gzip',decoded_bytes=len(raw),wire_bytes=len(wire),
            sha256decoded=sha(raw),wire_sha256=sha(wire)))
        pending,pending_bytes=[],0

    def intern(text):
        nonlocal pending_bytes,next_id
        digest = sha(text.encode('ascii'))
        if digest not in interned:
            size=len(encoded([text]))+1
            if pending and pending_bytes+size>chunk_bytes:flush()
            fragment_chunks[next_id]=len(chunks)
            pending.append([text]);pending_bytes+=size
            interned[digest]=next_id;next_id+=1
            if pending_bytes>=chunk_bytes:flush()
        return interned[digest]

    for key, entry in selected.items():
        asset = 'overlay_'+entry['sha256']
        aliases[key] = asset
        if asset in roots:
            continue
        path = site/entry['path']
        wire = path.read_bytes()
        raw = gzip.decompress(wire)
        if sha(wire) != entry['wire_sha256'] or sha(raw) != entry['sha256']:
            raise ValueError('Original overlay transport hash changed')
        value = json.loads(raw)
        if encoded(value) != raw:
            raise ValueError('Overlay is not the exact canonical current-export JSON')
        pieces, dependencies = ['{'], set()
        for number, (field, child) in enumerate(sorted(value.items())):
            pieces[-1] += (',' if number else '')+encoded(field).decode('ascii')+':'
            text = encoded(child).decode('ascii')
            if len(text) < minimum:
                pieces[-1] += text
            else:
                for offset in range(0,len(text),chunk_bytes):
                    fragment = intern(text[offset:offset+chunk_bytes])
                    dependencies.add(fragment_chunks[fragment])
                    pieces.extend([fragment,''])
        pieces[-1] += '}'
        roots[asset] = dict(encoding='fragment-dag',pieces=pieces,dependencies=sorted(dependencies),
            decoded_bytes=len(raw),sha256decoded=sha(raw),originalsha256=sha(wire),
            original_decoded_sha256=sha(raw),category=category,
            canonicalization='Exact canonical public-export bytes; no value or number changes')
        inputs[entry['path']] = sha(wire)
    flush()
    manifest = dict(version='graph-fragment-dag/1',encoding='fragment-dag',status='COMPLETE',
        assets=roots,chunks=chunks,original_assets_modified=False,all_roots_transport_verified=True)
    manifest['sha256'] = sha(pack_encoded(manifest))
    reader = Reader(stage,manifest,max_output_bytes=210000000)
    for asset, root in roots.items():
        checksum = __import__('hashlib').sha256()
        count = 0
        for block in reader.iter_asset(asset):
            checksum.update(block);count += len(block)
        if checksum.hexdigest() != root['sha256decoded'] or count != root['decoded_bytes']:
            raise ValueError('Overlay byte-for-byte roundtrip failed')
    raw_manifest = pack_encoded(manifest)
    if len(raw_manifest)>=32*1024**2:
        raise ValueError('Case response dictionary exceeds browser manifest budget')
    atomic(stage/'manifest.json',raw_manifest)
    result = deepcopy(index)
    for key, asset in aliases.items():
        result['entries'][key] = dict(encoding='fragment-dag',path=directory+'/manifest.json',
            asset=asset,manifest_sha256=sha(raw_manifest),sha256=roots[asset]['sha256decoded'],mime='application/json')
    with (package/'.graph-refresh.lock').open('a+') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        if index_path.read_bytes() != before or any(sha((site/path).read_bytes()) != pin for path,pin in inputs.items()):
            raise ValueError('Concurrent index/overlay update; no pointer installed')
        for relative in ['manifest.json']+[c['path'] for c in chunks]:
            target = site/directory/relative
            if target.exists():
                raise ValueError('Use a fresh immutable overlay pack')
            atomic(target,(stage/relative).read_bytes())
        atomic(stage/'before-index.json',before)
        atomic(index_path,encoded(result))
    receipt = dict(status='PACKED_EXACT_BYTES',routes=len(selected),assets=len(roots),
        before_index_sha256=index_sha256,index_sha256=sha(encoded(result)),
        original_unique_wire_bytes=sum((site/p).stat().st_size for p in inputs),
        packed_wire_bytes=len(raw_manifest)+sum(c['wire_bytes'] for c in chunks),
        api_calls=0,native_outputs_modified=False,all_roots_transport_verified=True)
    atomic(stage/'completion.json',encoded(receipt))
    return receipt


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--index-sha256',required=True)
    p.add_argument('--execute',action='store_true')
    modes=p.add_mutually_exclusive_group()
    modes.add_argument('--sources',action='store_true',help='Separate per-case dictionaries of exact source-page responses')
    modes.add_argument('--nodes',action='store_true',help='Separate per-case dictionaries of exact saved-node responses')
    modes.add_argument('--guides',action='store_true',help='Separate per-case dictionaries of exact saved-route responses')
    args = p.parse_args()
    package=Path(__file__).resolve().parents[1]
    if args.sources or args.nodes or args.guides:
        endpoint='source-v6'if args.sources else 'node-v6'if args.nodes else 'guide-v6'
        index=json.loads((package/'site/data/api-index.json').read_bytes())
        cases=sorted({parse_qs(urlsplit(k).query)['case_id'][0]for k in index['entries']
            if urlsplit(k).path=='/api/current/'+endpoint and index['entries'][k].get('encoding')=='gzip'})
        pin=args.index_sha256
        for cid in cases:
            result=pack(package,pin,execute=args.execute,minimum=512,endpoints=(endpoint,),
                case_id=cid,category='current-'+endpoint)
            print(json.dumps(dict(result,case_id=cid),sort_keys=True),flush=True)
            if args.execute:pin=result['index_sha256']
    else:
        print(json.dumps(pack(package,args.index_sha256,execute=args.execute),sort_keys=True))
