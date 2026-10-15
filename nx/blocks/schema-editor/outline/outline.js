import { html, LitElement, nothing } from 'da-lit';
import { loadStyle } from '../../../../nx2/utils/utils.js';
import { getConfig } from '../../../../nx2/scripts/nx.js';
import { toFieldTree, countFields } from './utils.js';

const style = await loadStyle(import.meta.url);
const { codeBase } = getConfig();

const icon = (name) => html`
  <svg class="icon" viewBox="0 0 20 20" aria-hidden="true">
    <use href="${codeBase}/img/icons/s2-icon-${name}-20-n.svg#icon"></use>
  </svg>`;

/**
 * Author-facing preview of the open schema as a list of form fields.
 * Reads `{ title, schema, invalid }` from the host's `schema-change` events
 * and fires `field-select` with the field's key path when a field is clicked.
 */
class NxSchemaOutline extends LitElement {
  static properties = {
    source: { attribute: false },
    _snapshot: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [style];
    this._snapshot = this.source?.snapshot;
    this.source?.addEventListener('schema-change', this.handleChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.source?.removeEventListener('schema-change', this.handleChange);
  }

  handleChange = ({ detail }) => {
    this._snapshot = detail;
  };

  selectField(field) {
    const detail = { key: field.key, pointer: field.pointer };
    this.dispatchEvent(new CustomEvent('field-select', { detail }));
  }

  renderField(field) {
    return html`
      <li class="field">
        <button
          class="field-target"
          title=${field.sharedIn ? `Show in shared ${field.sharedIn} definition` : 'Show in editor'}
          @click=${() => this.selectField(field)}>
          <span class="field-row">
            <span class="field-label">${field.label}${field.required ? html`<span class="required" title="Required">*</span>` : nothing}</span>
            <span class="field-type">${field.type}</span>
          </span>
          ${field.description ? html`<span class="field-description">${field.description}</span>` : nothing}
          ${field.options ? html`<span class="field-options">${field.options.join(' · ')}</span>` : nothing}
        </button>
        ${field.children.length ? html`<ul class="fields nested">${field.children.map((child) => this.renderField(child))}</ul>` : nothing}
      </li>`;
  }

  renderMessage({ title, text }) {
    return html`
      <div class="message">
        ${icon('data')}
        <p><strong>${title}</strong></p>
        <p>${text}</p>
      </div>`;
  }

  render() {
    const { title, schema, invalid } = this._snapshot ?? {};
    if (!title) return this.renderMessage({ title: 'No schema open', text: 'Select a schema to preview its fields.' });
    if (invalid) return this.renderMessage({ title: 'Preview unavailable', text: 'Fix the JSON to preview the fields authors see.' });

    const fields = toFieldTree(schema);
    return html`
      <div class="intro">
        <p class="intro-title">${title}</p>
        <p class="intro-text">${countFields(fields)} fields authors fill in. <span class="required">*</span> marks required fields.</p>
      </div>
      ${fields.length
    ? html`<ul class="fields">${fields.map((field) => this.renderField(field))}</ul>`
    : this.renderMessage({ title: 'No fields yet', text: 'Add properties to the schema to create form fields.' })}`;
  }
}

customElements.define('nx-schema-outline', NxSchemaOutline);
