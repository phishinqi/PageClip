// Publisher-owned release policy. Public client identifiers are not credentials.
// Desktop loopback is a feasibility experiment, NOT verified release support.
export const GOOGLE_AUTH_POLICY = Object.freeze({
  desktopExperiment: true, // Packaging replaces this with false and verifies it.
  verifiedReleaseBrowsers: [], // No complete real-account release acceptance yet.
});
