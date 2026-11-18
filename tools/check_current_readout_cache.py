"""Compare cached transport readouts with the unchanged actual Viewer offline."""
import argparse
import json
from pathlib import Path

from export_current_replays import ReadoutCache, checked, encoded, route, sha, viewer_for
from export_replays import atomic, proof_ids


def check(root, reference):
    report = checked(root,reference)
    row = next(r for r in report['cases'] if r['case']['corpus'] == 'cib')
    config = 'llm_readings'
    item = row['configurations'][config]
    params = dict(case_id=row['case']['case_id'],config=config,
        **{k:row['resource_binding'][k] for k in ('resource_id','registry_sha256','index_sha256')})
    viewer = viewer_for(root,reference)
    try:
        reading = next(iter(item['flow_refs']))
        projection = viewer.api('flow-v6',{k:[str(v)] for k,v in dict(params,reading=reading,limit=2048).items()})
        candidate = next(c for c in projection['candidates'] if c.get('represented_routes') or c.get('routes'))
        args = dict(params,reading=reading,candidate_id=candidate['id'],route_index=0)
        query = {k:[str(v)] for k,v in args.items()}
        packet = viewer.api('guide-v6',query)
        cache = ReadoutCache()
        key = cache.guide_key(args)
        cache.guides[key] = packet
        expected_overlay = viewer.api('guide-overlay-v64',query)
        actual_overlay = cache.overlay(viewer,args)
        assert actual_overlay == expected_overlay
        cache.overlays[key] = actual_overlay
        source_id = sorted(proof_ids(packet)|proof_ids(actual_overlay))[0]
        source_args = dict(params,source_id=source_id)
        source = viewer.api('source-v6',{k:[str(v)] for k,v in source_args.items()})
        assert cache.source(viewer,source_args) == source
        assert cache.source(viewer,source_args) == source
        cache.sources[params['case_id'],config,source_id] = source
        source_query = dict(args,phase='source',source_id=source_id)
        expected_source = viewer.api('guide-view-v6',{k:[str(v)] for k,v in source_query.items()})
        actual_source = cache.source_view(source_query)
        assert actual_source == expected_source
        return dict(status='PASS_EXACT_READOUT_PARITY',source_report_ref=reference,case_id=params['case_id'],
            overlay_sha256=sha(encoded(actual_overlay)),source_view_sha256=sha(encoded(actual_source)),
            source_id=source_id,api_calls=0,native_outputs_modified=False,
            scope='One real case and route; source/membership parity, not retrieval effectiveness')
    finally:
        cache.close()
        viewer.close()


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root',type=Path,required=True)
    p.add_argument('--report',required=True)
    p.add_argument('--report-sha256',required=True)
    p.add_argument('--output',type=Path,required=True)
    args = p.parse_args()
    result = check(args.root.resolve(),dict(path=args.report,sha256=args.report_sha256))
    atomic(args.output,encoded(result))
    print(json.dumps(result,sort_keys=True))
