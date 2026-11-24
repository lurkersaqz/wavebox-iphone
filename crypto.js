export const curve = { name: 'ECDH', namedCurve: 'P-256' };

export function encode(bytes) {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 8192) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decode(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('Invalid base64url');
  return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
}

export async function fingerprint(publicBytes) {
  return encode(new Uint8Array(await crypto.subtle.digest('SHA-256', publicBytes)));
}

export async function releaseKey(privateKey, partnerBytes, salt, usage) {
  const partnerKey = await crypto.subtle.importKey('raw', partnerBytes, curve, false, []);
  const sharedSecret = await crypto.subtle.deriveBits({ name: 'ECDH', public: partnerKey }, privateKey, 256);
  const material = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({
    name: 'HKDF', hash: 'SHA-256', salt,
    info: new TextEncoder().encode('Wavebox Free GitHub Pages v1'),
  }, material, { name: 'AES-GCM', length: 256 }, false, [usage]);
}
