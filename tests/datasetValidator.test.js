import test from 'node:test';
import assert from 'node:assert/strict';
import {DatasetValidator} from '../src/benchmark/DatasetValidator.js';

test('accepts positive item only when referenced evidence supports the answer',async()=>{
  const validator=new DatasetValidator();
  const result=await validator.validate({
    items:[{
      id:'p1',polarity:'positive',question:'Какие ароматы?',
      referenceAnswer:'ежевика и слива',evidence:{chunkId:'doc:1'}
    }]
  },{
    documentId:'doc',
    chunkById:async id=>id==='doc:1'?{id,documentId:'doc',text:'Ароматы: ежевика и слива.',metadata:{page:19}}:null,
    searchDocument:async()=>[]
  });
  assert.equal(result.stats.accepted,1);
  assert.equal(result.items[0].status,'approved');
  assert.equal(result.items[0].evidence.page,19);
});

test('rejects negative item when strong evidence exists',async()=>{
  const validator=new DatasetValidator();
  const result=await validator.validate({
    items:[{id:'n1',polarity:'negative',question:'Есть ли цена?'}]
  },{
    documentId:'doc',
    chunkById:async()=>null,
    searchDocument:async()=>[{id:'doc:2',documentId:'doc',text:'Цена составляет 100 леев.',score:.91}],
    negativeJudgeBatch:async candidates=>new Map(candidates.map(x=>[x.id,{id:x.id,answerPresent:true,reason:'Цена указана'}]))
  });
  assert.equal(result.stats.rejected,1);
  assert.equal(result.rejected[0].rejectionReason,'NEGATIVE_ANSWER_FOUND');
});
