// What the notification page should say, from what the browser tells us. Kept apart from the page so it can be tested.
//   code       the one-time code from the app's Settings link (without it the page was not opened from the app)
//   ios        an iPhone or iPad
//   installed  running as an app from the home screen (iOS only allows web notifications there)
//   supported  the browser has service workers, push and notifications
//   permission 'default' | 'granted' | 'denied'

export function stateOf({ code, ios, installed, supported, permission }) {
  if (!code) return { kind: 'nocode' };
  if (ios && !installed) return { kind: 'ios-install' };
  if (!supported) return { kind: 'unsupported', ios };
  if (permission === 'denied') return { kind: 'denied', ios };
  return { kind: 'ready' };
}

/** After the person answered the permission question. */
export const afterAsk = (permission, ios) => (permission === 'granted' ? { kind: 'granted' } : { kind: 'denied', ios });
