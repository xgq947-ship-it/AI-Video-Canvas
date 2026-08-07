export function encodeLicensePayload(payload: object): string;

export function decodeLicensePayload(payloadB64url: string): Record<string, unknown>;

export function signLicensePayload(
  payloadB64url: string,
  pkcs8Der: Uint8Array
): Promise<string>;

export function verifyLicenseSignature(
  payloadB64url: string,
  signatureB64url: string,
  spkiDer: Uint8Array
): Promise<boolean>;

export function pemToDer(pem: string): Uint8Array;

export function b64urlEncode(bytes: Uint8Array): string;
export function b64urlDecode(s: string): Uint8Array;
