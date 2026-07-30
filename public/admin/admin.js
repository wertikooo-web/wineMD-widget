const $ = id => document.getElementById(id);
let setupRequired = false;
let documents = [];
let currentDataset = null;
let currentFilter = 'approved';

function show(id) {
  for (const x of ['loading', 'auth', 'admin']) $(x).classList.toggle('hidden', x !== id);
}
function status(el, text, type = '') {
  el.textContent = text;
  el.className = type;
}
async function api(url, options = {}) {
  const r = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body && typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  let data = {};
  try { data = await r.json(); } catch {}
  return { r, data };
}
async function boot() {
  const me = await api('/api/admin/auth/me');
  if (me.r.ok) return enterAdmin(me.data.user);
  const state = await api('/api/admin/auth/setup-status');
  setupRequired = Boolean(state.data.setupRequired);
  $('authTitle').textContent = setupRequired ? 'Создание первого администратора' : 'Вход администратора';
  $('authHelp').textContent = setupRequired ? 'Создайте первый аккаунт. Настройка доступна один раз.' : 'Войдите в защищённую панель.';
  $('authButton').textContent = setupRequired ? 'Создать аккаунт' : 'Войти';
  $('name').classList.toggle('hidden', !setupRequired);
  $('nameLabel').classList.toggle('hidden', !setupRequired);
  $('passwordHelp').classList.toggle('hidden', !setupRequired);
  show('auth');
}
async function enterAdmin(user) {
  $('identity').textContent = `${user.name} · ${user.email}`;
  show('admin');
  await loadDocuments();
  await loadSettings();
  await loadDatasets();
}
$('authButton').onclick = async () => {
  status($('authResult'), 'Проверяем…');
  const { r, data } = await api(setupRequired ? '/api/admin/auth/setup' : '/api/admin/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: $('email').value, password: $('password').value, name: $('name').value })
  });
  if (!r.ok) return status($('authResult'), data.message || data.error, 'error');
  enterAdmin(data.user);
};
$('password').onkeydown = e => { if (e.key === 'Enter') $('authButton').click(); };
$('logout').onclick = async () => { await api('/api/admin/auth/logout', { method: 'POST' }); show('auth'); };

function selectTab(name) {
  $('documentsView').classList.toggle('hidden', name !== 'documents');
  $('assistantView').classList.toggle('hidden', name !== 'assistant');
  $('testingView').classList.toggle('hidden', name !== 'testing');
  $('tabDocuments').classList.toggle('active', name === 'documents');
  $('tabAssistant').classList.toggle('active', name === 'assistant');
  $('tabTesting').classList.toggle('active', name === 'testing');
}
$('tabDocuments').onclick = () => selectTab('documents');
$('tabAssistant').onclick = () => selectTab('assistant');
$('tabTesting').onclick = () => selectTab('testing');

async function loadDocuments() {
  const { r, data } = await api('/api/admin/documents');
  if (!r.ok) return;
  documents = data.documents || [];
  const select = $('benchmarkDocument');
  select.replaceChildren();
  for (const d of documents) {
    const option = document.createElement('option');
    option.value = d.documentId;
    option.textContent = `${d.title} · ${d.chunkCount} chunks`;
    select.append(option);
  }
  await renderDocuments();
}

