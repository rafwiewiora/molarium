import { verifyCampaign } from '../ledger.mjs';
import { verifyMovieManifest } from '../movie.mjs';
import { buildCampaignModel, cueState, decisionPresentation, eventLabel,
  selectedRecord, narrativeText } from './model.mjs';

const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const params = new URLSearchParams(location.search);
const state = { index:null, campaign:null, movie:null, model:null, storyId:null,
  cueIndex:0, frameIndex:0, frames:[], playing:false, raf:null, playStarted:null,
  playStartFrame:0, depictionToken:0, depictionCache:new Map() };
if (params.get('render') === '1') document.body.classList.add('render-mode');

const rdkitWorker = new Worker('../../rdkit-worker.js');
const rdkitJobs = new Map(); let rdkitSequence = 0;
rdkitWorker.addEventListener('message', ({ data }) => {
  const pending = rdkitJobs.get(data?.id); if (!pending || data.type === 'progress') return;
  rdkitJobs.delete(data.id); data.type === 'result' ? pending.resolve(data)
    : pending.reject(new Error(data.error || 'RDKit depiction failed'));
});
function rdkitJob(job, options) {
  const id = `history-${++rdkitSequence}`;
  return new Promise((resolve, reject) => {
    rdkitJobs.set(id, { resolve, reject }); rdkitWorker.postMessage({ type:'run', id, job, options });
  });
}

function safeSvg(text) {
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg')
    throw new Error('Invalid molecule depiction');
  const svg = parsed.documentElement;
  svg.querySelectorAll('script,foreignObject').forEach((node) => node.remove());
  svg.querySelectorAll('*').forEach((node) => [...node.attributes].forEach((attribute) => {
    if (/^on/i.test(attribute.name) || /(?:javascript|data):/i.test(attribute.value))
      node.removeAttribute(attribute.name);
  }));
  svg.removeAttribute('width'); svg.removeAttribute('height');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  return document.importNode(svg, true);
}

function compact(value) {
  if (value == null) return '—';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return Object.entries(value).map(([key, entry]) => `${key}: ${compact(entry)}`).join(' · ');
  return String(value);
}

function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function eventSummary(event) {
  const payload = event?.payload || {};
  return payload.rationale || payload.observation || payload.statement || payload.result
    || payload.objective || payload.message || eventLabel(event?.kind);
}

function actorMark(actor) {
  return actor.type === 'human' ? 'H' : actor.type === 'agent' ? 'A'
    : actor.type === 'system' ? 'S' : '↗';
}

function renderActors() {
  $('actors').replaceChildren(...state.campaign.actors.map((actor) => {
    const row = document.createElement('div'); row.className = 'actor';
    row.innerHTML = `<span class="actor-mark ${actor.type}">${actorMark(actor)}</span><div class="actor-copy"><strong></strong><span></span></div>`;
    row.querySelector('strong').textContent = actor.displayName;
    row.querySelector('.actor-copy span').textContent = actor.type;
    return row;
  }));
}

function renderSources() {
  $('sources').replaceChildren(...state.campaign.sources.map((source) => {
    const row = document.createElement('div'); row.className = 'source';
    const title = source.url ? document.createElement('a') : document.createElement('strong');
    title.textContent = source.title;
    if (source.url) { title.href = source.url; title.target = '_blank'; title.rel = 'noreferrer'; }
    const locator = document.createElement('span'); locator.textContent = source.locator || source.type;
    row.append(title, locator); return row;
  }));
}

function linePath(edge) {
  const x1 = edge.from.x + 13, y1 = edge.from.y, x2 = edge.to.x - 13, y2 = edge.to.y;
  const middle = (x1 + x2) / 2;
  return `M${x1},${y1} C${middle},${y1} ${middle},${y2} ${x2},${y2}`;
}

function cueFor({ commitId = null, eventId = null }) {
  let index = -1;
  if (eventId) index = state.movie.cues.findIndex((cue) => cue.eventId === eventId);
  if (index < 0 && commitId) index = state.movie.cues.findIndex((cue) => cue.commitId === commitId);
  return index;
}

