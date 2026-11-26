"""The current study entry binds the active report, not an old study capsule."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from browser_smoke import digest, encoded, public_cases, public_study


class StudyEntryTests(unittest.TestCase):
    def row(self):
        case = dict(case_id='masked-study', corpus='cib', task='redaction', query='A [REDACTION] delegation.', date='1959-02-17', document_id='doc')
        checkpoint = dict(path='saved/native.json', sha256='a' * 64)
        return dict(case=case, collection='withheld_delegation', study_slot='first',
            current_resource_execution=True, reference_answer_kind='unknown_still_withheld',
            selected_demo=False, selected_bench=False, selected_additional=False,
            configurations=dict(llm_readings=dict(native_checkpoint=checkpoint,
                source_view_policy=dict(id='supplied_documents_inclusive'))),
            native_public_case_binding=dict(state='PASS', native_packet_modified=False,
                native_checkpoint=deepcopy(checkpoint), query_sha256=digest(case['query']),
                public_case_sha256=digest(case), native_public_case_sha256=digest(case), native_case_sha256=digest(case)))

    def fixture(self, root, row):
        (root / 'data').mkdir()
        report = encoded(dict(cases=[row]))
        (root / 'data/report-v6.json').write_bytes(report)
        index = encoded(dict(entries={'/data/report-v6.json': dict(sha256=hashlib.sha256(report).hexdigest())}))
        (root / 'data/api-index.json').write_bytes(index)
        index_sha = hashlib.sha256(index).hexdigest()
        (root / 'release-manifest.json').write_bytes(encoded(dict(
            api_index=dict(path='data/api-index.json', sha256=index_sha),
            source_report_ref=dict(sha256=hashlib.sha256(report).hexdigest()), case_ids=[row['case']['case_id']])))
        (root / 'swedish-study.html').write_text('<meta name="source-api-index-sha256" content="' + index_sha + '"><script src="workbench-study-entry.js"></script>')

    def test_current_entry_and_unknown_case_are_bound(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            row = self.row()
            self.fixture(root, row)
            reference, study = public_study(root)
            self.assertEqual(reference['path'], 'data/report-v6.json')
            self.assertEqual(public_cases(root, study), [row])

    def test_even_resealed_reports_cannot_promote_truth_or_change_native_binding(self):
        mutations = [
            lambda r: r.update(reference_answer='a known answer'),
            lambda r: r.update(reference_answer_available=True),
            lambda r: r.update(study_slot='last'),
            lambda r: r.update(selected_demo=True),
            lambda r: r['case'].update(query='Changed input'),
            lambda r: r['case'].update(corpus='iran'),
            lambda r: r['configurations']['llm_readings']['source_view_policy'].update(id='ordinary'),
            lambda r: r['native_public_case_binding'].update(native_packet_modified=True),
            lambda r: r['configurations']['llm_readings']['native_checkpoint'].update(sha256='b' * 64),
        ]
        for index, mutate in enumerate(mutations):
            with self.subTest(mutation=index), tempfile.TemporaryDirectory() as folder:
                root = Path(folder).resolve()
                row = self.row()
                mutate(row)
                self.fixture(root, row)
                _, study = public_study(root)
                with self.assertRaises(AssertionError):
                    public_cases(root, study)

    def test_changed_report_or_index_bytes_fail(self):
        for name in ('data/report-v6.json', 'data/api-index.json'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as folder:
                root = Path(folder).resolve()
                self.fixture(root, self.row())
                with (root / name).open('ab') as stream:
                    stream.write(b' ')
                with self.assertRaises(AssertionError):
                    public_study(root)


if __name__ == '__main__':
    unittest.main()
