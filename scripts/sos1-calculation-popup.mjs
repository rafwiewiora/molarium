// Reuse the actual Molarium calculation card; no application/science code is loaded.
const documentSource = await (await fetch('../index.html')).text();
const source = new DOMParser().parseFromString(documentSource, 'text/html');
const overlay = source.querySelector('#run-overlay').cloneNode(true);
const label = document.createElement('span');
label.id = 'recorded-calculation-label';
label.textContent = 'Precomputed replay · recorded calculation';
overlay.querySelector('.run-card').prepend(label);
document.body.append(overlay);
window.setRecordedPopup = (text, frame = 0) => {
  overlay.classList.toggle('hidden', text == null);
  overlay.querySelector('#run-status').textContent = text || '';
  overlay.querySelector('#progress-calc').style.transform = `translateX(${frame * 18}%)`;
  for (const animation of document.getAnimations()) {
    animation.pause(); animation.currentTime = frame * 1000 / 12;
  }
  return { text:overlay.querySelector('#run-status').textContent,
    label:label.textContent, hasApplicationApi:Boolean(window.MolariumChemistActions) };
};
window.recordedPopupReady = true;
