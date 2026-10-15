const STORAGE_KEY = 'nx-schema-editor-pane-width';
const MAX_SHARE = 0.5;

export const PANE_WIDTH = Object.freeze({
  DEFAULT: 296,
  MIN: 240,
  MAX: 640,
  STEP: 16,
});

/** Keeps the list pane readable while leaving at least half the layout to the editor. */
export function clampPaneWidth({ width, available }) {
  const max = Math.max(PANE_WIDTH.MIN, Math.min(PANE_WIDTH.MAX, available * MAX_SHARE));
  return Math.round(Math.min(max, Math.max(PANE_WIDTH.MIN, width)));
}

export function loadPaneWidth() {
  const width = Number(localStorage.getItem(STORAGE_KEY));
  return width >= PANE_WIDTH.MIN ? width : undefined;
}

export function savePaneWidth(width) {
  if (width === undefined) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, String(width));
}
