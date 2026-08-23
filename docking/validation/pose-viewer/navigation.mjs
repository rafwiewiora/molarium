export function wrappedId(entries, currentId, delta) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const current = entries.findIndex((entry) => entry.id === currentId);
  if (current < 0) return entries[0].id;
  const index = current;
  return entries[(index + delta % entries.length + entries.length) % entries.length].id;
}

export function poseArrowDelta({ key, altKey = false, ctrlKey = false, metaKey = false,
  shiftKey = false, tagName = '', contentEditable = false } = {}) {
  if (altKey || ctrlKey || metaKey || shiftKey || contentEditable) return null;
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(String(tagName).toUpperCase())) return null;
  if (key === 'ArrowLeft') return -1;
  if (key === 'ArrowRight') return 1;
  return null;
}

export function copyCameraSnapshot(state) {
  if (!state) return null;
  return {
    ...state,
    target:Array.isArray(state.target) ? [...state.target] : state.target,
    position:Array.isArray(state.position) ? [...state.position] : state.position,
    up:Array.isArray(state.up) ? [...state.up] : state.up
  };
}
