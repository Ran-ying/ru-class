// Whisper models trained on subtitled video emit fixed "credits" lines when a
// window holds only silence or noise (e.g. "Редактор субтитров Н.Закомолдина
// Корректор А.Егорова"). Observed on the owner's Mac mini whisper.cpp small
// endpoint for a pure 8-second silent window, 2026-10-21.
//
// This filter ONLY changes the text given to the lossy caption projection.
// The exact provider response is still archived first as raw evidence.
// Only whole Whisper segments (newline-separated) matching an explicit
// credit pattern are dropped; ordinary speech is never edited or trimmed.
const CREDIT_SEGMENTS=[
  /^(редактор|корректор)\s+субтитров(\s|$)/iu,
  /^[Кк]орректор\s+[А-ЯЁ]\.\s?[А-ЯЁ][а-яё]+\.?$/u,
  /^субтитры\s+(сделал|создавал|подготовил|делал)(а|и)?(\s|$)/iu,
  /^субтитры\s+(от|by)\s/iu,
  /dimatorzok/iu,
  /^продолжение\s+следует[.…!]*$/iu,
  // Whole-segment sound annotations, e.g. "[звук систии]" returned for 8 s of
  // low noise on the same endpoint. Spoken words are never fully bracketed.
  /^\[[^\]]*\]$/u,
  /^\([^)]*\)$/u,
  /^[♪♫*\s]+$/u
];
export function isCreditSegment(segment){
  const text=segment.trim();
  return !!text&&CREDIT_SEGMENTS.some(pattern=>pattern.test(text));
}
/** Text for TranscriptBuffer: identical to the input unless a whole segment is a known credit line. */
export function captionProjectionText(raw){
  if(typeof raw!=='string')return raw;
  const segments=raw.split(/\r?\n/u);
  if(!segments.some(isCreditSegment))return raw;
  return segments.filter(segment=>!isCreditSegment(segment)).join('\n');
}
