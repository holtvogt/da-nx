import { html, LitElement, nothing } from 'da-lit';
import { loadStyle, hashChange } from '../../../nx2/utils/utils.js';
import { getConfig } from '../../../nx2/scripts/nx.js';
import { showToast, VARIANT_ERROR } from '../../../nx2/blocks/shared/toast/toast.js';
import {
  DEFAULT_SCHEMA,
  loadSchemas,
  saveSchema,
  deleteSchema,
  getSchemaPath,
  getSchemaTitle,
  toSchemaList,
  filterSchemaList,
  toSchemaId,
  describeSchemaIssues,
  loadCodeMirror,
  updateCodeMirror,
  revealLine,
} from './utils/utils.js';
import { findKeyOffset } from './utils/json-pointer.js';
import {
  PANE_WIDTH,
  clampPaneWidth,
  loadPaneWidth,
  savePaneWidth,
} from './utils/pane-width.js';

import {
  setupWorkspace,
  togglePanel,
  openPanel,
  isPanelOpen,
  observePanel,
  isChatAvailable,
} from './workspace.js';
import { saveRecentSite } from './site-switcher/utils.js';

import './site-switcher/site-switcher.js';
import '../../../nx2/blocks/shared/search/search.js';
import '../../../nx2/blocks/shared/menu/menu.js';
import '../../../nx2/blocks/shared/dialog/dialog.js';
import '../../../nx2/blocks/shared/segmented-btn/segmented.js';

const EL_NAME = 'nx-schema-editor';
const VALIDATE_DELAY = 400;
const SKELETON_ROWS = 6;

const OVERFLOW_ITEMS = [
  { id: 'duplicate', label: 'Duplicate', icon: 'copy' },
  { divider: true },
  { id: 'delete', label: 'Delete', icon: 'delete' },
];

const style = await loadStyle(import.meta.url);
const buttonStyle = await loadStyle(new URL('../../../nx2/styles/buttons.css', import.meta.url).href);
const formStyle = await loadStyle(new URL('../../../nx2/styles/form.css', import.meta.url).href);
const { codeBase } = getConfig();

const iconHref = (name) => `${codeBase}/img/icons/s2-icon-${name}-20-n.svg`;

const HOME_HASH = '#/';

const PANE_VIEWS = [
  { value: 'schemas', label: 'Schemas', icon: iconHref('filetext') },
  { value: 'fields', label: 'Fields', icon: iconHref('data') },
];

const icon = (name) => html`
  <svg class="icon" viewBox="0 0 20 20" aria-hidden="true">
    <use href="${codeBase}/img/icons/s2-icon-${name}-20-n.svg#icon"></use>
  </svg>`;

function toDoc(entry) {
  if (entry?.status === 'invalid-json') return entry.raw;
  return JSON.stringify(entry?.schema ?? DEFAULT_SCHEMA, null, 2);
}

// Lazily loaded on first use to keep the SDK bundle out of the editor's load.
async function runValidation(schema) {
  const { validateSchema } = await import('../../deps/da-sc-sdk/dist/index.js');
  return validateSchema({ schema });
}

class SchemaEditor extends LitElement {
  static properties = {
    _org: { state: true },
    _site: { state: true },
    _schemas: { state: true },
    _loadError: { state: true },
    _query: { state: true },
    _selected: { state: true },
    _check: { state: true },
    _dirty: { state: true },
    _saving: { state: true },
    _dialog: { state: true },
    _panelOpen: { state: true },
    _chatAvailable: { state: true },
    _paneView: { state: true },
    _paneWidth: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [buttonStyle, formStyle, style];
    this._paneWidth = loadPaneWidth();
    this._unsubscribe = hashChange.subscribe((state) => this.setContext(state));
    this.addEventListener('keydown', this.handleShortcut);
    window.addEventListener('beforeunload', this.handleBeforeUnload);
    this._panelOpen = isPanelOpen();
    this._unobservePanel = observePanel((open) => { this._panelOpen = open; });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unsubscribe?.();
    this._unobservePanel?.();
    this.removeEventListener('keydown', this.handleShortcut);
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
    this._editor?.destroy();
    this._editor = undefined;
  }

