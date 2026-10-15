import { html, LitElement, nothing } from 'da-lit';
import { loadStyle } from '../../../../nx2/utils/utils.js';
import { getConfig } from '../../../../nx2/scripts/nx.js';
import { PANEL_EVENT } from '../../../../nx2/utils/panel.js';

import '../../../../nx2/blocks/shared/segmented-btn/segmented.js';

const style = await loadStyle(import.meta.url);
const buttonStyle = await loadStyle(new URL('../../../../nx2/styles/buttons.css', import.meta.url).href);
const { codeBase } = getConfig();

const iconHref = (name) => `${codeBase}/img/icons/s2-icon-${name}-20-n.svg`;

/**
 * Managed side panel following the `nx-tool-panel` contract in docs/workspace.md.
 * Views are `{ id, label, icon, load }` descriptors. `load` runs once on first
 * activation and its element is kept across switches and open/close cycles.
 */
class NxSchemaSidePanel extends LitElement {
  static properties = {
    views: { attribute: false },
    active: { type: String },
  };

  _loaded = new Map();

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [buttonStyle, style];
  }

  willUpdate(changed) {
    if (changed.has('views') && !this.views?.some(({ id }) => id === this.active)) {
      this.active = this.views?.[0]?.id;
    }
  }

  updated() {
    this.activate(this.active);
    [...this.children].forEach((child) => { child.hidden = child.dataset.view !== this.active; });
  }

  async show(id) {
    if (id && this.views?.some((view) => view.id === id)) this.active = id;
    await this.updateComplete;
    return this._loaded.get(this.active);
  }

  activate(id) {
    const view = this.views?.find((entry) => entry.id === id);
    if (!view || this._loaded.has(id)) return;
    const pending = Promise.resolve(view.load()).then((element) => {
      element.dataset.view = id;
      element.hidden = id !== this.active;
      this.append(element);
      return element;
    });
    this._loaded.set(id, pending);
  }

  close() {
    this.dispatchEvent(new CustomEvent(PANEL_EVENT.CLOSE, { bubbles: true, composed: true }));
  }

  renderSwitcher() {
    const items = this.views?.map(({ id, label, icon }) => ({
      value: id, label, icon: iconHref(icon),
    }));
    if ((items?.length ?? 0) < 2) return html`<h2>${this.views?.[0]?.label ?? nothing}</h2>`;
    return html`
      <nx-segmented-btn
        label="Panel views"
        .items=${items}
        .value=${this.active}
        @change=${({ detail }) => { this.active = detail.value; }}
      ></nx-segmented-btn>`;
  }

  render() {
    return html`
      <header class="panel-header">
        <button class="nx-action-btn-icon" aria-label="Close panel" title="Close panel" @click=${this.close}>
          <svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><use href="${iconHref('splitleft')}#icon"></use></svg>
        </button>
        ${this.renderSwitcher()}
      </header>
      <div class="panel-content"><slot></slot></div>`;
  }
}

customElements.define('nx-schema-side-panel', NxSchemaSidePanel);
