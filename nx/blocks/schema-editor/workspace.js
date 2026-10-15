import { loadStyle, hashChange } from '../../../nx2/utils/utils.js';
import { registerPanelSection, wasPanelOpen, PANEL_EVENT } from '../../../nx2/utils/panel.js';
import { isEWEnabled, isEwChatDisabled } from '../../../nx2/utils/ewFlags.js';
import { loadChat, useAoChat, CHAT_EVENT } from '../../../nx2/utils/chat.js';

// The SDK's `actions.setPrompt` relay opens this section by name.
export const PANEL_SECTION = 'chat';
const PANEL_SELECTOR = `aside.panel[data-section="${PANEL_SECTION}"]`;

const pageStyle = await loadStyle(new URL('./workspace.css', import.meta.url).href);

function ensureAppFrame() {
  let meta = document.head.querySelector('meta[name="template"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'template';
    document.head.append(meta);
  }
  meta.content = 'app-frame';
}

function getSite() {
  let state;
  const unsubscribe = hashChange.subscribe((value) => { state = value; });
  unsubscribe();
  return { org: state?.org, site: state?.site };
}

export async function isChatAvailable({ org, site }) {
  if (!org || !site) return false;
  const [enabled, disabled] = await Promise.all([
    isEWEnabled({ org, site }),
    isEwChatDisabled({ org, site }),
  ]);
  return enabled && !disabled;
}

async function loadEmbeddedChat() {
  const chat = await loadChat();
  chat.embedded = true;
  return chat;
}

async function getViews() {
  if (!await isChatAvailable(getSite())) return [];
  const label = await useAoChat() ? 'Coworker' : 'Chat';
  return [{
    id: 'chat', label, icon: 'chat', load: loadEmbeddedChat,
  }];
}

async function createSidePanel() {
  await import('./side-panel/side-panel.js');
  const panel = document.createElement('nx-schema-side-panel');
  panel.views = await getViews();
  hashChange.subscribe(async () => { panel.views = await getViews(); });
  return panel;
}

async function showView(aside, id, options) {
  const panel = aside.querySelector('nx-schema-side-panel');
  const element = await panel?.show(options?.text ? 'chat' : id);
  if (!options?.text || element?.dataset.view !== 'chat') return;
  await element.updateComplete;
  const { text, autoSend } = options;
  document.dispatchEvent(new CustomEvent(CHAT_EVENT.SET_PROMPT, { detail: { text, autoSend } }));
}

export const isPanelOpen = () => Boolean(document.querySelector(`${PANEL_SELECTOR}:not([hidden])`));

export function openPanel({ view, text, autoSend } = {}) {
  const options = text ? { text, autoSend } : undefined;
  const detail = { section: PANEL_SECTION, id: view, options };
  document.dispatchEvent(new CustomEvent(PANEL_EVENT.OPEN, { detail }));
}

export function togglePanel() {
  if (isPanelOpen()) {
    const detail = { section: PANEL_SECTION };
    document.dispatchEvent(new CustomEvent(PANEL_EVENT.CLOSE, { detail }));
    return;
  }
  openPanel();
}

export function observePanel(callback) {
  const observer = new MutationObserver(() => callback(isPanelOpen()));
  observer.observe(document.body, { childList: true, subtree: true, attributeFilter: ['hidden'] });
  return () => observer.disconnect();
}

export async function setupWorkspace() {
  ensureAppFrame();
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, pageStyle];
  registerPanelSection(PANEL_SECTION, {
    position: 'before',
    width: '380px',
    getContent: createSidePanel,
    onShow: showView,
  });
  if (wasPanelOpen(PANEL_SECTION) && await isChatAvailable(getSite())) openPanel();
}
