import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

async function read(relativePath) {
  return fs.readFile(path.join(projectRoot, relativePath), 'utf8');
}

test('loader contains duplicate-instance protection', async () => {
  const source = await read('public/widget/loader.js');
  assert.match(source, /__wineMdVoiceLiteWidget/);
  assert.match(source, /if \(window\[INSTANCE_KEY\]\) return/);
});

test('frontend files do not contain API keys', async () => {
  const files = [
    'public/demo.html',
    'public/widget/loader.js',
    'public/widget/embed.html',
    'public/widget/widget.js',
    'public/widget/widget.css'
  ];

  for (const file of files) {
    const source = await read(file);
    assert.doesNotMatch(source, /OPENAI_API_KEY|sk-[A-Za-z0-9_-]{20,}/, file);
  }
});

test('widget uses textContent instead of dynamic innerHTML', async () => {
  const source = await read('public/widget/widget.js');
  assert.doesNotMatch(source, /innerHTML\s*=/);
  assert.match(source, /textContent/);
});

test('phase 2 uses MediaRecorder and requests microphone only on user action', async () => {
  const source = await read('public/widget/widget.js');
  assert.match(source, /navigator\.mediaDevices\?\.getUserMedia/);
  assert.match(source, /new MediaRecorder/);
  assert.match(source, /talkButton\.addEventListener\('pointerdown', beginRecording\)/);
  assert.doesNotMatch(source, /getUserMedia[\s\S]{0,80}\(\);\s*$/m);
});

test('phase 2 limits recordings and releases microphone tracks', async () => {
  const source = await read('public/widget/widget.js');
  assert.match(source, /MAX_RECORDING_MS = 20_000/);
  assert.match(source, /track\.stop\(\)/);
  assert.match(source, /URL\.revokeObjectURL/);
});

test('phase 2 exposes local playback controls', async () => {
  const html = await read('public/widget/embed.html');
  assert.match(html, /id="audioPlayer" controls/);
  assert.match(html, /id="recordingMeta"/);
  assert.match(html, /id="permissionHint"/);
});

test('phase 3 uploads raw audio to the protected transcription endpoint', async () => {
  const source = await read('public/widget/widget.js');
  assert.match(source, /fetch\(`\/api\/transcribe\?clientId=/);
  assert.match(source, /'Content-Type': latestRecordingBlob\.type/);
  assert.match(source, /body: latestRecordingBlob/);
  assert.match(source, /AbortController/);
});

test('phase 3 transcript is rendered safely with textContent', async () => {
  const source = await read('public/widget/widget.js');
  const html = await read('public/widget/embed.html');
  assert.match(html, /id="transcriptText"/);
  assert.match(html, /id="transcribeButton"/);
  assert.match(source, /transcriptText\.textContent = payload\.text/);
  assert.doesNotMatch(source, /transcriptText\.innerHTML/);
});

test('server keeps STT credentials outside frontend files', async () => {
  const config = await read('src/config.js');
  const service = await read('src/transcription.js');
  assert.match(config, /env\.OPENAI_API_KEY/);
  assert.match(service, /Authorization: `Bearer \$\{apiKey\}`/);
});

test('phase 5A renders catalog cards safely without innerHTML', async () => {
  const widget = await read('public/widget/widget.js');
  const embed = await read('public/widget/embed.html');
  assert.match(widget, /renderProducts/);
  assert.match(widget, /document\.createElement\('article'\)/);
  assert.match(widget, /noopener noreferrer/);
  assert.doesNotMatch(widget, /\.innerHTML\s*=/);
  assert.match(embed, /id="productList"/);
});

test('phase 6A admin UI explains how to generate and view benchmark questions', async () => {
  const html = await fs.readFile(new URL('../public/admin/index.html', import.meta.url), 'utf8');
  const js = await fs.readFile(new URL('../public/admin/admin.js', import.meta.url), 'utf8');
  assert.match(html, /Как пользоваться/);
  assert.match(html, /benchmarkProgress/);
  assert.match(js, /pollBenchmarkJob/);
  assert.match(js, /datasetItems/);
});

test('voice demo limits spoken text and always has TTS/playback timeouts', async () => {
  const widget = await fs.readFile(new URL('../public/widget/widget.js', import.meta.url), 'utf8');
  assert.match(widget, /MAX_SPEECH_CHARACTERS\s*=\s*300/);
  assert.match(widget, /TTS_REQUEST_TIMEOUT_MS\s*=\s*20_000/);
  assert.match(widget, /AUDIO_PLAYBACK_TIMEOUT_MS\s*=\s*45_000/);
  assert.match(widget, /answerAudio\.addEventListener\('ended'/);
  assert.match(widget, /answerAudio\.addEventListener\('error'/);
  assert.match(widget, /setState\('answered'\)/);
});
