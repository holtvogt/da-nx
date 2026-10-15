import { html, LitElement, nothing } from 'da-lit';
import { loadStyle } from '../../../../nx2/utils/utils.js';
import { getConfig } from '../../../../nx2/scripts/nx.js';
import {
  parseSiteInput,
  toSiteKey,
  getRecentSites,
  filterSites,
  getSiteInitials,
  getSiteColor,
} from './utils.js';

import '../../../../nx2/blocks/shared/popover/popover.js';

const style = await loadStyle(import.meta.url);
const buttonStyle = await loadStyle(new URL('../../../../nx2/styles/buttons.css', import.meta.url).href);
const formStyle = await loadStyle(new URL('../../../../nx2/styles/form.css', import.meta.url).href);
const { codeBase } = getConfig();

const icon = (name) => html`
  <svg class="icon" viewBox="0 0 20 20" aria-hidden="true">
    <use href="${codeBase}/img/icons/s2-icon-${name}-20-n.svg#icon"></use>
  </svg>`;

const avatar = (entry) => {
  const color = getSiteColor(entry);
  const colors = `--avatar-bg: var(--s2-${color}-200); --avatar-fg: var(--s2-${color}-1000)`;
  return html`<span class="avatar" style=${colors} aria-hidden="true">${getSiteInitials(entry)}</span>`;
};

const isSameSite = (a, b) => Boolean(a && b) && toSiteKey(a) === toSiteKey(b);

/**
 * Site chooser for authors and developers.
 * `variant="menu"` renders a toolbar trigger with a searchable popover.
 * `variant="inline"` renders a full chooser for pages without a site.
 * Fires `site-change` with `{ org, site }`. The host decides when to navigate.
 */
class NxSiteSwitcher extends LitElement {
  static properties = {
    org: { type: String },
    site: { type: String },
    variant: { type: String },
    _query: { state: true },
    _activeIndex: { state: true },
    _open: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [buttonStyle, formStyle, style];
  }

  get current() {
    return this.org && this.site ? { org: this.org, site: this.site } : undefined;
  }

  get options() {
    const recent = filterSites({ sites: getRecentSites(), query: this._query });
    const typed = parseSiteInput(this._query);
    const typedIsNew = typed && !recent.some((entry) => isSameSite(entry, typed));
    return {
      recent,
      typed: typedIsNew ? typed : undefined,
      all: typedIsNew ? [typed, ...recent] : recent,
    };
  }

  select(entry) {
    if (!entry) return;
    this.closeMenu();
    if (isSameSite(entry, this.current)) return;
    const detail = { org: entry.org, site: entry.site };
    this.dispatchEvent(new CustomEvent('site-change', { detail, bubbles: true, composed: true }));
  }

  openMenu() {
    const popover = this.shadowRoot.querySelector('nx-popover');
    const anchor = this.shadowRoot.querySelector('.trigger');
    this._query = '';
    this._activeIndex = 0;
    this._open = true;
    popover.show({ anchor, placement: 'below' });
    requestAnimationFrame(() => this.shadowRoot.querySelector('.menu-search')?.focus());
  }

  closeMenu() {
    if (!this._open) return;
    this._open = false;
    this.shadowRoot.querySelector('nx-popover')?.close();
  }

  handleInput({ target }) {
    this._query = target.value;
    this._activeIndex = 0;
  }

  handleKeydown(e) {
    const { all } = this.options;
    const moves = { ArrowDown: 1, ArrowUp: -1 };
    if (moves[e.key] && all.length) {
      e.preventDefault();
      this._activeIndex = (this._activeIndex + moves[e.key] + all.length) % all.length;
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      this.select(all[this._activeIndex] ?? parseSiteInput(this._query));
    }
  }

  handleSubmit(e) {
    e.preventDefault();
    const { all } = this.options;
    this.select(parseSiteInput(this._query) ?? (this._query ? all[0] : undefined));
  }

  renderSiteText(entry) {
    return html`
      <span class="site-text">
        <span class="site-name">${entry.site}</span>
        <span class="site-org">${entry.org}</span>
      </span>`;
  }

  renderOption(entry, index) {
    const selected = isSameSite(entry, this.current);
    return html`
      <li
        class="option ${index === this._activeIndex ? 'is-active' : ''}"
        role="option"
        aria-selected=${selected}
        @pointerenter=${() => { this._activeIndex = index; }}
        @click=${() => this.select(entry)}>
        ${avatar(entry)}
        ${this.renderSiteText(entry)}
        ${selected ? icon('checkmark') : nothing}
      </li>`;
  }

