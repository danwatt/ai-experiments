// Shared app singletons + a tiny external store that React components subscribe to.
import { React } from '../vendor/rete-bundle.js';
import { Simulator } from './sim.js';

export const app = {
  sim: new Simulator(),
  editor: null,
  area: null,
  running: true,
  speed: 1,
  lesson: null, // example currently loaded (for the Lesson tab)
  hoverNet: null, // network id under the mouse (wire highlight)
};

let version = 0;
const listeners = new Set();

export const store = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  get: () => version,
  bump() {
    version += 1;
    for (const fn of listeners) fn();
  },
};

/** Re-render the calling component whenever the store is bumped (once per animation frame while running). */
export function useStore() {
  return React.useSyncExternalStore(store.subscribe, store.get);
}

const changeListeners = new Set();
/** Called after any user edit (config change, wiring) – used for autosave. */
export function onUserChange(fn) {
  changeListeners.add(fn);
}
export function userChanged() {
  for (const fn of changeListeners) fn();
  store.bump();
}
