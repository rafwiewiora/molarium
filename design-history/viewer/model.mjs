import { expandMovieFrames } from '../movie.mjs';

const STATUS = Object.freeze({
  progressed:{ label:'Progressed', tone:'progressed' },
  'not-progressed':{ label:'Not progressed', tone:'stopped' },
  deferred:{ label:'Deferred', tone:'deferred' },
  failed:{ label:'Failed', tone:'failed' },
  duplicate:{ label:'Duplicate', tone:'muted' },
  superseded:{ label:'Superseded', tone:'superseded' },
  archived:{ label:'Archived', tone:'archived' },
  undecided:{ label:'No decision', tone:'muted' },
});

export function decisionPresentation(disposition = 'undecided') {
  return STATUS[disposition] || STATUS.undecided;
}

export function eventLabel(kind = '') {
  return ({
    'campaign.started':'Campaign started', 'observation.recorded':'Observation',
    'hypothesis.proposed':'Hypothesis', 'molecule.committed':'Molecule committed',
    'calculation.completed':'Calculation', 'measurement.recorded':'Measurement',
    'decision.recorded':'Decision', 'branch.created':'Branch created',
    'branch.merged':'Branch merged', 'movie.cue':'Movie cue',
    'campaign.completed':'Campaign completed',
  })[kind] || kind;
}

export function buildCampaignModel(campaign) {
  const commitEvents = campaign.events.filter((event) => event.kind === 'molecule.committed');
  const decisions = campaign.events.filter((event) => event.kind === 'decision.recorded');
  const decisionsByCommit = new Map();
  decisions.forEach((event) => {
    const id = event.payload.targetCommitId;
    if (!decisionsByCommit.has(id)) decisionsByCommit.set(id, []);
    decisionsByCommit.get(id).push(event);
  });
  const branchNames = [...new Set(commitEvents.map((event) => event.branch))]
    .sort((a, b) => a === 'main' ? -1 : b === 'main' ? 1 : a.localeCompare(b));
  const laneByBranch = new Map(branchNames.map((branch, index) => [branch, index]));
  const eventOrder = new Map(commitEvents.map((event, index) => [event.payload.commitId, index]));
  const nodes = commitEvents.map((event, index) => {
    const commitId = event.payload.commitId, commit = campaign.objects.commits[commitId];
    const snapshot = campaign.objects.snapshots[commit.snapshotId];
    const commitDecisions = decisionsByCommit.get(commitId) || [];
    const decision = commitDecisions.at(-1) || null;
    return { commitId, commit, snapshot, event, decisions:commitDecisions, decision,
      branch:event.branch, lane:laneByBranch.get(event.branch), x:92 + index * 164,
      y:72 + laneByBranch.get(event.branch) * 88,
      status:decisionPresentation(decision?.payload?.disposition) };
  });
  const nodeById = new Map(nodes.map((node) => [node.commitId, node]));
  const edges = nodes.flatMap((node) => node.commit.parents.map((parentId) => ({
    parentId, childId:node.commitId, from:nodeById.get(parentId), to:node,
    merge:node.commit.parents.length > 1,
  })).filter((edge) => edge.from && edge.to));
  return { nodes, edges, nodeById, branchNames, laneByBranch, eventOrder,
    width:Math.max(720, 184 + nodes.length * 164), height:Math.max(220, 132 + branchNames.length * 88),
    timeline:campaign.events.filter((event) => !['molecule.committed','campaign.completed']
      .includes(event.kind)) };
}

export function cueState(movie, { cueIndex = 0, frame = null } = {}) {
  const frames = expandMovieFrames(movie);
  if (Number.isInteger(frame)) {
    const selected = frames[Math.max(0, Math.min(frames.length - 1, frame))];
    return { cueIndex:selected.cueIndex, frameIndex:selected.frame - 1,
      cue:movie.cues[selected.cueIndex], frame:selected, frames };
  }
  const safeCue = Math.max(0, Math.min(movie.cues.length - 1, Number(cueIndex) || 0));
  const frameIndex = frames.findIndex((entry) => entry.cueIndex === safeCue);
  return { cueIndex:safeCue, frameIndex:Math.max(0, frameIndex), cue:movie.cues[safeCue],
    frame:frames[Math.max(0, frameIndex)], frames };
}

export function selectedRecord(campaign, cue) {
  const event = cue?.eventId
    ? campaign.events.find((entry) => entry.eventId === cue.eventId) || null : null;
  const commit = cue?.commitId ? campaign.objects.commits[cue.commitId] || null : null;
  const snapshotId = cue?.snapshotId || commit?.snapshotId || null;
  const snapshot = snapshotId ? campaign.objects.snapshots[snapshotId] || null : null;
  const actor = event ? campaign.actors.find((entry) => entry.id === event.actorId) || null : null;
  return { event, commit, snapshotId, snapshot, actor };
}

export function narrativeText(event, cue) {
  if (cue?.narration) return cue.narration;
  const payload = event?.payload || {};
  return payload.rationale || payload.observation || payload.statement || payload.result
    || payload.objective || eventLabel(event?.kind);
}

