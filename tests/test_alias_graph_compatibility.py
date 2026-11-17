"""Offline v6 checks; optional local native exports use MATRYOSHKA_TEST_NATIVE_GRAPH=1."""

import json
import os
from pathlib import Path
import shutil
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "site/graph-full-v6.js"
NATIVE_DATA = Path(os.environ.get(
    "MATRYOSHKA_NATIVE_GRAPH_DATA", str(ROOT.parent / "src/demo/iran_site_visit/web/data")
))
PUBLIC_BOOTSTRAP = ROOT / "site/data/bootstrap"
LEGACY_PUBLIC_COMPARISONS = {
    "cib": "21777a599d36f2547982a7626b8e91b49279885f902f31cd7b89468266db1bfc",
    "iran": "80f77553e40089ada4975938d0662ec3d24b2eb16712812fc325b0f7623fc5be",
    "vietnam": "8c31d89a31348883d4d999815a04166538f306ff7612aaf13144566373a02529",
}


def run_js(checks, *, query="", timeout=30):
    node = shutil.which("node")
    assert node, "Node is required for offline viewer compatibility checks"
    script = VIEWER.read_text()
    # Skip only page startup; evaluate the real classes, loaders and guide functions.
    start = script.index('$("#full-corpus").value=corpusId;')
    end = script.index("// Presentation-only provenance.", start)
    script = script[:start] + script[end:]
    assert script.endswith("if (!redirectCibRoute) init();\n")
    script = script.removesuffix("if (!redirectCibRoute) init();\n")
    harness = r"""
const assert=require('node:assert/strict'),fs=require('node:fs'),zlib=require('node:zlib');
global.crypto=require('node:crypto').webcrypto;
const elements=new Map();
function element(){return {innerHTML:'',textContent:'',hidden:false,scrollTop:0,
  classList:{toggle(){},remove(){}},querySelector(){return null;},querySelectorAll(){return [];},
  setAttribute(){},after(child){if(child.id)elements.set('#'+child.id,child);}};}
global.document={body:{dataset:{}},addEventListener(){},querySelector(selector){return elements.get(selector)||null;},
  querySelectorAll(){return [];},createElement:element};
global.location={origin:'https://offline.invalid'};
global.matchMedia=()=>({matches:false,addEventListener(){}});
global.window={addEventListener(){},location:{search:QUERY,href:'https://offline.invalid/graph-full-v6.html'+QUERY}};
global.fetch=async(url)=>{throw new Error('Unmocked network request: '+url);};
function responseFor(value){
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));
  return {ok:true,headers:{get:()=> 'gzip'},json:async()=>JSON.parse(bytes.toString()),
    arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
}
function readAsset(file){const bytes=fs.readFileSync(file);return file.endsWith('.gz')?zlib.gunzipSync(bytes):bytes;}
function readJson(file){return JSON.parse(readAsset(file));}
function mockAssets(assets){global.fetch=async(url)=>{
  assert.ok(Object.hasOwn(assets,url),'No offline fixture for '+url);
  return responseFor(assets[url]);
};}
function rowsFor(mode){return mode==='native'?[
  {id:'vocabulary',type:'Entity',label:'Ministry',reference_scope:'lexical_reference',instance_identity_asserted:false},
  {id:'scoped',type:'Entity',label:'Council',reference_scope:'model_source_context',instance_identity_asserted:true},
  {id:'unknown',type:'Entity',label:'Unknown',reference_scope:null,instance_identity_asserted:null}
]:[
  {id:'vocabulary',type:'Entity',label:'Ministry',identity_scope:'corpus-resolved canonical cluster'},
  {id:'scoped',type:'Entity',label:'Council',identity_scope:'source-specific identity',
    reference_scope:'named_entity',instance_identity_asserted:true,_identity_authority_mode:'native'},
  {id:'unknown',type:'Entity',label:'Unknown',identity_scope:'validated identity'}
];}
function fixtureFor(mode){
  const version=kind=>identityAuthoritySchemas[kind][mode],rows=()=>rowsFor(mode);
  const view={key:'current_later',label:'Current',levels:{
    domain:{nodes:rows(),catalog_url:'domain.json'},
    evidence:{nodes:rows(),member_nodes:rows(),overview_url:'overview.json',
      neighborhood_catalog:{schema_version:version('neighborhood'),filename_pattern:'neighbors-{shard}.json',shard_count:1},
      community_detail_schema_version:version('community'),community_detail_files:{c:'members.json'}}}};
  const graph={schema_version:version('comparison'),graph_run_id:'graph-test',hierarchy_run_id:'hierarchy-test',
    neighborhood_catalogs:{schema_version:version('neighborhood')},
    community_detail_catalogs:{schema_version:version('community')},views:{current_later:view}};
  const edge={id:'edge',source:'vocabulary',target:'scoped',weight:0.125,edge_type:'RELATED_TO'};
  const assets={
    '/unit/search.json':{schema_version:version('search'),graph_run_id:graph.graph_run_id,hierarchy_run_id:graph.hierarchy_run_id,
      view_files:{current_later:'entities.json'},evidence_view_files:{current_later:'evidence.json'}},
    '/unit/entities.json':{schema_version:version('search'),view_key:view.key,records:rows()},
    '/unit/evidence.json':{schema_version:version('search'),view_key:view.key,record_kind:'evidence_node',records:rows()},
    '/unit/neighbors-00.json':{schema_version:version('neighborhood'),view_key:view.key,object_table:[...rows(),edge],
      packed_neighborhoods:{vocabulary:{node:0,neighbors:[1,2],edges:[3]}}},
    '/unit/members.json':{schema_version:version('community'),view_key:view.key,communities:{c:{nodes:rows(),edges:[edge]}}},
    '/unit/domain.json':{schema_version:'cib-hierarchy-catalog/2.0',view_key:view.key,level:'domain',nodes:rows(),edges:[]},
    '/unit/overview.json':{schema_version:'cib-evidence-overview/1.0',view_key:view.key,level:'evidence',nodes:rows(),edges:[]}
  };
  return {graph,view,assets,edge};
}
""".replace("QUERY", json.dumps(query))
    result = subprocess.run(
        [node, "-"], input=harness + script + "\n" + checks,
        text=True, capture_output=True, cwd=ROOT, timeout=timeout,
    )
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.parametrize("mode", ["legacy", "native"])
def test_all_authority_surfaces_and_cache_merges(mode):
    run_js("const mode=" + json.dumps(mode) + r""";
(async()=>{
  const {graph,view,assets,edge}=fixtureFor(mode);
  state.data=adaptComparisonAuthority(graph,false);
  refreshBinding={};assetBase='/unit/';searchAsset='/unit/search.json';mockAssets(assets);
  await ensureSearchCatalog([view.key]);await ensureEvidenceSearchCatalog([view.key]);
  await ensureHierarchyCatalog(view,'domain');await ensureHierarchyCatalog(view,'evidence');
  const detail=await ensureNodeNeighborhood(view,'vocabulary'),community={id:'c'};
  await ensureCommunityDetail(view,community);
  const collections=[view.levels.domain.nodes,view.levels.domain.catalog_nodes,view.levels.evidence.nodes,
    view.levels.evidence.member_nodes,view.levels.evidence.overview_nodes,state.searchViews[view.key],
    state.searchEvidenceViews[view.key],[detail.node,...detail.neighbors],community.member_nodes];
  for(const rows of collections)for(const [index,row] of rows.entries()){
    assert.equal(row._identity_authority_mode,mode);assert.ok(!Object.hasOwn(row,'identity_scope'));
    if(mode==='native'){
      assert.equal(row.reference_scope,['lexical_reference','model_source_context',null][index]);
      assert.equal(row.instance_identity_asserted,[false,true,null][index]);
    }else{
      assert.equal(row.reference_scope,null);assert.equal(row.instance_identity_asserted,null);
      assert.equal(identityScopeLabel(row),'identity authority unavailable (legacy)');
    }
  }
  assert.deepEqual(detail.edges,[edge]);assert.deepEqual(community.member_edges,[edge]);
  const inspector=element(),results=element();elements.set('#search-results',results);
  state.query='ministry';state.searchResults={legacy:[],current:state.searchViews[view.key]};
  state.data.views.current_earlier={label:'Earlier'};renderSearchResults();
  for(const row of state.searchViews[view.key]){
    const panel={selected:row,inspector,view,visibilityPolicy:()=> 'show',canEnter:()=>false,
      claimTopologyLabels:()=>[],incidentConnections:()=>''};
    GraphPanel.prototype.renderInspector.call(panel);
    assert.ok(inspector.innerHTML.includes(esc(identityScopeLabel(row))));
    assert.ok(results.innerHTML.includes(esc(identityScopeLabel(row))));
    assert.ok(!inspector.innerHTML.includes('corpus-resolved canonical cluster'));
    if(mode==='native')assert.ok(inspector.innerHTML.includes('Instance identity asserted:</b> '+
      (row.instance_identity_asserted===null?'not recorded':String(row.instance_identity_asserted))));
  }
  state.searchEvidenceIndexes[view.key]=new Map([['vocabulary',{
    reference_scope:'named_entity',instance_identity_asserted:true,identity_scope:'validated identity'}]]);
  const merged=GraphPanel.prototype.normalizedEvidenceNode.call({view},detail.node);
  assert.equal(merged.instance_identity_asserted,mode==='legacy'?null:false);
  assert.equal(identityScopeLabel(merged),identityScopeLabel(detail.node));
  if(mode==='legacy')assert.ok(legacyAuthoritySchemas.has(graph.schema_version));
})().catch(error=>{console.error(error);process.exitCode=1;});
""")


