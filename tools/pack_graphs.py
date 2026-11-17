"""Lossless graph transport prototype, independent of graph/native semantics.

Runtime contract (for the public-runtime owner):
* ``encoding=fragment-dag`` roots and dictionary rows are odd-length arrays
  alternating ASCII JSON text strings and positive integer fragment IDs.
  A source array such as ["$ref", 1] is literal text, NEVER a reference tag.
* Gzip chunks contain {version, first_id, fragments}; IDs are consecutive and
  every reference is to a smaller ID. Check wire_sha256 before decompression,
  sha256decoded after decompression, then root sha256decoded after assembly.
* Fetch only the root's dependencies; concatenate text, THEN JSON.parse once.
  Never parse/reserialize literal number tokens in the dictionary. All fields,
  object/array order, source text and number lexemes survive. Whitespace/string
  escaping is normalized to ASCII JSON; originalsha256 pins the ORIGINAL file,
  not a claim that canonical transport reproduces its gzip header/formatting.
* Fragment identities are Merkle hashes of tagged text/child hashes, NOT hashes
  of repeatedly expanded ancestor JSON. Root hashes ARE SHA256 of actual
  decoded canonical JSON bytes. Work is linear in tokens/template bytes, not
  quadratic serialization of every ancestor's expanded JSON.

Only a fresh explicit scratch --output is written. No active index is changed.
Preview is default; --execute performs a bounded local sample and round trips.
The SQLite build database is NOT a public payload. No network/API dependencies.
"""
from __future__ import annotations

import argparse
from bisect import bisect_right
from collections import OrderedDict
from dataclasses import dataclass
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import sqlite3
import time
import zlib

VERSION = "graph-fragment-dag/1"
CHUNK_VERSION = "graph-fragment-dag-chunk/1"
CANONICAL = "ascii-json-preserve-number-lexemes/1"
WORKSPACE = Path(__file__).resolve().parents[2]
NUMBER = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?")
SAFE_ID = 2**53 - 1
FULL_BINDING_SHA256 = "13fb0246056b8ec308abf78e4df848b279ff82bdeb8b5f27deb838feaeb8a70f"


def require(value, message):
    if not value:
        raise ValueError(message)


def encoded(value):
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"), allow_nan=False).encode("ascii")


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def file_sha(path):
    result = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024**2), b""):
            result.update(block)
    return result.hexdigest()


def sealed(value):
    return dict(value, sha256=sha(encoded(value)))


def immutable(path, raw):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as stream:
        stream.write(raw)


@dataclass(frozen=True, slots=True)
class Ref:
    id: int
    key: bytes
    size: int


class Dictionary:
    """Global disk index; the bounded hot cache stores metadata, not expansions."""
    def __init__(self, path, cache_entries=65536):
        require(not Path(path).exists(), "Refuse an existing build database")
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA journal_mode=DELETE")
        self.db.execute("PRAGMA cache_size=-65536")
        self.db.execute("CREATE TABLE fragments (id INTEGER PRIMARY KEY, digest BLOB UNIQUE NOT NULL, size INTEGER NOT NULL, pieces BLOB NOT NULL, owner INTEGER NOT NULL)")
        self.cache = OrderedDict()
        self.cache_entries = cache_entries
        self.owner = 0
        self.used = set()
        self.visits = self.hits = self.created = self.template_bytes = 0

    def intern(self, pieces):
        require(len(pieces) % 2 == 1, "Malformed template")
        h = hashlib.sha256(b"graph-fragment-dag-concat/1\0")
        ids, size = [], 0
        for i, piece in enumerate(pieces):
            if i % 2:
                require(isinstance(piece, Ref), "Reference positions require Ref")
                h.update(b"R" + piece.key)
                ids.append(piece.id)
                size += piece.size
            else:
                require(isinstance(piece, str), "Literal positions require text")
                raw = piece.encode("ascii")
                h.update(b"T" + len(raw).to_bytes(8, "big") + raw)
                ids.append(piece)
                size += len(raw)
        key = h.digest()
        self.visits += 1
        ref = self.cache.get(key)
        if ref:
            self.cache.move_to_end(key)
            self.hits += 1
        else:
            row = self.db.execute("SELECT id,size FROM fragments WHERE digest=?", (key,)).fetchone()
            if row:
                require(row[1] == size, "Fragment digest/size collision")
                ref = Ref(row[0], key, size)
                self.hits += 1
            else:
                raw = encoded(ids)
                cursor = self.db.execute("INSERT INTO fragments(digest,size,pieces,owner) VALUES (?,?,?,?)", (key,size,raw,self.owner))
                require(cursor.lastrowid <= SAFE_ID, "Fragment IDs exceed browser safe integers")
                ref = Ref(cursor.lastrowid,key,size)
                self.created += 1
                self.template_bytes += len(raw)
            if self.cache_entries:
                self.cache[key] = ref
                if len(self.cache) > self.cache_entries:
                    self.cache.popitem(last=False)
        self.used.add(ref.id)
        return ref

    def close(self):
        self.db.commit()
        self.db.close()


