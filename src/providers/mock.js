// Offline provider for UI work and tests. Deterministic, no network.
const LINES = [
  ' and that was only the beginning.',
  ' which made everything else feel easier.',
  ' so we decided to try again in the morning.',
  ' but nobody in the room was ready for it.',
];

export function createMockProvider() {
  return {
    name: 'mock',
    model: 'mock',
    async complete({ user, signal, n = 1, temperature }) {
      await new Promise((r, j) => {
        const t = setTimeout(r, 120);
        signal?.addEventListener('abort', () => { clearTimeout(t); j(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
      });
      const before = user.split('<CURSOR/>')[0];
      const partial = before.match(/([A-Za-z]+)$/)?.[1];
      if (partial && partial.length >= 2) {
        const words = ['beginning', 'everything', 'morning', 'together', 'remember', 'something', 'however', 'because'];
        const w = words.find((x) => x.startsWith(partial.toLowerCase()) && x.length > partial.length);
        if (w) return { texts: [w.slice(partial.length)] };
      }
      let start = before.length % LINES.length;
      // MOCK_DUPES=1 imitates a model that returns identical candidates, so
      // the server's top-up path can be exercised.
      if (process.env.MOCK_DUPES && n > 1) return { texts: Array(n).fill(LINES[start]) };
      if (temperature >= 1) start = Math.floor(Math.random() * LINES.length);
      return { texts: Array.from({ length: n }, (_, i) => LINES[(start + i) % LINES.length]) };
    },
  };
}