@pytest.mark.parametrize("metadata,label", [
    ({"reference_scope": "lexical_reference", "instance_identity_asserted": False}, "reference-only vocabulary"),
    ({"reference_scope": "concept", "instance_identity_asserted": True}, "reference-only vocabulary"),
    ({"reference_scope": "unresolved_reference", "instance_identity_asserted": False}, "unresolved reference"),
    ({"reference_scope": "ambiguous_lexical_hub", "instance_identity_asserted": True}, "unresolved reference"),
    ({"reference_scope": "unresolved_contextual_reference", "instance_identity_asserted": None}, "unresolved reference"),
    ({"reference_scope": "model_source_context", "instance_identity_asserted": True}, "source-specific identity"),
    ({"reference_scope": "human_source_occurrence_scope", "instance_identity_asserted": True}, "source-specific identity"),
    ({"reference_scope": "source_referent", "instance_identity_asserted": True}, "source-supported identity"),
    ({"reference_scope": "named_entity", "instance_identity_asserted": True}, "source-supported identity"),
    ({"reference_scope": "named_entity", "instance_identity_asserted": False}, "reference-only;"),
    ({"reference_scope": None, "instance_identity_asserted": None}, "identity authority not recorded"),
    ({"reference_scope": "new_scope", "instance_identity_asserted": True}, "identity authority not recorded"),
    ({}, "identity authority not recorded"),
])
def test_labels_use_native_flags_never_identity_scope(metadata, label):
    run_js("const metadata=" + json.dumps(metadata) + ";const expected=" + json.dumps(label) + r""";
const row={type:'Entity',identity_scope:'corpus-resolved canonical cluster',identity_context_sensitive:false,...metadata};
assert.ok(identityScopeLabel(row).startsWith(expected));
assert.ok(!identityAuditHtml(row).includes(row.identity_scope));
assert.equal(identityScopeLabel({...row,type:'Claim'}),'');
assert.ok(identityAuditHtml({...row,reference_scope:'<script>'}).includes('&lt;script&gt;'));
""")


