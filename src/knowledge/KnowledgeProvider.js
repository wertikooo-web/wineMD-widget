/**
 * Stable provider contract for Wine.md knowledge retrieval.
 *
 * A future KOS adapter must implement the same search() method, so API and UI
 * code do not need to change when the storage backend changes.
 */
export class KnowledgeProvider {
  /**
   * @param {{query: string, limit: number}} _request
   * @returns {Promise<Array<{id:string,type:string,title:string,text:string,sourceUrl?:string,score:number,metadata?:object}>>}
   */
  async search(_request) {
    throw new Error('KnowledgeProvider.search() must be implemented');
  }
}
