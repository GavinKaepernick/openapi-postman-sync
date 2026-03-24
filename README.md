# generate_postman_collection

Generate Postman collections from Elixir Phoenix OpenAPI specs. Auto-detects spec configuration from `mix.exs`, converts to Postman Collection v2.1, applies customizations, and generates environment files.

Built for Stord services using `open_api_spex`.

## What it does

1. **Auto-detects specs from mix.exs** — Finds `openapi.spec.yaml` aliases, their output paths, and spec modules automatically
2. **Generates OpenAPI specs** — Runs the detected `mix` commands against a local Elixir repo
3. **Converts to Postman** — Transforms OpenAPI YAML/JSON into Postman Collection v2.1 (handles `$ref`, `allOf`/`oneOf`/`anyOf`, path-level params)
4. **Customizes the collection** — Disables query params by default, sorts alphabetically, adds auth, deduplicates request names, excludes paths
5. **Creates environment files** — Generates Postman environments for whichever environments you select (local, staging, production)

## Prerequisites

- Node.js >= 18
- Access to the Elixir project repo you want to generate collections for

## Quick start

```bash
cd openapi-postman-sync

# Install dependencies
npm install

# Run the interactive wizard
npm start
```

The wizard will walk you through:
1. Pointing to your Elixir project (e.g., `../parcel-service`)
2. Auto-detecting OpenAPI spec aliases from `mix.exs`
3. Choosing which specs to convert
4. Setting a collection name, auth type, and path exclusions
5. Adding collection variables (e.g., `organizationId`, `apiVersion`)
6. Selecting which environments to generate and entering base URLs

After the first run, your configuration is saved to `configs/<repo-name>.json` for reuse.

## Using a saved config

Once you've run the wizard and a config is saved, skip the interactive setup:

```bash
# Generate fresh specs and convert
npm run generate:config parcel-service

# Skip spec generation (use existing spec files)
npm start -- --config parcel-service --no-generate
```

## CLI options

```
npm start                                  # Interactive wizard
npm run help                               # Show help
npm run generate:config <name>             # Use a saved config
npm start -- --config <name> --no-generate # Skip spec generation

All options (via npm start -- [options]):
  --config, -c <name>    Use a saved config from configs/ directory
  --repo, -r <path>      Path to Elixir project (non-interactive mode)
  --no-generate          Skip OpenAPI spec generation (use existing files)
  --non-interactive      Run without interactive prompts (requires --config)
  --verbose, -v          Show detailed output
  --help, -h             Show help message
```

## Output structure

Generated files are organized by service under `collections/` and `environments/`:

```
openapi-postman-sync/
├── src/
│   ├── index.js           # Main pipeline orchestration
│   ├── cli.js             # Interactive CLI wizard
│   ├── spec-generator.js  # Runs mix commands to generate OpenAPI specs
│   ├── converter.js       # OpenAPI → Postman conversion (with $ref resolution)
│   ├── customizer.js      # Collection modifications (sort, dedup, auth, etc.)
│   ├── mix-parser.js      # Auto-detects spec aliases from mix.exs
│   └── yaml-parser.js     # YAML parsing with fallback chain
├── configs/
│   └── parcel-service.json
├── collections/
│   └── parcel-service/
│       ├── parcel-service.postman_collection.json
│       └── parcel-service-public-api-docs.postman_collection.json
├── environments/
│   └── parcel-service/
│       ├── parcel-service_local.postman_environment.json
│       ├── parcel-service_staging.postman_environment.json
│       └── parcel-service_prod.postman_environment.json
└── .github/workflows/
    └── generate-postman.yaml
```

## Testing

```bash
# Run the full test suite
npm test

# Run tests with coverage report
npm run test:coverage

# Run a specific test file
node --test test/customizer.test.js
```

## Importing into Postman

1. Open Postman → **Import** → **Upload Files**
2. Select collection files from `collections/<service>/`
3. Select environment files from `environments/<service>/`
4. Choose the environment from the dropdown in the top-right of Postman

## Adding a new repo

The easiest way is to run the interactive wizard and point it at the new repo:

```bash
npm start
# Enter the path to your Elixir project when prompted
```

The wizard auto-detects everything from `mix.exs` and saves a config file when finished. You can also create a config manually at `configs/<repo-name>.json`:

```json
{
  "repoName": "my-service",
  "relativeRepoPath": "../my-service",
  "specFiles": {
    "my-service": "priv/documentation/api.yaml"
  },
  "mixCommands": ["api_docs"],
  "environments": {
    "local": { "name": "Local", "baseUrl": "http://localhost:4000" },
    "staging": { "name": "Staging", "baseUrl": "https://api.staging.my-service.stord.com" }
  },
  "customization": {
    "collectionName": "My Service API",
    "disableQueryParams": true,
    "sortByName": true,
    "auth": { "type": "bearer", "tokenVariable": "bearerToken" },
    "headerDefaults": { "Accept": "application/json" },
    "excludePaths": ["/docs/*", "/internal/*", "/webhooks/*"]
  }
}
```

Then run: `npm run generate:config my-service`

## Customization options

| Option | Default | Description |
|--------|---------|-------------|
| `collectionName` | from mix.exs | Override the Postman collection name |
| `disableQueryParams` | `true` | Turn off all query params by default |
| `sortByName` | `true` | Sort folders and requests alphabetically |
| `auth.type` | — | Collection-level auth: `bearer`, `apikey`, `basic` |
| `headerDefaults` | — | Default headers added to all requests |
| `excludePaths` | `["/docs/*", "/internal/*", "/webhooks/*"]` | Path patterns to exclude (supports `*` wildcard) |
| `excludeTags` | `[]` | Tags/folders to remove from output |
| `folderOverrides` | `{}` | Rename folders: `{"OldName": "NewName"}` |
| `additionalVariables` | `[]` | Extra collection variables |

## Request name deduplication

When multiple requests in the same folder share both a name and HTTP method (e.g., two GET "List Parcels" from different path prefixes), the tool disambiguates them by appending a path hint. Requests with different methods (e.g., PUT and PATCH "Update Carrier") are left as-is since Postman already shows the method badge next to each request.

- `List Parcels` (GET `/v1/parcels`) → `List Parcels (/v1/parcels)`
- `List Parcels` (GET `/public/v1/parcels`) → `List Parcels (/public/v1/parcels)`

## CI/CD

The included GitHub Actions workflow can be triggered manually or via `repository_dispatch`. It checks out the target repo, generates specs, converts them, and uploads the Postman files as artifacts.

To trigger from another repo's CI:

```yaml
- name: Generate Postman collection
  uses: peter-evans/repository-dispatch@v3
  with:
    token: ${{ secrets.GH_PERSONAL_ACCESS_TOKEN }}
    repository: stordco/openapi-postman-sync
    event-type: generate-postman
    client-payload: '{"repo": "parcel-service"}'
```