@pytest.mark.parametrize("metadata", [
    {}, {"reference_scope": "named_entity"}, {"instance_identity_asserted": True},
    {"reference_scope": "named_entity", "instance_identity_asserted": "true"},
    {"reference_scope": {}, "instance_identity_asserted": True},
    {"reference_scope": "named_entity", "instance_identity_asserted": 0},
])
def test_native_schema_requires_typed_authority_on_every_surface(metadata):
    run_js("const metadata=" + json.dumps(metadata) + r""";
(async()=>{
  const row={id:'bad',type:'Entity',identity_scope:'validated identity',...metadata};
  assert.throws(()=>adaptIdentityRecord({...row},'native'),/native identity authority/);
  const graph=fixtureFor('native').graph;graph.views.current_later.levels.evidence.nodes=[row];
  assert.throws(()=>adaptComparisonAuthority(graph,false),/native identity authority/);
  for(const surface of ['entity','evidence','neighborhood','neighbor','community','domain','overview']){
    const {graph,view,assets}=fixtureFor('native');state.data=adaptComparisonAuthority(graph,false);
    for(const key of ['searchManifest'])state[key]=null;
    for(const key of ['searchViews','searchIndexes','searchPromises','searchEvidenceViews','searchEvidenceIndexes',
      'searchEvidencePromises','neighborhoodPromises','neighborhoodShards','communityDetailPromises',
      'communityDetailShards','hierarchyPromises'])state[key]={};
    if(surface==='entity')assets['/unit/entities.json'].records=[row];
    if(surface==='evidence')assets['/unit/evidence.json'].records=[row];
    if(surface==='neighborhood')assets['/unit/neighbors-00.json'].object_table[0]=row;
    if(surface==='neighbor')assets['/unit/neighbors-00.json'].object_table[1]=row;
    if(surface==='community')assets['/unit/members.json'].communities.c.nodes=[row];
    if(surface==='domain')assets['/unit/domain.json'].nodes=[row];
    if(surface==='overview')assets['/unit/overview.json'].nodes=[row];
    refreshBinding={};assetBase='/unit/';searchAsset='/unit/search.json';mockAssets(assets);
    const load=surface==='entity'?()=>ensureSearchCatalog([view.key]):
      surface==='evidence'?()=>ensureEvidenceSearchCatalog([view.key]):
      surface==='community'?()=>ensureCommunityDetail(view,{id:'c'}):
      surface==='domain'?()=>ensureHierarchyCatalog(view,'domain'):
      surface==='overview'?()=>ensureHierarchyCatalog(view,'evidence'):
      ()=>ensureNodeNeighborhood(view,'vocabulary');
    await assert.rejects(load,/native identity authority/);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
""")


