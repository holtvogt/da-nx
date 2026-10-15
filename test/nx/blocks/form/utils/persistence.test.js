import { expect } from '@esm-bundle/chai';
import { attachPersistence } from '../../../../../nx/blocks/form/utils/persistence.js';

const DOC_PATH = '/org/site/doc';
const FORBIDDEN = { error: 'Forbidden', status: 403 };
const SERVER_ERROR = { error: 'Internal server error', status: 500 };
const UNAVAILABLE = { error: 'Service unavailable', status: 503 };
const NETWORK_ERROR = 'Network request failed';

// `setValues()` swaps in a new document reference, which is how persistence detects a mutation.
function makeEditor(initial = {}) {
  let state = {
    document: {
      metadata: { schemaName: 'demo' },
      data: initial,
    },
  };
  return {
    getState: () => state,
    setValues: (next, metadata = { schemaName: 'demo' }) => {
      state = { document: { metadata, data: next } };
    },
  };
}

// Save stub whose calls settle only via `release(callIndex, result)` or `fail(callIndex, error)`.
function makeSave() {
  const calls = [];
  const resolvers = [];
  const save = ({ path, html }) => new Promise((resolve, reject) => {
    calls.push({ path, html });
    resolvers.push({ resolve, reject });
  });
  const lastCall = () => calls.length - 1;
  return {
    save,
    calls,
    release: (callIndex = lastCall(), result = { ok: true }) => {
      resolvers[callIndex].resolve(result);
    },
    fail: (callIndex = lastCall(), error = new Error(NETWORK_ERROR)) => {
      resolvers[callIndex].reject(error);
    },
  };
}

const tick = () => new Promise((resolve) => { setTimeout(resolve, 0); });

function setup() {
  const editor = makeEditor();
  const saver = makeSave();
  const persistence = attachPersistence(editor, { path: DOC_PATH, save: saver.save });
  const edit = (values) => {
    editor.setValues(values);
    persistence.notify();
  };
  return { editor, persistence, edit, ...saver };
}

