import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateRepo, readExistingSpecs } from '../src/spec-generator.js';

function createTempElixirProject(specs = {}) {
  const dir = join(tmpdir(), `spec-gen-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'mix.exs'), 'defmodule Test.MixProject do\nend\n', 'utf-8');

  for (const [relPath, content] of Object.entries(specs)) {
    const fullPath = join(dir, relPath);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content, 'utf-8');
  }

  return dir;
}

describe('validateRepo', () => {
  it('returns absolute path for a valid Elixir project', () => {
    const dir = createTempElixirProject();
    const result = validateRepo(dir);
    assert.equal(result, dir);
    rmSync(dir, { recursive: true });
  });

  it('throws when repo path does not exist', () => {
    assert.throws(
      () => validateRepo('/nonexistent/path/to/repo'),
      { message: /does not exist/ }
    );
  });

  it('throws when no mix.exs is found', () => {
    const dir = join(tmpdir(), `no-mix-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    assert.throws(
      () => validateRepo(dir),
      { message: /No mix\.exs found/ }
    );
    rmSync(dir, { recursive: true });
  });
});

describe('readExistingSpecs', () => {
  it('reads existing spec files', () => {
    const specContent = '{"openapi": "3.0.0", "info": {"title": "Test", "version": "1.0.0"}, "paths": {}}';
    const dir = createTempElixirProject({
      'priv/docs/api.yaml': specContent,
    });

    const results = readExistingSpecs({
      repoPath: dir,
      specFiles: { 'test-api': 'priv/docs/api.yaml' },
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'test-api');
    assert.equal(results[0].content, specContent);
    rmSync(dir, { recursive: true });
  });

  it('reads multiple spec files', () => {
    const dir = createTempElixirProject({
      'priv/docs/api.yaml': 'spec-a',
      'priv/docs/public.yaml': 'spec-b',
    });

    const results = readExistingSpecs({
      repoPath: dir,
      specFiles: {
        'api': 'priv/docs/api.yaml',
        'public': 'priv/docs/public.yaml',
      },
    });

    assert.equal(results.length, 2);
    rmSync(dir, { recursive: true });
  });

  it('skips missing spec files', () => {
    const dir = createTempElixirProject({
      'priv/docs/api.yaml': 'spec-a',
    });

    const results = readExistingSpecs({
      repoPath: dir,
      specFiles: {
        'api': 'priv/docs/api.yaml',
        'missing': 'priv/docs/missing.yaml',
      },
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'api');
    rmSync(dir, { recursive: true });
  });

  it('throws when no spec files are found at all', () => {
    const dir = createTempElixirProject();

    assert.throws(
      () => readExistingSpecs({
        repoPath: dir,
        specFiles: { 'missing': 'priv/docs/missing.yaml' },
      }),
      { message: /No spec files found/ }
    );
    rmSync(dir, { recursive: true });
  });
});
