defmodule ParcelService.MixProject do
  use Mix.Project

  def project do
    [
      app: :parcel_service,
      version: "0.1.0",
      elixir: "~> 1.14",
      deps: deps(),
      aliases: aliases()
    ]
  end

  defp aliases do
    [
      setup: ["deps.get", "ecto.setup"],
      "ecto.setup": ["ecto.create", "ecto.migrate", "run priv/repo/seeds.exs"],
      "ecto.reset": ["ecto.drop", "ecto.setup"],
      test: ["ecto.create --quiet", "ecto.migrate --quiet", "test"],
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

  defp deps do
    [
      {:phoenix, "~> 1.7"},
      {:open_api_spex, "~> 3.16"}
    ]
  end
end
