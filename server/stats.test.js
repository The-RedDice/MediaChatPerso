const { test, mock } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const stats = require('./stats');

test('saveStats handles writeFileSync errors gracefully', (t) => {
  // Mock console.error to prevent polluting test output and to verify it was called
  const consoleMock = mock.method(console, 'error', () => {});

  // Mock fs.writeFile to throw an error
  const fsMock = mock.method(fs, 'writeFile', (path, data, cb) => {
    cb(new Error('Mocked write error'));
  });

  // Since saveStats is debounced using setTimeout(..., 1000), we need to override setTimeout
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (cb) => { cb(); return 1; };

  // recordAction calls saveStats()
  stats.recordAction('test-user-id', 'test-username', 'message');

  // Verify console.error was called with the expected message
  assert.strictEqual(consoleMock.mock.callCount(), 1);
  assert.match(consoleMock.mock.calls[0].arguments[0], /\[Stats\] Erreur lors de la sauvegarde:/);
  assert.strictEqual(consoleMock.mock.calls[0].arguments[1].message, 'Mocked write error');

  // Restore mocks
  mock.restoreAll();
  global.setTimeout = originalSetTimeout;
});
