const ALLOWED_AUDIO_TYPES = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav'
]);

export function normalizeAudioType(contentType = '') {
  return contentType.split(';', 1)[0].trim().toLowerCase();
}

export function isAllowedAudioType(contentType) {
  return ALLOWED_AUDIO_TYPES.has(normalizeAudioType(contentType));
}

function extensionForType(contentType) {
  const type = normalizeAudioType(contentType);
  if (type === 'audio/ogg') return 'ogg';
  if (type === 'audio/mp4') return 'm4a';
  if (type === 'audio/mpeg') return 'mp3';
  if (type === 'audio/wav' || type === 'audio/x-wav') return 'wav';
  return 'webm';
}

export async function transcribeWithOpenAI({
  audioBuffer,
  contentType,
  apiKey,
  model = 'gpt-4o-mini-transcribe',
  language,
  prompt,
  fetchImpl = globalThis.fetch
}) {
  if (!apiKey) {
    const error = new Error('STT provider is not configured');
    error.code = 'STT_NOT_CONFIGURED';
    throw error;
  }

  const form = new FormData();
  const extension = extensionForType(contentType);
  const file = new Blob([audioBuffer], { type: normalizeAudioType(contentType) });

  form.append('file', file, `recording.${extension}`);
  form.append('model', model);
  form.append('response_format', 'json');
  if (language) form.append('language', language);
  if (prompt) form.append('prompt', prompt);

  const response = await fetchImpl('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: form,
    signal: AbortSignal.timeout(30_000)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `STT request failed with status ${response.status}`);
    const providerCode = payload?.error?.code;
    error.code = response.status === 429
      ? (providerCode === 'insufficient_quota' ? 'STT_QUOTA_EXCEEDED' : 'STT_RATE_LIMIT')
      : 'STT_PROVIDER_ERROR';
    error.status = response.status;
    throw error;
  }

  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  if (!text) {
    const error = new Error('STT provider returned empty transcription');
    error.code = 'STT_EMPTY_RESULT';
    throw error;
  }

  return { text, model, language: typeof payload.language === 'string' ? payload.language : undefined };
}
