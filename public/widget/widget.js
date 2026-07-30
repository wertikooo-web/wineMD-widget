(() => {
  'use strict';

  const widgetShell = document.getElementById('widgetShell');
  const talkButton = document.getElementById('talkButton');
  const talkButtonText = document.getElementById('talkButtonText');
  const connectButton = document.getElementById('connectButton');
  const closeButton = document.getElementById('closeButton');
  const statusBubble = document.getElementById('statusBubble');
  const statusLabel = document.getElementById('statusLabel');

  const recordingPanel = document.getElementById('recordingPanel');
  const recordingMeta = document.getElementById('recordingMeta');
  const audioPlayer = document.getElementById('audioPlayer');
  const transcribeButton = document.getElementById('transcribeButton');
  const transcriptPanel = document.getElementById('transcriptPanel');
  const transcriptText = document.getElementById('transcriptText');
  const answerPanel = document.getElementById('answerPanel');
  const answerText = document.getElementById('answerText');
  const answerAudio = document.getElementById('answerAudio');
  const sourcesPanel = document.getElementById('sourcesPanel');
  const sourcesList = document.getElementById('sourcesList');
  const productList = document.getElementById('productList');
  const productPlaceholder = document.getElementById('productPlaceholder');

  const MAX_RECORDING_MS = 20_000;
  const MIN_RECORDING_MS = 250;
  const MAX_SPEECH_CHARACTERS = 300;
  const TTS_REQUEST_TIMEOUT_MS = 20_000;
  const AUDIO_PLAYBACK_TIMEOUT_MS = 45_000;
  const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  const clientId = new URLSearchParams(window.location.search).get('clientId') || 'winemd';

  const COPY = {
    ru: {
      disconnected: 'ОТКЛЮЧЕНО', connected: 'СЛУШАЮ', listening: 'СЛУШАЮ ВОПРОС',
      transcribing: 'РАСПОЗНАЮ', thinking: 'ДУМАЮ', speaking: 'ГОВОРЮ', error: 'ОШИБКА',
      connect: 'CONNECT', stop: 'STOP', hold: 'Удерживайте кнопку и говорите',
      micDenied: 'ДОСТУП К МИКРОФОНУ ЗАПРЕЩЁН', micUnavailable: 'МИКРОФОН НЕДОСТУПЕН',
      tooShort: 'СЛИШКОМ КОРОТКАЯ ЗАПИСЬ', requestFailed: 'НЕ УДАЛОСЬ ОБРАБОТАТЬ ВОПРОС'
    },
    ro: {
      disconnected: 'DECONECTAT', connected: 'ASCULT', listening: 'ASCULT ÎNTREBAREA',
      transcribing: 'RECUNOSC', thinking: 'MĂ GÂNDESC', speaking: 'VORBESC', error: 'EROARE',
      connect: 'CONNECT', stop: 'STOP', hold: 'Țineți apăsat și vorbiți',
      micDenied: 'ACCESUL LA MICROFON ESTE BLOCAT', micUnavailable: 'MICROFON INDISPONIBIL',
      tooShort: 'ÎNREGISTRARE PREA SCURTĂ', requestFailed: 'ÎNTREBAREA NU A PUTUT FI PROCESATĂ'
    },
    en: {
      disconnected: 'DISCONNECTED', connected: 'LISTENING', listening: 'LISTENING TO YOU',
      transcribing: 'TRANSCRIBING', thinking: 'THINKING', speaking: 'SPEAKING', error: 'ERROR',
      connect: 'CONNECT', stop: 'STOP', hold: 'Hold the button and speak',
      micDenied: 'MICROPHONE ACCESS DENIED', micUnavailable: 'MICROPHONE UNAVAILABLE',
      tooShort: 'RECORDING TOO SHORT', requestFailed: 'COULD NOT PROCESS THE QUESTION'
    }
  };

  let language = 'auto';
  let uiLanguage = 'ru';

  let state = 'disconnected';
  let connected = false;
  let mediaStream = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let recordingStartedAt = 0;
  let maxDurationTimer = null;
  let pointerHeld = false;
  let pendingStart = false;
  let activeRequestController = null;
  let answerAudioUrl = null;
  let latestRecordingBlob = null;

  function t(key) { return COPY[uiLanguage]?.[key] || COPY.ru[key] || key; }

  function applyLanguage() {
    document.documentElement.lang = uiLanguage;
    connectButton.textContent = connected ? t('stop') : t('connect');
    talkButton.setAttribute('aria-label', t('hold'));
    talkButtonText.textContent = t('hold');
    if (state === 'disconnected') setState('disconnected');
    else if (state === 'connected' || state === 'ready') setState('connected');
    else setState(state);
  }

  function detectLanguageFromText(text) {
    const value = String(text || '').toLowerCase();
    if (/[А-Яа-яЁё]/u.test(value)) return 'ru';
    if (/[ăâîșț]/u.test(value)) return 'ro';
    const romanianWords = /\b(bună|salut|mulțumesc|vin|vinuri|cramă|moldova|care|este|despre|vreau|poți|recomandă)\b/u;
    return romanianWords.test(value) ? 'ro' : 'en';
  }

  function setState(nextState, customMessage) {
    state = nextState;
    widgetShell.className = `widget-shell state-${nextState}`;
    const labels = {
      disconnected: t('disconnected'), connected: t('connected'), ready: t('connected'),
      listening: t('listening'), transcribing: t('transcribing'), thinking: t('thinking'),
      speaking: t('speaking'), error: t('error')
    };
    statusLabel.textContent = customMessage || labels[nextState] || t('connected');
    statusBubble.hidden = nextState === 'disconnected';
    talkButton.classList.toggle('is-held', nextState === 'listening');
    connectButton.textContent = connected ? t('stop') : t('connect');
  }

  function chooseMimeType() {
    if (!window.MediaRecorder) return '';
    return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  }

  function clearRecordingTimer() {
    if (maxDurationTimer) window.clearTimeout(maxDurationTimer);
    maxDurationTimer = null;
  }

  function stopTracks() {
    if (!mediaStream) return;
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  function clearAnswerAudio() {
    answerAudio.pause();
    answerAudio.currentTime = 0;
    answerAudio.removeAttribute('src');
    answerAudio.load();
    if (answerAudioUrl) URL.revokeObjectURL(answerAudioUrl);
    answerAudioUrl = null;
  }

  function abortCurrentTurn() {
    activeRequestController?.abort();
    activeRequestController = null;
    clearAnswerAudio();
  }


  function renderProducts(products) {
    while (productList.firstChild) productList.removeChild(productList.firstChild);
    if (!Array.isArray(products)) return;
    for (const product of products) {
      const card = document.createElement('article');
      const link = document.createElement('a');
      link.href = product.productUrl || '#';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = product.name || '';
      card.appendChild(link);
      productList.appendChild(card);
    }
  }

  function resetHiddenResults() {
    latestRecordingBlob = null;
    transcriptText.textContent = '';
    answerText.textContent = '';
    transcriptPanel.hidden = true;
    answerPanel.hidden = true;
    recordingPanel.hidden = true;
    recordingMeta.textContent = '';
    while (sourcesList.firstChild) sourcesList.removeChild(sourcesList.firstChild);
    sourcesPanel.hidden = true;
    while (productList.firstChild) productList.removeChild(productList.firstChild);
    productList.hidden = true;
    productPlaceholder.hidden = true;
  }

  async function ensureMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      throw new Error(t('micUnavailable'));
    }
    if (mediaStream?.active && mediaStream.getAudioTracks().some((track) => track.readyState === 'live')) {
      return mediaStream;
    }
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    const liveTrack = mediaStream.getAudioTracks().find((track) => track.readyState === 'live');
    if (!liveTrack) {
      stopTracks();
      throw new Error(t('micUnavailable'));
    }
    return mediaStream;
  }

  async function connect() {
    if (connected) return;
    connectButton.disabled = true;
    try {
      await ensureMicrophone();
      connected = true;
      setState('connected');
    } catch (error) {
      const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
      connected = false;
      setState('error', denied ? t('micDenied') : t('micUnavailable'));
    } finally {
      connectButton.disabled = false;
      connectButton.textContent = connected ? t('stop') : t('connect');
    }
  }

  function disconnect() {
    pointerHeld = false;
    pendingStart = false;
    clearRecordingTimer();
    abortCurrentTurn();
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try { mediaRecorder.stop(); } catch {}
    }
    mediaRecorder = null;
    audioChunks = [];
    stopTracks();
    connected = false;
    resetHiddenResults();
    setState('disconnected');
  }

  async function beginRecording(event) {
    event?.preventDefault();
    pointerHeld = true;

    if (!connected) {
      setState('error', t('connect'));
      return;
    }

    // PTT is also barge-in: stop the current answer and cancel its network turn.
    abortCurrentTurn();
    resetHiddenResults();

    if (mediaRecorder && mediaRecorder.state !== 'inactive') return;

    pendingStart = true;
    try {
      const stream = await ensureMicrophone();
      if (!pointerHeld || !connected) return;

      const mimeType = chooseMimeType();
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recordingStartedAt = Date.now();

      mediaRecorder.addEventListener('dataavailable', (dataEvent) => {
        if (dataEvent.data?.size) audioChunks.push(dataEvent.data);
      });
      mediaRecorder.addEventListener('error', () => {
        clearRecordingTimer();
        mediaRecorder = null;
        setState('error', t('micUnavailable'));
      });

      mediaRecorder.start(180);
      if (event?.pointerId !== undefined) talkButton.setPointerCapture?.(event.pointerId);
      setState('listening');
      maxDurationTimer = window.setTimeout(() => finishRecording(), MAX_RECORDING_MS);
    } catch (error) {
      const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
      setState('error', denied ? t('micDenied') : t('micUnavailable'));
    } finally {
      pendingStart = false;
    }
  }

  function finishRecording(event) {
    event?.preventDefault();
    pointerHeld = false;
    clearRecordingTimer();

    if (pendingStart) return;
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      if (connected && state === 'listening') setState('connected');
      return;
    }

    const recorder = mediaRecorder;
    const durationMs = Date.now() - recordingStartedAt;
    mediaRecorder = null;
    recordingStartedAt = 0;

    recorder.addEventListener('stop', () => {
      const finalType = recorder.mimeType || audioChunks[0]?.type || 'audio/webm';
      const blob = new Blob(audioChunks, { type: finalType });
      audioChunks = [];

      if (!connected) return;
      if (durationMs < MIN_RECORDING_MS || blob.size === 0) {
        setState('error', t('tooShort'));
        window.setTimeout(() => { if (connected) setState('connected'); }, 1200);
        return;
      }

      latestRecordingBlob = blob;
      transcribeAndAsk();
    }, { once: true });

    try { recorder.stop(); }
    catch { if (connected) setState('connected'); }
  }

  function createSpeechText(text) {
    const cleanText = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (cleanText.length <= MAX_SPEECH_CHARACTERS) return cleanText;
    let shortened = cleanText.slice(0, MAX_SPEECH_CHARACTERS - 1).trim();
    const lastSpace = shortened.lastIndexOf(' ');
    if (lastSpace > 190) shortened = shortened.slice(0, lastSpace);
    return `${shortened.replace(/[,:;—-]+$/u, '')}.`;
  }

  async function speakAnswer(text, signal) {
    const stageStartedAt = performance.now();
    const speechText = createSpeechText(text);
    if (!speechText || !connected) return;
    setState('speaking');

    const controller = new AbortController();
    const abortFromParent = () => controller.abort();
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', abortFromParent, { once: true });
    const timeout = window.setTimeout(() => controller.abort(), TTS_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`/api/speak?clientId=${encodeURIComponent(clientId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: speechText, language: uiLanguage }), signal: controller.signal
      });
      if (!response.ok) throw new Error('TTS failed');
      const blob = await response.blob();
      console.info(`[Wine AI timing] TTS ready in ${Math.round(performance.now() - stageStartedAt)} ms`);
      if (!blob.size) throw new Error('Empty audio');

      clearAnswerAudio();
      answerAudioUrl = URL.createObjectURL(blob);
      answerAudio.src = answerAudioUrl;

      await new Promise((resolve) => {
        let done = false;
        const playbackTimeout = window.setTimeout(() => {
          answerAudio.pause();
          finish();
        }, AUDIO_PLAYBACK_TIMEOUT_MS);
        const finish = () => {
          if (done) return;
          done = true;
          window.clearTimeout(playbackTimeout);
          answerAudio.removeEventListener('ended', finish);
          answerAudio.removeEventListener('error', finish);
          resolve();
        };
        answerAudio.addEventListener('ended', finish, { once: true });
        answerAudio.addEventListener('error', finish, { once: true });
        answerAudio.play().catch(finish);
      });
    } finally {
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', abortFromParent);
      if (connected && !signal.aborted) { setState('answered'); setState('connected'); }
    }
  }

  async function requestAnswer(query, signal) {
    const stageStartedAt = performance.now();
    setState('thinking');
    const response = await fetch(`/api/answer?clientId=${encodeURIComponent(clientId)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, language: uiLanguage }), signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || 'Answer failed');
    console.info(`[Wine AI timing] Answer ready in ${Math.round(performance.now() - stageStartedAt)} ms`);
    answerText.textContent = payload.answer || '';
    renderProducts(payload.products);
    await speakAnswer(payload.answer, signal);
  }

  async function transcribeAndAsk() {
    if (!latestRecordingBlob || !connected) return;
    const stageStartedAt = performance.now();
    abortCurrentTurn();
    activeRequestController = new AbortController();
    const controller = activeRequestController;
    setState('transcribing');

    try {
      const response = await fetch(`/api/transcribe?clientId=${encodeURIComponent(clientId)}`, {
        method: 'POST', headers: { 'Content-Type': latestRecordingBlob.type || 'audio/webm' },
        body: latestRecordingBlob, signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'STT failed');
      console.info(`[Wine AI timing] STT ready in ${Math.round(performance.now() - stageStartedAt)} ms: ${payload.text || ''}`);
      transcriptText.textContent = payload.text || '';
      const detected = ['ru', 'ro', 'en'].includes(payload.language) ? payload.language : detectLanguageFromText(payload.text);
      uiLanguage = detected;
      applyLanguage();
      await requestAnswer(payload.text, controller.signal);
    } catch (error) {
      if (error?.name !== 'AbortError' && connected) {
        setState('error', t('requestFailed'));
        window.setTimeout(() => { if (connected) setState('connected'); }, 1600);
      }
    } finally {
      if (activeRequestController === controller) activeRequestController = null;
    }
  }

  connectButton.addEventListener('click', () => connected ? disconnect() : connect());
  talkButton.addEventListener('pointerdown', beginRecording);
  talkButton.addEventListener('pointerup', finishRecording);
  talkButton.addEventListener('pointercancel', finishRecording);
  talkButton.addEventListener('lostpointercapture', () => { if (pointerHeld) finishRecording(); });
  talkButton.addEventListener('contextmenu', (event) => event.preventDefault());
  talkButton.addEventListener('keydown', (event) => {
    if ((event.code === 'Space' || event.code === 'Enter') && !pointerHeld) beginRecording(event);
  });
  talkButton.addEventListener('keyup', (event) => {
    if (event.code === 'Space' || event.code === 'Enter') finishRecording(event);
  });


  closeButton.addEventListener('click', () => {
    disconnect();
    window.parent.postMessage({ type: 'wine-md-voice-lite:close' }, window.location.origin);
  });

  window.addEventListener('beforeunload', disconnect);
  fetch(`/widget/config?clientId=${encodeURIComponent(clientId)}`).then(r=>r.ok?r.json():null).then(cfg=>{const lang=cfg?.assistantSettings?.defaultLanguage;if(['ru','ro','en'].includes(lang)){uiLanguage=lang;language=lang;}applyLanguage();}).catch(()=>applyLanguage());
})();
