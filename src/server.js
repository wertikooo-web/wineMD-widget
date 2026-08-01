import dotenv from 'dotenv';

dotenv.config({ override: true });

import http from 'node:http';
import { createRequestHandler } from './appWithKnowledgeStudio.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const server = http.createServer(createRequestHandler(config));

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    console.error(`Порт ${config.port} уже занят. Скорее всего, Wine.md Voice Lite уже запущен.`);
    console.error(`Откройте http://localhost:${config.port}/demo.html или остановите старый процесс командой: npx kill-port ${config.port}`);
    process.exitCode = 1;
    return;
  }
  throw error;
});

server.listen(config.port, () => {
  console.log(`Wine.md Voice Lite running at http://localhost:${config.port}/demo.html`);
  console.log('Voice chain ready: microphone → STT → knowledge base → answer → TTS');
});

function shutdown(signal) {
  console.log(`Received ${signal}. Shutting down...`);
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
