/**
 * OpenAPI Spec Generator
 * Runs mix commands against a local Elixir/Phoenix repo to generate OpenAPI specs.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * @typedef {Object} SpecGeneratorConfig
 * @property {string} repoPath - Absolute path to the Elixir repo
 * @property {string[]} mixCommands - Mix commands to run (e.g., ['api_docs', 'public_api_docs'])
 * @property {Object.<string, string>} specFiles - Map of spec name to relative file path in the repo
 */

/**
 * Validate that the repo path exists and looks like an Elixir project.
 */
export function validateRepo(repoPath) {
  const absPath = resolve(repoPath);

  if (!existsSync(absPath)) {
    throw new Error(`Repository path does not exist: ${absPath}`);
  }

  if (!existsSync(join(absPath, 'mix.exs'))) {
    throw new Error(`No mix.exs found at ${absPath}. Is this an Elixir project?`);
  }

  return absPath;
}

/**
 * Run a mix command in the given repo directory.
 * Returns stdout as a string.
 */
export function runMixCommand(repoPath, command, { verbose = false } = {}) {
  const absPath = resolve(repoPath);
  const fullCommand = `mix ${command}`;

  if (verbose) {
    console.log(`  Running: ${fullCommand} (in ${absPath})`);
  }

  try {
    const output = execSync(fullCommand, {
      cwd: absPath,
      encoding: 'utf-8',
      timeout: 120_000, // 2 minute timeout
      env: {
        ...process.env,
        MIX_ENV: 'dev',
      },
      stdio: verbose ? 'inherit' : 'pipe',
    });
    return output;
  } catch (error) {
    throw new Error(
      `Failed to run '${fullCommand}' in ${absPath}:\n${error.stderr || error.message}`
    );
  }
}

/**
 * Generate OpenAPI specs by running the configured mix commands.
 * Returns an array of { name, path, content } for each generated spec.
 */
export function generateSpecs(config) {
  const { repoPath, mixCommands, specFiles } = config;
  const absRepoPath = validateRepo(repoPath);
  const results = [];

  for (const command of mixCommands) {
    console.log(`\n  Running mix ${command}...`);
    try {
      runMixCommand(absRepoPath, command, { verbose: false });
      console.log(`  ✓ mix ${command} completed`);
    } catch (err) {
      console.error(`  ✗ mix ${command} failed: ${err.message}`);
      throw err;
    }
  }

  for (const [name, relPath] of Object.entries(specFiles)) {
    const fullPath = join(absRepoPath, relPath);
    if (!existsSync(fullPath)) {
      throw new Error(`Expected spec file not found: ${fullPath}`);
    }
    const content = readFileSync(fullPath, 'utf-8');
    results.push({ name, path: fullPath, content });
    console.log(`  ✓ Found spec: ${name} (${relPath})`);
  }

  return results;
}

/**
 * Read existing spec files without running mix commands.
 * Useful when specs are already generated.
 */
export function readExistingSpecs(config) {
  const { repoPath, specFiles } = config;
  const absRepoPath = resolve(repoPath);
  const results = [];

  for (const [name, relPath] of Object.entries(specFiles)) {
    const fullPath = join(absRepoPath, relPath);
    if (!existsSync(fullPath)) {
      console.log(`  ⚠ Spec file not found: ${fullPath} — skipping`);
      continue;
    }
    const content = readFileSync(fullPath, 'utf-8');
    results.push({ name, path: fullPath, content });
    console.log(`  ✓ Found existing spec: ${name}`);
  }

  if (results.length === 0) {
    throw new Error('No spec files found. Try running with --generate to create them first.');
  }

  return results;
}
