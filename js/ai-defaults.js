// Magpie local gateway uses a placeholder token, not a provider credential.
export const MAGPIE_BASE_URL = 'http://127.0.0.1:3425/v1';
export function gatewayDefaultKey(baseUrl) { return String(baseUrl).replace(/\/+$/, '') === MAGPIE_BASE_URL ? 'magpie' : ''; }
