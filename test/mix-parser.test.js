import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMixExs } from '../src/mix-parser.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function createTempProject(mixContent) {
  const dir = join(tmpdir(), `mix-parser-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'mix.exs'), mixContent, 'utf-8');
  return dir;
}

describe('parseMixExs', () => {
  describe('app name extraction', () => {
    it('extracts app name from app: :name pattern', () => {
      const dir = createTempProject(`
defmodule MyApp.MixProject do
  use Mix.Project

  def project do
    [
      app: :my_cool_app,
      version: "0.1.0"
    ]
  end

  defp aliases do
    []
  end
end
`);
      const result = parseMixExs(dir);
      assert.equal(result.appName, 'my_cool_app');
      assert.equal(result.projectName, 'My Cool App');
      rmSync(dir, { recursive: true });
    });

    it('falls back to module name when app: is missing', () => {
      const dir = createTempProject(`
defmodule ParcelService.MixProject do
  use Mix.Project

  def project do
    [
      version: "0.1.0"
    ]
  end

  defp aliases do
    []
  end
end
`);
      const result = parseMixExs(dir);
      assert.equal(result.appName, 'parcel_service');
      rmSync(dir, { recursive: true });
    });
  });

  describe('OpenAPI alias detection', () => {
    it('detects a single openapi alias', () => {
      const dir = createTempProject(`
defmodule MyApp.MixProject do
  use Mix.Project

  def project do
    [app: :my_app]
  end

  defp aliases do
    [
      api_docs: [
        "openapi.spec.yaml --filename priv/docs/api.yaml --spec MyAppWeb.ApiSpec"
      ]
    ]
  end
end
`);
      const result = parseMixExs(dir);
      assert.equal(result.specs.length, 1);
      assert.equal(result.specs[0].aliasName, 'api_docs');
      assert.equal(result.specs[0].outputPath, 'priv/docs/api.yaml');
      assert.equal(result.specs[0].specModule, 'MyAppWeb.ApiSpec');
      assert.equal(result.specs[0].label, 'Api Docs');
      rmSync(dir, { recursive: true });
    });

    it('detects multiple openapi aliases', () => {
      const dir = createTempProject(`
defmodule MyApp.MixProject do
  use Mix.Project

  def project do
    [app: :my_app]
  end

  defp aliases do
    [
      setup: ["deps.get", "ecto.setup"],
      api_docs: [
        "cmd echo 'generating'",
        "openapi.spec.yaml --filename priv/docs/api.yaml --spec MyAppWeb.ApiSpec"
      ],
      public_api_docs: [
        "openapi.spec.yaml --filename priv/docs/public.yaml --spec MyAppWeb.PublicSpec"
      ]
    ]
  end
end
`);
      const result = parseMixExs(dir);
      assert.equal(result.specs.length, 2);
      assert.equal(result.specs[0].aliasName, 'api_docs');
      assert.equal(result.specs[0].outputPath, 'priv/docs/api.yaml');
      assert.equal(result.specs[1].aliasName, 'public_api_docs');
      assert.equal(result.specs[1].outputPath, 'priv/docs/public.yaml');
      rmSync(dir, { recursive: true });
    });

    it('returns empty specs when no openapi aliases exist', () => {
      const dir = createTempProject(`
defmodule MyApp.MixProject do
  use Mix.Project

  def project do
    [app: :my_app]
  end

  defp aliases do
    [
      setup: ["deps.get"],
      test: ["ecto.create --quiet", "test"]
    ]
  end
end
`);
      const result = parseMixExs(dir);
      assert.equal(result.specs.length, 0);
      rmSync(dir, { recursive: true });
    });

    it('handles aliases with fn blocks without false matching end', () => {
      const dir = createTempProject(`
defmodule MyApp.MixProject do
  use Mix.Project

  def project do
    [app: :my_app]
  end

  defp aliases do
    [
      setup: ["deps.get"],
      "ecto.setup": [
        fn _ -> Mix.shell().cmd("echo done") end
      ],
      api_docs: [
        "openapi.spec.yaml --filename priv/docs/api.yaml --spec MyAppWeb.ApiSpec"
      ]
    ]
  end
end
`);
      const result = parseMixExs(dir);
      assert.equal(result.specs.length, 1);
      assert.equal(result.specs[0].aliasName, 'api_docs');
      rmSync(dir, { recursive: true });
    });
  });

  describe('error handling', () => {
    it('throws when mix.exs does not exist', () => {
      assert.throws(
        () => parseMixExs('/nonexistent/path'),
        { message: /No mix\.exs found/ }
      );
    });

    it('returns empty specs when aliases block is missing', () => {
      const dir = createTempProject(`
defmodule MyApp.MixProject do
  use Mix.Project

  def project do
    [app: :my_app]
  end
end
`);
      const result = parseMixExs(dir);
      assert.equal(result.specs.length, 0);
      rmSync(dir, { recursive: true });
    });
  });

  describe('with real fixture', () => {
    it('parses the sample mix.exs fixture', () => {
      const fixturePath = join(
        new URL('.', import.meta.url).pathname,
        'fixtures'
      );
      // Create a temp dir with the fixture content
      const content = `
defmodule ParcelService.MixProject do
  use Mix.Project

  def project do
    [
      app: :parcel_service,
      version: "0.1.0"
    ]
  end

  defp aliases do
    [
      setup: ["deps.get", "ecto.setup"],
      api_docs: [
        "cmd echo 'Generating api docs...'",
        "openapi.spec.yaml --filename priv/documentation/parcel.open-api.yaml --spec ParcelServiceWeb.ApiSpec"
      ],
      public_api_docs: [
        "cmd echo 'Generating public api docs...'",
        "openapi.spec.yaml --filename priv/documentation/parcel-public.open-api.yaml --spec ParcelServiceWeb.PublicApiSpec"
      ]
    ]
  end
end
`;
      const dir = createTempProject(content);
      const result = parseMixExs(dir);
      assert.equal(result.appName, 'parcel_service');
      assert.equal(result.projectName, 'Parcel Service');
      assert.equal(result.specs.length, 2);
      assert.equal(result.specs[0].outputPath, 'priv/documentation/parcel.open-api.yaml');
      assert.equal(result.specs[1].specModule, 'ParcelServiceWeb.PublicApiSpec');
      rmSync(dir, { recursive: true });
    });
  });
});
