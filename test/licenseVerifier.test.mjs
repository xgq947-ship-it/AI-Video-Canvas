import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { encodeLicensePayload, signLicensePayload, b64urlEncode } from '../shared/licenseSignature.js';
import { verifyStoredLicense } from '../electron/license/licenseVerifier.js';

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pkcs8Der = new Uint8Array(privateKey.export({ type: 'pkcs8', format: 'der' }));
  const spkiDer = new Uint8Array(publicKey.export({ type: 'spki', format: 'der' }));
  return { pkcs8Der, spkiB64url: b64urlEncode(spkiDer) };
}

const DEVICE_HASH = 'd'.repeat(64);

async function issue(pkcs8Der, overrides = {}) {
  const payload = {
    license_id: 'lic-1',
    user_id: 'user-1',
    device_hash: DEVICE_HASH,
    license_type: 'perpetual',
    features: ['director_workflow'],
    issued_at: 1786000000,
    version: 1,
    ...overrides,
  };
  const payloadB64url = encodeLicensePayload(payload);
  const signature = await signLicensePayload(payloadB64url, pkcs8Der);
  return { payload: payloadB64url, signature };
}

test('签名有效 + device_hash 匹配 → 通过，解出正确 payload', async () => {
  const { pkcs8Der, spkiB64url } = keypair();
  const license = await issue(pkcs8Der);
  const result = await verifyStoredLicense(license, DEVICE_HASH, spkiB64url);
  assert.equal(result.valid, true);
  assert.equal(result.payload.license_id, 'lic-1');
  assert.deepEqual(result.payload.features, ['director_workflow']);
});

test('复制到其他设备：签名有效但 device_hash 不匹配 → 拒绝', async () => {
  const { pkcs8Der, spkiB64url } = keypair();
  const license = await issue(pkcs8Der);
  const result = await verifyStoredLicense(license, 'e'.repeat(64), spkiB64url);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'device_mismatch');
});

test('修改 payload 内容后签名验证失败', async () => {
  const { pkcs8Der, spkiB64url } = keypair();
  const license = await issue(pkcs8Der);
  const tampered = { ...license, payload: license.payload.slice(0, -2) + (license.payload.slice(-2) === 'AA' ? 'BB' : 'AA') };
  const result = await verifyStoredLicense(tampered, DEVICE_HASH, spkiB64url);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'signature_invalid');
});

test('用错误的公钥验证 → 拒绝', async () => {
  const { pkcs8Der } = keypair();
  const other = keypair();
  const license = await issue(pkcs8Der);
  const result = await verifyStoredLicense(license, DEVICE_HASH, other.spkiB64url);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'signature_invalid');
});

test('license_type 不是 perpetual → 拒绝', async () => {
  const { pkcs8Der, spkiB64url } = keypair();
  const license = await issue(pkcs8Der, { license_type: 'trial' });
  const result = await verifyStoredLicense(license, DEVICE_HASH, spkiB64url);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'unsupported_license_type');
});

test('features 不是数组 → 拒绝', async () => {
  const { pkcs8Der, spkiB64url } = keypair();
  const license = await issue(pkcs8Der, { features: 'not-an-array' });
  const result = await verifyStoredLicense(license, DEVICE_HASH, spkiB64url);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'payload_malformed');
});

test('本地缺少 payload 或 signature → 拒绝，不抛错', async () => {
  const { spkiB64url } = keypair();
  assert.equal((await verifyStoredLicense(null, DEVICE_HASH, spkiB64url)).valid, false);
  assert.equal((await verifyStoredLicense({ payload: 'x' }, DEVICE_HASH, spkiB64url)).valid, false);
  assert.equal((await verifyStoredLicense({ signature: 'x' }, DEVICE_HASH, spkiB64url)).valid, false);
});
