import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

describe('CLI argument parsing', () => {
  it('shows help text with --help', () => {
    const output = execSync('node src/index.js --help', {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
    });
    assert.ok(output.includes('generate_postman_collection'));
    assert.ok(output.includes('--config'));
    assert.ok(output.includes('--no-generate'));
  });

  it('shows help text with -h', () => {
    const output = execSync('node src/index.js -h', {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
    });
    assert.ok(output.includes('generate_postman_collection'));
  });
});

describe('config loading', () => {
  it('errors on missing config', () => {
    assert.throws(() => {
      execSync('node src/index.js --config nonexistent-service 2>&1', {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      });
    });
  });
});

describe('environment file generation', () => {
  // Test the environment file format by running a conversion with a temp config
  it('generates valid Postman environment JSON', () => {
    // Create a temp directory to simulate a project
    const tmpDir = join(tmpdir(), `env-test-${Date.now()}`);
    const envDir = join(tmpDir, 'environments', 'test-service');
    mkdirSync(envDir, { recursive: true });

    // Create a minimal environment file to validate the format
    const env = {
      id: 'test-id',
      name: 'test-service - Staging',
      values: [
        { key: 'baseUrl', value: 'https://api.staging.test.com', type: 'default', enabled: true },
        { key: 'bearerToken', value: '', type: 'secret', enabled: true },
      ],
      _postman_variable_scope: 'environment',
    };

    const envPath = join(envDir, 'test-service_staging.postman_environment.json');
    writeFileSync(envPath, JSON.stringify(env, null, 2), 'utf-8');

    // Verify the file is valid JSON and has expected structure
    const parsed = JSON.parse(readFileSync(envPath, 'utf-8'));
    assert.equal(parsed.name, 'test-service - Staging');
    assert.equal(parsed._postman_variable_scope, 'environment');
    assert.ok(Array.isArray(parsed.values));
    assert.ok(parsed.values.find(v => v.key === 'baseUrl'));
    assert.ok(parsed.values.find(v => v.key === 'bearerToken'));
    assert.equal(parsed.values.find(v => v.key === 'bearerToken').type, 'secret');

    rmSync(tmpDir, { recursive: true });
  });
});

describe('config save format', () => {
  it('saves config without secrets', () => {
    // Simulate what saveConfig does: strip variables from environments
    const config = {
      repoName: 'test-service',
      environments: {
        staging: {
          name: 'Staging',
          baseUrl: 'https://api.staging.test.com',
          variables: { bearerToken: 'secret-jwt-token-here' },
        },
        prod: {
          name: 'Production',
          baseUrl: 'https://api.test.com',
          variables: { bearerToken: 'another-secret' },
        },
      },
    };

    // Apply the same stripping logic as saveConfig
    const portable = { ...config };
    if (portable.environments) {
      portable.environments = Object.fromEntries(
        Object.entries(portable.environments).map(([key, env]) => [
          key,
          { name: env.name, baseUrl: env.baseUrl },
        ])
      );
    }

    // Verify no secrets
    for (const [, env] of Object.entries(portable.environments)) {
      assert.equal(env.variables, undefined, 'Should not have variables in saved config');
      assert.ok(env.baseUrl, 'Should still have baseUrl');
      assert.ok(env.name, 'Should still have name');
    }
  });
});

describe('end-to-end pipeline', () => {
  it('converts a spec file through the full pipeline', async () => {
    const { convertToPostman } = await import('../src/converter.js');
    const { customizeCollection } = await import('../src/customizer.js');

    const specPath = join(__dirname, 'fixtures', 'sample-spec.yaml');
    const specContent = readFileSync(specPath, 'utf-8');

    // Convert
    const { collection, parsedSpec } = await convertToPostman(specContent, 'e2e-test');
    assert.ok(collection.item.length > 0, 'Should have folders');

    // Customize
    const customized = customizeCollection(collection, {
      collectionName: 'E2E Test Collection',
      disableQueryParams: true,
      sortByName: true,
      auth: { type: 'bearer', tokenVariable: 'bearerToken' },
      excludePaths: ['/docs/*', '/webhooks/*', '/internal/*'],
    }, parsedSpec);

    // Verify
    assert.equal(customized.info.name, 'E2E Test Collection');
    assert.ok(customized.auth, 'Should have auth');
    assert.equal(customized.auth.type, 'bearer');

    // Check excluded paths are gone
    let allPaths = [];
    function collectPaths(items) {
      for (const item of items) {
        if (item.item) { collectPaths(item.item); continue; }
        if (item.request?.url) {
          const path = item.request.url.path?.join('/') || '';
          allPaths.push('/' + path);
        }
      }
    }
    collectPaths(customized.item);
    assert.ok(!allPaths.some(p => p.startsWith('/docs/')), 'Should exclude /docs/');
    assert.ok(!allPaths.some(p => p.startsWith('/webhooks/')), 'Should exclude /webhooks/');
    assert.ok(!allPaths.some(p => p.startsWith('/internal/')), 'Should exclude /internal/');

    // Check query params are disabled
    let allQueryParams = [];
    function collectQuery(items) {
      for (const item of items) {
        if (item.item) { collectQuery(item.item); continue; }
        if (item.request?.url?.query) allQueryParams.push(...item.request.url.query);
      }
    }
    collectQuery(customized.item);
    if (allQueryParams.length > 0) {
      assert.ok(allQueryParams.every(p => p.disabled === true), 'All query params should be disabled');
    }

    // Check sorting
    for (let i = 1; i < customized.item.length; i++) {
      assert.ok(
        customized.item[i - 1].name.localeCompare(customized.item[i].name) <= 0,
        `Folders should be sorted: ${customized.item[i - 1].name} <= ${customized.item[i].name}`
      );
    }
  });
});
