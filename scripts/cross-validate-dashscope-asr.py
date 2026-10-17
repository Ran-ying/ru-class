#!/usr/bin/env python3
"""P1 private C1/C2 cross-check with official Alibaba Cloud Qwen3-ASR-Flash.

This uploads six short private WAV clips to the user's selected Alibaba Cloud
region. Credentials are loaded ONLY from DASHSCOPE_API_KEY. Prints numerical
comparisons, never audio, recognized text, the key or request bodies.
Python stdlib only; no model download and no OpenAI/DashScope SDK dependency.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request
import wave
from difflib import SequenceMatcher

SCRIPT_DIR = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    'ru_class_private_cross_asr', SCRIPT_DIR / 'cross-validate-private-asr.py'
)
cross = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cross)

MODEL = 'qwen3-asr-flash'
ENDPOINTS = {
    'beijing': ('dashscope.aliyuncs.com', 'cn-beijing'),
    'singapore': ('dashscope-intl.aliyuncs.com', 'ap-southeast-1'),
}
ENDPOINT_PATH = '/compatible-mode/v1/chat/completions'
MAX_AUDIO_BYTES = 10 * 1024 * 1024

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None

def api_endpoint(region, workspace_id=None):
    if region not in ENDPOINTS:
        raise ValueError('INVALID_DASHSCOPE_REGION')
    legacy_host, location = ENDPOINTS[region]
    if workspace_id:
        if not re.fullmatch(r'[A-Za-z0-9-]{1,128}', workspace_id):
            raise ValueError('INVALID_WORKSPACE_ID')
        host = f'{workspace_id}.{location}.maas.aliyuncs.com'
    else:
        host = legacy_host
    return 'https://' + host + ENDPOINT_PATH

def read_focused_wav(item):
    # Use only private audio and original course-sample coordinates validated
    # by the existing P1 audit code. Never re-infer sample offsets.
    start = item['start'] - item['clip_start']
    end = item['end'] - item['clip_start']
    with wave.open(str(item['audio']), 'rb') as audio:
        audio.setpos(start)
        pcm = audio.readframes(end - start)
    if len(pcm) != (end - start) * 2:
        raise ValueError('INCOMPLETE_FOCUSED_AUDIO')
    import io
    stream = io.BytesIO()
    with wave.open(stream, 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16000)
        output.writeframes(pcm)
    return stream.getvalue()

def request_body(wav_bytes):
    if len(wav_bytes) > MAX_AUDIO_BYTES:
        raise ValueError('AUDIO_EXCEEDS_PROVIDER_LIMIT')
    return {
        'model': MODEL,
        'messages': [{'role': 'user', 'content': [
            {'type': 'input_audio', 'input_audio': {
                'data': 'data:audio/wav;base64,' +
                        base64.b64encode(wav_bytes).decode('ascii')
            }}
        ]}],
        'stream': False,
        'asr_options': {'language': 'ru', 'enable_itn': False}
    }

def parse_response(payload):
    if not isinstance(payload, dict):
        raise ValueError('INVALID_DASHSCOPE_RESPONSE')
    choices = payload.get('choices')
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise ValueError('INVALID_DASHSCOPE_CHOICES')
    entry = choices[0]
    message = entry.get('message')
    text = message.get('content') if isinstance(message, dict) else None
    if not isinstance(text, str) or len(text) > 20000:
        raise ValueError('INVALID_DASHSCOPE_TRANSCRIPT')
    annotations = message.get('annotations')
    language = None
    if isinstance(annotations, list):
        for annotation in annotations:
            if isinstance(annotation, dict) and annotation.get('type') == 'audio_info':
                language = annotation.get('language')
                break
    return {'text': text,
            'language': language if isinstance(language, str) else None,
            'finish_reason': entry.get('finish_reason') if isinstance(entry.get('finish_reason'), str) else None,
            'model': payload.get('model') if isinstance(payload.get('model'), str) else None}

def infer(wav_bytes, endpoint, key, *, opener=None):
    if not isinstance(key, str) or not key or any(c in key for c in ('\r', '\n')):
        raise ValueError('DASHSCOPE_API_KEY_REQUIRED')
    encoded = json.dumps(request_body(wav_bytes), ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(endpoint, data=encoded, method='POST', headers={
        'Authorization': 'Bearer ' + key,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    })
    safe_opener = opener if opener is not None else urllib.request.build_opener(NoRedirect())
    try:
        with safe_opener.open(req, timeout=120) as response:
            raw = response.read(1024 * 1024 + 1)
    except urllib.error.HTTPError as e:
        # Do not print response bodies, Authorization header, URLs or provider
        # error text: those may include sensitive inputs.
        if 300 <= e.code < 400:
            raise ValueError('DASHSCOPE_REDIRECT_REFUSED') from None
        raise ValueError('DASHSCOPE_HTTP_' + str(e.code)) from None
    except (urllib.error.URLError, TimeoutError):
        raise ValueError('DASHSCOPE_NETWORK_FAILURE') from None
    if len(raw) > 1024 * 1024:
        raise ValueError('DASHSCOPE_RESPONSE_TOO_LARGE')
    try:
        return parse_response(json.loads(raw))
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ValueError('INVALID_DASHSCOPE_JSON') from None

def metrics(reference, alternative):
    a = cross.normalized_words(reference)
    b = cross.normalized_words(alternative)
    return {
        'original_words': len(a),
        'independent_words': len(b),
        'lexical_similarity': round(SequenceMatcher(
            None, a, b, autojunk=False).ratio(), 4)
    }

def run(root, region, workspace_id, output_dir, *, dry_run=False, api_key=None, infer_fn=infer):
    items = cross.validated_inputs(root)
    endpoint = api_endpoint(region, workspace_id)
    if dry_run:
        return {'status': 'VALIDATED_INPUT_ONLY_NO_API_REQUEST',
                'model': MODEL, 'region': region,
                'cases': [{'case': f"{x['group']} #{x['index']}",
                           'duration_seconds': x['duration_seconds'],
                           'sha256': x['wav_sha256']}
                          for x in items]}
    if output_dir is None or output_dir.exists() or not output_dir.parent.is_dir():
        raise ValueError('NEW_PRIVATE_OUTPUT_DIR_REQUIRED')
    key = api_key if api_key is not None else os.environ.get('DASHSCOPE_API_KEY')
    if not key:
        raise ValueError('DASHSCOPE_API_KEY_REQUIRED')
    private = []
    for item in items:
        original = item['focused']['text']
        context_audio = item['audio'].read_bytes()
        focus_audio = read_focused_wav(item)
        focus = infer_fn(focus_audio, endpoint, key)
        context = infer_fn(context_audio, endpoint, key)
        private.append({
            'case': f"{item['group']} #{item['index']}",
            'human_audio_verified': False,
            'human_classification': 'INDETERMINATE',
            'note': 'Two ASR hypotheses are not acoustic ground truth.',
            'input': {
                'wav_sha256': item['wav_sha256'],
                'sample_rate': 16000,
                'clip_start_sample': item['clip_start'],
                'clip_end_sample': item['clip_end'],
                'focused_window_start_sample': item['start'],
                'focused_window_end_sample': item['end']},
            'original_whisper_focused_window': original,
            'original_whisper_neighbor_windows': item['neighbors'],
            'independent_dashscope_qwen3_asr': {
                'focused_8s_text': focus['text'],
                'context_text': context['text'],
                'focused_language': focus['language'],
                'context_language': context['language'],
                'focused_finish_reason': focus['finish_reason'],
                'context_finish_reason': context['finish_reason'],
                'model': focus['model'] or MODEL},
            'computed_text_metrics': {
                'focused_vs_original': metrics(original, focus['text']),
                'context_vs_original': metrics(original, context['text'])}
        })
    # No report is persisted until all six API calls complete. Source audio
    # and raw evidence are never modified. Destination is exclusively local.
    old_umask = os.umask(0o077)
    try:
        output_dir.mkdir(mode=0o700)
        report = {
            'format': 'ru-class-p1-dashscope-cross-asr-private-v1',
            'model_family': 'Qwen3-ASR-Flash (official Alibaba Cloud)',
            'provider_region': region,
            'audio_uploaded_to_provider': True,
            'whisper_rerun': False,
            'human_verified': False,
            'classification_status': 'MODEL_COMPARISON_ONLY',
            'cases': private
        }
        file = output_dir / 'cross-asr-private.json'
        with file.open('x', encoding='utf-8') as output:
            json.dump(report, output, ensure_ascii=False, indent=2)
        file.chmod(0o600)
    finally:
        os.umask(old_umask)
    return {'status': 'CLOUD_MODEL_CROSS_CHECK_EXECUTED_NOT_HUMAN_VERIFIED',
            'model': MODEL, 'region': region, 'provider_requests': 6,
            'private_report_saved': True,
            'cases': [{'case': c['case'],
                       'focused_vs_original': c['computed_text_metrics']['focused_vs_original'],
                       'context_vs_original': c['computed_text_metrics']['context_vs_original']}
                      for c in private]}

def main():
    parser = argparse.ArgumentParser(
        description='Official Alibaba Cloud Qwen3-ASR audio cross-check (uploads 3 private clips twice)')
    parser.add_argument('--private-root', type=Path, required=True)
    parser.add_argument('--region', choices=tuple(ENDPOINTS), default='beijing')
    parser.add_argument('--workspace-id', default=os.environ.get('DASHSCOPE_WORKSPACE_ID'))
    parser.add_argument('--output-dir', type=Path)
    parser.add_argument('--dry-run', action='store_true',
                        help='Validate private WAV/JSON only: never contacts Alibaba Cloud')
    args = parser.parse_args()
    try:
        result = run(args.private_root, args.region, args.workspace_id,
                     args.output_dir, dry_run=args.dry_run)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    except Exception as e:
        # No key, transcripts, paths, third-party body or stack traces.
        code = str(e) if isinstance(e, ValueError) and re.fullmatch(r'[A-Z0-9_]+', str(e)) else 'CROSS_ASR_RUNTIME_FAILURE'
        print('PRIVATE_DASHSCOPE_CROSS_ASR_ERROR: ' + code, file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