class Builder:
    """Bounded raw/template buffers; long values become backward-reference ropes."""
    def __init__(self, dictionary, minimum, template_limit):
        self.dictionary = dictionary
        self.minimum = minimum
        self.limit = template_limit
        self.parts = []
        self.raw = []
        self.width = 0

    def flush_text(self):
        self.parts.append("".join(self.raw))
        self.raw.clear()

    def add(self, piece):
        if isinstance(piece, Ref):
            self.flush_text()
            self.parts.append(piece)
            self.width += 20
            self.split_if_needed()
        else:
            for start in range(0,len(piece),16384):
                text = piece[start:start+16384]
                self.raw.append(text)
                self.width += len(text)
                self.split_if_needed()

    def split_if_needed(self):
        if self.width >= self.limit:
            self.flush_text()
            ref = self.dictionary.intern(self.parts)
            self.parts = ["",ref]
            self.raw = []
            self.width = 20

    def finish(self, force=False):
        self.flush_text()
        if not force and len(self.parts) == 1 and len(self.parts[0]) < self.minimum:
            return self.parts[0]
        return self.dictionary.intern(self.parts)


class Sink:
    def __init__(self):
        self.hash = hashlib.sha256()
        self.buffer = bytearray()
        self.size = self.gzip_size = 0
        self.compressor = zlib.compressobj(9,zlib.DEFLATED,31)

    def write(self, raw):
        self.buffer.extend(raw.encode("ascii"))
        if len(self.buffer) >= 65536:
            self.flush()

    def flush(self):
        self.hash.update(self.buffer)
        self.size += len(self.buffer)
        self.gzip_size += len(self.compressor.compress(self.buffer))
        self.buffer.clear()

    def finish(self):
        self.flush()
        self.gzip_size += len(self.compressor.flush())
        return self.hash.hexdigest()


class Parser:
    def __init__(self, text, dictionary, minimum=256, template_limit=65536, max_depth=128):
        self.text, self.pos = text, 0
        self.dictionary, self.minimum, self.limit = dictionary, minimum, template_limit
        self.max_depth = max_depth
        self.sink = Sink()
        self.strings = OrderedDict()

    def whitespace(self):
        text = self.text
        while self.pos < len(text) and text[self.pos] in " \r\n\t":
            self.pos += 1

    def token(self, text):
        self.sink.write(text)
        return text

    def string(self):
        require(self.pos < len(self.text) and self.text[self.pos] == '"', "Expected JSON string")
        value, self.pos = json.decoder.scanstring(self.text,self.pos+1,True)
        literal = self.strings.get(value) if len(value) < 256 else None
        if literal is None:
            literal = encoded(value).decode("ascii")
            if len(value) < 256:
                self.strings[value] = literal
                if len(self.strings) > 32768:
                    self.strings.popitem(last=False)
        return value,self.token(literal)

    def value(self, depth=0):
        require(depth <= self.max_depth, "JSON nesting exceeds explicit depth limit")
        self.whitespace()
        require(self.pos < len(self.text), "Truncated JSON value")
        ch = self.text[self.pos]
        b = Builder(self.dictionary,self.minimum,self.limit)
        if ch in "[{":
            end = "]" if ch == "[" else "}"
            b.add(self.token(ch))
            self.pos += 1
            self.whitespace()
            keys = set() if ch == "{" else None
            if self.pos < len(self.text) and self.text[self.pos] != end:
                while True:
                    if keys is not None:
                        self.whitespace()
                        key,literal = self.string()
                        require(key not in keys, "Duplicate object key would not be lossless")
                        keys.add(key)
                        b.add(literal)
                        self.whitespace()
                        require(self.pos < len(self.text) and self.text[self.pos] == ":", "Expected colon")
                        self.pos += 1
                        b.add(self.token(":"))
                    b.add(self.value(depth+1))
                    self.whitespace()
                    require(self.pos < len(self.text), "Truncated container")
                    if self.text[self.pos] == end:
                        break
                    require(self.text[self.pos] == ",", "Expected comma or container end")
                    self.pos += 1
                    b.add(self.token(","))
            require(self.pos < len(self.text) and self.text[self.pos] == end, "Truncated or malformed container")
            self.pos += 1
            b.add(self.token(end))
        elif ch == '"':
            _,literal = self.string()
            b.add(literal)
        else:
            match = NUMBER.match(self.text,self.pos)
            if match:
                literal = match.group()
            else:
                literal = next((word for word in ("true","false","null") if self.text.startswith(word,self.pos)), None)
                require(literal is not None, "Invalid JSON scalar")
            self.pos += len(literal)
            b.add(self.token(literal))
        return b.finish()

    def parse(self):
        root = self.value()
        self.whitespace()
        require(self.pos == len(self.text), "Trailing JSON data")
        if not isinstance(root,Ref):
            root = self.dictionary.intern([root])
        checksum = self.sink.finish()
        require(root.size == self.sink.size, "Canonical byte count differs")
        return root,checksum