describe('attachPersistence', () => {
  it('does not save when notify() is called with no mutation (same values reference)', async () => {
    const { persistence, calls } = setup();
    persistence.notify();
    persistence.notify();
    await tick();
    expect(calls).to.have.lengthOf(0);
    persistence.detach();
  });

  it('saves once after a mutation', async () => {
    const { persistence, edit, calls, release } = setup();
    edit({ a: 1 });
    await tick();
    expect(calls).to.have.lengthOf(1);
    expect(calls[0].path).to.equal(DOC_PATH);
    expect(calls[0].html).to.include('demo');
    release();
    persistence.detach();
  });

  it('coalesces concurrent mutations during an in-flight save (single-flight + re-queue)', async () => {
    const { persistence, edit, calls, release } = setup();
    edit({ a: 1 });
    await tick();
    expect(calls).to.have.lengthOf(1);

    edit({ a: 2 });
    edit({ a: 3 });
    await tick();
    expect(calls).to.have.lengthOf(1);

    release(0);
    await tick();
    expect(calls).to.have.lengthOf(2);
    expect(calls[1].html).to.include('>3<');
    expect(calls[1].html).to.not.include('>2<');
    release(1);
    await tick();

    edit({ a: 4 });
    await tick();
    expect(calls).to.have.lengthOf(3);
    release(2);
    persistence.detach();
  });

  describe('flush()', () => {
    it('resolves ok without a request when nothing is unsaved', async () => {
      const { persistence, calls } = setup();
      expect(await persistence.flush()).to.deep.equal({ ok: true });
      expect(calls).to.have.lengthOf(0);
    });

    it('resolves ok once the in-flight save is acknowledged', async () => {
      const { persistence, edit, release } = setup();
      edit({ a: 1 });
      const result = persistence.flush();
      await tick();
      release(0);
      expect(await result).to.deep.equal({ ok: true });
      expect(await persistence.flush()).to.deep.equal({ ok: true });
    });

    it('reports an HTTP failure with error and status', async () => {
      const { persistence, edit, release } = setup();
      edit({ a: 1 });
      const result = persistence.flush();
      await tick();
      release(0, FORBIDDEN);
      expect(await result).to.deep.equal({ ok: false, ...FORBIDDEN });
    });

    it('treats a result without ok as a failure (signed out returns {})', async () => {
      const { persistence, edit, release } = setup();
      edit({ a: 1 });
      const result = persistence.flush();
      await tick();
      release(0, {});
      const { ok, error, status } = await result;
      expect(ok).to.be.false;
      expect(error).to.be.a('string');
      expect(status).to.be.undefined;
    });

    it('treats an undefined result as a failure', async () => {
      const editor = makeEditor();
      const save = async () => undefined;
      const persistence = attachPersistence(editor, { path: DOC_PATH, save });
      editor.setValues({ a: 1 });
      persistence.notify();
      expect((await persistence.flush()).ok).to.be.false;
    });

    it('reports a thrown save as a failure', async () => {
      const { persistence, edit, fail } = setup();
      edit({ a: 1 });
      const result = persistence.flush();
      await tick();
      fail(0, new Error(NETWORK_ERROR));
      expect(await result).to.deep.equal({ ok: false, error: NETWORK_ERROR });
    });

    it('reports a serialization error without calling save', async () => {
      const { editor, persistence, calls } = setup();
      editor.setValues({ a: 1 }, {});
      persistence.notify();
      const { ok, error } = await persistence.flush();
      expect(ok).to.be.false;
      expect(error).to.match(/^Could not serialize document: /);
      expect(calls).to.have.lengthOf(0);
    });

    it('does not mark a failed edit as saved and re-sends it on flush', async () => {
      const { persistence, edit, calls, release } = setup();
      edit({ a: 1 });
      await tick();
      release(0, SERVER_ERROR);
      await tick();

      persistence.notify();
      await tick();
      expect(calls).to.have.lengthOf(1);

      const result = persistence.flush();
      await tick();
      expect(calls).to.have.lengthOf(2);
      expect(calls[1].html).to.include('>1<');
      release(1);
      expect(await result).to.deep.equal({ ok: true });
    });

    it('waits for the save of an edit made during an in-flight save', async () => {
      const { persistence, edit, calls, release } = setup();
      edit({ a: 1 });
      await tick();
      edit({ a: 2 });
      const result = persistence.flush();

      release(0);
      await tick();
      expect(calls).to.have.lengthOf(2);
      let settled = false;
      result.then(() => { settled = true; });
      await tick();
      expect(settled).to.be.false;

      release(1);
      expect(await result).to.deep.equal({ ok: true });
    });

    it('acknowledges only the latest of many edits made during one save', async () => {
      const { persistence, edit, calls, release } = setup();
      edit({ a: 1 });
      const first = persistence.flush();
      await tick();
      edit({ a: 2 });
      edit({ a: 3 });
      edit({ a: 4 });
      const latest = persistence.flush();

      release(0);
      await tick();
      expect(calls).to.have.lengthOf(2);
      expect(calls[1].html).to.include('>4<');

      release(1, SERVER_ERROR);
      expect(await first).to.deep.equal({ ok: true });
      expect((await latest).ok).to.be.false;
      expect(calls).to.have.lengthOf(2);
    });

    it('fails when the queued save fails after an earlier success', async () => {
      const { persistence, edit, release } = setup();
      edit({ a: 1 });
      await tick();
      edit({ a: 2 });
      release(0);
      await tick();
      const result = persistence.flush();
      release(1, UNAVAILABLE);
      expect(await result).to.deep.equal({ ok: false, ...UNAVAILABLE });
    });

    it('resolves ok when a new edit succeeds after a failed save', async () => {
      const { persistence, edit, calls, release } = setup();
      edit({ a: 1 });
      await tick();
      release(0, SERVER_ERROR);
      await tick();

      edit({ a: 2 });
      const result = persistence.flush();
      await tick();
      expect(calls).to.have.lengthOf(2);
      release(1);
      expect(await result).to.deep.equal({ ok: true });
    });

    it('shares one save between concurrent flush calls', async () => {
      const { persistence, edit, calls, release } = setup();
      edit({ a: 1 });
      await tick();
      release(0, SERVER_ERROR);
      await tick();

      const first = persistence.flush();
      const second = persistence.flush();
      await tick();
      expect(calls).to.have.lengthOf(2);
      release(1);
      expect(await first).to.deep.equal({ ok: true });
      expect(await second).to.deep.equal({ ok: true });
    });

    it('does not retry automatically after a failure', async () => {
      const { persistence, edit, calls, fail } = setup();
      edit({ a: 1 });
      await tick();
      fail(0);
      await tick();
      await tick();
      expect(calls).to.have.lengthOf(1);
      persistence.detach();
    });
  });

  describe('detach()', () => {
    it('prevents subsequent saves', async () => {
      const { persistence, edit, calls } = setup();
      persistence.detach();
      edit({ a: 1 });
      await tick();
      expect(calls).to.have.lengthOf(0);
    });

    it('lets the in-flight save settle and resolves a pending flush', async () => {
      const { persistence, edit, calls, release } = setup();
      edit({ a: 1 });
      const result = persistence.flush();
      await tick();

      persistence.detach();
      edit({ a: 2 });
      release(0);
      expect(await result).to.deep.equal({ ok: true });
      expect(calls).to.have.lengthOf(1);
    });

    it('does not start a new save from flush after detach', async () => {
      const { persistence, edit, calls, release } = setup();
      edit({ a: 1 });
      await tick();
      release(0, SERVER_ERROR);
      await tick();

      persistence.detach();
      expect(await persistence.flush()).to.deep.equal({ ok: false, ...SERVER_ERROR });
      expect(calls).to.have.lengthOf(1);
    });
  });
});