def test_only_explicit_schema_versions_and_matching_revisions_are_supported():
    run_js(r"""
(async()=>{
  for(const kind of Object.keys(identityAuthoritySchemas)){
    const versions=identityAuthoritySchemas[kind];
    assert.equal(identityAuthorityMode(versions.legacy,kind),'legacy');
    assert.equal(identityAuthorityMode(versions.native,kind),'native');
    for(const version of [undefined,'unknown/1.0',versions.native+'0'])
      assert.throws(()=>identityAuthorityMode(version,kind),/Unsupported/);
    assert.throws(()=>identityAuthorityMode(versions.legacy,kind,'native'),/Mixed/);
    assert.throws(()=>identityAuthorityMode(versions.native,kind,'legacy'),/Mixed/);
  }
  for(const surface of ['manifest','entity','evidence','neighborhood','community']){
    const {graph,view,assets}=fixtureFor('native');state.data=adaptComparisonAuthority(graph,false);
    state.searchManifest=null;state.searchPromises={};state.searchEvidencePromises={};
    state.neighborhoodPromises={};state.communityDetailPromises={};
    const file={manifest:'search',entity:'entities',evidence:'evidence',neighborhood:'neighbors-00',community:'members'}[surface];
    const kind={manifest:'search',entity:'search',evidence:'search',neighborhood:'neighborhood',community:'community'}[surface];
    assets['/unit/'+file+'.json'].schema_version=identityAuthoritySchemas[kind].legacy;
    refreshBinding={};assetBase='/unit/';searchAsset='/unit/search.json';mockAssets(assets);
    const load=surface==='manifest'?()=>ensureSearchCatalog([]):surface==='entity'?()=>ensureSearchCatalog([view.key]):
      surface==='evidence'?()=>ensureEvidenceSearchCatalog([view.key]):surface==='community'?()=>ensureCommunityDetail(view,{id:'c'}):
      ()=>ensureNodeNeighborhood(view,'vocabulary');
    await assert.rejects(load,/Mixed|schema or view/);
  }
  const graph=fixtureFor('native').graph;
  graph.views.current_later.levels.evidence.neighborhood_catalog.schema_version=identityAuthoritySchemas.neighborhood.legacy;
  assert.throws(()=>adaptComparisonAuthority(graph,false),/Mixed/);
  assert.throws(()=>adaptComparisonAuthority({schema_version:'cib-legacy-current-comparison/5.0'},false),/Unsupported/);
  assert.throws(()=>adaptComparisonAuthority({schema_version:'matryoshka-single-corpus-browser/1.0',views:{}},true),/Unsupported/);
})().catch(error=>{console.error(error);process.exitCode=1;});
""")


