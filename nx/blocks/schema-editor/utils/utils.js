import { DA_ADMIN } from '../../../../nx2/utils/utils.js';
import { daFetch } from '../../../../nx2/utils/api.js';

import {
  EditorView,
  basicSetup,
  Compartment,
  json as cmjson,
  jsonParseLinter,
  linter,
  lintGutter,
  githubLight,
  githubDark,
} from '../../../deps/codemirror/dist/index.js';

const FORMS_BASE_PATH = '/.da/forms/schemas';
const HTML_SHELL = '<body><header></header><main><div><pre><code>{{JSON}}</code></pre></div></main><footer></footer></body>';

export const DEFAULT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {},
};

// loadSchema returns a tagged result the caller branches on via `status`:
//   { status: 'loaded', schema }      — parsed successfully
//   { status: 'invalid-json', raw }   — couldn't parse; raw text kept for repair
//   { status: 'load-failed' }         — couldn't fetch the source
// The status is an explicit contract, so the editor never has to inspect a
// schema's own fields (which could collide with a legitimate `invalid`/`error`
// property) to tell a real schema from a malformed one.
async function loadSchema(schema) {
  const resp = await daFetch({ url: `${DA_ADMIN}/source${schema.path}` });
  if (!resp.ok) return { status: 'load-failed' };
  const html = await resp.text();

  const parser = new DOMParser();
  const dom = parser.parseFromString(html, 'text/html');
  const jsonStr = dom.querySelector('code')?.textContent || '';

  try {
    return { status: 'loaded', schema: JSON.parse(jsonStr) };
  } catch {
    return { status: 'invalid-json', raw: jsonStr };
  }
}

// Returns `{ schemas }` (name -> tagged result) or `{ error, status }`.
export async function loadSchemas({ org, site }) {
  const orgPath = `/${org}${FORMS_BASE_PATH}`;
  const path = site ? `/${org}/${site}${FORMS_BASE_PATH}` : orgPath;

  let resp = await daFetch({ url: `${DA_ADMIN}/list${path}` });

  // If this was a site request, and it was empty, fallback to org
  if (!resp.ok && site) resp = await daFetch({ url: `${DA_ADMIN}/list${orgPath}` });

  if (resp.status === 404) return { schemas: {} };
  if (!resp.ok) return { error: 'Schemas could not be loaded.', status: resp.status };

  const json = await resp.json();
  if (!Array.isArray(json)) return { error: 'Schemas could not be read.' };

  // Schemas that failed to fetch are dropped so the editor only lists ones it can open.
  const entries = await Promise.all(
    json.map(async (item) => [item.name, await loadSchema(item)]),
  );
  return {
    schemas: Object.fromEntries(
      entries.filter(([, result]) => result.status !== 'load-failed'),
    ),
  };
}

export function getSchemaPath({ prefix, id }) {
  return `${prefix}${FORMS_BASE_PATH}/${id}.html`;
}

export async function saveSchema({ prefix, id, content }) {
  const body = new FormData();
  const data = new Blob([HTML_SHELL.replace('{{JSON}}', content)], { type: 'text/html' });
  body.append('data', data);

  const opts = { method: 'POST', body };
  const resp = await daFetch({ url: `${DA_ADMIN}/source${getSchemaPath({ prefix, id })}`, opts });
  if (!resp.ok) return { error: `The schema could not be saved (status ${resp.status ?? 'unknown'}).` };
  return { status: resp.status };
}

export async function deleteSchema({ prefix, id }) {
  const opts = { method: 'DELETE' };
  const resp = await daFetch({ url: `${DA_ADMIN}/source${getSchemaPath({ prefix, id })}`, opts });
  if (!resp.ok) return { error: `The schema could not be deleted (status ${resp.status ?? 'unknown'}).` };
  return { status: resp.status };
}

export function getSchemaTitle({ id, entry }) {
  return entry?.schema?.title || id;
}

export function toSchemaList(schemas) {
  return Object.entries(schemas ?? {})
    .map(([id, entry]) => ({ id, title: getSchemaTitle({ id, entry }), status: entry.status }))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}

export function filterSchemaList({ list, query }) {
  const needle = query?.trim().toLowerCase();
  if (!needle) return list;
  return list.filter(({ id, title }) => `${title} ${id}`.toLowerCase().includes(needle));
}

export function toSchemaId(value) {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
}

export function describeSchemaIssues(issues) {
  const lines = issues.map((issue) => {
    // `schemaPath` points at the schema source; root is '/'.
    const where = issue.schemaPath && issue.schemaPath !== '/' ? `#${issue.schemaPath}` : 'the schema root';
    const what = (issue.message || issue.reason || '').replace(/\.$/, '');
    return `${what} (at ${where})`;
  });
  // Distinct schema locations may collapse to the same line (a shared $def).
  return [...new Set(lines)];
}

// CodeMirror

const themeCompartment = new Compartment();

// Follow the app's effective color scheme rather than the OS preference.
function isDarkScheme(el) {
  const scheme = getComputedStyle(el).colorScheme || '';
  if (!scheme.includes('dark')) return false;
  if (!scheme.includes('light')) return true;
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

const getTheme = (el) => (isDarkScheme(el) ? githubDark : githubLight);

const FLASH_DURATION_MS = 1200;
const flashCompartment = new Compartment();
const flashAttributes = EditorView.editorAttributes.of({ class: 'cm-flash' });
const flashTimers = new WeakMap();

const s2Chrome = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
    backgroundColor: 'var(--s2-gray-25)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--s2-code-font-family, "Source Code Pro", ui-monospace, monospace)',
    lineHeight: '1.6',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--s2-gray-50)',
    color: 'var(--s2-gray-600)',
    borderRight: '1px solid var(--s2-gray-200)',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--s2-blue-200) 45%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--s2-gray-100)', color: 'var(--s2-gray-900)' },
  '&.cm-flash .cm-activeLine, &.cm-flash .cm-activeLineGutter': {
    animation: `nx-line-flash ${FLASH_DURATION_MS}ms ease-out`,
  },
  '@keyframes nx-line-flash': {
    from: { backgroundColor: 'color-mix(in srgb, var(--s2-blue-400) 60%, transparent)' },
  },
});

export function loadCodeMirror({ parent, doc, onChange }) {
  const editor = new EditorView({
    doc,
    extensions: [
      basicSetup,
      cmjson(),
      linter(jsonParseLinter()),
      lintGutter(),
      themeCompartment.of(getTheme(parent)),
      s2Chrome,
      flashCompartment.of([]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange?.(update.state.doc.toString());
      }),
    ],
    parent,
  });

  const syncTheme = () => {
    editor.dispatch({ effects: themeCompartment.reconfigure(getTheme(parent)) });
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncTheme);
  new MutationObserver(syncTheme).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  return editor;
}

export function updateCodeMirror(editor, doc) {
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: doc },
  });
}

const setFlash = (editor, on) => editor.dispatch({
  effects: flashCompartment.reconfigure(on ? flashAttributes : []),
});

/** Moves the cursor to the start of the line at `pos`, scrolls to it and flashes it. */
export function revealLine({ editor, pos }) {
  const { from } = editor.state.doc.lineAt(pos);
  clearTimeout(flashTimers.get(editor));
  editor.dispatch({
    selection: { anchor: from },
    effects: [EditorView.scrollIntoView(from, { y: 'center' }), flashCompartment.reconfigure([])],
  });
  editor.focus();
  // Two frames so a repeated reveal of the same line restarts the animation.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    setFlash(editor, true);
    flashTimers.set(editor, setTimeout(() => setFlash(editor, false), FLASH_DURATION_MS));
  }));
}