  handleShortcut = (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 's') return;
    e.preventDefault();
    if (this.canSave) this.handleSave();
  };

  handleBeforeUnload = (e) => {
    if (this._dirty) e.preventDefault();
  };

  setContext(state) {
    const org = state?.org ?? undefined;
    const site = state?.site ?? undefined;
    if (org === this._org && site === this._site) return;
    this._org = org;
    this._site = site;
    this._selected = undefined;
    this._dirty = false;
    this._query = '';
    this._chatAvailable = false;
    this.emitSnapshot();
    if (!org) return;
    this.load();
    isChatAvailable({ org, site }).then((available) => {
      if (org === this._org && site === this._site) this._chatAvailable = available;
    });
  }

  async load() {
    const { _org: org, _site: site } = this;
    this._schemas = undefined;
    this._loadError = undefined;

    const result = await loadSchemas({ org, site });
    if (org !== this._org || site !== this._site) return;
    if (result.error) {
      this._loadError = result;
      return;
    }
    this._schemas = result.schemas;
    if (site) saveRecentSite({ org, site });
    const [first] = toSchemaList(this._schemas);
    if (first) this.openSchema(first.id);
  }

  get prefix() {
    return this._site ? `/${this._org}/${this._site}` : `/${this._org}`;
  }

  get codeEditor() {
    return this.shadowRoot.querySelector('.nx-codemirror');
  }

  get currentDoc() {
    return this._editor?.state.doc.toString();
  }

  get hasIssues() {
    return ['invalid', 'invalid-json'].includes(this._check?.state);
  }

  get canSave() {
    return Boolean(this._selected && this._dirty && !this._saving && !this.hasIssues);
  }

  get selectedTitle() {
    return getSchemaTitle({ id: this._selected, entry: this._schemas?.[this._selected] });
  }

  get snapshot() {
    if (!this._selected) return {};
    return {
      title: this.selectedTitle,
      schema: this._parsed,
      invalid: this._check?.state === 'invalid-json',
    };
  }

  emitSnapshot() {
    this.dispatchEvent(new CustomEvent('schema-change', { detail: this.snapshot }));
  }

  requestOpen(id) {
    if (id === this._selected) return;
    if (this._dirty) {
      this._dialog = { type: 'discard', nextId: id };
      return;
    }
    this.openSchema(id);
  }

  async openSchema(id) {
    this._selected = id;
    this._check = undefined;
    this._parsed = undefined;
    await this.updateComplete;

    const doc = toDoc(this._schemas[id]);
    this._savedDoc = doc;
    this.setEditorDoc(doc);
    clearTimeout(this._validateTimer);
    this._dirty = false;
    this.validate(doc);
  }

  setEditorDoc(doc) {
    const parent = this.codeEditor;
    if (this._editor && parent.contains(this._editor.dom)) {
      updateCodeMirror(this._editor, doc);
      return;
    }
    this._editor?.destroy();
    const onChange = (value) => this.handleDocChange(value);
    this._editor = loadCodeMirror({ parent, doc, onChange });
  }

  handleFieldSelect({ detail }) {
    if (!this._editor) return;
    const pos = findKeyOffset({ text: this._editor.state.doc.toString(), pointer: detail.pointer });
    if (pos !== undefined) revealLine({ editor: this._editor, pos });
  }

  handleDocChange(doc) {
    this._dirty = doc !== this._savedDoc;
    clearTimeout(this._validateTimer);
    this._validateTimer = setTimeout(() => this.validate(doc), VALIDATE_DELAY);
  }

  async validate(doc) {
    const id = this._selected;
    let parsed;
    try {
      parsed = JSON.parse(doc);
    } catch (e) {
      this._check = { state: 'invalid-json', issues: [e.message] };
      this.emitSnapshot();
      return { valid: false };
    }

    this._parsed = parsed;
    this.emitSnapshot();

    if (!this._check) this._check = { state: 'checking' };
    const { valid, schemaIssues } = await runValidation(parsed);
    // Selection or content may have changed while the validator loaded.
    if (id !== this._selected || doc !== this.currentDoc) return { valid: false };

    this._check = valid
      ? { state: 'valid' }
      : { state: 'invalid', issues: describeSchemaIssues(schemaIssues) };
    return { valid, parsed };
  }

  async handleSave() {
    const id = this._selected;
    const content = this.currentDoc;
    const { valid, parsed } = await this.validate(content);
    if (!valid) {
      showToast({ text: 'Resolve the schema issues before saving.', variant: VARIANT_ERROR });
      return;
    }

    this._saving = true;
    const { error } = await saveSchema({ prefix: this.prefix, id, content });
    this._saving = false;
    if (error) {
      showToast({ text: error, variant: VARIANT_ERROR });
      return;
    }

    this._schemas = { ...this._schemas, [id]: { status: 'loaded', schema: parsed } };
    this._savedDoc = content;
    this._dirty = this.currentDoc !== content;
    showToast({ text: `${getSchemaTitle({ id, entry: this._schemas[id] })} saved.` });
  }

  handleMenuSelect({ detail }) {
    if (detail.id === 'delete') this._dialog = { type: 'delete' };
    if (detail.id === 'duplicate') this.openCreate({ sourceId: this._selected });
  }

  openCreate({ sourceId } = {}) {
    const title = sourceId ? `${this.selectedTitle} copy` : '';
    this._dialog = { type: 'create', sourceId, title, id: toSchemaId(title), idEdited: false };
  }

  updateDialog(changes) {
    this._dialog = { ...this._dialog, error: undefined, ...changes };
  }

  handleTitleInput({ target }) {
    const { idEdited } = this._dialog;
    const id = idEdited ? this._dialog.id : toSchemaId(target.value);
    this.updateDialog({ title: target.value, id });
  }

  handleIdInput({ target }) {
    const id = toSchemaId(target.value);
    target.value = id;
    this.updateDialog({ id, idEdited: true });
  }

  getCreateError({ title, id }) {
    if (!title.trim()) return 'Enter a name for the schema.';
    if (!id) return 'Enter a file name using letters and numbers.';
    if (this._schemas[id]) return `A schema named ${id}.html already exists.`;
    return undefined;
  }

  async handleCreate(e) {
    e?.preventDefault();
    const { title, id, sourceId } = this._dialog;
    const error = this.getCreateError({ title, id });
    if (error) {
      this.updateDialog({ error });
      return;
    }

    const source = this._schemas[sourceId]?.schema ?? DEFAULT_SCHEMA;
    const schema = { ...source, title: title.trim() };
    const content = JSON.stringify(schema, null, 2);

    this.updateDialog({ busy: true });
    const result = await saveSchema({ prefix: this.prefix, id, content });
    if (result.error) {
      this.updateDialog({ busy: false, error: result.error });
      return;
    }

    this._schemas = { ...this._schemas, [id]: { status: 'loaded', schema } };
    this._query = '';
    this.closeDialog();
    showToast({ text: `${schema.title} created.` });
    this.requestOpen(id);
  }

  async handleDelete() {
    const id = this._selected;
    const title = this.selectedTitle;
    this.updateDialog({ busy: true });
    const { error } = await deleteSchema({ prefix: this.prefix, id });
    if (error) {
      this.updateDialog({ busy: false, error });
      return;
    }

    const remaining = { ...this._schemas };
    delete remaining[id];
    this._schemas = remaining;
    this._dirty = false;
    this.closeDialog();
    showToast({ text: `${title} deleted.` });

    const [next] = toSchemaList(remaining);
    if (next) {
      this.openSchema(next.id);
    } else {
      this._selected = undefined;
    }
  }

  handleDiscard() {
    const { nextId, nextSite } = this._dialog;
    this._dirty = false;
    this.closeDialog();
    if (nextSite) {
      this.navigateToSite(nextSite);
      return;
    }
    this.openSchema(nextId);
  }

  navigateToSite({ org, site }) {
    window.location.hash = org ? `#/${org}/${site}` : HOME_HASH;
  }

  requestSiteChange(nextSite) {
    if (this._dirty) {
      this._dialog = { type: 'discard', nextSite };
      return;
    }
    this.navigateToSite(nextSite);
  }

  handleSiteChange({ detail }) {
    this.requestSiteChange(detail);
  }

  handleHome(e) {
    e.preventDefault();
    if (this._org) this.requestSiteChange({});
  }

  handleFixWithAI(e) {
    e.preventDefault();
    const path = getSchemaPath({ prefix: this.prefix, id: this._selected });
    const issues = this._check.issues.map((issue) => `- ${issue}`).join('\n');
    openPanel({ text: `Fix these issues in the schema ${path} and explain each change:\n${issues}` });
  }

  closeDialog() {
    this.shadowRoot.querySelector('nx-dialog')?.close();
    this._dialog = undefined;
  }

  handleDialogClose({ target }) {
    if (target.localName === 'nx-dialog') this._dialog = undefined;
  }

  renderSiteChooser() {
    return html`
      <div class="scroll-area">
        <nx-site-switcher variant="inline" @site-change=${this.handleSiteChange}></nx-site-switcher>
      </div>`;
  }

  renderLoadError() {
    const { error, status } = this._loadError;
    return html`
      <div class="state-card" role="alert">
        <div class="state-icon negative">${icon('alertdiamond')}</div>
        <h2>${error}</h2>
        <p>Check that you have access to ${this.prefix} and try again.${status ? ` (Status ${status})` : ''}</p>
        <button class="nx-action-btn" @click=${this.load}>Try again</button>
      </div>`;
  }

  setPaneWidth(width) {
    const available = this.shadowRoot.querySelector('.layout')?.clientWidth ?? window.innerWidth;
    this._paneWidth = clampPaneWidth({ width, available });
  }

  handleResizeStart(e) {
    if (e.button !== 0) return;
    const handle = e.currentTarget;
    const layout = handle.parentElement;
    const startX = e.clientX;
    const startWidth = this._paneWidth ?? PANE_WIDTH.DEFAULT;
    handle.setPointerCapture(e.pointerId);
    layout.classList.add('resizing');

    const onMove = (move) => this.setPaneWidth(startWidth + move.clientX - startX);
    const onEnd = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onEnd);
      handle.removeEventListener('pointercancel', onEnd);
      layout.classList.remove('resizing');
      savePaneWidth(this._paneWidth);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
  }

  handleResizeKey(e) {
    const width = this._paneWidth ?? PANE_WIDTH.DEFAULT;
    const targets = {
      ArrowLeft: width - PANE_WIDTH.STEP,
      ArrowRight: width + PANE_WIDTH.STEP,
      Home: PANE_WIDTH.MIN,
      End: PANE_WIDTH.MAX,
    };
    if (!(e.key in targets)) return;
    e.preventDefault();
    this.setPaneWidth(targets[e.key]);
    savePaneWidth(this._paneWidth);
  }

  resetPaneWidth() {
    this._paneWidth = undefined;
    savePaneWidth(undefined);
  }

  get paneStyle() {
    return this._paneWidth ? `--se-pane-width: ${this._paneWidth}px` : nothing;
  }

  renderPaneResizer() {
    return html`
      <div
        class="pane-resizer"
        role="separator"
        tabindex="0"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuemin=${PANE_WIDTH.MIN}
        aria-valuemax=${PANE_WIDTH.MAX}
        aria-valuenow=${this._paneWidth ?? PANE_WIDTH.DEFAULT}
        title="Drag to resize, double-click to reset"
        @pointerdown=${this.handleResizeStart}
        @keydown=${this.handleResizeKey}
        @dblclick=${this.resetPaneWidth}
      ></div>`;
  }

  renderSkeleton() {
    return html`
      <div class="layout" style=${this.paneStyle} aria-busy="true" aria-label="Loading schemas">
        <aside class="list-pane">
          <div class="list-header"><span class="skeleton skeleton-text"></span></div>
          <div class="skeleton skeleton-search"></div>
          <ul class="schema-list">
            ${Array.from({ length: SKELETON_ROWS }, () => html`<li class="skeleton skeleton-row"></li>`)}
          </ul>
        </aside>
        <section class="editor-pane">
          <div class="editor-header"><span class="skeleton skeleton-title"></span></div>
          <div class="skeleton skeleton-editor"></div>
        </section>
      </div>`;
  }

  renderListItem({ id, title, status }) {
    const selected = id === this._selected;
    return html`
      <li>
        <button
          class="schema-item ${status === 'invalid-json' ? 'is-broken' : ''}"
          role="option"
          aria-selected=${selected}
          @click=${() => this.requestOpen(id)}>
          ${icon(status === 'invalid-json' ? 'alertdiamond' : 'filetext')}
          <span class="schema-item-text">
            <span class="schema-item-title">${title}</span>
            <span class="schema-item-id">${id}.html</span>
          </span>
          ${selected && this._dirty ? html`<span class="dirty-dot" title="Unsaved changes"></span>` : nothing}
        </button>
      </li>`;
  }

  async handlePaneView({ detail }) {
    if (detail.value === 'fields') await import('./outline/outline.js');
    this._paneView = detail.value;
  }

  renderList() {
    const isFields = this._paneView === 'fields';
    return html`
      <aside class="list-pane">
        <div class="list-header">
          <nx-segmented-btn
            label="Sidebar view"
            .items=${PANE_VIEWS}
            .value=${isFields ? 'fields' : 'schemas'}
            @change=${this.handlePaneView}
          ></nx-segmented-btn>
          ${isFields ? nothing : html`
            <button class="nx-action-btn nx-btn-sm" @click=${() => this.openCreate()}>
              ${icon('add')}<span>New</span>
            </button>`}
        </div>
        ${isFields ? html`<nx-schema-outline
          .source=${this}
          @field-select=${this.handleFieldSelect}
        ></nx-schema-outline>` : this.renderSchemas()}
      </aside>`;
  }

  renderSchemas() {
    const list = toSchemaList(this._schemas);
    const filtered = filterSchemaList({ list, query: this._query });
    const placeholder = list.length === 1 ? 'Filter 1 schema' : `Filter ${list.length} schemas`;

    return html`
        ${list.length ? html`
          <nx-search
            variant="field"
            label="Filter schemas"
            placeholder=${placeholder}
            .value=${this._query ?? ''}
            @input=${({ target }) => { this._query = target.value; }}
          ></nx-search>` : nothing}
        ${filtered.length ? html`
          <ul class="schema-list" role="listbox" aria-label="Schemas">
            ${filtered.map((item) => this.renderListItem(item))}
          </ul>` : nothing}
        ${list.length && !filtered.length ? html`
          <div class="list-empty">
            <p>No schemas match “${this._query}”.</p>
            <button class="nx-action-btn-quiet nx-btn-sm" @click=${() => { this._query = ''; }}>Clear filter</button>
          </div>` : nothing}`;
  }

  renderBadge() {
    const { state, issues } = this._check ?? { state: 'checking' };
    if (state === 'checking') return html`<span class="badge neutral">Checking…</span>`;
    if (state === 'valid') return html`<span class="badge positive">${icon('checkmarkcircle')}Valid</span>`;
    if (state === 'invalid-json') return html`<span class="badge negative">${icon('alertdiamond')}Invalid JSON</span>`;
    const label = issues.length === 1 ? '1 issue' : `${issues.length} issues`;
    return html`<span class="badge negative">${icon('alertdiamond')}${label}</span>`;
  }

  renderIssues() {
    if (!this.hasIssues) return nothing;
    const { state, issues } = this._check;
    const title = state === 'invalid-json'
      ? 'This schema contains invalid JSON'
      : 'This schema has validation errors';
    return html`
      <details class="inline-alert negative" open role="alert">
        <summary>
          ${icon('alertdiamond')}<span class="alert-title">${title}. Resolve them to save.</span>
          ${this._chatAvailable ? html`
            <button class="nx-action-btn fix-btn nx-btn-sm" @click=${this.handleFixWithAI}>
              ${icon('aigenerate')}Fix with AI
            </button>` : nothing}
        </summary>
        <ul>${issues.map((issue) => html`<li>${issue}</li>`)}</ul>
      </details>`;
  }

  renderEditorHeader() {
    return html`
      <header class="editor-header">
        <div class="editor-title">
          <h2>${this.selectedTitle}</h2>
          <p class="editor-path" title=${getSchemaPath({ prefix: this.prefix, id: this._selected })}>${this._selected}.html</p>
        </div>
        <div class="editor-actions">
          ${this.renderBadge()}
          ${this._dirty ? html`<span class="unsaved"><span class="dirty-dot"></span>Unsaved changes</span>` : nothing}
          <button class="nx-btn-accent" ?disabled=${!this.canSave} @click=${this.handleSave}>
            ${this._saving ? 'Saving…' : 'Save'}
          </button>
          <nx-menu placement="below" .items=${OVERFLOW_ITEMS} @select=${this.handleMenuSelect}>
            <button slot="trigger" class="nx-action-btn-icon" aria-label="More actions">${icon('more')}</button>
          </nx-menu>
        </div>
      </header>
      ${this.renderIssues()}`;
  }

  renderEditorEmpty() {
    const hasSchemas = Object.keys(this._schemas).length > 0;
    return html`
      <div class="state-card">
        <div class="state-icon">${icon('filetext')}</div>
        <h2>${hasSchemas ? 'Select a schema' : 'No schemas yet'}</h2>
        <p>${hasSchemas
    ? 'Choose a schema from the list to view and edit it.'
    : 'Create a schema to define the fields authors fill in for structured content.'}</p>
        ${hasSchemas ? nothing : html`
          <button class="nx-btn-accent" @click=${() => this.openCreate()}>${icon('add')}Create schema</button>`}
      </div>`;
  }

  renderEditorPane() {
    return html`
      <section class="editor-pane">
        ${this._selected ? this.renderEditorHeader() : this.renderEditorEmpty()}
        <div class="nx-codemirror" ?hidden=${!this._selected}></div>
      </section>`;
  }

  renderCreateDialog() {
    const { sourceId, title, id, error, busy } = this._dialog;
    return html`
      <nx-dialog
        title=${sourceId ? 'Duplicate schema' : 'New schema'}
        ?busy=${busy}
        @close=${this.handleDialogClose}>
        <form class="dialog-form" id="create-form" @submit=${this.handleCreate}>
          <div class="nx-form-field">
            <label for="schema-title">Name</label>
            <input id="schema-title" class="nx-input" autofocus .value=${title} @input=${this.handleTitleInput} placeholder="Article" />
          </div>
          <div class="nx-form-field ${error ? 'nx-field-error' : ''}">
            <label for="schema-id">File name</label>
            <div class="input-suffix">
              <input id="schema-id" class="nx-input" .value=${id} @input=${this.handleIdInput} placeholder="article" />
              <span>.html</span>
            </div>
            ${error ? html`<p class="nx-input-error-msg">${error}</p>` : html`
              <p class="field-help">Saved to ${this.prefix}/.da/forms/schemas</p>`}
          </div>
        </form>
        <button slot="actions" class="nx-form-btn-secondary" @click=${this.closeDialog}>Cancel</button>
        <button slot="actions" class="nx-form-btn-primary" type="submit" form="create-form" ?disabled=${busy}>
          ${busy ? 'Creating…' : 'Create'}
        </button>
      </nx-dialog>`;
  }

  renderDeleteDialog() {
    const { error, busy } = this._dialog;
    return html`
      <nx-dialog title="Delete ${this.selectedTitle}?" ?busy=${busy} @close=${this.handleDialogClose}>
        <p class="dialog-text">
          <code>${this._selected}.html</code> will be permanently removed from ${this.prefix}.
          Content that relies on this schema will no longer validate.
        </p>
        ${error ? html`<p class="nx-input-error-msg">${error}</p>` : nothing}
        <button slot="actions" class="nx-form-btn-secondary" @click=${this.closeDialog}>Cancel</button>
        <button slot="actions" class="nx-form-btn-primary negative" ?disabled=${busy} @click=${this.handleDelete}>
          ${busy ? 'Deleting…' : 'Delete'}
        </button>
      </nx-dialog>`;
  }

  renderDiscardDialog() {
    return html`
      <nx-dialog title="Discard unsaved changes?" @close=${this.handleDialogClose}>
        <p class="dialog-text">Your changes to ${this.selectedTitle} have not been saved.</p>
        <button slot="actions" class="nx-form-btn-secondary" @click=${this.closeDialog}>Keep editing</button>
        <button slot="actions" class="nx-form-btn-primary negative" @click=${this.handleDiscard}>Discard</button>
      </nx-dialog>`;
  }

  renderDialog() {
    const dialogs = {
      create: () => this.renderCreateDialog(),
      delete: () => this.renderDeleteDialog(),
      discard: () => this.renderDiscardDialog(),
    };
    return dialogs[this._dialog?.type]?.() ?? nothing;
  }

  renderBody() {
    if (!this._org) return this.renderSiteChooser();
    if (this._loadError) return this.renderLoadError();
    if (!this._schemas) return this.renderSkeleton();
    return html`
      <div class="layout" style=${this.paneStyle}>
        ${this.renderList()}${this.renderPaneResizer()}${this.renderEditorPane()}
      </div>`;
  }

  renderToolbar() {
    return html`
      <div class="toolbar">
        ${this._chatAvailable && !this._panelOpen ? html`
          <button
            class="nx-action-btn-icon panel-toggle"
            aria-label="Open Coworker panel"
            title="Coworker"
            @click=${togglePanel}>${icon('splitleft')}</button>` : nothing}
        <h1 class="app-title">
          <a href=${HOME_HASH} title="Choose a site" @click=${this.handleHome}>
            <span class="app-mark">${icon('data')}</span>
            Schema Editor
          </a>
        </h1>
        ${this._org ? html`
          <span class="toolbar-divider" aria-hidden="true"></span>
          <nx-site-switcher
            .org=${this._org}
            .site=${this._site}
            @site-change=${this.handleSiteChange}
          ></nx-site-switcher>` : nothing}
      </div>`;
  }

  render() {
    return html`
      ${this.renderToolbar()}
      ${this.renderBody()}
      ${this.renderDialog()}`;
  }
}

customElements.define(EL_NAME, SchemaEditor);

export default function init(el) {
  const editor = document.createElement(EL_NAME);
  el.replaceChildren(editor);
  setupWorkspace();
}
