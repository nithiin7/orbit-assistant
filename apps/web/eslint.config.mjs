import nextConfig from "@orbit/eslint-config/next";

/** Lower layers never import higher ones (see docs/architecture.md#dependency-boundaries). */
function layerRule(files, forbidden) {
  return {
    files,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: forbidden.map((layer) => ({
            group: [`@/${layer}`, `@/${layer}/*`],
            message: `This layer must not depend on src/${layer}.`,
          })),
        },
      ],
    },
  };
}

/** @type {import("eslint").Linter.Config[]} */
const config = [
  ...nextConfig,
  layerRule(["src/api/**", "src/lib/**"], ["components", "hooks", "providers"]),
  layerRule(["src/providers/**"], ["components", "hooks"]),
  layerRule(["src/hooks/**"], ["components"]),
];

export default config;