async function renderDocuments() {
  const list = $('documentsList'); list.replaceChildren();
  const totalChunks = documents.reduce((n,d)=>n+(d.chunkCount||0),0);
  $('documentsSummary').replaceChildren();
  for (const [label,value] of [['Документов',documents.length],['Фрагментов',totalChunks],['С embeddings',documents.filter(d=>d.embeddingStatus==='ready').length]]) {
    const card=document.createElement('div');card.className='card';const a=document.createElement('span');a.textContent=label;const b=document.createElement('b');b.textContent=value;card.append(a,b);$('documentsSummary').append(card);
  }
  if(!documents.length){const p=document.createElement('p');p.className='muted';p.textContent='Документы пока не загружены.';list.append(p);return;}
  for(const d of documents){
    const {data}=await api(`/api/admin/documents/${encodeURIComponent(d.documentId)}/knowledge-stats`);
    const item=document.createElement('div');item.className='item document-item';
    const info=document.createElement('div');const title=document.createElement('b');title.textContent=d.title;
    const meta=document.createElement('div');meta.className='document-meta';
    const pill=document.createElement('span');pill.className=`status-pill ${d.embeddingStatus==='ready'?'status-ready':'status-working'}`;pill.textContent=d.embeddingStatus==='ready'?'Проиндексирован':'Без embeddings';
    const chunks=document.createElement('span');chunks.className='muted small';chunks.textContent=`${d.chunkCount||0} chunks`;
    const knowledge=document.createElement('span');knowledge.className='muted small';knowledge.textContent=`Сущности: ${data.stats?.entities||0} · факты: ${data.stats?.facts||0}`;
    meta.append(pill,chunks,knowledge);info.append(title,meta);
    const actions=document.createElement('div');actions.className='actions';
    const reindex=document.createElement('button');reindex.className='secondary';reindex.textContent='Переиндексировать';reindex.onclick=()=>reindexDocument(d.documentId,reindex);
    const extract=document.createElement('button');extract.className='secondary';extract.textContent='Извлечь знания';extract.onclick=()=>extractKnowledge(d.documentId,extract,item);
    const remove=document.createElement('button');remove.className='danger';remove.textContent='Удалить';remove.onclick=()=>deleteDocument(d.documentId);
    actions.append(reindex,extract,remove);item.append(info,actions);list.append(item);
  }
}

async function reindexDocument(id,button){button.disabled=true;button.textContent='Индексируем…';const {r,data}=await api(`/api/admin/documents/${encodeURIComponent(id)}/reindex`,{method:'POST'});button.disabled=false;button.textContent='Переиндексировать';if(!r.ok)alert(data.message||data.error);await loadDocuments();}
async function deleteDocument(id){if(!confirm('Удалить документ, его chunks и извлечённые знания?'))return;const {r,data}=await api(`/api/admin/documents/${encodeURIComponent(id)}`,{method:'DELETE'});if(!r.ok)return alert(data.message||data.error);await loadDocuments();}
async function extractKnowledge(id,button,item){button.disabled=true;button.textContent='Запускаем…';const {r,data}=await api(`/api/admin/documents/${encodeURIComponent(id)}/extract`,{method:'POST',body:JSON.stringify({force:false})});if(!r.ok){button.disabled=false;button.textContent='Извлечь знания';return alert(data.message||data.error);}let progress=item.querySelector('.doc-progress');if(!progress){progress=document.createElement('div');progress.className='doc-progress';item.firstChild.append(progress);}for(;;){const state=await api(`/api/admin/extraction-jobs/${encodeURIComponent(data.job.jobId)}`);const job=state.data.job;progress.textContent=`${job.message} · ${job.progress?.processed||0}/${job.progress?.total||0}`;if(job.status==='completed'||job.status==='failed'){button.disabled=false;button.textContent='Извлечь знания';if(job.status==='failed')alert(job.message);await loadDocuments();break;}await sleep(1200);}}

async function loadSettings(){const {r,data}=await api('/api/admin/settings');if(!r.ok)return;const x=data.settings;$('answerMode').value=x.answerMode;$('systemPrompt').value=x.systemPrompt;$('answerLength').value=x.answerLength;$('voiceStyle').value=x.voiceStyle;$('assistantVoice').value=x.voice;$('defaultLanguage').value=x.defaultLanguage;}
$('saveSettings').onclick=async()=>{status($('settingsResult'),'Сохраняем…');const payload={answerMode:$('answerMode').value,systemPrompt:$('systemPrompt').value,answerLength:$('answerLength').value,voiceStyle:$('voiceStyle').value,voice:$('assistantVoice').value,defaultLanguage:$('defaultLanguage').value};const {r,data}=await api('/api/admin/settings',{method:'PUT',body:JSON.stringify(payload)});status($('settingsResult'),r.ok?'Настройки сохранены.':data.message||data.error,r.ok?'success':'error');};

