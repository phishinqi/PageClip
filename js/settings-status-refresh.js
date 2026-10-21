// Read persisted status only. No token requests or remote Drive polling.
// A change arriving during a read invalidates that snapshot before it is rendered.
export function createStatusRefresh({ read, apply, visible = () => true, onError = () => {}, delay = 60, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null, running = false, dirty = false, revision = 0;
  async function drain() {
    timer = null;
    if (running || !dirty || !visible()) return;
    running = true;
    try {
      while (dirty && visible()) {
        dirty = false;
        const started = revision;
        try {
          const snapshot = await read();
          if (started === revision && visible()) apply(snapshot);
        } catch (error) {
          if (started === revision && visible()) onError(error);
        }
      }
    } finally { running = false; }
  }
  return {
    request({ immediate = false } = {}) {
      dirty = true;
      revision++;
      if (!visible() || running) return;
      if (timer !== null) clearTimer(timer);
      timer = setTimer(() => { void drain(); }, immediate ? 0 : delay);
    },
    stop() { if (timer !== null) clearTimer(timer); timer = null; dirty = false; revision++; },
  };
}
