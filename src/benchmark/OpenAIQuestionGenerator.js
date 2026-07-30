const ENDPOINT = 'https://api.openai.com/v1/responses';
const EVIDENCE_PROPERTIES = {
  chunkId: { type: ['string', 'null'] },
  page: { type: ['integer', 'null'] },
  quote: { type: ['string', 'null'] }
};
const EVIDENCE_SCHEMA = { type: ['object', 'null'], additionalProperties: false, required: ['chunkId', 'page', 'quote'], properties: EVIDENCE_PROPERTIES };
const QUESTION_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['items'], properties: {
    items: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['polarity','question','referenceAnswer','category','difficulty','questionType','complexity','sourceMode','expectedFacts','evidence','evidences'],
      properties: {
        polarity: { type: 'string', enum: ['positive','negative'] }, question: { type: 'string' }, referenceAnswer: { type: ['string','null'] }, category: { type: 'string' }, difficulty: { type: 'integer', minimum: 1, maximum: 5 }, questionType: { type: 'string' },
        complexity: { type: 'string', enum: ['simple','compound'] }, sourceMode: { type: 'string', enum: ['none','single_source','multi_source'] },
        expectedFacts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id','text','evidenceChunkIds'], properties: { id: { type: 'string' }, text: { type: 'string' }, evidenceChunkIds: { type: 'array', items: { type: 'string' } } } } },
        evidence: EVIDENCE_SCHEMA,
        evidences: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['chunkId','page','quote'], properties: EVIDENCE_PROPERTIES } }
      }
    }}
  }
};
const JUDGE_SCHEMA = { type:'object',additionalProperties:false,required:['results'],properties:{results:{type:'array',items:{type:'object',additionalProperties:false,required:['id','answerPresent','reason'],properties:{id:{type:'string'},answerPresent:{type:'boolean'},reason:{type:'string'}}}}}};
function providerError(status,payload){const error=new Error(payload?.error?.message||`Question generator HTTP ${status}`);error.code=status===429?'BENCHMARK_RATE_LIMIT':'BENCHMARK_PROVIDER_ERROR';return error;}
function outputText(payload){return payload.output_text??payload.output?.flatMap(x=>x.content??[]).find(x=>x.type==='output_text')?.text;}
export class OpenAIQuestionGenerator{
  constructor({apiKey,model='gpt-4.1-mini',fetchImpl=globalThis.fetch}){this.apiKey=apiKey;this.model=model;this.fetchImpl=fetchImpl;}
  get configured(){return Boolean(this.apiKey);}
  validateApiKey(){const key=String(this.apiKey??'').trim();if(!key)throw Object.assign(new Error('OPENAI_API_KEY не настроен.'),{code:'BENCHMARK_NOT_CONFIGURED'});if(!/^[\x21-\x7E]+$/.test(key))throw Object.assign(new Error('OPENAI_API_KEY содержит недопустимые символы. Укажите настоящий API-ключ OpenAI.'),{code:'BENCHMARK_INVALID_API_KEY'});if(/^(ваш[_ -]?ключ|your[_ -]?key|replace[_ -]?me)$/i.test(key)||key.length<20)throw Object.assign(new Error('OPENAI_API_KEY выглядит как заглушка или слишком короткий.'),{code:'BENCHMARK_INVALID_API_KEY'});return key;}
  async requestJson({name,schema,instructions,payload}){const apiKey=this.validateApiKey();const response=await this.fetchImpl(ENDPOINT,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:this.model,temperature:.1,input:[{role:'system',content:instructions},{role:'user',content:JSON.stringify(payload)}],text:{format:{type:'json_schema',name,strict:true,schema}}})});let data={};try{data=await response.json();}catch{}if(!response.ok)throw providerError(response.status,data);const text=outputText(data);if(!text)throw Object.assign(new Error('Generator returned no JSON'),{code:'BENCHMARK_INVALID_RESPONSE'});try{return JSON.parse(text);}catch{throw Object.assign(new Error('Generator returned invalid JSON'),{code:'BENCHMARK_INVALID_RESPONSE'});}}
  async generateBatch({document,chunks,count,polarity,language='ru',excludedQuestions=[]}){
    const positiveRules=[
      'Сначала выбери подтверждённые факты из фрагментов, затем сформулируй вопрос.',
      'Разрешены простые и составные вопросы. Составной вопрос обязан иметь отдельный expectedFact для каждой части.',
      'Факты могут находиться в разных chunks: перечисли все источники в evidences и привяжи expectedFacts через evidenceChunkIds.',
      'referenceAnswer должен полностью отвечать на все части вопроса.',
      'evidence сохрани как первый источник для обратной совместимости; evidences содержит полный список.',
      'Не делай выводов о гастропарах, если они прямо не подтверждены текстом.'
    ].join(' ');
    const negativeRules='Вопрос правдоподобен по теме, но ответа нет ни в одном фрагменте. referenceAnswer=null, expectedFacts=[], evidence=null, evidences=[], sourceMode=none.';
    const instructions=`Ты создаёшь benchmark закрытой RAG-системы Wine.md. Только переданные фрагменты, без внешних знаний. Создай ровно ${count} уникальных ${polarity} вопросов на языке ${language}. ${polarity==='positive'?positiveRules:negativeRules} Не повторяй excludedQuestions. Возвращай только JSON.`;
    return this.requestJson({name:`benchmark_${polarity}_batch`,schema:QUESTION_SCHEMA,instructions,payload:{document,chunks,count,polarity,excludedQuestions}});
  }
  async generate({document,chunks,positiveCount,negativeCount,language='ru'}){const items=[];if(positiveCount>0)items.push(...(await this.generateBatch({document,chunks,count:positiveCount,polarity:'positive',language})).items);if(negativeCount>0)items.push(...(await this.generateBatch({document,chunks,count:negativeCount,polarity:'negative',language})).items);return{items};}
  async judgeNegativeBatch({candidates}){if(!candidates.length)return new Map();const instructions='Проверь, содержат ли фрагменты прямой или однозначно выводимый ответ. answerPresent=true только если ответ реально есть. Тематическое совпадение без ответа не считается.';const data=await this.requestJson({name:'benchmark_negative_judge',schema:JUDGE_SCHEMA,instructions,payload:{candidates}});return new Map((data.results??[]).map(x=>[x.id,x]));}
}
