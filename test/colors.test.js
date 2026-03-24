import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// We need to test with colors enabled, so import directly
// The module checks process.stdout.isTTY and NO_COLOR at import time
import { c, separator, stepHeader } from '../src/colors.js';

describe('colors', () => {
  describe('color functions', () => {
    it('c.bold wraps text (or returns plain if no TTY)', () => {
      const result = c.bold('hello');
      assert.ok(typeof result === 'string');
      assert.ok(result.includes('hello'));
    });

    it('c.dim wraps text', () => {
      const result = c.dim('faded');
      assert.ok(result.includes('faded'));
    });

    it('c.red wraps text', () => {
      const result = c.red('error');
      assert.ok(result.includes('error'));
    });

    it('c.green wraps text', () => {
      const result = c.green('success');
      assert.ok(result.includes('success'));
    });

    it('c.yellow wraps text', () => {
      const result = c.yellow('warning');
      assert.ok(result.includes('warning'));
    });

    it('c.cyan wraps text', () => {
      const result = c.cyan('info');
      assert.ok(result.includes('info'));
    });

    it('c.blue wraps text', () => {
      const result = c.blue('blue');
      assert.ok(result.includes('blue'));
    });

    it('c.magenta wraps text', () => {
      const result = c.magenta('magenta');
      assert.ok(result.includes('magenta'));
    });

    it('c.white wraps text', () => {
      const result = c.white('white');
      assert.ok(result.includes('white'));
    });

    it('c.gray wraps text', () => {
      const result = c.gray('gray');
      assert.ok(result.includes('gray'));
    });

    it('c.italic wraps text', () => {
      const result = c.italic('italic');
      assert.ok(result.includes('italic'));
    });

    it('c.underline wraps text', () => {
      const result = c.underline('underline');
      assert.ok(result.includes('underline'));
    });

    it('supports nesting colors', () => {
      const result = c.bold(c.cyan('nested'));
      assert.ok(result.includes('nested'));
    });
  });

  describe('separator', () => {
    it('is a function', () => {
      assert.equal(typeof separator, 'function');
    });

    // separator() outputs to console.log, so we just verify it doesn't throw
    it('does not throw', () => {
      assert.doesNotThrow(() => separator());
    });
  });

  describe('stepHeader', () => {
    it('is a function', () => {
      assert.equal(typeof stepHeader, 'function');
    });

    it('does not throw', () => {
      assert.doesNotThrow(() => stepHeader('Step 1', 'Test'));
    });
  });
});