@pytest.mark.parametrize("key", ["current_earlier", "current_later"])
def test_real_current_native_exports_through_public_loaders(key):
    if os.environ.get("MATRYOSHKA_TEST_NATIVE_GRAPH") != "1":
        pytest.skip("Set MATRYOSHKA_TEST_NATIVE_GRAPH=1 to check optional local native exports")
    if not (NATIVE_DATA / "cib_refresh_binding.json").is_file():
        pytest.skip(f"Optional native exports are absent: {NATIVE_DATA}")
    run_js("const root=" + json.dumps(str(NATIVE_DATA)) + ";const key=" + json.dumps(key) + r""";
(async()=>{
  refreshBinding=readJson(root+'/cib_refresh_binding.json');
  const original=readJson(root+'/'+refreshBinding.comparison_asset);
  assert.equal(original.schema_version,'cib-legacy-current-comparison/4.9');
  state.data=adaptComparisonAuthority(structuredClone(original),false);
  assert.equal(state.data.graph_run_id,refreshBinding.graph_run_id);
  assetBase='/native/';searchAsset=assetURL(refreshBinding.search_asset);
  global.fetch=async(url)=>{
    assert.ok(url.startsWith(assetBase),'No external requests');
    const filename=url.slice(assetBase.length);assert.ok(!filename.includes('/'));
    return responseFor(readAsset(root+'/'+filename));
  };
  const manifest=readJson(root+'/'+refreshBinding.search_asset);
  assert.equal(manifest.schema_version,'cib-graph-search/3.5');
  const originals=readJson(root+'/'+manifest.view_files[key]).records;
  await ensureSearchCatalog([key]);await ensureEvidenceSearchCatalog([key]);
  const view=state.data.views[key],byId=new Map(originals.map(row=>[row.id,row]));
  const check=rows=>{
    let count=0;
    for(const row of rows)if((row.type||row.node_type)==='Entity'){
      count++;assert.equal(row._identity_authority_mode,'native');
      assert.ok(Object.hasOwn(row,'reference_scope'));assert.ok(Object.hasOwn(row,'instance_identity_asserted'));
      const original=byId.get(row.id);
      if(original){
        assert.equal(row.reference_scope,original.reference_scope);
        assert.equal(row.instance_identity_asserted,original.instance_identity_asserted);
      }
      assert.ok(!Object.hasOwn(row,'identity_scope'));
      assert.ok(!identityScopeLabel(row).includes('validated'));
      assert.ok(identityAuditHtml(row).includes(esc(row.reference_scope??'not recorded')));
    }
    return count;
  };
  assert.ok(check(state.searchViews[key])>0);assert.ok(check(state.searchEvidenceViews[key])>0);
  const chosen=state.searchViews[key].find(row=>row.instance_identity_asserted===false);
  assert.ok(chosen,'Real export must include unasserted reference vocabulary');
  const detail=await ensureNodeNeighborhood(view,chosen.id);
  assert.equal(detail.node.instance_identity_asserted,false);check([detail.node,...detail.neighbors]);
  const c=Object.keys(view.levels.evidence.community_detail_files)[0],community={id:c};
  await ensureCommunityDetail(view,community);assert.ok(check(community.member_nodes)>0);
  await ensureHierarchyCatalog(view,'community');await ensureHierarchyCatalog(view,'evidence');
  assert.deepEqual(detail.edges,readJson(root+'/'+view.levels.evidence.neighborhood_catalog.filename_pattern
    .replace('{shard}',String(hashNumber(chosen.id)%64).padStart(2,'0'))).neighborhoods[chosen.id].edges);
  for(const [name,level] of Object.entries(original.views[key].levels)){
    assert.deepEqual(state.data.views[key].levels[name].edges,level.edges);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
""", timeout=120)


