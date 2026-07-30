import path from 'node:path';
import { BenchmarkDatasetRepository } from './BenchmarkDatasetRepository.js';
import { BenchmarkRunRepository } from './BenchmarkRunRepository.js';
import { OpenAIQuestionGenerator } from './OpenAIQuestionGenerator.js';
import { DatasetValidator } from './DatasetValidator.js';
import { BenchmarkDatasetService } from './BenchmarkDatasetService.js';
import { BenchmarkJobService } from './BenchmarkJobService.js';
import { BenchmarkRunnerService } from './BenchmarkRunnerService.js';
import { BenchmarkRunJobService } from './BenchmarkRunJobService.js';
export function createBenchmarkServices(config,{registry,generator,answerQuestion}={}){
  const datasetDir=config.benchmarkDatasetDir||path.join(process.cwd(),'data','benchmark','runtime');
  const repository=new BenchmarkDatasetRepository({directory:datasetDir});
  const runRepository=new BenchmarkRunRepository({directory:path.join(datasetDir,'runs')});
  const questionGenerator=generator??new OpenAIQuestionGenerator({apiKey:config.openAiApiKey,model:config.benchmarkGeneratorModel});
  const validator=new DatasetValidator();
  const service=new BenchmarkDatasetService({repository,registry,chunksFile:config.documentChunksFile,generator:questionGenerator,validator,batchSize:config.benchmarkBatchSize,maxAttempts:config.benchmarkMaxAttempts});
  const jobs=new BenchmarkJobService({datasetService:service});
  const runner=answerQuestion?new BenchmarkRunnerService({datasetRepository:repository,runRepository,answerQuestion}):null;
  const runJobs=runner?new BenchmarkRunJobService({runner}):null;
  return{repository,runRepository,generator:questionGenerator,validator,service,jobs,runner,runJobs};
}