class ChunkWriter:
    def __init__(self, output, dictionary, chunk_bytes=4*1024**2):
        self.output, self.dictionary, self.limit = Path(output),dictionary,chunk_bytes
        self.chunks = []
        self.last_id = 0

    def flush_new(self):
        group, size = [], 0
        for row in self.dictionary.db.execute("SELECT id,pieces FROM fragments WHERE id>? ORDER BY id",(self.last_id,)):
            if group and size+len(row[1])+1 > self.limit-128:
                self.write(group)
                group, size = [], 0
            require(len(row[1]) < self.limit-128, "Single template exceeds dictionary chunk limit")
            group.append(row)
            size += len(row[1])+1
        if group:
            self.write(group)

    def write(self, rows):
        require(rows[0][0] == self.last_id+1, "Dictionary ID gap")
        prefix = encoded(dict(version=CHUNK_VERSION,first_id=rows[0][0]))[:-1]
        raw = prefix + b',"fragments":[' + b",".join(r[1] for r in rows) + b"]}"
        require(len(raw) <= self.limit, "Dictionary chunk exceeds limit")
        wire = gzip.compress(raw,compresslevel=9,mtime=0)
        name = "chunks/" + sha(wire) + ".json.gz"
        immutable(self.output/name,wire)
        self.chunks.append(dict(id=len(self.chunks),path=name,encoding="gzip",wire_sha256=sha(wire),
            sha256decoded=sha(raw),decoded_bytes=len(raw),wire_bytes=len(wire),first_id=rows[0][0],last_id=rows[-1][0]))
        self.last_id = rows[-1][0]

    def dependencies(self, fragment_ids):
        starts = [c["first_id"] for c in self.chunks]
        deps = set()
        for fid in fragment_ids:
            index = bisect_right(starts,fid)-1
            require(index >= 0 and fid <= self.chunks[index]["last_id"], "Unexported dependency")
            deps.add(index)
        return sorted(deps)