@pytest.mark.parametrize("corpus", ["cib", "iran", "vietnam"])
def test_real_legacy_comparison_contracts_remain_unknown(corpus):
    # Immutable public fixtures remain study assets when current bindings are updated.
    fixture = PUBLIC_BOOTSTRAP / (LEGACY_PUBLIC_COMPARISONS[corpus] + ".json.gz")
    run_js("const file=" + json.dumps(str(fixture)) + ";const single=" + json.dumps(corpus != "cib") + r""";
const original=readJson(file);
assert.equal(original.schema_version,single?'matryoshka-single-corpus-browser/1.0':'cib-legacy-current-comparison/4.8');
const payload=adaptComparisonAuthority(structuredClone(original),single);
assert.equal(payload._identity_authority_mode,'legacy');
let count=0;
for(const view of Object.values(payload.views))for(const level of Object.values(view.levels))
  for(const key of ['nodes','catalog_nodes','overview_nodes','member_nodes'])for(const row of level[key]||[])
    if((row.type||row.node_type)==='Entity'){
      count++;assert.equal(row.reference_scope,null);assert.equal(row.instance_identity_asserted,null);
      assert.equal(identityScopeLabel(row),'identity authority unavailable (legacy)');
    }
assert.ok(count>0);assert.equal(payload.graph_run_id,original.graph_run_id);
assert.equal(payload.hierarchy_run_id,original.hierarchy_run_id);
""")


