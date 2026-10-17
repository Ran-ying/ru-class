#!/usr/bin/env python3
"""Offline C1/C2 second-model review: Qwen3-ASR via MLX, not Whisper.
Never uploads audio or prints private hypotheses. Dry-run needs stdlib only.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import wave
from difflib import SequenceMatcher
from pathlib import Path

# Disable remote model discovery/telemetry BEFORE importing the MLX library.
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['WANDB_MODE'] = 'offline'
RATE = 16000
CASES = (
    ('C1', 30, 'c1-targeted-private', 'review-0030'),
    ('C2', 77, 'c2-targeted-private', 'review-0077'),
    ('C1', 120, 'c1-targeted-private', 'review-0120'),
)
TOKEN_RE = re.compile(r'[^\W_]+', re.UNICODE)


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def normalized_words(text):
    return TOKEN_RE.findall(text.casefold().replace('ё', 'е'))


def text_metrics(a, b):
    x, y = normalized_words(a), normalized_words(b)
    return {'first_tokens': len(x), 'second_tokens': len(y),
            'word_similarity': round(SequenceMatcher(None, x, y, autojunk=False).ratio(), 4)}


def validate_case(root, case):
    group, index, subdir, stem = case
    folder = root / subdir
    audio = folder / (stem + '.wav')
    evidence = folder / (stem + '-private.json')
    if not audio.is_file() or not evidence.is_file():
        raise ValueError('MISSING_LOCAL_CLIP_OR_EVIDENCE')
    with wave.open(str(audio), 'rb') as wav:
        if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getcomptype()) != (1, 2, RATE, 'NONE'):
            raise ValueError('AUDIO_MUST_BE_16KHZ_MONO_PCM16')
        frames = wav.getnframes()
    raw = json.loads(evidence.read_text(encoding='utf-8'))
    if raw.get('format') != 'ru-class-private-p1-review-v1':
        raise ValueError('UNSUPPORTED_EVIDENCE_FORMAT')
    if raw.get('focused_window_index') != index:
        raise ValueError('FOCUS_INDEX_MISMATCH')
    start, end = raw.get('clip_start_sample'), raw.get('clip_end_sample')
    if not isinstance(start, int) or not isinstance(end, int) or start < 0 or end - start != frames:
        raise ValueError('CLIP_COORDINATE_MISMATCH')
    neighbors = raw.get('neighbors')
    if not isinstance(neighbors, list) or not neighbors:
        raise ValueError('INVALID_OR_EMPTY_NEIGHBORS')
    focused = [w for w in neighbors if w.get('index') == index]
    if len(focused) != 1 or not isinstance(focused[0].get('text'), str):
        raise ValueError('FOCUS_HYPOTHESIS_MISSING')
    focus = focused[0]
    wstart, wend = focus.get('window_start_sample'), focus.get('window_end_sample')
    if not isinstance(wstart, int) or not isinstance(wend, int) or wstart < start or wend > end or wstart >= wend:
        raise ValueError('FOCUS_WINDOW_OUT_OF_AUDIO')
    for w in neighbors:
        if not isinstance(w.get('index'), int) or not isinstance(w.get('text'), str):
            raise ValueError('INVALID_NEIGHBOR')
        if not isinstance(w.get('window_start_sample'), int) or not isinstance(w.get('window_end_sample'), int):
            raise ValueError('INVALID_NEIGHBOR_COORDINATES')
    return dict(group=group, index=index, audio=audio, evidence=evidence,
                clip_start=start, clip_end=end, start=wstart, end=wend,
                duration_seconds=round(frames / RATE, 6), wav_sha256=digest(audio),
                neighbors=neighbors, focused=focus)


def focus_wav(case, folder):
    path = folder / 'focused.wav'
    with wave.open(str(case['audio']), 'rb') as src:
        src.setpos(case['start'] - case['clip_start'])
        data = src.readframes(case['end'] - case['start'])
    old = os.umask(0o077)
    try:
        with wave.open(str(path), 'wb') as out:
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(RATE)
            out.writeframes(data)
    finally:
        os.umask(old)
    path.chmod(0o600)
    return path


def validated_inputs(private_root):
    return [validate_case(private_root, row) for row in CASES]


def run(private_root, model_dir, output_dir, *, dry_run=False):
    cases = validated_inputs(private_root)
    if dry_run:
        return {'status': 'VALIDATED_INPUT_ONLY', 'cases': [
            {'case': f"{c['group']} #{c['index']}", 'audio_seconds': c['duration_seconds'],
             'clip_start_sample': c['clip_start'], 'clip_end_sample': c['clip_end'],
             'window_start_sample': c['start'], 'window_end_sample': c['end'],
             'sha256': c['wav_sha256'], 'neighbors': len(c['neighbors'])}
            for c in cases],
            'disclaimer': 'NO independent ASR performed by dry-run.'}
    if model_dir is None or not model_dir.is_dir() or not (model_dir / 'config.json').is_file():
        raise ValueError('LOCAL_MODEL_DIR_REQUIRED')
    if output_dir is None or output_dir.exists():
        raise ValueError('NEW_PRIVATE_OUTPUT_DIR_REQUIRED')
    if sys.platform != 'darwin':
        raise ValueError('APPLE_SILICON_MACOS_REQUIRED')
    try:
        from mlx_qwen3_asr import Session
    except ImportError as err:
        raise ValueError('INSTALL_MLX_QWEN3_ASR_LOCALLY') from err
    session = Session(model=str(model_dir.resolve()))
    output_dir.mkdir(mode=0o700, parents=False, exist_ok=False)
    old = os.umask(0o077)
    try:
        private = []
        for case in cases:
            context = session.transcribe(str(case['audio']), language='Russian', return_chunks=True)
            with tempfile.TemporaryDirectory(prefix='focus-', dir=output_dir) as tmp:
                wav = focus_wav(case, Path(tmp))
                focused = session.transcribe(str(wav), language='Russian', return_chunks=True)
            original = case['focused']['text']
            private.append({
                'case': f"{case['group']} #{case['index']}",
                'human_audio_verified': False, 'human_classification': 'INDETERMINATE',
                'note': 'Independent model hypotheses are not manually verified ground truth.',
                'input': {
                    'wav_sha256': case['wav_sha256'], 'sample_rate': RATE,
                    'clip_start_sample': case['clip_start'], 'clip_end_sample': case['clip_end'],
                    'focused_window_start_sample': case['start'],
                    'focused_window_end_sample': case['end']},
                'original_whisper_focused_window': original,
                'original_whisper_neighbor_windows': case['neighbors'],
                'independent_qwen3_asr': {
                    'focused_8s_text': focused.text, 'context_text': context.text,
                    'focused_language': focused.language, 'context_language': context.language,
                    'focused_finish_reason': getattr(focused, 'finish_reason', None),
                    'context_finish_reason': getattr(context, 'finish_reason', None),
                    'focused_truncated': getattr(focused, 'truncated', None),
                    'context_truncated': getattr(context, 'truncated', None)},
                'computed_text_metrics': {
                    'focused_vs_original': text_metrics(original, focused.text),
                    'context_vs_original': text_metrics(original, context.text)},
            })
        report = {
            'format': 'ru-class-p1-cross-asr-private-v1',
            'model_family': 'Qwen3-ASR / MLX (not Whisper)',
            'model_dir_local_only': model_dir.name,
            'audio_uploaded': False, 'whisper_rerun': False,
            'classification_status': 'MODEL_DISAGREEMENT_TRIAGE_ONLY',
            'cases': private}
        target = output_dir / 'cross-asr-private.json'
        with target.open('x', encoding='utf-8') as stream:
            json.dump(report, stream, ensure_ascii=False, indent=2)
        target.chmod(0o600)
    finally:
        os.umask(old)
    return {
        'status': 'MODEL_CROSS_CHECK_EXECUTED_NOT_HUMAN_VERIFIED',
        'model_family': 'Qwen3-ASR',
        'cases': [{
            'case': c['case'],
            'focused_vs_original': c['computed_text_metrics']['focused_vs_original'],
            'context_vs_original': c['computed_text_metrics']['context_vs_original']}
            for c in private],
        'private_report_saved': True,
        'disclaimer': 'Independent ASR comparison; NOT a human-verified transcription.'}


def main():
    parser = argparse.ArgumentParser(description='Offline Qwen3-ASR cross-check for C1/C2 private audio clips')
    parser.add_argument('--private-root', required=True, type=Path)
    parser.add_argument('--model-dir', type=Path, help='Existing local Qwen3-ASR MLX model directory')
    parser.add_argument('--output-dir', type=Path, help='New private output directory; must not exist')
    parser.add_argument('--dry-run', action='store_true', help='Input validation only; NO inference')
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.private_root, args.model_dir, args.output_dir,
                             dry_run=args.dry_run), ensure_ascii=False, indent=2))
    except Exception as exc:
        code = str(exc) if isinstance(exc, ValueError) and re.fullmatch('[A-Z0-9_]+', str(exc)) else 'LOCAL_VALIDATION_OR_RUNTIME_FAILURE'
        print(f'PRIVATE_CROSS_ASR_ERROR: {code}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