class Reader:
    """Independent reference decoder; no source original or SQLite required."""
    def __init__(self, output, manifest, cache_chunks=64, max_output_bytes=4*1024**3):
        self.output = Path(output).resolve()
        require(manifest.get("version") == VERSION and manifest.get("encoding") == "fragment-dag", "Unknown graph pack")
        require(manifest.get("sha256") == sha(encoded({k:v for k,v in manifest.items() if k != "sha256"})), "Manifest digest differs")
        self.manifest = manifest
        self.chunks = manifest["chunks"]
        self.starts = [c["first_id"] for c in self.chunks]
        require(all(c["id"] == i and c["first_id"] == (1 if i == 0 else self.chunks[i-1]["last_id"]+1)
                    and c["last_id"] >= c["first_id"] for i,c in enumerate(self.chunks)), "Chunk ID ranges differ")
        self.cache, self.cache_chunks, self.max_output = OrderedDict(),cache_chunks,max_output_bytes

    def chunk(self, index):
        if index in self.cache:
            self.cache.move_to_end(index)
            return self.cache[index]
        ref = self.chunks[index]
        require(re.fullmatch(r"chunks/[a-f0-9]{64}\.json\.gz",ref["path"]), "Unsafe chunk path")
        path = self.output/ref["path"]
        require(path.resolve().is_relative_to(self.output), "Chunk symlink leaves pack")
        wire = path.read_bytes()
        require(len(wire) == ref["wire_bytes"] and sha(wire) == ref["wire_sha256"], "Chunk wire integrity failure")
        require(0 <= ref["decoded_bytes"] <= 64*1024**2, "Chunk exceeds decoder size bound")
        with gzip.GzipFile(fileobj=io.BytesIO(wire)) as stream:
            raw = stream.read(ref["decoded_bytes"]+1)
        require(len(raw) == ref["decoded_bytes"] and sha(raw) == ref["sha256decoded"], "Chunk decoded integrity failure")
        value = json.loads(raw)
        require(value["version"] == CHUNK_VERSION and value["first_id"] == ref["first_id"], "Chunk header differs")
        rows = value["fragments"]
        require(len(rows) == ref["last_id"]-ref["first_id"]+1, "Chunk row count differs")
        for fid,pieces in enumerate(rows,ref["first_id"]):
            self.validate(pieces,fid)
        self.cache[index] = rows
        if len(self.cache) > self.cache_chunks:
            self.cache.popitem(last=False)
        return rows

    @staticmethod
    def validate(pieces, parent=SAFE_ID+1):
        require(isinstance(pieces,list) and len(pieces) % 2 == 1, "Malformed template pieces")
        for i,piece in enumerate(pieces):
            require(isinstance(piece,str) if i % 2 == 0 else type(piece) is int and 0 < piece < parent,
                    "Literal/ref collision or non-backward reference")
            if i % 2 == 0:
                piece.encode("ascii")

    def needed_templates(self, root_pieces, allowed):
        """Resolve backward refs topologically, loading each needed chunk once.

        Scanning both chunks and rows in descending ID order means a discovered
        child is always still ahead of the scan. Reachable templates are held
        independently of the bounded cross-root chunk LRU. Expansion never
        consults or refills that cache, even when dependencies exceed capacity.
        """
        pending, retained = {}, {}

        def enqueue(fid):
            index = bisect_right(self.starts,fid)-1
            require(index in allowed and fid <= self.chunks[index]["last_id"],
                    "Undeclared or absent fragment dependency")
            pending.setdefault(index,set()).add(fid)

        for fid in root_pieces[1::2]:
            enqueue(fid)
        for index in sorted(allowed,reverse=True):
            if index not in pending:
                continue
            needed = pending[index]
            rows = self.chunk(index)
            first = self.chunks[index]["first_id"]
            for offset in range(len(rows)-1,-1,-1):
                fid = first+offset
                if fid not in needed:
                    continue
                pieces = rows[offset]
                needed.remove(fid)
                retained[fid] = pieces
                for child in pieces[1::2]:
                    enqueue(child)
            require(not needed, "Unresolved fragment within dependency chunk")
            del pending[index]
            del rows
        require(not pending, "Unresolved fragment dependencies")
        return retained

    def iter_asset(self, name):
        root = self.manifest["assets"][name]
        require(root["encoding"] == "fragment-dag", "Unknown root encoding")
        require(0 <= root["decoded_bytes"] <= self.max_output, "Root exceeds output limit")
        self.validate(root["pieces"])
        allowed = set(root["dependencies"])
        require(all(type(i) is int and 0 <= i < len(self.chunks) for i in allowed), "Unknown dependency chunk")
        retained = self.needed_templates(root["pieces"],allowed)
        stack = [iter(root["pieces"])]
        checksum, length = hashlib.sha256(),0
        while stack:
            try:
                piece = next(stack[-1])
            except StopIteration:
                stack.pop()
                continue
            if isinstance(piece,str):
                raw = piece.encode("ascii")
                length += len(raw)
                require(length <= root["decoded_bytes"], "Root expansion exceeds declared size")
                checksum.update(raw)
                if raw:
                    yield raw
            else:
                require(piece in retained, "Unresolved fragment during expansion")
                stack.append(iter(retained[piece]))
        require(length == root["decoded_bytes"] and checksum.hexdigest() == root["sha256decoded"], "Assembled root integrity failure")

    def decode(self, name):
        return b"".join(self.iter_asset(name))


