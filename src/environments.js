/**
 * Postman Environment Manager
 *
 * Generates Postman environment files for different deployment targets
 * (local, staging, production) based on per-repo configuration.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {Object} EnvironmentDef
 * @property {string} name - Environment name (e.g., "Local", "Staging", "Production")
 * @property {Object.<string, string>} values - Key-value pairs for environment variables
 */

/**
 * Load environment definitions from a directory.
 * Expects JSON files named: local.json, staging.json, prod.json, etc.
 * @param {string} envDir - Path to the environments directory
 * @returns {EnvironmentDef[]}
 */
export function loadEnvironments(envDir) {
  const environments = [];
  const envFiles = ['local', 'staging', 'prod'];

  for (const envName of envFiles) {
    const filePath = join(envDir, `${envName}.json`);
    if (existsSync(filePath)) {
      try {
        const content = JSON.parse(readFileSync(filePath, 'utf-8'));
        environments.push({
          name: content.name || envName,
          values: content.values || {},
        });
      } catch (err) {
        console.warn(`  ⚠ Failed to parse ${filePath}: ${err.message}`);
      }
    }
  }

  return environments;
}

/**
 * Generate a Postman environment JSON object.
 * @param {string} repoName - Name of the repo (used in env naming)
 * @param {EnvironmentDef} envDef - Environment definition
 * @returns {Object} - Postman Environment v2 object
 */
export function generatePostmanEnvironment(repoName, envDef) {
  const values = Object.entries(envDef.values).map(([key, value]) => ({
    key,
    value,
    type: 'default',
    enabled: true,
  }));

  return {
    id: generateId(),
    name: `${repoName} - ${envDef.name}`,
    values,
    _postman_variable_scope: 'environment',
    _postman_exported_at: new Date().toISOString(),
    _postman_exported_using: 'openapi-postman-sync',
  };
}

/**
 * Save a Postman environment to a JSON file.
 * @param {Object} environment - Postman environment object
 * @param {string} outputDir - Directory to save to
 * @param {string} filename - Output filename
 * @returns {string} - Path to the saved file
 */
export function saveEnvironment(environment, outputDir, filename) {
  const outputPath = join(outputDir, filename);
  writeFileSync(outputPath, JSON.stringify(environment, null, 2), 'utf-8');
  return outputPath;
}

/**
 * Generate all Postman environments for a repo config.
 * @param {string} repoName - Name of the repo
 * @param {string} envDir - Path to environment definitions
 * @param {string} outputDir - Path to save generated environments
 * @returns {string[]} - Paths to generated files
 */
export function generateAllEnvironments(repoName, envDir, outputDir) {
  const environments = loadEnvironments(envDir);
  const savedPaths = [];

  if (environments.length === 0) {
    console.log('  ⚠ No environment files found. Creating defaults...');
    const defaults = getDefaultEnvironments();
    for (const envDef of defaults) {
      const env = generatePostmanEnvironment(repoName, envDef);
      const filename = `${repoName}_${envDef.name.toLowerCase().replace(/\s+/g, '_')}.postman_environment.json`;
      const path = saveEnvironment(env, outputDir, filename);
      savedPaths.push(path);
      console.log(`  ✓ Created default environment: ${filename}`);
    }
    return savedPaths;
  }

  for (const envDef of environments) {
    const env = generatePostmanEnvironment(repoName, envDef);
    const filename = `${repoName}_${envDef.name.toLowerCase().replace(/\s+/g, '_')}.postman_environment.json`;
    const path = saveEnvironment(env, outputDir, filename);
    savedPaths.push(path);
    console.log(`  ✓ Generated environment: ${filename}`);
  }

  return savedPaths;
}

/**
 * Get default environment definitions when none are configured.
 */
function getDefaultEnvironments() {
  return [
    {
      name: 'Local',
      values: {
        baseUrl: 'http://localhost:4000',
      },
    },
    {
      name: 'Staging',
      values: {
        baseUrl: 'https://api-staging.example.com',
      },
    },
    {
      name: 'Production',
      values: {
        baseUrl: 'https://api.example.com',
      },
    },
  ];
}

/**
 * Generate a simple UUID-like identifier.
 */
function generateId() {
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  const segment = (len) => Array.from({ length: len }, hex).join('');
  return `${segment(8)}-${segment(4)}-${segment(4)}-${segment(4)}-${segment(12)}`;
}