@pytest.mark.parametrize("corpus", ["cib", "iran", "vietnam"])
def test_study_selection_is_explicit_and_current_link_clears_saved_ids(corpus):
    run_js(r"""
assert.equal(viewerBindingURL(),'/api/graph-v4-viewer?corpus='+corpusId);
for(const guide of ['guide_case','guide','guide_data','guide_ref']){
  assert.equal(viewerBindingURL(new URLSearchParams({[guide]:'saved'})),
    '/api/graph-v4-viewer?corpus='+corpusId+'&revision=study');
}
assert.equal(viewerBindingURL(new URLSearchParams('graph_revision=study')),
  '/api/graph-v4-viewer?corpus='+corpusId+'&revision=study');
for(const value of ['latest','current','arbitrary',''])
  assert.throws(()=>viewerBindingURL(new URLSearchParams({graph_revision:value})),/Unsupported graph revision/);
assert.throws(()=>viewerBindingURL(new URLSearchParams('graph_revision=study&graph_revision=evil')),/Unsupported/);
window.location.href+='&guide_case=saved&guide_data=bytes&guide_ref=ref&guide=old&guide_arm=graph&graph_revision=study&node_id=old&q=old&return_to=%2Fworkbench-v6.html';
const current=new URL(currentCorpusMapURL(),location.origin);
assert.equal(current.searchParams.get('corpus'),corpusId);
assert.equal(current.searchParams.get('return_to'),'/workbench-v6.html');
assert.ok([...current.searchParams.keys()].every(key=>!key.startsWith('guide')&&!['graph_revision','node_id','q'].includes(key)));
for(const id of ['exploration-scope','exploration-layout','exploration-binding strong'])elements.set('#'+id,element());
refreshBinding={graph_run_id:'saved-graph',hierarchy_run_id:'saved-hierarchy'};
renderExplorationBinding(new URLSearchParams('guide_case=saved'));
assert.ok(elements.get('#exploration-scope').textContent.includes('Saved study graph'));
assert.ok(elements.get('#exploration-layout').textContent.includes('never remapped'));
assert.equal(elements.get('#current-corpus-map-link').href,currentCorpusMapURL());
assert.equal(typeof guideRouteBadgeV65,'function');assert.equal(typeof loadSavedGuide,'function');
assert.ok(highlightedSourceText('<Minister> said',['Minister']).includes('<mark>Minister</mark>'));
""", query=f"?corpus={corpus}")


@pytest.mark.parametrize("corpus", ["cib", "iran", "vietnam"])
@pytest.mark.parametrize("selector", ["", "&guide_case=saved", "&guide=old", "&graph_revision=study"])
def test_initialize_requests_only_selected_binding_without_fallback(corpus, selector):
    run_js(r"""
(async()=>{
  for(const id of ['purpose','build-label'])elements.set('#'+id,element());
  elements.set('.graph-grid',element());
  const requested=[];
  global.fetch=async(url)=>{requested.push(url);return {ok:false};};
  await init();
  const study=hasSavedGuide()||pageParams.get('graph_revision')==='study';
  assert.deepEqual(requested,['/api/graph-v4-viewer?corpus='+corpusId+(study?'&revision=study':'')]);
  assert.ok(elements.get('#purpose').textContent.includes('No different graph or mutable latest fallback'));
})().catch(error=>{console.error(error);process.exitCode=1;});
""", query=f"?corpus={corpus}{selector}")


def test_search_checksum_run_and_view_binding_guards_are_preserved():
    run_js(r"""
(async()=>{
  const {graph,view,assets}=fixtureFor('native');state.data=adaptComparisonAuthority(graph,false);
  assetBase='/unit/';searchAsset='/unit/search.json';mockAssets(assets);
  refreshBinding={search_sha256:'0'.repeat(64)};
  await assert.rejects(()=>ensureSearchCatalog([]),/checksum differs/);
  assert.equal(state.searchManifest,null);
  refreshBinding={};assets[searchAsset].graph_run_id='another-graph';
  await assert.rejects(()=>ensureSearchCatalog([]),/different refresh revisions/);
  assert.equal(state.searchManifest,null);
  assets[searchAsset].graph_run_id=graph.graph_run_id;assets[searchAsset].hierarchy_run_id='another-hierarchy';
  await assert.rejects(()=>ensureSearchCatalog([]),/different refresh revisions/);
  assets[searchAsset].hierarchy_run_id=graph.hierarchy_run_id;
  assets['/unit/entities.json'].view_key='another-view';
  await assert.rejects(()=>ensureSearchCatalog([view.key]),/schema or view/);
  assets['/unit/neighbors-00.json'].view_key='another-view';
  await assert.rejects(()=>ensureNodeNeighborhood(view,'vocabulary'),/Unexpected/);
  assets['/unit/members.json'].view_key='another-view';
  await assert.rejects(()=>ensureCommunityDetail(view,{id:'c'}),/Unexpected/);
})().catch(error=>{console.error(error);process.exitCode=1;});
""")
