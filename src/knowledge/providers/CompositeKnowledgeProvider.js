import {KnowledgeProvider} from '../KnowledgeProvider.js';
export class CompositeKnowledgeProvider extends KnowledgeProvider{
  constructor({providers}){super();this.providers=providers.filter(Boolean);}
  async search({query,limit=5}){const groups=await Promise.all(this.providers.map(p=>p.search({query,limit})));const seen=new Set();return groups.flat().sort((a,b)=>(b.score||0)-(a.score||0)).filter(x=>{if(seen.has(x.id))return false;seen.add(x.id);return true;}).slice(0,limit);}
}