def select_sample(source_root, corpora=("iran","cib","vietnam"), shards_per_view=1, include_search=False):
    binding_path = source_root/"src-demo-day/data/full_graph_bindings_v4.json"
    binding = json.loads(binding_path.read_bytes())
    selected, population = [], []
    for corpus in corpora:
        bound = binding["corpora"][corpus]
        views = ("current_earlier","current_later") if corpus == "cib" else ("current_redaction","current_later")
        comparison_ref = bound["assets"][bound["comparison"]]
        require(file_sha(source_root/comparison_ref["path"]) == comparison_ref["sha256"], "Comparison binding differs")
        comparison = json.loads((source_root/comparison_ref["path"]).read_bytes())
        hierarchy_names = {name for view in views for name in comparison["hierarchy_catalogs"]["files"][view].values()}
        for name,ref in bound["assets"].items():
            active = any("."+view+"." in name for view in views)
            if not active:
                continue
            category = "neighborhood" if ".neighborhood." in name else "hierarchy" if name in hierarchy_names else "other"
            population.append(dict(corpus=corpus,category=category,name=name,bytes=ref["bytes"]))
        for view in views:
            choices = [(name,ref) for name,ref in bound["assets"].items() if "."+view+".neighborhood." in name]
            for name,ref in sorted(choices,key=lambda item:(-item[1]["bytes"],item[0]))[:shards_per_view]:
                selected.append(dict(corpus=corpus,category="neighborhood",name=name,ref=ref))
        for view in views:
            name = comparison["hierarchy_catalogs"]["files"][view]["community"]
            selected.append(dict(corpus=corpus,category="hierarchy",name=name,ref=bound["assets"][name]))
        if include_search:
            for view in views:
                choices = [(name,ref) for name,ref in bound["assets"].items() if "search" in name and "."+view+"." in name]
                if choices:
                    name,ref = max(choices,key=lambda item:item[1]["bytes"])
                    selected.append(dict(corpus=corpus,category="search",name=name,ref=ref))
    return selected,population,dict(path=str(binding_path),sha256=file_sha(binding_path))


def category(name):
    if ".neighborhood." in name:
        return "neighborhood"
    if ".members." in name:
        return "members"
    if ".adjacency." in name:
        return "adjacency"
    if ".sources." in name:
        return "sources"
    if "search" in name:
        return "search"
    if any("."+level+"." in name for level in ("community","theme","evidence")):
        return "hierarchy"
    return "bootstrap"


def checked_ref(source_root, reference, verify_hash=True):
    relative = Path(reference["path"])
    require(not relative.is_absolute() and ".." not in relative.parts, "Unsafe source path")
    path = (source_root/relative).resolve()
    require(path.is_relative_to(source_root.resolve()), "Source symlink leaves workspace")
    require(re.fullmatch("[a-f0-9]{64}",reference.get("sha256", "")), "Missing source SHA256")
    if "bytes" in reference:
        require(path.stat().st_size == reference["bytes"], "Source byte count differs")
    if verify_hash:
        require(file_sha(path) == reference["sha256"], "Source hash differs")
    return path


