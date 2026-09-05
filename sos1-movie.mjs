// Some static hosts ignore Range requests. A complete local Blob makes native
// video seeking independent of server byte-range support; no scientific code.
const video = document.querySelector('video');
const status = document.querySelector('#movie-playback-status');
let objectUrl;
try {
  const response = await fetch(video.querySelector('source').src,
    { signal:AbortSignal.timeout(60000) });
  if (!response.ok || !response.headers.get('content-type')?.includes('video/mp4'))
    throw new Error('The movie download failed');
  const blob = await response.blob();
  const time = video.currentTime, paused = video.paused;
  objectUrl = URL.createObjectURL(blob);
  video.addEventListener('loadedmetadata', () => {
    video.currentTime = Math.min(time,video.duration);
    video.dataset.seekReady = 'true';
    status.textContent = 'Ready. Drag the timeline to move forward or backward; pause on any frame.';
    if (!paused) video.play().catch(() => {});
  }, { once:true });
  video.src = objectUrl;
  video.load();
} catch {
  status.textContent = 'Streaming playback. If seeking stalls, download the MP4 to watch locally.';
}
window.addEventListener('pagehide', () => { if (objectUrl) URL.revokeObjectURL(objectUrl); },{once:true});