function renderGraph() {
  const svg = $('campaign-graph'); svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${state.model.width} ${state.model.height}`);
  svg.style.width = `${state.model.width}px`; svg.style.height = '100%';
  state.model.branchNames.forEach((branch, lane) => {
    const label = document.createElementNS(SVG, 'text'); label.setAttribute('x', '12');
    label.setAttribute('y', String(75 + lane * 88)); label.setAttribute('class', 'lane-label');
    label.textContent = branch; svg.append(label);
  });
  state.model.edges.forEach((edge) => {
    const path = document.createElementNS(SVG, 'path'); path.setAttribute('d', linePath(edge));
    path.setAttribute('class', `graph-edge${edge.merge ? ' merge' : ''}`); svg.append(path);
  });
  state.model.nodes.forEach((node) => {
    const group = document.createElementNS(SVG, 'g');
    group.setAttribute('class', `graph-node ${node.status.tone}`);
    group.dataset.commitId = node.commitId; group.setAttribute('tabindex', '0');
    const circle = document.createElementNS(SVG, 'circle'); circle.setAttribute('cx', String(node.x));
    circle.setAttribute('cy', String(node.y)); circle.setAttribute('r', '11');
    const title = document.createElementNS(SVG, 'title');
    title.textContent = `${node.snapshot.label} · ${node.status.label}`; group.append(circle, title);
    const name = document.createElementNS(SVG, 'text'); name.setAttribute('x', String(node.x + 18));
    name.setAttribute('y', String(node.y - 2)); name.setAttribute('class', 'node-label');
    name.textContent = node.snapshot.label.length > 23 ? `${node.snapshot.label.slice(0, 22)}…` : node.snapshot.label;
    const status = document.createElementNS(SVG, 'text'); status.setAttribute('x', String(node.x + 18));
    status.setAttribute('y', String(node.y + 11)); status.setAttribute('class', 'node-status');
    status.textContent = node.status.label; group.append(name, status);
    const select = () => { const index = cueFor({ commitId:node.commitId }); if (index >= 0) setCue(index); };
    group.addEventListener('click', select); group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); }
    }); svg.append(group);
  });
}

function renderTimeline() {
  $('event-total').textContent = `${state.campaign.events.length} events`;
  $('timeline').replaceChildren(...state.model.timeline.map((event) => {
    const actor = state.campaign.actors.find((entry) => entry.id === event.actorId);
    const row = document.createElement('article');
    row.className = `timeline-event ${event.kind.replaceAll('.', '-')}`; row.dataset.eventId = event.eventId;
    const kind = document.createElement('span'); kind.textContent = `${eventLabel(event.kind)} · ${actor?.displayName || event.actorId}`;
    const title = document.createElement('strong');
    title.textContent = event.kind === 'decision.recorded'
      ? decisionPresentation(event.payload.disposition).label : eventLabel(event.kind);
    const copy = document.createElement('p'); copy.textContent = eventSummary(event);
    row.append(kind, title, copy);
    row.addEventListener('click', () => { const index = cueFor({ eventId:event.eventId,
      commitId:event.payload?.targetCommitId }); if (index >= 0) setCue(index); });
    return row;
  }));
}

async function renderDepiction(snapshot) {
  const token = ++state.depictionToken, target = $('depiction');
  document.body.dataset.depictionReady = 'pending';
  if (!snapshot?.canonicalSmiles) {
    target.innerHTML = `<div class="depiction-placeholder">${snapshot?.label || 'Campaign evidence'}<br><small>No exact structure was asserted in this reconstruction.</small></div>`;
    document.body.dataset.depictionReady = '1';
    return;
  }
  target.innerHTML = '<div class="depiction-placeholder">Drawing locally with RDKit WebAssembly…</div>';
  try {
    let svgText = state.depictionCache.get(snapshot.canonicalSmiles);
    if (!svgText) {
      const result = await rdkitJob('smiles-depict', { smiles:snapshot.canonicalSmiles, width:760, height:430 });
      svgText = result.svg; state.depictionCache.set(snapshot.canonicalSmiles, svgText);
    }
    if (token !== state.depictionToken) return;
    target.replaceChildren(safeSvg(svgText));
    document.body.dataset.depictionReady = '1';
  } catch (error) {
    if (token === state.depictionToken) {
      target.innerHTML = `<div class="depiction-placeholder">2D depiction unavailable<br><small>${String(error.message || error)}</small></div>`;
      document.body.dataset.depictionReady = 'error';
    }
  }
}

function renderProperties(snapshot) {
  const entries = Object.entries(snapshot?.properties || {}).filter(([key]) => key !== 'claimStatus').slice(0, 6);
  $('snapshot-properties').replaceChildren(...entries.map(([key, value]) => {
    const pill = document.createElement('span'); pill.className = 'property-pill';
    pill.title = `${key}: ${compact(value)}`; pill.textContent = `${key}: ${compact(value)}`; return pill;
  }));
}

function markSelection(cue, record) {
  document.querySelectorAll('.graph-node').forEach((node) =>
    node.classList.toggle('active', node.dataset.commitId === cue.commitId));
  document.querySelectorAll('.timeline-event').forEach((node) =>
    node.classList.toggle('active', node.dataset.eventId === cue.eventId));
  const graphNode = cue.commitId && document.querySelector(`.graph-node[data-commit-id="${CSS.escape(cue.commitId)}"]`);
  graphNode?.scrollIntoView({ block:'nearest', inline:'center', behavior:params.get('render') === '1' ? 'auto' : 'smooth' });
  const timelineNode = cue.eventId && document.querySelector(`.timeline-event[data-event-id="${CSS.escape(cue.eventId)}"]`);
  timelineNode?.scrollIntoView({ block:'nearest', behavior:params.get('render') === '1' ? 'auto' : 'smooth' });
}

function paintCue() {
  const cue = state.movie.cues[state.cueIndex], record = selectedRecord(state.campaign, cue);
  const decision = record.event?.kind === 'decision.recorded' ? record.event
    : cue.commitId ? state.model.nodeById.get(cue.commitId)?.decision : null;
  const status = decisionPresentation(decision?.payload?.disposition);
  $('record-badge').className = `record-badge ${status.tone}`;
  $('record-badge').textContent = status.label;
  $('event-kind').textContent = eventLabel(record.event?.kind || 'molecule.committed');
  $('snapshot-title').textContent = record.snapshot?.label || cue.title;
  $('narrative').textContent = narrativeText(record.event, cue);
  const meta = [];
  if (record.actor) meta.push({ text:`${record.actor.displayName} · ${record.actor.type}`, className:`actor-${record.actor.type}` });
  if (record.event?.payload?.claimStatus) meta.push({ text:record.event.payload.claimStatus });
  if (record.event?.branch) meta.push({ text:record.event.branch });
  $('event-meta').replaceChildren(...meta.map((entry) => {
    const pill = document.createElement('span'); pill.className = `meta-pill ${entry.className || ''}`;
    pill.textContent = entry.text; return pill;
  }));
  renderDepiction(record.snapshot); renderProperties(record.snapshot); markSelection(cue, record);
  $('chapter-count').textContent = `Chapter ${state.cueIndex + 1}/${state.movie.cues.length} · ${cue.title}`;
  document.body.dataset.cue = String(state.cueIndex); document.body.dataset.frame = String(state.frameIndex);
}

function paintProgress() {
  $('scrubber').max = String(Math.max(0, state.frames.length - 1));
  $('scrubber').value = String(state.frameIndex);
  const frameDuration = 1000 / state.movie.fps;
  $('movie-time').textContent = `${formatTime(state.frameIndex * frameDuration)} / ${formatTime(state.frames.length * frameDuration)}`;
}

function setFrame(frameIndex, { updateUrl = true } = {}) {
  const next = cueState(state.movie, { frame:Number(frameIndex) });
  const cueChanged = next.cueIndex !== state.cueIndex;
  state.frameIndex = next.frameIndex; state.cueIndex = next.cueIndex;
  if (cueChanged) paintCue(); else document.body.dataset.frame = String(state.frameIndex);
  paintProgress();
  if (updateUrl && !state.playing) {
    const url = new URL(location.href); url.searchParams.set('story', state.storyId);
    url.searchParams.set('frame', String(state.frameIndex)); url.searchParams.delete('cue');
    history.replaceState(null, '', url);
  }
}

function setCue(cueIndex) {
  pause(); const next = cueState(state.movie, { cueIndex });
  state.cueIndex = next.cueIndex; state.frameIndex = next.frameIndex;
  paintCue(); paintProgress();
  const url = new URL(location.href); url.searchParams.set('story', state.storyId);
  url.searchParams.set('cue', String(state.cueIndex)); url.searchParams.delete('frame');
  history.replaceState(null, '', url);
}

function pause() {
  state.playing = false; cancelAnimationFrame(state.raf); state.raf = null;
  $('play').textContent = '▶ Play history';
}

function animate(now) {
  if (!state.playing) return;
  const frame = state.playStartFrame + Math.floor((now - state.playStarted) * state.movie.fps / 1000);
  if (frame >= state.frames.length) { setFrame(state.frames.length - 1, { updateUrl:false }); pause(); return; }
  setFrame(frame, { updateUrl:false }); state.raf = requestAnimationFrame(animate);
}

function togglePlay() {
  if (state.playing) { pause(); return; }
  if (state.frameIndex >= state.frames.length - 1) setFrame(0, { updateUrl:false });
  state.playing = true; state.playStarted = performance.now(); state.playStartFrame = state.frameIndex;
  $('play').textContent = '❚❚ Pause'; state.raf = requestAnimationFrame(animate);
}

async function loadStory(storyId) {
  pause(); const entry = state.index.stories.find((story) => story.id === storyId) || state.index.stories[0];
  const base = new URL('../stories/generated/', import.meta.url);
  const [campaign, movie] = await Promise.all([
    fetch(new URL(entry.campaign.replace('./',''), base)).then((response) => {
      if (!response.ok) throw new Error(`Campaign: HTTP ${response.status}`); return response.json();
    }),
    fetch(new URL(entry.movie.replace('./',''), base)).then((response) => {
      if (!response.ok) throw new Error(`Movie: HTTP ${response.status}`); return response.json();
    }),
  ]);
  const [campaignAudit, movieAudit] = await Promise.all([verifyCampaign(campaign), verifyMovieManifest(movie, campaign)]);
  if (!campaignAudit.valid) throw new Error(`Campaign integrity failed: ${campaignAudit.reason}`);
  if (!movieAudit.valid) throw new Error(`Movie integrity failed: ${movieAudit.reason}`);
  state.storyId = entry.id; state.campaign = campaign; state.movie = movie;
  state.model = buildCampaignModel(campaign);
  const requestedFrame = params.has('frame') ? Number(params.get('frame')) : null;
  const initial = cueState(movie, Number.isInteger(requestedFrame)
    ? { frame:requestedFrame } : { cueIndex:Number(params.get('cue') || 0) });
  state.cueIndex = initial.cueIndex; state.frameIndex = initial.frameIndex; state.frames = initial.frames;
  $('story-select').value = entry.id; $('campaign-title').textContent = campaign.title;
  $('campaign-description').textContent = campaign.description;
  $('metric-designs').textContent = String(Object.keys(campaign.objects.commits).length);
  const decisions = campaign.events.filter((event) => event.kind === 'decision.recorded');
  $('metric-decisions').textContent = String(decisions.length);
  $('metric-stopped').textContent = String(decisions.filter((event) =>
    !['progressed'].includes(event.payload.disposition)).length);
  $('campaign-hash').textContent = campaign.campaignSha256;
  $('movie-hash').textContent = movie.movieSha256;
  $('integrity-label').textContent = `Verified · ${campaign.campaignSha256.slice(0, 10)}`;
  renderActors(); renderSources(); renderGraph(); renderTimeline(); paintCue(); paintProgress();
  window.__molariumDesignHistory = Object.freeze({ storyId:entry.id,
    campaignSha256:campaign.campaignSha256, movieSha256:movie.movieSha256,
    frameCount:state.frames.length, cueCount:movie.cues.length,
    selectCue(index) { setCue(Number(index)); },
    selectFrame(index) { pause(); setFrame(Number(index)); },
    state() { return Object.freeze({ storyId:state.storyId, cueIndex:state.cueIndex,
      frameIndex:state.frameIndex, depictionReady:document.body.dataset.depictionReady }); },
  });
  document.body.dataset.ready = '1';
}

async function init() {
  state.index = await fetch('../stories/generated/index.json').then((response) => {
    if (!response.ok) throw new Error(`Story index: HTTP ${response.status}`); return response.json();
  });
  $('story-select').replaceChildren(...state.index.stories.map((story) => {
    const option = document.createElement('option'); option.value = story.id;
    option.textContent = story.title; return option;
  }));
  $('story-select').addEventListener('change', () => loadStory($('story-select').value));
  $('previous-cue').addEventListener('click', () => setCue(state.cueIndex - 1));
  $('next-cue').addEventListener('click', () => setCue(state.cueIndex + 1));
  $('play').addEventListener('click', togglePlay);
  $('scrubber').addEventListener('input', () => { pause(); setFrame(Number($('scrubber').value)); });
  document.addEventListener('keydown', (event) => {
    if (['INPUT','SELECT','TEXTAREA'].includes(event.target?.tagName)) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); setCue(state.cueIndex - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); setCue(state.cueIndex + 1); }
    if (event.key === ' ') { event.preventDefault(); togglePlay(); }
  });
  await loadStory(params.get('story') || state.index.stories[0].id);
}

init().catch((error) => {
  $('fatal').hidden = false; $('fatal').textContent = error?.stack || String(error);
  document.body.dataset.ready = 'error';
});
