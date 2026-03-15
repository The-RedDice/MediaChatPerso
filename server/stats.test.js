const { test, mock } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const stats = require('./stats');

test('saveStats handles writeFileSync errors gracefully', (t) => {
  // Mock console.error to prevent polluting test output and to verify it was called
  const consoleMock = mock.method(console, 'error', () => {});

  // Mock fs.writeFileSync to throw an error
  const fsMock = mock.method(fs, 'writeFileSync', () => {
    throw new Error('Mocked write error');
  });

  // recordAction calls saveStats()
  stats.recordAction('test-user-id', 'test-username', 'message');

  // Verify console.error was called with the expected message
  assert.strictEqual(consoleMock.mock.callCount(), 1);
  assert.match(consoleMock.mock.calls[0].arguments[0], /\[Stats\] Erreur lors de la sauvegarde:/);
  assert.strictEqual(consoleMock.mock.calls[0].arguments[1].message, 'Mocked write error');

  // Restore mocks
  mock.restoreAll();
});
