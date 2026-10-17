"""Synthetic-only tests for P1 independent ASR cross-check; never invoke a real ASR."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import wave

SCRIPT=Path(__file__).resolve().parents[1]/'scripts'/'cross-validate-private-asr.py'
spec=importlib.util.spec_from_file_location('private_cross_asr',SCRIPT)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class FakeSession:
    def __init__(self,model):
        self.model=model
    def transcribe(self,wav,language=None,return_chunks=None):
        assert language=='Russian' and return_chunks is True
        return types.SimpleNamespace(text='Совершенно другой текст',
                                     language='Russian',finish_reason='eos',truncated=False)

class PrivateCrossAsrTests(unittest.TestCase):
    def setUp(self):
        self.t=tempfile.TemporaryDirectory()
        self.root=Path(self.t.name)
        self.private=self.root/'source-private'
        self.private.mkdir()
        for group,index,folder,stem in mod.CASES:
            directory=self.private/folder
            directory.mkdir(exist_ok=True)
            start=352000 if index==30 else 1283200 if index==77 else 1789686
            frames=192000 if index!=120 else 160000
            with wave.open(str(directory/(stem+'.wav')),'wb') as audio:
                audio.setnchannels(1);audio.setsampwidth(2);audio.setframerate(mod.RATE)
                audio.writeframes(b'\\x00\\x00'*frames)
            focusstart=start+32000
            focusend=start+min(160000,frames)
            record={'format':'ru-class-private-p1-review-v1',
                    'clip_start_sample':start,'clip_end_sample':start+frames,
                    'focused_window_index':index,
                    'neighbors':[{'index':index,'window_start_sample':focusstart,
                                  'window_end_sample':focusend,
                                  'text':'Тайный русский учебный материал','final':index==120}]}
            (directory/(stem+'-private.json')).write_text(json.dumps(record),encoding='utf-8')
        self.model=self.root/'local-model'
        self.model.mkdir()
        (self.model/'config.json').write_text('{}')
    def tearDown(self):
        self.t.cleanup()

    def test_validate_only_three_without_model_or_leaks(self):
        report=mod.run(self.private,None,None,dry_run=True)
        self.assertEqual(report['status'],'VALIDATED_INPUT_ONLY')
        self.assertEqual(len(report['cases']),3)
        self.assertNotIn('Тайный',json.dumps(report,ensure_ascii=False))

    def test_reject_incorrect_audio_coordinates(self):
        path=self.private/'c1-targeted-private'/'review-0030-private.json'
        data=json.loads(path.read_text());data['clip_end_sample']+=1
        path.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError,'CLIP_COORDINATE_MISMATCH'):
            mod.validated_inputs(self.private)

    def test_absent_model_not_marked_as_asr(self):
        out=self.root/'new-private-results'
        with self.assertRaisesRegex(ValueError,'LOCAL_MODEL_DIR_REQUIRED'):
            mod.run(self.private,self.root/'no-model',out)
        self.assertFalse(out.exists())

    def test_fake_model_data_only_saved_in_private_report(self):
        fake=types.ModuleType('mlx_qwen3_asr')
        fake.Session=FakeSession
        out=self.root/'new-private-report'
        with patch.object(sys,'platform','darwin'),patch.dict(sys.modules,{'mlx_qwen3_asr':fake}):
            summary=mod.run(self.private,self.model,out)
        self.assertEqual(summary['status'],'MODEL_CROSS_CHECK_EXECUTED_NOT_HUMAN_VERIFIED')
        self.assertNotIn('Тайный',json.dumps(summary,ensure_ascii=False))
        self.assertNotIn(str(self.private),json.dumps(summary))
        saved=json.loads((out/'cross-asr-private.json').read_text())
        self.assertEqual(len(saved['cases']),3)
        self.assertEqual(saved['cases'][0]['original_whisper_focused_window'],
                         'Тайный русский учебный материал')
        self.assertEqual(saved['cases'][0]['independent_qwen3_asr']['focused_8s_text'],
                         'Совершенно другой текст')
        self.assertEqual(saved['cases'][0]['human_classification'],'INDETERMINATE')
        self.assertFalse(saved['cases'][0]['human_audio_verified'])
        if os.name!='nt':
            self.assertEqual(out.stat().st_mode & 0o777,0o700)
            self.assertEqual((out/'cross-asr-private.json').stat().st_mode & 0o777,0o600)

    def test_never_overwrite_existing_private_report(self):
        out=self.root/'existing-private-report'
        out.mkdir()
        with self.assertRaisesRegex(ValueError,'NEW_PRIVATE_OUTPUT_DIR_REQUIRED'):
            mod.run(self.private,self.model,out)

if __name__=='__main__':
    unittest.main()