def select_reachable(source_root, corpora=("iran","cib","vietnam"), verify_hashes=False,
                     binding_sha256=FULL_BINDING_SHA256):
    """Replay comparison/search references and shard templates, not bytes maps.

    Returns a reusable input-list object. Its ``selected`` rows use logical
    /graph-assets-v4 keys plus actual pinned workspace refs. Default full
    binding is byte-pinned; fixtures/next binding must be explicit alternatives.
    """
    source_root = Path(source_root).resolve()
    binding_path = source_root/"src-demo-day/data/full_graph_bindings_v4.json"
    require(file_sha(binding_path) == binding_sha256, "Full graph binding differs")
    binding = json.loads(binding_path.read_bytes())
    selected, totals = [], {}
    for corpus in corpora:
        bound = binding["corpora"][corpus]
        assets = bound["assets"]
        active = {"current_earlier","current_later"} if corpus == "cib" else {"current_redaction","current_later"}
        bootstrap = (bound["comparison"],bound["search"])
        documents = [json.loads(checked_ref(source_root,assets[n]).read_bytes()) for n in bootstrap]
        known_views = set(documents[0]["views"])
        found = set(bootstrap)

        def walk(value, parent=None):
            if isinstance(value,dict):
                for key,child in value.items():
                    if key in {"bytes","view_bytes","evidence_view_bytes"} or key in known_views-active:
                        continue
                    walk(child,value)
            elif isinstance(value,list):
                for child in value:
                    walk(child,parent)
            elif isinstance(value,str):
                if value in assets:
                    found.add(value)
                elif "{shard}" in value:
                    pattern = re.escape(value).replace(r"\{shard\}",r"[0-9]{2}")
                    names = [n for n in assets if re.fullmatch(pattern,n)]
                    require(names, "Shard template has no bound files")
                    if isinstance(parent,dict) and "shard_count" in parent:
                        require(len(names) == parent["shard_count"], "Shard template count differs")
                    found.update(names)

        for document in documents:
            walk(document)
        expected = {n for n in assets if n in bootstrap or any("."+v+"." in n for v in active)}
        require(found == expected, "Consumer-reference closure differs from active bound files: " +
                str(dict(missing=sorted(expected-found)[:8],unexpected=sorted(found-expected)[:8])))
        for name in sorted(found):
            checked_ref(source_root,assets[name],verify_hashes)
            selected.append(dict(name="/graph-assets-v4/"+corpus+"/"+name,corpus=corpus,
                category=category(name),ref=assets[name]))
        totals[corpus] = dict(files=len(found),bytes=sum(assets[n]["bytes"] for n in found),active_views=sorted(active))
    return dict(version="graph-pack-input-list/1",workspace_root=str(source_root),selected=selected,
        source_binding=dict(path="src-demo-day/data/full_graph_bindings_v4.json",sha256=binding_sha256),
        corpus_totals=totals,original_stored_bytes=sum(i["ref"]["bytes"] for i in selected),
        bytes_maps_are_not_fetch_dependencies=True,hashes_verified=verify_hashes)


def read_input_list(path, source_root):
    """Accept pinned selected/inputs rows; no globbing, guessing or re-selection.

    Rows: {name|key, ref:{path,sha256,bytes?}, corpus?,category?}. A bare
    array is also accepted. Lead's prepared graph list may provide a separate
    lineage[name].original ref, which is independently verified, not invented.
    Multiple --input-list flags combine graph and saved public API packets in
    one global dictionary, in the supplied order.
    """
    path, source_root = Path(path),Path(source_root).resolve()
    wire = path.read_bytes()
    document = json.loads(wire)
    if isinstance(document,dict):
        if "sha256" in document:
            require(document["sha256"] == sha(encoded({k:v for k,v in document.items() if k != "sha256"})), "Input-list seal differs")
        if "workspace_root" in document:
            require(Path(document["workspace_root"]).resolve() == source_root, "Input-list workspace differs from --source-root")
        selected = document.get("selected",document.get("inputs"))
        lineage = document.get("lineage",{})
        bound_sha = document.get("source_binding_sha256")
        if bound_sha:
            require(file_sha(source_root/"src-demo-day/data/full_graph_bindings_v4.json") == bound_sha, "Input-list source binding differs")
    else:
        selected,lineage = document,{}
    require(isinstance(selected,list) and selected, "Input list needs a nonempty selected/inputs array")
    rows = []
    for item in selected:
        require(isinstance(item,dict), "Input-list row must be an object")
        name = item.get("key",item.get("name"))
        require(isinstance(name,str) and name, "Input-list row needs exact name/key")
        reference = item.get("ref")
        if reference is None:
            reference = {k:item[k] for k in ("path","sha256","bytes") if k in item}
        checked_ref(source_root,reference,False)
        row = dict(name=name,ref=reference,corpus=item.get("corpus","public"),category=item.get("category","api"))
        original = item.get("original_ref") or lineage.get(name,{}).get("original")
        if lineage.get(name,{}).get("prepared"):
            require(lineage[name]["prepared"] == reference, "Prepared lineage differs from selected input ref")
        if original:
            checked_ref(source_root,original,False)
            row["original_ref"] = original
        rows.append(row)
    require(len({r["name"] for r in rows}) == len(rows), "Duplicate logical input key")
    return rows,dict(path=str(path.resolve()),sha256=sha(wire),assets=len(rows))