  renderTypedOption(entry) {
    return html`
      <li
        class="option open-option ${this._activeIndex === 0 ? 'is-active' : ''}"
        role="option"
        aria-selected="false"
        @pointerenter=${() => { this._activeIndex = 0; }}
        @click=${() => this.select(entry)}>
        <span class="avatar" aria-hidden="true">${icon('globegrid')}</span>
        <span class="site-text">
          <span class="site-name">Open ${toSiteKey(entry)}</span>
          <span class="site-org">Go to this site</span>
        </span>
      </li>`;
  }

  renderMenu() {
    const { recent, typed } = this.options;
    const offset = typed ? 1 : 0;
    return html`
      <div class="menu">
        <div class="menu-search-field">
          ${icon('search')}
          <input
            class="menu-search"
            role="combobox"
            aria-expanded="true"
            aria-controls="site-options"
            aria-label="Search sites or enter org/site"
            placeholder="Search sites or paste a URL"
            .value=${this._query ?? ''}
            @input=${this.handleInput}
            @keydown=${this.handleKeydown} />
        </div>
        <ul id="site-options" class="options" role="listbox" aria-label="Sites">
          ${typed ? this.renderTypedOption(typed) : nothing}
          ${recent.length ? html`<li class="group-label" role="presentation">Recent sites</li>` : nothing}
          ${recent.map((entry, index) => this.renderOption(entry, index + offset))}
        </ul>
        ${!recent.length && !typed ? html`
          <p class="menu-empty">
            ${this._query ? 'No recent sites match.' : 'No recent sites yet.'}
            Enter <code>org/site</code> or paste a site URL.
          </p>` : nothing}
      </div>`;
  }

  renderMenuVariant() {
    const { current } = this;
    return html`
      <button
        class="trigger"
        aria-haspopup="listbox"
        aria-expanded=${Boolean(this._open)}
        aria-label=${current ? `Site ${toSiteKey(current)}. Change site` : 'Choose a site'}
        @click=${() => (this._open ? this.closeMenu() : this.openMenu())}>
        ${current ? avatar(current) : html`<span class="avatar">${icon('globegrid')}</span>`}
        ${current ? this.renderSiteText(current) : html`<span class="site-name">Choose a site</span>`}
        <svg class="icon chevron" viewBox="0 0 20 20" aria-hidden="true">
          <use href="${codeBase}/img/icons/s2-icon-chevrondown-20-n.svg#icon"></use>
        </svg>
      </button>
      <nx-popover class="site-popover" @close=${() => { this._open = false; }}>
        ${this._open ? this.renderMenu() : nothing}
      </nx-popover>`;
  }

  renderCard(entry) {
    return html`
      <li>
        <button class="site-card" @click=${() => this.select(entry)}>
          ${avatar(entry)}
          ${this.renderSiteText(entry)}
        </button>
      </li>`;
  }

  renderInlineVariant() {
    const { recent, typed } = this.options;
    return html`
      <section class="chooser">
        <div class="chooser-icon">${icon('globegrid')}</div>
        <h2>Choose a site</h2>
        <p class="chooser-text">Schemas belong to a site. Pick one you worked on recently, or enter its address.</p>
        <form class="chooser-form" @submit=${this.handleSubmit}>
          <div class="menu-search-field">
            ${icon('search')}
            <input
              class="menu-search"
              name="site"
              aria-label="Search recent sites or enter org/site"
              placeholder="Search recent sites or paste a URL"
              autocomplete="off"
              .value=${this._query ?? ''}
              @input=${this.handleInput} />
          </div>
          <button class="nx-btn-accent" type="submit" ?disabled=${!typed && !recent.length}>
            ${typed ? `Open ${toSiteKey(typed)}` : 'Open'}
          </button>
        </form>
        <p class="chooser-hint">Accepts <code>org/site</code>, a da.live link or an aem.page URL.</p>
        ${recent.length ? html`
          <h3 class="group-label">Recent sites</h3>
          <ul class="site-grid">${recent.map((entry) => this.renderCard(entry))}</ul>` : nothing}
        ${this._query && !recent.length && !typed ? html`
          <p class="menu-empty">No recent sites match “${this._query}”.</p>` : nothing}
      </section>`;
  }

  render() {
    return this.variant === 'inline' ? this.renderInlineVariant() : this.renderMenuVariant();
  }
}

customElements.define('nx-site-switcher', NxSiteSwitcher);
