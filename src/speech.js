export async function synthesizeWithOpenAI({
  text,
  apiKey,
  model = 'gpt-4o-mini-tts',
  voice = 'marin',
  instructions = 'Говори естественно, доброжелательно и уверенно, как профессиональный сомелье. Не торопись.',
  fetchImpl = globalThis.fetch
}) {
  if (!apiKey) {
    const error = new Error('TTS provider is not configured');
    error.code = 'TTS_NOT_CONFIGURED';
    throw error;
  }
  const cleanText = String(text ?? '').trim();
  if (!cleanText) {
    const error = new Error('TTS text is empty');
    error.code = 'TTS_EMPTY_TEXT';
    throw error;
  }

  const response = await fetchImpl('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      voice,
      input: cleanText,
      instructions,
      response_format: 'mp3'
    })
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    const error = new Error(`OpenAI TTS failed with ${response.status}: ${details.slice(0, 500)}`);
    if (response.status === 429) error.code = details.toLowerCase().includes('quota') ? 'TTS_QUOTA_EXCEEDED' : 'TTS_RATE_LIMIT';
    else error.code = 'TTS_PROVIDER_ERROR';
    throw error;
  }

  return {
    audioBuffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || 'audio/mpeg',
    model,
    voice
  };
}
