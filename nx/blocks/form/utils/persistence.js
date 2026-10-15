// Persistence for the form block.
//
// At most one save runs at a time. Edits made during a save are coalesced
// into one follow-up save of the latest document, so saves never overwrite
// each other out of order.
//
// Usage:
//   const editor = createEngine({ schema, document, onChange });
//   const persistence = attachPersistence(editor, { path });
//   // ...in the shell's onChange handler:
//   persistence.notify();
//   const { ok, error, status } = await persistence.flush();
//   persistence.detach();   // on teardown
//
// `save` is injectable so the call is testable in isolation. The default is
// the form block's `saveSourceHtml`.

import { convertJsonToHtml } from '../../../deps/da-sc-sdk/dist/index.js';
import { saveSourceHtml } from './da-api.js';

const SAVED = Object.freeze({ ok: true });
const SAVE_FAILED = 'Could not save source document.';
const SERIALIZE_FAILED = 'Could not serialize document';

function toFailure(result) {
  const failure = { ok: false, error: result?.error ?? SAVE_FAILED };
  if (result?.status) {
    failure.status = result.status;
  }
  return failure;
}

async function saveDocument({ document, path, save }) {
  try {
    const { html, error } = convertJsonToHtml({ json: document });
    if (error) {
      return { ok: false, error: `${SERIALIZE_FAILED}: ${error}` };
    }

    const result = await save({ path, html });
    if (!result?.ok) {
      return toFailure(result);
    }
    return SAVED;
  } catch (thrown) {
    return { ok: false, error: thrown?.message ?? SAVE_FAILED };
  }
}

export function attachPersistence(editor, { path, save = saveSourceHtml } = {}) {
  let latestDocument = editor.getState()?.document;
  let revision = 0;
  let savedRevision = 0;
  let lastResult = SAVED;
  let pending = false;
  let inFlight = null;
  let detached = false;

  async function saveLatestDocument() {
    try {
      do {
        pending = false;
        const sentRevision = revision;
        lastResult = await saveDocument({ document: latestDocument, path, save });
        if (lastResult.ok) {
          savedRevision = sentRevision;
        }
      } while (pending);
    } finally {
      inFlight = null;
    }
  }

  function persist() {
    if (inFlight) {
      pending = true;
      return inFlight;
    }
    inFlight = saveLatestDocument();
    return inFlight;
  }

  function waitForSave() {
    if (inFlight) {
      return inFlight;
    }
    if (detached) {
      return Promise.resolve();
    }
    return persist();
  }

  return {
    // mutate.js clones the document on every change, so a new reference means new content.
    notify: () => {
      if (detached) return;
      const next = editor.getState()?.document;
      if (next === latestDocument) return;
      latestDocument = next;
      revision += 1;
      persist();
    },
    // Waits for autosave to go idle and reports whether the document as of this call is saved.
    flush: async () => {
      const target = revision;
      const isSaved = () => savedRevision >= target;
      if (isSaved()) {
        return SAVED;
      }
      await waitForSave();
      if (isSaved()) {
        return SAVED;
      }
      return lastResult;
    },
    detach: () => { detached = true; },
  };
}
