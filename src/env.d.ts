declare module "*.css" {}

/**
 * Injected by https://tally.so/widgets/embed.js. The loader exposes
 * `loadEmbeds` but never calls it itself — see src/mcp-app.ts.
 */
interface Window {
  Tally?: {
    loadEmbeds: () => void;
  };
}
