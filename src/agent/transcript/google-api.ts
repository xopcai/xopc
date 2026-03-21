/**
 * Google API detection (adapted from OpenClaw pi-embedded-runner/google.ts, MIT).
 */

export function isGoogleModelApi(api?: string | null): boolean {
  return (
    api === "google-gemini-cli" ||
    api === "google-generative-ai" ||
    api === "google-vertex"
  );
}
