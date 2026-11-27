"""Closed CI checks for the native later-only CIB source policy."""
import hashlib
import re

POLICY=dict(version='trusted-corpus-source-view/1',id='later_release_inclusive',date_relation='<=',
    cutoff_role='source_document_date',cib_source_document='LATER_ONLY_INCLUDING_ORIGIN',
    cable_origin='WHOLE_DOCUMENT_EXCLUDED',cable_classification='CONFIDENTIAL',
    cable_document_wide_handling_veto=True,later_or_secret_version_admitted=True,
    source_dates_or_document_ids_rewritten=False,source_edition='later',
    native_later_source_index_required=True,ordinary_source_views_unchanged=True)


def assert_policy(policy):
    assert type(policy) is dict and set(policy)==set(POLICY)
    assert all(type(policy[k]) is type(value) and policy[k]==value for k,value in POLICY.items()),'Changed later-only source descriptor'


def reference(value):
    if not isinstance(value,dict) or not isinstance(value.get('path'),str):return False
    path=value['path']
    return (bool(path) and not re.search(r'[\\?#:\x00-\x1f]',path) and not path.startswith('/')
        and all(p not in ('','.','..') for p in path.split('/'))
        and bool(re.fullmatch('[a-f0-9]{64}',value.get('sha256',''))))


def assert_source(row,config,source,*,full_page,execution,envelope,digest):
    case=row['case'];policy=row['configurations'][config]['source_view_policy']
    assert_policy(policy)
    assert case['corpus']=='cib' and source['document_id']
    assert isinstance(source['date'],str) and re.fullmatch('[0-9]{4}-[0-9]{2}-[0-9]{2}',source['date'])
    assert source['date']<=case['date']
    assert not str(source.get('canonical_page_id',source.get('id',''))).startswith('supplied_page_')
    assert 'supplied_source' not in source and source.get('visibility')!='supplied_registered'
    if not full_page:return
    binding=row['resource_binding'];index=execution['index_ref'];context=envelope['binding']
    assert_policy(envelope['source_view_policy'])
    assert_policy(execution.get('result',{}).get('source_view_policy',execution.get('source_view_policy')))
    assert envelope['resource_binding']==execution['resource_binding']==binding
    assert index['sha256']==binding['index_sha256'] and index['registry_sha256']==binding['registry_sha256']
    assert digest(context)==index['source_binding_sha256']
    registry=context['native_registry']
    assert context['corpus']=='cib'
    assert all(context[k]==binding[k] for k in ('resource_id','graph_id','hierarchy_id'))
    assert context['native_registry_digest']==registry['registry_digest']
    assert registry['native_source_view']=='later' and registry['source_view_contract']=='public-native-later-source-projection/1'
    assert reference(registry['projection_parent_registry_ref'])
    assert '/views/later/' in registry['files']['pages']['path']
    assert re.fullmatch('[a-f0-9]{64}',registry['files']['pages']['sha256'])
    assert not registry.get('registered_supplied_documents')
    assert envelope['cutoff']==case['date'] and envelope['whole_origin_excluded'] is None
    for page in [envelope.get('page',envelope),*envelope.get('document_pages',[])]:
        native=page['native_page'];physical=page['source_page']
        assert page['corpus']=='cib' and page['permitted'] is True and page['document_id']
        assert isinstance(page['date'],str) and re.fullmatch('[0-9]{4}-[0-9]{2}-[0-9]{2}',page['date']) and page['date']<=case['date']
        assert page['visibility']==page['view']==native['view']=='later'
        assert type(physical) is int and 0<physical<=2**53-1 and page['earlier_page'] is None
        assert native['canonical_page_id']==page.get('id',page.get('canonical_page_id'))
        assert native['document_id']==page['document_id'] and native['source_page']==physical and native['text']==page['text']
        assert page['source_hash_contract']=='shared-json-string-ensure-ascii-true/sha256'
        assert digest(page['text'])==page['source_sha256']
        assert hashlib.sha256(page['text'].encode()).hexdigest()==page['raw_text_sha256']
