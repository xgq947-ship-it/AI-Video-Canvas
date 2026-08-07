export const DEVICE_HASH_NAMESPACE: string;

export function computeDeviceHash(
  installationId: string,
  deviceSecret: string,
  namespace?: string
): string;

export function hashInstallationId(installationId: string): string;