$('upload').onclick = async () => {
  const file = $('file').files[0];
  if (!file) return status($('result'), 'Выберите файл.', 'error');
  status($('result'), 'Загрузка…');
  const metadata = {
    title: $('title').value || file.name,
    authors: $('authors').value.split(',').map(x => x.trim()).filter(Boolean),
    language: $('language').value,
    owner: 'Wine.md',
    sourceType: 'book',
    allowedForAnswers: true,
    allowedForQuoting: $('quoting').checked
  };
  const { r, data } = await api('/api/admin/documents', {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-Filename': encodeURIComponent(file.name),
      'X-Document-Metadata': encodeURIComponent(JSON.stringify(metadata))
    },
    body: file
  });
  status($('result'), r.ok ? `Готово: ${data.document.title}\nФрагментов: ${data.document.chunkCount}` : `Ошибка: ${data.message || data.error}`, r.ok ? 'success' : 'error');
  if (r.ok) await loadDocuments();
};

function summary(d) {
  const s = d.stats || {};
  $('datasetSummary').classList.remove('hidden');
  const values = [
    ['Статус', s.complete ? 'Готов' : 'Частично'],
    ['Запрошено', s.requested ?? 0],
    ['Кандидатов', s.generated ?? s.requested ?? 0],
    ['Принято', s.accepted ?? 0],
    ['Positive', s.positive ?? 0],
    ['Negative', s.negative ?? 0],
    ['Отклонено', s.rejected ?? 0]
  ];
  $('datasetSummary').replaceChildren();
  for (const [label, value] of values) {
    const card = document.createElement('div');
    card.className = 'card';
    const span = document.createElement('span');
    span.textContent = label;
    const strong = document.createElement('b');
    strong.textContent = String(value);
    card.append(span, strong);
    $('datasetSummary').append(card);
  }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function pollBenchmarkJob(jobId) {
  for (;;) {
    const { r, data } = await api(`/api/admin/benchmark/jobs/${encodeURIComponent(jobId)}`);
    if (!r.ok) throw new Error(data.message || data.error || 'Не удалось получить состояние генерации.');
    const job = data.job;
    const p = job.progress || {};
    $('benchmarkProgress').classList.remove('hidden');
    $('benchmarkProgressText').textContent = job.message || 'Обработка…';
    $('benchmarkProgressMeta').textContent = `Сгенерировано кандидатов: ${p.generated ?? 0} · принято: ${p.approved ?? 0} · отклонено: ${p.rejected ?? 0}`;
    const total = Number($('positiveCount').value) + Number($('negativeCount').value);
    const percent = total ? Math.min(95, Math.round(((p.approved ?? 0) / total) * 100)) : 0;
    $('benchmarkProgressBar').style.width = `${job.status === 'completed' ? 100 : percent}%`;
    if (job.status === 'completed') return job;
    if (job.status === 'failed') throw new Error(job.message || job.error || 'Генерация завершилась ошибкой.');
    await sleep(1200);
  }
}

$('generateBenchmark').onclick = async () => {
  const documentId = $('benchmarkDocument').value;
  if (!documentId) return status($('benchmarkResult'), 'Сначала загрузите и выберите документ.', 'error');
  $('generateBenchmark').disabled = true;
  $('benchmarkProgress').classList.remove('hidden');
  $('benchmarkProgressBar').style.width = '2%';
  $('benchmarkProgressText').textContent = 'Запускаем генерацию…';
  $('benchmarkProgressMeta').textContent = 'Страница может оставаться открытой: сервер продолжит работу в фоне.';
  status($('benchmarkResult'), '');
  try {
    const { r, data } = await api('/api/admin/benchmark/generate', {
      method: 'POST',
      body: JSON.stringify({
        documentId,
        positiveCount: Number($('positiveCount').value),
        negativeCount: Number($('negativeCount').value),
        language: $('benchmarkLanguage').value
      })
    });
    if (!r.ok) throw new Error(data.message || data.error || 'Не удалось запустить генерацию.');
    const job = await pollBenchmarkJob(data.job.jobId);
    status($('benchmarkResult'), job.stats?.complete ? 'Набор полностью готов.' : 'Набор сохранён частично: откройте его и посмотрите причины отклонений.', job.stats?.complete ? 'success' : 'error');
    await loadDatasets();
    await viewDataset(job.datasetId);
  } catch (error) {
    status($('benchmarkResult'), error.message, 'error');
  } finally {
    $('generateBenchmark').disabled = false;
  }
};

async function loadDatasets() {
  const { r, data } = await api('/api/admin/benchmark/datasets');
  if (!r.ok) return;
  const list = $('datasetList');
  list.replaceChildren();
  const datasets = data.datasets || [];
  if (!datasets.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Наборов пока нет.';
    list.append(p);
    return;
  }
  for (const d of datasets) {
    const item = document.createElement('div');
    item.className = 'item';
    const title = document.createElement('b');
    title.textContent = d.title || d.datasetId;
    const meta = document.createElement('div');
    meta.className = 'muted';
    meta.textContent = `${d.datasetId} · ${new Date(d.createdAt).toLocaleString()}`;
    const stats = document.createElement('div');
    stats.textContent = `Positive: ${d.stats?.positive ?? 0}, Negative: ${d.stats?.negative ?? 0}, Отклонено: ${d.stats?.rejected ?? 0}`;
    const actions = document.createElement('div');
    actions.className = 'actions';
    const open = document.createElement('button');
    open.className = 'secondary';
    open.textContent = 'Открыть';
    open.onclick = () => viewDataset(d.datasetId);
    const remove = document.createElement('button');
    remove.className = 'danger';
    remove.textContent = 'Удалить';
    remove.onclick = () => deleteDataset(d.datasetId);
    actions.append(open, remove);
    item.append(title, meta, stats, actions);
    list.append(item);
  }
}

function reasonLabel(code) {
  const labels = {
    POSITIVE_EVIDENCE_INVALID: 'Нет корректной привязки к фрагменту документа',
    REFERENCE_ANSWER_NOT_SUPPORTED: 'Эталонный ответ недостаточно подтверждается фрагментом',
    NEGATIVE_POSSIBLE_EVIDENCE_FOUND: 'В документе найден возможный ответ',
    NEGATIVE_ANSWER_FOUND: 'Проверка подтвердила, что ответ есть в документе',
    NEGATIVE_JUDGE_MISSING: 'Не удалось завершить проверку отсутствия ответа',
    QUESTION_EMPTY: 'Модель вернула пустой вопрос',
    TARGET_ALREADY_REACHED: 'Целевое количество уже набрано',
    UNKNOWN_POLARITY: 'Неизвестный тип вопроса'
  };
  return labels[code] || code || 'Причина не указана';
}

function itemMatches(item, query) {
  if (!query) return true;
  const haystack = [item.question, item.referenceAnswer, item.category, item.rejectionReason, item.evidence?.quote, item.evidence?.preview].join(' ').toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function activeItems() {
  if (!currentDataset) return [];
  if (currentFilter === 'rejected') return currentDataset.rejected || [];
  const items = currentDataset.items || [];
  if (currentFilter === 'positive') return items.filter(x => x.polarity === 'positive');
  if (currentFilter === 'negative') return items.filter(x => x.polarity === 'negative');
  return items;
}

function renderDatasetItems() {
  const host = $('datasetItems');
  host.replaceChildren();
  if (!currentDataset) return;
  const query = $('datasetSearch').value.trim();
  const items = activeItems().filter(x => itemMatches(x, query));
  $('visibleCount').textContent = `Показано: ${items.length}`;
  if (!items.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'По выбранному фильтру ничего нет.';
    host.append(p);
    return;
  }
  items.forEach((item, index) => {
    const article = document.createElement('article');
    article.className = `question-card ${item.polarity === 'negative' ? 'negative-card' : ''} ${item.rejectionReason ? 'rejected-card' : ''}`;

    const head = document.createElement('div');
    head.className = 'question-head';
    const number = document.createElement('span');
    number.className = 'question-number';
    number.textContent = `${index + 1}`;
    const badge = document.createElement('span');
    badge.className = `badge ${item.rejectionReason ? 'badge-rejected' : item.polarity === 'negative' ? 'badge-negative' : 'badge-positive'}`;
    badge.textContent = item.rejectionReason ? 'Отклонён' : item.polarity === 'negative' ? 'Negative' : 'Positive';
    const category = document.createElement('span');
    category.className = 'muted small';
    category.textContent = item.category || item.questionType || '';
    head.append(number, badge, category);

    const q = document.createElement('h4');
    q.textContent = item.question || 'Вопрос отсутствует';
    article.append(head, q);

    if (item.rejectionReason) {
      const reason = document.createElement('div');
      reason.className = 'reason-box';
      const label = document.createElement('b');
      label.textContent = 'Причина: ';
      reason.append(label, document.createTextNode(reasonLabel(item.rejectionReason)));
      article.append(reason);
      if (item.matches?.length) {
        const matches = document.createElement('div');
        matches.className = 'muted small';
        matches.textContent = `Совпадения: ${item.matches.map(m => `${m.title || m.id} (${Number(m.score || 0).toFixed(2)})`).join(', ')}`;
        article.append(matches);
      }
    } else if (item.polarity === 'positive') {
      const answer = document.createElement('div');
      answer.className = 'answer-box';
      const label = document.createElement('b');
      label.textContent = 'Эталонный ответ';
      const text = document.createElement('p');
      text.textContent = item.referenceAnswer || '—';
      answer.append(label, text);
      article.append(answer);

      const evidence = document.createElement('details');
      const summary = document.createElement('summary');
      const page = item.evidence?.page != null ? ` · страница ${item.evidence.page}` : '';
      summary.textContent = `Источник${page}`;
      const chunk = document.createElement('div');
      chunk.className = 'evidence-meta';
      chunk.textContent = `Chunk: ${item.evidence?.chunkId || 'не указан'}`;
      const quote = document.createElement('blockquote');
      quote.textContent = item.evidence?.quote || item.evidence?.preview || 'Фрагмент не сохранён.';
      evidence.append(summary, chunk, quote);
      article.append(evidence);
    } else {
      const expected = document.createElement('div');
      expected.className = 'answer-box';
      expected.textContent = 'Ожидаемое поведение: ассистент должен отказать из-за отсутствия информации в документе.';
      article.append(expected);
    }

    const actions = document.createElement('div');
    actions.className = 'question-actions';
    const copy = document.createElement('button');
    copy.className = 'secondary compact';
    copy.textContent = 'Копировать вопрос';
    copy.onclick = async () => {
      await navigator.clipboard.writeText(item.question || '');
      copy.textContent = 'Скопировано';
      setTimeout(() => { copy.textContent = 'Копировать вопрос'; }, 1200);
    };
    actions.append(copy);
    article.append(actions);
    host.append(article);
  });
}

function setDatasetFilter(filter) {
  currentFilter = filter;
  for (const id of ['filterApproved', 'filterPositive', 'filterNegative', 'filterRejected']) {
    $(id).classList.toggle('active', id === ({ approved: 'filterApproved', positive: 'filterPositive', negative: 'filterNegative', rejected: 'filterRejected' }[filter]));
  }
  renderDatasetItems();
}

window.viewDataset = async id => {
  const { r, data } = await api(`/api/admin/benchmark/datasets/${encodeURIComponent(id)}`);
  if (!r.ok) return status($('benchmarkResult'), data.message || data.error, 'error');
  currentDataset = data.dataset;
  summary(currentDataset);
  $('datasetViewer').classList.remove('hidden');
  $('datasetViewerTitle').textContent = currentDataset.title || currentDataset.datasetId;
  $('datasetViewerMeta').textContent = `${currentDataset.datasetId} · ${new Date(currentDataset.createdAt).toLocaleString()}`;
  $('datasetSearch').value = '';
  setDatasetFilter('approved');
  $('datasetViewer').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.deleteDataset = async id => {
  if (!confirm('Удалить набор?')) return;
  await api(`/api/admin/benchmark/datasets/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (currentDataset?.datasetId === id) {
    currentDataset = null;
    $('datasetViewer').classList.add('hidden');
  }
  await loadDatasets();
};

function downloadFile(name, type, content) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}


async function pollRunJob(jobId) {
  for (;;) {
    const { r, data } = await api(`/api/admin/benchmark/run-jobs/${encodeURIComponent(jobId)}`);
    if (!r.ok) throw new Error(data.message || data.error || 'Не удалось получить состояние проверки.');
    const job = data.job;
    $('runBenchmark').textContent = job.message || 'Проверка…';
    if (job.status === 'completed') return job;
    if (job.status === 'failed') throw new Error(job.message || job.error || 'Проверка завершилась ошибкой.');
    await sleep(900);
  }
}

function renderRunSummary(run) {
  const host = $('runSummary');
  host.replaceChildren();
  const stats = run.stats || {};
  const rows = [
    ['Общая точность', `${Math.round((stats.accuracy || 0) * 100)}%`],
    ['Positive', `${Math.round((stats.positiveAccuracy || 0) * 100)}%`],
    ['Negative', `${Math.round((stats.negativeAccuracy || 0) * 100)}%`],
    ['Recall источников', `${Math.round((stats.sourceRecall || 0) * 100)}%`],
    ['Multi-source', `${Math.round((stats.multiSourceAccuracy || 0) * 100)}%`],
    ['Средняя задержка', `${stats.averageLatencyMs || 0} мс`]
  ];
  for (const [label, value] of rows) {
    const card = document.createElement('div'); card.className = 'card';
    const span = document.createElement('span'); span.textContent = label;
    const strong = document.createElement('b'); strong.textContent = value;
    card.append(span, strong); host.append(card);
  }
  host.classList.remove('hidden');
}

$('runBenchmark').onclick = async () => {
  if (!currentDataset) return;
  const button = $('runBenchmark');
  button.disabled = true;
  button.textContent = 'Запускаем…';
  try {
    const { r, data } = await api(`/api/admin/benchmark/datasets/${encodeURIComponent(currentDataset.datasetId)}/run`, { method: 'POST', body: '{}' });
    if (!r.ok) throw new Error(data.message || data.error || 'Не удалось запустить проверку.');
    const job = await pollRunJob(data.job.jobId);
    const runResponse = await api(`/api/admin/benchmark/runs/${encodeURIComponent(job.runId)}`);
    if (!runResponse.r.ok) throw new Error(runResponse.data.message || runResponse.data.error || 'Не удалось загрузить отчёт.');
    renderRunSummary(runResponse.data.run);
  } catch (error) {
    status($('benchmarkResult'), error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Запустить проверку';
  }
};

$('exportJson').onclick = () => {
  if (!currentDataset) return;
  downloadFile(`${currentDataset.datasetId}.json`, 'application/json;charset=utf-8', JSON.stringify(currentDataset, null, 2));
};
$('exportCsv').onclick = () => {
  if (!currentDataset) return;
  const rows = [['id', 'status', 'polarity', 'question', 'referenceAnswer', 'page', 'chunkId', 'rejectionReason']];
  for (const item of [...(currentDataset.items || []), ...(currentDataset.rejected || [])]) {
    rows.push([
      item.id || '', item.status || '', item.polarity || '', item.question || '', item.referenceAnswer || '',
      item.evidence?.page ?? '', item.evidence?.chunkId || '', item.rejectionReason || ''
    ]);
  }
  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  downloadFile(`${currentDataset.datasetId}.csv`, 'text/csv;charset=utf-8', '\uFEFF' + csv);
};

$('filterApproved').onclick = () => setDatasetFilter('approved');
$('filterPositive').onclick = () => setDatasetFilter('positive');
$('filterNegative').onclick = () => setDatasetFilter('negative');
$('filterRejected').onclick = () => setDatasetFilter('rejected');
$('datasetSearch').oninput = renderDatasetItems;
$('closeDatasetViewer').onclick = () => $('datasetViewer').classList.add('hidden');
$('refreshDatasets').onclick = loadDatasets;

boot().catch(e => { show('auth'); status($('authResult'), e.message, 'error'); });
