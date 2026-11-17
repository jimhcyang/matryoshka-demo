"""Byte-exact, source-lineage and corruption tests for offline graph packing."""
import contextlib
from decimal import Decimal
import gzip
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("graph_pack",ROOT/"tools/pack_graphs.py")
pack = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = pack
spec.loader.exec_module(pack)


class GraphPackingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root/"sources"
        self.source.mkdir()
        self.output = self.root/"packed"

    def source_file(self,name,raw,compressed=False):
        wire = gzip.compress(raw,mtime=123) if compressed else raw
        (self.source/name).write_bytes(wire)
        return dict(name=name,corpus="test",category="neighborhood",ref=dict(path=name,sha256=pack.sha(wire),bytes=len(wire)))

    def run_pack(self,items,**kwargs):
        with contextlib.redirect_stdout(io.StringIO()):
            return pack.pack_assets(self.source,self.output,items,**kwargs)

    def test_all_graph_fields_arrays_ids_edges_memberships_sources(self):
        node = dict(id="node_1",type="Entity",source_quotes=["quotation "*80],aliases=["b","a"],mass=1.000000000001)
        value = dict(neighborhoods={"node_1":dict(node=node,neighbors=[node,node],edges=[dict(id="e1",source="node_1",target="node_2",weight=1.0)],memberships=["z","a","z"])},object_tables={"nodes":{"node_1":node}},unknown_extension=[None,False,0,[],{}])
        raw = json.dumps(value,indent=2,ensure_ascii=False).encode()
        item = self.source_file("graph.json.gz",raw,True)
        manifest,result = self.run_pack([item])
        decoded = pack.Reader(self.output,manifest).decode(item["name"])
        self.assertEqual(json.loads(decoded),value)
        self.assertEqual(decoded,pack.encoded(value))
        self.assertEqual(manifest["assets"][item["name"]]["originalsha256"],item["ref"]["sha256"])
        self.assertTrue(result["measurements"][0]["reconstruction_verified"])

    def test_exact_numeric_tokens_no_float_roundtrip(self):
        raw = b'{"values":[9007199254740993123456789,1.230000000000000000001,-0,-0.0,1E+009,1e-9999,0.0000000000000000000003]}'
        item = self.source_file("numbers.json",raw)
        manifest,_ = self.run_pack([item])
        self.assertEqual(pack.Reader(self.output,manifest).decode(item["name"]),raw)
        self.assertEqual(json.loads(raw,parse_float=Decimal),json.loads(pack.Reader(self.output,manifest).decode(item["name"]),parse_float=Decimal))

    def test_ref_collision_guard_and_unicode_source_quotes(self):
        value = {"$ref":[1,["$ref",2],{"id":3}],"pieces":["raw",2,"raw"],"quote":"한글 \"quoted\"\n\\ and emoji \U0001f4c4"*30}
        item = self.source_file("tags.json",json.dumps(value,ensure_ascii=False).encode())
        manifest,_ = self.run_pack([item])
        self.assertEqual(pack.Reader(self.output,manifest).decode(item["name"]),pack.encoded(value))

    def test_cross_asset_dictionary_dedup_and_cache_eviction(self):
        shared = {"source_quote":"paragraph "*80,"id":"same_node","aliases":["b","a"]}
        a = self.source_file("one.json",pack.encoded({"nodes":[shared]*30}))
        b = self.source_file("two.json",pack.encoded({"nodes":[shared]*30,"extra":1}))
        manifest,result = self.run_pack([a,b])
        self.assertGreater(result["fragment_reuse_visits"],20)
        self.assertLess(result["measurements"][1]["new_fragments"],result["measurements"][0]["new_fragments"])
        reader = pack.Reader(self.output,manifest,cache_chunks=1)
        self.assertEqual(json.loads(reader.decode("one.json"))["nodes"],[shared]*30)
        self.assertEqual(json.loads(reader.decode("two.json"))["extra"],1)

    def test_bounded_chunks_and_deep_rope_iterative_decoder(self):
        raw = pack.encoded(["same paragraph "*100]*300)
        item = self.source_file("large.json",raw)
        manifest,_ = self.run_pack([item],minimum=64,template_limit=128,chunk_bytes=2048)
        self.assertTrue(all(c["decoded_bytes"] <= 2048 for c in manifest["chunks"]))
        self.assertEqual(pack.Reader(self.output,manifest).decode("large.json"),raw)

    def test_no_parent_expanded_serialization_identity(self):
        store = pack.Dictionary(self.root/"dict.sqlite",cache_entries=1)
        try:
            child = store.intern(["x"*300])
            parent = store.intern(["[",child,",",child,"]"])
            self.assertEqual(parent.size,603)
            self.assertEqual(store.intern(["x"*300]),child)
            self.assertLess(store.template_bytes,500)
        finally:
            store.close()

    def test_duplicate_keys_and_invalid_json_rejected(self):
        for raw in ('{"x":1,"x":2}','[01]','[NaN]','[true,]','{} trailing','{"x":1', '"bad\ntext"'):
            with self.subTest(raw=raw):
                db = self.root/("test"+str(abs(hash(raw)))+".sqlite")
                store = pack.Dictionary(db)
                try:
                    with self.assertRaises((ValueError,json.JSONDecodeError)):
                        pack.Parser(raw,store).parse()
                finally:
                    store.close()

    def test_changed_source_sha_rejected(self):
        item = self.source_file("source.json",b"{}")
        (self.source/"source.json").write_bytes(b"[]")
        with self.assertRaisesRegex(ValueError,"source hash"):
            self.run_pack([item])

    def test_original_bytes_unchanged_and_output_not_overwritten(self):
        item = self.source_file("source.json.gz",b' { "id": [2, 1, 2] } ',True)
        original = (self.source/item["name"]).read_bytes()
        self.run_pack([item])
        self.assertEqual((self.source/item["name"]).read_bytes(),original)
        with self.assertRaisesRegex(ValueError,"fresh"):
            self.run_pack([item])

    def test_chunk_wire_tampering_rejected(self):
        item = self.source_file("source.json",pack.encoded(["quotation"*80]*3))
        manifest,_ = self.run_pack([item])
        path = self.output/manifest["chunks"][0]["path"]
        wire = bytearray(path.read_bytes()); wire[-1] ^= 1; path.write_bytes(wire)
        with self.assertRaisesRegex(ValueError,"wire integrity"):
            pack.Reader(self.output,manifest).decode(item["name"])

    def test_manifest_and_root_hash_tampering_rejected(self):
        item = self.source_file("source.json",b'{"id":2}')
        manifest,_ = self.run_pack([item])
        bad = json.loads(json.dumps(manifest)); bad["assets"][item["name"]]["sha256decoded"] = "0"*64
        with self.assertRaisesRegex(ValueError,"Manifest digest"):
            pack.Reader(self.output,bad)
        bad = pack.sealed({k:v for k,v in bad.items() if k != "sha256"})
        with self.assertRaisesRegex(ValueError,"root integrity"):
            pack.Reader(self.output,bad).decode(item["name"])

    def test_undeclared_chunks_and_output_bomb_limit(self):
        item = self.source_file("source.json",pack.encoded(["a"*500]*3))
        manifest,_ = self.run_pack([item])
        bad = json.loads(json.dumps(manifest)); bad["assets"][item["name"]]["dependencies"] = []
        bad = pack.sealed({k:v for k,v in bad.items() if k != "sha256"})
        with self.assertRaisesRegex(ValueError,"Undeclared"):
            pack.Reader(self.output,bad).decode(item["name"])
        with self.assertRaisesRegex(ValueError,"output limit"):
            pack.Reader(self.output,manifest,max_output_bytes=10).decode(item["name"])

    def test_boolean_refs_cycles_and_literal_positions_rejected(self):
        for value in (["",True,""],["",0,""],["",2,""],[1],["","2",""]):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    pack.Reader.validate(value,parent=2)

    def test_source_traversal_rejected_before_writes(self):
        item = dict(name="bad",corpus="test",category="test",ref=dict(path="../escape",sha256="0"*64))
        with self.assertRaisesRegex(ValueError,"source path"):
            self.run_pack([item])
        self.assertFalse(self.output.exists())

    def test_explicit_selected_list_logical_api_keys_and_prepared_lineage(self):
        original = self.source_file("original.json",b' {"source_quote":"same quote","machine":"/Users/example"} ')
        prepared = self.source_file("prepared.json",b'{"source_quote":"same quote","machine":"research-workspace"}')
        name = "/graph-assets-v4/test/comparison.json"
        row = dict(prepared,name=name)
        document = dict(selected=[row],lineage={name:dict(original=original["ref"],prepared=prepared["ref"])})
        path = self.root/"input.json"
        path.write_bytes(pack.encoded(document))
        rows,ref = pack.read_input_list(path,self.source)
        self.assertEqual(rows[0]["name"],name)
        self.assertEqual(ref["sha256"],pack.file_sha(path))
        manifest,_ = self.run_pack(rows)
        entry = manifest["assets"][name]
        self.assertEqual(entry["input_sha256"],prepared["ref"]["sha256"])
        self.assertEqual(entry["originalsha256"],original["ref"]["sha256"])
        self.assertTrue(entry["source_metadata_preprocessed"])
        self.assertIsNone(entry["original_decoded_sha256"])
        self.assertEqual(pack.Reader(self.output,manifest).decode(name),(self.source/"prepared.json").read_bytes())

    def test_direct_key_path_rows_and_preview_does_not_pack(self):
        source = self.source_file("api.json",b'{"id":"exact","rank":3}')
        row = dict(key="/api/node-v6?case_id=exact&node_id=n1",**source["ref"])
        path = self.root/"api-inputs.json"
        path.write_bytes(pack.encoded([row]))
        rows,_ = pack.read_input_list(path,self.source)
        self.assertEqual(rows[0]["name"],row["key"])
        with contextlib.redirect_stdout(io.StringIO()) as output:
            pack.main(["--source-root",str(self.source),"--input-list",str(path)])
        preview = json.loads(output.getvalue())
        self.assertEqual(preview["mode"],"preview")
        self.assertFalse(self.output.exists())

    def test_repeated_input_lists_share_one_dictionary(self):
        a = self.source_file("a.json",pack.encoded({"quote":"same full paragraph "*30}))
        b = self.source_file("b.json",pack.encoded({"quote":"same full paragraph "*30,"rank":2}))
        inputs = []
        for i,row in enumerate((a,b)):
            path = self.root/(str(i)+".json")
            path.write_bytes(pack.encoded(dict(inputs=[row])))
            inputs.extend(["--input-list",str(path)])
        with contextlib.redirect_stdout(io.StringIO()):
            pack.main(["--source-root",str(self.source),*inputs,"--execute","--output",str(self.output)])
        manifest = json.loads((self.output/"manifest.json").read_bytes())
        self.assertEqual(set(manifest["assets"]),{"a.json","b.json"})
        self.assertEqual(json.loads(pack.Reader(self.output,manifest).decode("b.json"))["rank"],2)

    def test_wrong_prepared_or_original_lineage_ref_rejected(self):
        a = self.source_file("a.json",b'{"id":1}')
        b = self.source_file("b.json",b'{"id":2}')
        path = self.root/"input.json"
        path.write_bytes(pack.encoded(dict(selected=[a],lineage={a["name"]:dict(prepared=b["ref"],original=a["ref"])})))
        with self.assertRaisesRegex(ValueError,"Prepared lineage"):
            pack.read_input_list(path,self.source)
        bad = dict(b,original_ref=dict(a["ref"],sha256="0"*64))
        with self.assertRaisesRegex(ValueError,"Source hash differs"):
            self.run_pack([bad])

    def test_input_list_root_mismatch_and_duplicate_keys_rejected(self):
        row = self.source_file("a.json",b"{}")
        path = self.root/"input.json"
        path.write_bytes(pack.encoded(dict(workspace_root=str(self.root),selected=[row])))
        with self.assertRaisesRegex(ValueError,"workspace"):
            pack.read_input_list(path,self.source)
        path.write_bytes(pack.encoded([row,row]))
        with self.assertRaisesRegex(ValueError,"Duplicate logical"):
            pack.read_input_list(path,self.source)

    def test_reachable_ignores_bytes_maps_and_inactive_views(self):
        location = self.source/"src-demo-day/data"
        location.mkdir(parents=True)
        names = ("comparison.json","search.json","test.current_redaction.neighborhood.00.json.gz",
                 "test.current_later.neighborhood.00.json.gz","test.current_reveal.neighborhood.00.json.gz")
        files = {n:self.source_file(n,b"{}")["ref"] for n in names}
        comparison = dict(views=dict(current_redaction={},current_later={},current_reveal={}),
            catalogs={v:dict(filename_pattern="test."+v+".neighborhood.{shard}.json.gz",shard_count=1) for v in ("current_redaction","current_later","current_reveal")},
            bytes={names[-1]:123})
        (self.source/names[0]).write_bytes(pack.encoded(comparison))
        files[names[0]] = dict(path=names[0],sha256=pack.file_sha(self.source/names[0]),bytes=(self.source/names[0]).stat().st_size)
        binding = dict(corpora=dict(iran=dict(comparison=names[0],search=names[1],assets=files)))
        boundpath = location/"full_graph_bindings_v4.json"
        boundpath.write_bytes(pack.encoded(binding))
        selected = pack.select_reachable(self.source,corpora=("iran",),verify_hashes=True,binding_sha256=pack.file_sha(boundpath))
        self.assertEqual(len(selected["selected"]),4)
        self.assertFalse(any("current_reveal" in r["name"] for r in selected["selected"]))

    def test_browser_index_entry_matches_root_transport_contract(self):
        item = self.source_file("graph.json",b'{"mass":1.0000000000000003}')
        manifest,_ = self.run_pack([item])
        entry = dict(encoding="fragment-dag",path="data/packed/manifest.json",asset=item["name"],
            manifest_sha256=pack.file_sha(self.output/"manifest.json"),
            sha256=manifest["assets"][item["name"]]["sha256decoded"],mime="application/json")
        self.assertEqual(pack.sha(pack.Reader(self.output,manifest).decode(entry["asset"])),entry["sha256"])
        self.assertEqual(entry["manifest_sha256"],pack.sha((self.output/"manifest.json").read_bytes()))

    def test_more_than64_chunks_read_once_with_repeated_cross_chunk_refs(self):
        # Revisit more chunks than the old LRU could retain, repeatedly and in
        # opposite orders. Descending dependency discovery must not refetch.
        nodes = [dict(id="node_"+str(i),quote=(str(i)+" source paragraph ")*40) for i in range(180)]
        value = dict(nodes=nodes+list(reversed(nodes))+nodes+nodes)
        raw = pack.encoded(value)
        item = self.source_file("many.json",raw)
        manifest,_ = self.run_pack([item],minimum=64,template_limit=128,chunk_bytes=2048)
        root = manifest["assets"]["many.json"]
        self.assertGreater(len(root["dependencies"]),64)
        reader = pack.Reader(self.output,manifest,cache_chunks=1)
        with patch.object(reader,"chunk",wraps=reader.chunk) as reads:
            self.assertEqual(reader.decode("many.json"),raw)
        indices = [call.args[0] for call in reads.call_args_list]
        self.assertGreater(len(indices),64)
        self.assertEqual(len(indices),len(set(indices)))
        self.assertEqual(indices,sorted(indices,reverse=True))
        self.assertEqual(len(reader.cache),min(reader.cache_chunks,len(indices)))

    def test_topological_scan_keeps_needed_rows_not_whole_chunks(self):
        shared = "common source paragraph "*30
        first = self.source_file("first.json",pack.encoded([shared,"unrelated paragraph "*40]))
        second = self.source_file("second.json",pack.encoded(dict(quote=shared)))
        manifest,_ = self.run_pack([first,second])
        reader = pack.Reader(self.output,manifest)
        root = manifest["assets"]["second.json"]
        retained = reader.needed_templates(root["pieces"],set(root["dependencies"]))
        declared_rows = sum(reader.chunks[i]["last_id"]-reader.chunks[i]["first_id"]+1 for i in root["dependencies"])
        self.assertLess(len(retained),declared_rows)
        self.assertFalse(any("unrelated paragraph" in p for row in retained.values() for p in row if isinstance(p,str)))
        self.assertEqual(reader.decode("second.json"),pack.encoded(dict(quote=shared)))

    def test_same_chunk_backward_refs_discovered_in_one_descending_pass(self):
        value = dict(one=[dict(quote="long source quote "*30)]*20)
        item = self.source_file("nested.json",pack.encoded(value))
        manifest,_ = self.run_pack([item])
        self.assertEqual(len(manifest["chunks"]),1)
        reader = pack.Reader(self.output,manifest)
        with patch.object(reader,"chunk",wraps=reader.chunk) as reads, \
             patch.object(pack.gzip,"GzipFile",wraps=pack.gzip.GzipFile) as decompressions:
            self.assertEqual(reader.decode("nested.json"),pack.encoded(value))
            self.assertEqual(reader.decode("nested.json"),pack.encoded(value))
        self.assertEqual(reads.call_count,2)
        self.assertEqual(decompressions.call_count,1)


if __name__ == "__main__":
    unittest.main()
