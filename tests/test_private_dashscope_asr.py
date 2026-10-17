"""Synthetic-only tests for official Alibaba Qwen3-ASR P1 cloud integration."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch
import wave

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'cross-validate-dashscope-asr.py'
spec = importlib.util.spec_from_file_location('private_dashscope_asr', SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class FakeResponse:
    def __init__(self, content):
        self.content = content
    def read(self, limit):
        return self.content
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return None


class FakeOpener:
    def __init__(self):
        self.requests = []
    def open(self, req, timeout):
        self.requests.append((req, timeout))
        body = json.loads(req.data)
        assert body['model'] == mod.MODEL
        assert body['asr_options']['language'] == 'ru'
        data = body['messages'][0]['content'][0]['input_audio']['data']
        assert data.startswith('data:audio/wav;base64,')
        assert base64.b64decode(data.split(',', 1)[1]).startswith(b'RIFF')
        return FakeResponse(json.dumps({
            'model': mod.MODEL,
            'choices': [{
                'finish_reason': 'stop',
                'message': {
                    'content': 'Независимая гипотеза',
                    'annotations': [{'type': 'audio_info', 'language': 'ru'}]
                }
            }]
        }).encode('utf-8'))


class DashscopePrivateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.private = self.root / 'private'
        self.private.mkdir()
        for group, index, subdir, stem in mod.cross.CASES:
            folder = self.private / subdir
            folder.mkdir(exist_ok=True)
            start = 352000 if index == 30 else 1283200 if index == 77 else 1789686
            count = 160000 if index == 120 else 192000
            with wave.open(str(folder / (stem + '.wav')), 'wb') as out:
                out.setnchannels(1)
                out.setsampwidth(2)
                out.setframerate(16000)
                out.writeframes(bytes(count * 2))
            focus_start = start + 32000
            focus_end = min(start + count, focus_start + 128000)
            (folder / (stem + '-private.json')).write_text(
                json.dumps({
                    'format': 'ru-class-private-p1-review-v1',
                    'focused_window_index': index,
                    'clip_start_sample': start,
                    'clip_end_sample': start + count,
                    'neighbors': [{
                        'index': index,
                        'text': 'Приватная оригинальная фраза',
                        'window_start_sample': focus_start,
                        'window_end_sample': focus_end
                    }]
                }), encoding='utf-8')
    def tearDown(self):
        self.temp.cleanup()

    def test_region_host_allowlist_and_workspace(self):
        self.assertEqual(mod.api_endpoint('beijing'),
                         'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions')
        self.assertEqual(mod.api_endpoint('singapore', 'ws123'),
                         'https://ws123.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions')
        for wid in ('evil.example.com', 'evil/x', '../other', 'a@evil.com'):
            with self.assertRaisesRegex(ValueError, 'INVALID_WORKSPACE_ID'):
                mod.api_endpoint('beijing', wid)
        with self.assertRaisesRegex(ValueError, 'INVALID_DASHSCOPE_REGION'):
            mod.api_endpoint('us')

    def test_dryrun_uses_no_key_or_requests(self):
        with patch.dict(os.environ, {'DASHSCOPE_API_KEY': ''}):
            report = mod.run(self.private, 'beijing', None, None, dry_run=True)
        self.assertEqual(report['status'], 'VALIDATED_INPUT_ONLY_NO_API_REQUEST')
        self.assertEqual(len(report['cases']), 3)
        self.assertNotIn('Приватная', json.dumps(report, ensure_ascii=False))

    def test_request_payload_and_result_parse(self):
        opener = FakeOpener()
        result = mod.infer(b'RIFF' + bytes(40), mod.api_endpoint('beijing'), 'private-token', opener=opener)
        self.assertEqual(result['text'], 'Независимая гипотеза')
        self.assertEqual(result['language'], 'ru')
        self.assertEqual(result['finish_reason'], 'stop')
        self.assertEqual(len(opener.requests), 1)
        req = opener.requests[0][0]
        self.assertEqual(req.get_header('Authorization'), 'Bearer private-token')

    def test_six_mocked_requests_and_local_private_only_report(self):
        requests = []
        def fake_asr(data, url, key):
            self.assertTrue(data.startswith(b'RIFF'))
            self.assertEqual(key, 'private-token')
            self.assertTrue(url.startswith('https://dashscope.aliyuncs.com/'))
            requests.append(len(data))
            return dict(text='Независимая гипотеза', language='ru',
                        finish_reason='stop', model=mod.MODEL)
        output = self.root / 'new-private-output'
        summary = mod.run(self.private, 'beijing', None, output,
                          api_key='private-token', infer_fn=fake_asr)
        self.assertEqual(len(requests), 6)
        self.assertEqual(summary['provider_requests'], 6)
        self.assertNotIn('Приватная', json.dumps(summary, ensure_ascii=False))
        self.assertNotIn('Независимая', json.dumps(summary, ensure_ascii=False))
        report = json.loads((output / 'cross-asr-private.json').read_text())
        self.assertEqual(len(report['cases']), 3)
        self.assertEqual(report['cases'][0]['original_whisper_focused_window'],
                         'Приватная оригинальная фраза')
        self.assertFalse(report['human_verified'])
        self.assertTrue(report['audio_uploaded_to_provider'])
        if os.name != 'nt':
            self.assertEqual(output.stat().st_mode & 0o777, 0o700)
            self.assertEqual((output / 'cross-asr-private.json').stat().st_mode & 0o777, 0o600)

    def test_fail_closed_before_request_without_key_or_private_dir(self):
        out = self.root / 'new-private'
        with patch.dict(os.environ, {'DASHSCOPE_API_KEY': ''}):
            with self.assertRaisesRegex(ValueError, 'DASHSCOPE_API_KEY_REQUIRED'):
                mod.run(self.private, 'beijing', None, out)
        self.assertFalse(out.exists())
        out.mkdir()
        with self.assertRaisesRegex(ValueError, 'NEW_PRIVATE_OUTPUT_DIR_REQUIRED'):
            mod.run(self.private, 'beijing', None, out, api_key='not-a-real-key')

    def test_reject_bad_provider_response(self):
        with self.assertRaisesRegex(ValueError, 'INVALID_DASHSCOPE_TRANSCRIPT'):
            mod.parse_response({'choices': [{'message': {'content': [{'text': 'X'}]}}]})
        with self.assertRaisesRegex(ValueError, 'AUDIO_EXCEEDS_PROVIDER_LIMIT'):
            mod.request_body(bytes(mod.MAX_AUDIO_BYTES + 1))


if __name__ == '__main__':
    unittest.main()
