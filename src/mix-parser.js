/**
 * Mix.exs Parser
 *
 * Reads a Phoenix project's mix.exs to auto-detect:
 * - Mix aliases that generate OpenAPI specs (openapi.spec.yaml commands)
 * - The --filename flag to find where specs are written
 * - The --spec flag to identify which spec module is used
 * - The project name from the :app field
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

/**
 * @typedef {Object} DetectedSpec
 * @property {string} aliasName - The mix alias name (e.g., "api_docs")
 * @property {string} mixCommand - The full mix command string
 * @property {string} specModule - The spec module (e.g., "ParcelServiceWeb.ApiSpec")
 * @property {string} outputPath - Relative path where the spec YAML is written
 * @property {string} label - Human-readable label derived from alias name
 */

/**
 * @typedef {Object} MixExsInfo
 * @property {string} appName - The OTP app name (e.g., "parcel_service")
 * @property {string} projectName - Human-readable project name
 * @property {DetectedSpec[]} specs - Detected OpenAPI spec generation aliases
 * @property {string} repoPath - Absolute path to the repo
 */

/**
 * Parse a mix.exs file and extract OpenAPI-related information.
 * @param {string} repoPath - Path to the Elixir project root
 * @returns {MixExsInfo}
 */
export function parseMixExs(repoPath) {
  const absPath = resolve(repoPath);
  const mixPath = join(absPath, 'mix.exs');

  if (!existsSync(mixPath)) {
    throw new Error(`No mix.exs found at ${absPath}. Is this an Elixir project?`);
  }

  const content = readFileSync(mixPath, 'utf-8');

  const appName = extractAppName(content);
  const specs = extractOpenApiAliases(content);

  return {
    appName: appName || basename(absPath),
    projectName: formatProjectName(appName || basename(absPath)),
    specs,
    repoPath: absPath,
  };
}

/**
 * Extract the :app name from the mix.exs project/0 function.
 * Looks for patterns like `app: :parcel_service`
 */
function extractAppName(content) {
  // Match `app: :some_name`
  const appMatch = content.match(/app:\s*:(\w+)/);
  if (appMatch) return appMatch[1];

  // Fallback: match module name `defmodule SomeName.MixProject`
  const moduleMatch = content.match(/defmodule\s+([\w.]+)\.MixProject/);
  if (moduleMatch) {
    return moduleMatch[1]
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '')
      .replace(/\._/g, '_');
  }

  return null;
}

/**
 * Extract all mix aliases that invoke openapi.spec.yaml.
 * Parses the aliases/0 function to find spec generation commands.
 *
 * Strategy: find every line containing an openapi.spec.yaml command string,
 * then look backwards through the alias block to find the alias name.
 * This avoids issues with nested brackets in fn blocks of other aliases.
 */
function extractOpenApiAliases(content) {
  const specs = [];

  // Find the aliases block. Use greedy match + anchor the closing `end` to
  // column 2-4 indentation so we skip `end` keywords inside fn bodies.
  const aliasBlockMatch = content.match(/defp\s+aliases\s+do\s*\n([\s\S]*?)\n\s{2,4}end\b/);
  if (!aliasBlockMatch) return specs;

  const aliasBlock = aliasBlockMatch[1];
  const lines = aliasBlock.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Look for lines containing an openapi.spec.yaml command string
    const cmdMatch = line.match(/"(openapi\.spec\.yaml[^"]*)"/);
    if (!cmdMatch) continue;

    const fullCommand = cmdMatch[1];

    // Extract --filename
    const filenameMatch = fullCommand.match(/--filename\s+(\S+)/);
    const outputPath = filenameMatch ? filenameMatch[1] : null;

    // Extract --spec
    const specMatch = fullCommand.match(/--spec\s+(\S+)/);
    const specModule = specMatch ? specMatch[1] : null;

    // Look backwards to find the alias name (the `name: [` line)
    let aliasName = null;
    for (let j = i; j >= 0; j--) {
      const prevLine = lines[j].trim();
      // Match `alias_name: [` or `"alias.name": [`
      const nameMatch = prevLine.match(/^"?([\w.]+)"?\s*:\s*\[/);
      if (nameMatch) {
        aliasName = nameMatch[1];
        break;
      }
    }

    if (aliasName && outputPath) {
      // Avoid duplicates (in case an alias has multiple openapi commands)
      if (!specs.find(s => s.aliasName === aliasName)) {
        specs.push({
          aliasName,
          mixCommand: aliasName,
          specModule,
          outputPath,
          label: formatAliasLabel(aliasName),
        });
      }
    }
  }

  return specs;
}

/**
 * Convert an app name like "parcel_service" to "Parcel Service"
 */
function formatProjectName(appName) {
  return appName
    .split(/[_-]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Convert an alias name like "api_docs" or "public_api_docs" to a readable label.
 */
function formatAliasLabel(aliasName) {
  return aliasName
    .split(/[_-]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Print a summary of detected specs for the user.
 */
export function printDetectedInfo(info) {
  console.log(`\n  Project:  ${info.projectName} (${info.appName})`);
  console.log(`  Repo:     ${info.repoPath}`);

  if (info.specs.length === 0) {
    console.log(`\n  ⚠ No OpenAPI spec aliases found in mix.exs`);
    console.log(`    Expected aliases using "openapi.spec.yaml" with --filename flag`);
    return;
  }

  console.log(`\n  Detected ${info.specs.length} OpenAPI spec alias(es):\n`);
  for (const spec of info.specs) {
    console.log(`    ✓ mix ${spec.aliasName}`);
    console.log(`      Module:  ${spec.specModule || '(not specified)'}`);
    console.log(`      Output:  ${spec.outputPath}`);
    console.log('');
  }
}
