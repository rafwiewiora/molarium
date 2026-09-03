import { runPoseSearchPartition } from './pose-search-ensemble.mjs';

self.addEventListener('message', (event) => {
  const message = event.data;
  if (message?.type !== 'run') return;
  runPoseSearchPartition(message.payload, async (progress) => {
    self.postMessage({ type:'progress', id:message.id, progress });
  }).then((result) => {
    const transfers = result.results.flatMap((entry) =>
      entry.refinement?.positions?.buffer ? [entry.refinement.positions.buffer] : []);
    self.postMessage({ type:'result', id:message.id, result }, transfers);
  }).catch((error) => {
    self.postMessage({ type:'error', id:message.id,
      message:error instanceof Error ? error.message : String(error) });
  });
});
