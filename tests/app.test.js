import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createRequestHandler } from '../src/app.js';

async function withServer(run, dependencies = {}, configOverrides = {}) {
  const config = {
    port: 0,
    publicBaseUrl: 'http://localhost',
    allowedClientIds: new Set(['winemd']),
    allowedEmbedOrigins: new Set(['http://localhost']),
    openAiApiKey: 'test-key',
    sttModel: 'gpt-4o-mini-transcribe',
    sttLanguage: '',
    maxAudioBytes: 5 * 1024 * 1024,
    maxJsonBytes: 16 * 1024,
    answerModel: 'gpt-4.1-mini',
    knowledgeProvider: 'local',
    localKnowledgeFile: '',
    knowledgeMinScore: 0.34,
    knowledgeMaxResults: 5,
    catalogProvider: 'local',
    localCatalogFile: '',
    catalogMaxProducts: 5,
    ...configOverrides
  };
  const server = http.createServer(createRequestHandler(config, dependencies));
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('health endpoint responds successfully', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.phase, '6B-voice');
    assert.equal(body.sttConfigured, true);
  });
});

test('demo page is available', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/demo.html`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /WINE AI — Digital Sommelier of Moldova/);
  });
});

test('loader is available', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/widget/loader.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /javascript/);
  });
});

test('unknown client id is rejected', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/widget/config?clientId=unknown`);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /clientId/i);
  });
});

test('directory traversal is rejected', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/..%2Fpackage.json`);
    assert.notEqual(response.status, 200);
  });
});

test('transcription endpoint accepts supported audio and returns text', async () => {
  let received;
  await withServer(async (baseUrl) => {
    const audio = Buffer.alloc(500, 7);
    const response = await fetch(`${baseUrl}/api/transcribe?clientId=winemd`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm;codecs=opus' },
      body: audio
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.text, 'Тестовая расшифровка');
    assert.equal(received.contentType, 'audio/webm');
    assert.equal(received.audioBuffer.length, 500);
  }, {
    transcribe: async (input) => {
      received = input;
      return { text: 'Тестовая расшифровка', model: input.model };
    }
  });
});

test('transcription endpoint rejects unsupported content type', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/transcribe?clientId=winemd`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: Buffer.alloc(500)
    });
    assert.equal(response.status, 415);
  });
});

test('transcription endpoint rejects oversized audio', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/transcribe?clientId=winemd`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm' },
      body: Buffer.alloc(501)
    });
    assert.equal(response.status, 413);
  }, {}, { maxAudioBytes: 500 });
});

test('transcription endpoint reports missing provider configuration', async () => {
  const error = new Error('missing');
  error.code = 'STT_NOT_CONFIGURED';
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/transcribe?clientId=winemd`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm' },
      body: Buffer.alloc(500)
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error, 'STT_NOT_CONFIGURED');
  }, { transcribe: async () => { throw error; } }, { openAiApiKey: '' });
});



test('speech endpoint returns synthesized audio', async () => {
  let received;
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/speak?clientId=winemd`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Тестовый ответ' })
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /audio\/mpeg/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([1, 2, 3, 4]));
    assert.equal(received.text, 'Тестовый ответ');
  }, {
    synthesize: async (input) => {
      received = input;
      return { audioBuffer: Buffer.from([1, 2, 3, 4]), contentType: 'audio/mpeg', model: input.model, voice: input.voice };
    }
  }, { ttsModel: 'gpt-4o-mini-tts', ttsVoice: 'marin', ttsInstructions: 'test' });
});

test('speech endpoint validates text', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/speak?clientId=winemd`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '' })
    });
    assert.equal(response.status, 422);
  });
});

test('answer endpoint refuses when the knowledge base has no evidence', async () => {
  let answerProviderCalled = false;
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/answer?clientId=winemd`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Какая сегодня погода?' })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.refused, true);
    assert.deepEqual(body.sources, []);
    assert.equal(answerProviderCalled, false);
  }, {
    knowledgeService: {
      retrieve: async (query) => ({ found: false, query, results: [], reason: 'NO_RELEVANT_EVIDENCE' }),
      noEvidenceAnswer: () => 'В предоставленной базе Wine.md нет точной информации для ответа на этот вопрос.'
    },
    answerProvider: async () => { answerProviderCalled = true; return { text: 'wrong' }; }
  });
});

test('answer endpoint returns grounded answer and provenance', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/answer?clientId=winemd`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Что подать к рыбе?' })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.grounded, true);
    assert.equal(body.refused, false);
    assert.equal(body.answer, 'Сухое белое вино.');
    assert.equal(body.sources[0].id, 'source-1');
  }, {
    knowledgeService: {
      retrieve: async (query) => ({
        found: true,
        query,
        results: [{ id: 'source-1', type: 'pairing', title: 'Вино к рыбе', text: 'К рыбе подходит сухое белое вино.', score: 0.9, metadata: {} }]
      }),
      noEvidenceAnswer: () => 'no evidence'
    },
    answerProvider: async ({ evidence }) => {
      assert.equal(evidence[0].id, 'source-1');
      return { text: 'Сухое белое вино.', model: 'mock-model' };
    },
    catalogService: { getProductsByIds: async () => [] }
  });
});

test('answer endpoint validates query length', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/answer?clientId=winemd`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '' })
    });
    assert.equal(response.status, 422);
  });
});
