import { useSyncExternalStore } from 'react';
export const MODES = ['system', 'light', 'dark'];
const system = window.matchMedia('(prefers-color-scheme: dark)'),
  listeners = new Set();
let appearance = {
  mode: 'system'
};
export function persistPreference(values) {
  return fetch('/api/action', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      action: 'preferences',
      args: values
    })
  }).then(r => {
    if (!r.ok) throw new Error('无法保存设置。');
  });
}
function apply() {
  const theme = appearance.mode === 'system' ? system.matches ? 'dark' : 'light' : appearance.mode;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#1E1D1B' : '#F5F2EC');
  window.chrome?.webview?.postMessage({
    type: 'appearance',
    theme,
    language: document.documentElement.lang
  });
}
export function useAppearance() {
  return useSyncExternalStore(fn => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, () => appearance);
}
export function applySavedAppearance(p) {
  appearance = {
    mode: MODES.includes(p?.mode) ? p.mode : 'system'
  };
  apply();
  for (const fn of listeners) fn();
}
export async function setAppearance(values) {
  await persistPreference(values);
  applySavedAppearance({
    ...appearance,
    ...values
  });
}
export const notifyHostAppearance = apply;
system.addEventListener('change', apply);
apply();
