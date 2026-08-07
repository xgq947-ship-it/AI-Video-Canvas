import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  encodeLicensePayload,
  decodeLicensePayload,
  signLicensePayload,
  verifyLicenseSignature,
  pemToDer,
} from '../shared/licenseSignature.js';

function throwawayKeypairDer() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pkcs8Der = new Uint8Array(privateKey.export({ type: 'pkcs8', format: 'der' }));
  const spkiDer = new Uint8Array(publicKey.export({ type: 'spki', format: 'der' }));
  return { pkcs8Der, spkiDer };
}

const SAMPLE_PAYLOAD = {
  license_id: 'lic-test-1',
  user_id: 'user-test-1',
  device_hash: 'a'.repeat(64),
  license_type: 'perpetual',
  features: ['director_workflow'],
  issued_at: 1786000000,
  version: 1,
};

test('签发+验签往返成功（同一份 WebCrypto Ed25519 实现，Node 侧即代表 Electron 主进程行为）', async () => {
  const { pkcs8Der, spkiDer } = throwawayKeypairDer();
  const payloadB64url = encodeLicensePayload(SAMPLE_PAYLOAD);
  const signature = await signLicensePayload(payloadB64url, pkcs8Der);

  const ok = await verifyLicenseSignature(payloadB64url, signature, spkiDer);
  assert.equal(ok, true);

  const decoded = decodeLicensePayload(payloadB64url);
  assert.deepEqual(decoded, SAMPLE_PAYLOAD);
});

test('payload 被篡改一个字符 → 验签失败', async () => {
  const { pkcs8Der, spkiDer } = throwawayKeypairDer();
  const payloadB64url = encodeLicensePayload(SAMPLE_PAYLOAD);
  const signature = await signLicensePayload(payloadB64url, pkcs8Der);

  const tampered = payloadB64url.slice(0, -1) + (payloadB64url.at(-1) === 'A' ? 'B' : 'A');
  assert.notEqual(tampered, payloadB64url);
  const ok = await verifyLicenseSignature(tampered, signature, spkiDer);
  assert.equal(ok, false);
});

test('签名被篡改一个字符 → 验签失败', async () => {
  const { pkcs8Der, spkiDer } = throwawayKeypairDer();
  const payloadB64url = encodeLicensePayload(SAMPLE_PAYLOAD);
  const signature = await signLicensePayload(payloadB64url, pkcs8Der);

  // 篡改开头字符，而不是末尾：64 字节签名 base64url 编码后末位字符落在
  // 填充 bit 上（64 不能被 3 整除），翻转末位可能解码出完全相同的字节，
  // 不是有效的"篡改"用例。开头字符必然是数据有效位。
  const tampered = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
  const ok = await verifyLicenseSignature(payloadB64url, tampered, spkiDer);
  assert.equal(ok, false);
});

test('用另一把密钥的公钥验证 → 失败（不同设备/密钥不能互相验签）', async () => {
  const pairA = throwawayKeypairDer();
  const pairB = throwawayKeypairDer();
  const payloadB64url = encodeLicensePayload(SAMPLE_PAYLOAD);
  const signature = await signLicensePayload(payloadB64url, pairA.pkcs8Der);

  const ok = await verifyLicenseSignature(payloadB64url, signature, pairB.spkiDer);
  assert.equal(ok, false);
});

test('复制到「其他设备」场景：payload 里的 device_hash 与当前设备不符——签名仍然有效，但调用方必须额外比对 device_hash 才能拒绝', async () => {
  const { pkcs8Der, spkiDer } = throwawayKeypairDer();
  const payloadB64url = encodeLicensePayload(SAMPLE_PAYLOAD);
  const signature = await signLicensePayload(payloadB64url, pkcs8Der);

  const ok = await verifyLicenseSignature(payloadB64url, signature, spkiDer);
  assert.equal(ok, true, '签名本身依然有效（这是设计使然，验签只证明"服务端确实签过这份 payload"）');

  const decoded = decodeLicensePayload(payloadB64url);
  const otherDeviceHash = 'b'.repeat(64);
  assert.notEqual(decoded.device_hash, otherDeviceHash, '调用方必须自己比对 device_hash，验签本身不做这件事');
});

test('损坏的 base64url 输入不抛错，返回 false', async () => {
  const { spkiDer } = throwawayKeypairDer();
  const ok = await verifyLicenseSignature('not-valid-base64url!!!', 'also-not-valid!!!', spkiDer);
  assert.equal(ok, false);
});

test('pemToDer 提取的 DER 与直接导出的 DER 字节一致', () => {
  const { publicKey } = generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const derFromPem = pemToDer(pem);
  const derDirect = new Uint8Array(publicKey.export({ type: 'spki', format: 'der' }));
  assert.deepEqual(derFromPem, derDirect);
});