def pack_assets(source_root, output, selected, minimum=256, chunk_bytes=4*1024**2, template_limit=65536):
    source_root, output = Path(source_root).resolve(),Path(output).resolve()
    require(minimum >= 1 and template_limit >= minimum and chunk_bytes >= 8*template_limit, "Invalid fragment/chunk sizes")
    require(not output.exists() or not any(output.iterdir()), "Use a fresh, empty scratch output")
    for item in selected:
        relative = Path(item["ref"]["path"])
        require(not relative.is_absolute() and ".." not in relative.parts, "Unsafe source path")
        source = (source_root/relative).resolve()
        require(source.is_relative_to(source_root) and not source.is_relative_to(output), "Output contains source assets")
        if item.get("original_ref"):
            original_path = checked_ref(source_root,item["original_ref"],False)
            require(not original_path.is_relative_to(output), "Output contains original lineage assets")
    require(len({i["name"] for i in selected}) == len(selected), "Duplicate asset selector")
    output.mkdir(parents=True,exist_ok=True)
    store = Dictionary(output/"build.sqlite3")
    writer = ChunkWriter(output,store,chunk_bytes)
    assets, measurements = {}, []
    start = time.monotonic()
    try:
        for number,item in enumerate(selected):
            require(shutil.disk_usage(output).free >= 4*1024**3, "Disk guard: less than 4GiB free; scratch preserved")
            before_bytes = sum(c["wire_bytes"] for c in writer.chunks)
            before_created = store.created
            source = source_root/item["ref"]["path"]
            checksum = file_sha(source)
            require(checksum == item["ref"]["sha256"], "Original source hash differs")
            require(source.stat().st_size == item["ref"].get("bytes",source.stat().st_size), "Original source size differs")
            original_ref = item.get("original_ref",item["ref"])
            checked_ref(source_root,original_ref,original_ref != item["ref"])
            store.owner, store.used = number,set()
            if source.suffix == ".gz":
                with gzip.open(source,"rb") as stream:
                    original = stream.read()
            else:
                original = source.read_bytes()
            original_decoded_sha, original_decoded_bytes = sha(original),len(original)
            parser = Parser(original.decode("utf-8"),store,minimum,template_limit)
            del original
            root,decoded_sha = parser.parse()
            store.db.commit()
            writer.flush_new()
            entry = dict(encoding="fragment-dag",pieces=["",root.id,""],dependencies=writer.dependencies(store.used),
                sha256decoded=decoded_sha,decoded_bytes=root.size,originalsha256=checksum,
                original_decoded_sha256=original_decoded_sha,original_bytes=source.stat().st_size,
                original_decoded_bytes=original_decoded_bytes,original_encoding="gzip" if source.suffix == ".gz" else "identity",
                root_merkle_sha256=root.key.hex(),canonicalization=CANONICAL,corpus=item["corpus"],category=item["category"])
            entry.update(input_sha256=checksum,input_decoded_sha256=original_decoded_sha,
                input_bytes=source.stat().st_size,input_encoding=entry["original_encoding"],
                originalsha256=original_ref["sha256"],original_bytes=(source_root/original_ref["path"]).stat().st_size,
                source_metadata_preprocessed=original_ref["sha256"] != checksum)
            if entry["source_metadata_preprocessed"]:
                entry["original_decoded_sha256"] = None
            assets[item["name"]] = entry
            tentative = sealed(dict(version=VERSION,encoding="fragment-dag",chunks=writer.chunks,assets={item["name"]:entry}))
            reader = Reader(output,tentative)
            for _ in reader.iter_asset(item["name"]):
                pass
            require(file_sha(source) == checksum, "Source changed while packing")
            new_bytes = sum(c["wire_bytes"] for c in writer.chunks)-before_bytes
            measurement = dict(name=item["name"],corpus=item["corpus"],category=item["category"],
                original_bytes=entry["input_bytes"],canonical_bytes=root.size,
                canonical_gzip_baseline_bytes=parser.sink.gzip_size,
                marginal_dictionary_wire_bytes=new_bytes,new_fragments=store.created-before_created,
                dependency_chunks=len(entry["dependencies"]),
                dependency_wire_bytes=sum(writer.chunks[i]["wire_bytes"] for i in entry["dependencies"]),
                reconstruction_verified=True,elapsed_seconds=round(time.monotonic()-start,3))
            measurements.append(measurement)
            print(json.dumps(measurement),flush=True)
            del parser
        manifest = sealed(dict(version=VERSION,status="COMPLETE",encoding="fragment-dag",canonicalization=CANONICAL,
            minimum_fragment_bytes=minimum,template_limit_bytes=template_limit,chunk_limit_bytes=chunk_bytes,
            chunks=writer.chunks,assets=assets,original_assets_modified=False,all_roots_transport_verified=True))
        raw = encoded(manifest)
        immutable(output/"manifest.json",raw)
        original_bytes = sum(m["original_bytes"] for m in measurements)
        wire_bytes = sum(c["wire_bytes"] for c in writer.chunks)+len(raw)
        result = dict(version="graph-packing-measurement/1",status="COMPLETE",manifest=dict(path="manifest.json",sha256=file_sha(output/"manifest.json")),
            asset_count=len(assets),measurements=measurements,original_stored_bytes=original_bytes,
            canonical_json_bytes=sum(m["canonical_bytes"] for m in measurements),
            separate_canonical_gzip_baseline_bytes=sum(m["canonical_gzip_baseline_bytes"] for m in measurements),
            published_wire_bytes=wire_bytes,manifest_bytes=len(raw),dictionary_chunks=len(writer.chunks),
            dictionary_fragments=store.created,dictionary_template_bytes=store.template_bytes,
            fragment_visits=store.visits,fragment_reuse_visits=store.hits,
            stored_ratio=wire_bytes/original_bytes if original_bytes else None,
            elapsed_seconds=round(time.monotonic()-start,3),api_calls=0,
            measurement_only_not_published=True,sqlite_build_file_is_not_public=True,
            extrapolation_is_not_full_corpus_measurement=True)
        immutable(output/"measurement.json",encoded(sealed(result)))
        return manifest,result
    finally:
        store.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root",type=Path,default=WORKSPACE)
    parser.add_argument("--output",type=Path)
    parser.add_argument("--corpus",action="append",choices=("iran","cib","vietnam"))
    parser.add_argument("--shards-per-view",type=int,choices=(1,2),default=1)
    parser.add_argument("--include-search",action="store_true")
    parser.add_argument("--minimum",type=int,default=256)
    parser.add_argument("--input-list",type=Path,action="append",help="Explicit selected/inputs JSON rows; repeat to combine graph+public API packets")
    parser.add_argument("--reachable",action="store_true",help="Replay all active comparison/search fetch references")
    parser.add_argument("--write-input-list",type=Path,help="Write an immutable reusable selection; preview otherwise writes nothing")
    parser.add_argument("--execute",action="store_true")
    args = parser.parse_args(argv)
    source_root = args.source_root.resolve()
    if args.input_list:
        require(not args.reachable,"Use input-list OR reachable selection")
        selected,refs = [],[]
        for path in args.input_list:
            rows,reference = read_input_list(path,source_root)
            selected.extend(rows)
            refs.append(reference)
        require(len({i["name"] for i in selected}) == len(selected), "Duplicate key across input lists")
        preview = dict(version="graph-pack-input-list/1",mode="execute" if args.execute else "preview",selected=selected,
            workspace_root=str(source_root),input_list_refs=refs,sample_original_bytes=sum(i["ref"].get("bytes",(source_root/i["ref"]["path"]).stat().st_size) for i in selected))
    elif args.reachable:
        preview = select_reachable(source_root,args.corpus or ("iran","cib","vietnam"))
        selected = preview["selected"]
    else:
        selected,population,binding = select_sample(source_root,args.corpus or ("iran","cib","vietnam"),args.shards_per_view,args.include_search)
        preview = dict(version=VERSION,mode="execute" if args.execute else "preview",source_binding=binding,selected=selected,
            sample_original_bytes=sum(i["ref"]["bytes"] for i in selected),active_category_population=population,
            sample_bias="Largest shard per active view; community catalogs only. Not a random or full-closure sample.",
            no_sub650mb_claim_without_full_population_measurement=True)
    if args.write_input_list:
        immutable(args.write_input_list,encoded(sealed(preview)))
    if not args.execute:
        print(json.dumps(preview,indent=2))
        return
    require(args.output is not None,"--execute requires an explicit fresh scratch --output")
    _,result = pack_assets(source_root,args.output,selected,args.minimum)
    immutable(args.output/"sample_inputs.json",encoded(sealed(preview)))
    print(json.dumps(result,indent=2))


if __name__ == "__main__":
    main()
