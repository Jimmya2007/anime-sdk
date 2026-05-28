const crypto = require('crypto');

async function test() {
  const allAnimeKeyPhrase = "Xot36i3lK3:v1";
  
  // Node crypto key
  const nodeKey = crypto.createHash('sha256').update(allAnimeKeyPhrase).digest();
  
  // Web crypto key
  const webCrypto = globalThis.crypto;
  const keyBytes = new TextEncoder().encode(allAnimeKeyPhrase);
  const hashBuffer = await webCrypto.subtle.digest('SHA-256', keyBytes);
  const webKey = new Uint8Array(hashBuffer);

  console.log("Keys match:", Buffer.from(webKey).toString('hex') === nodeKey.toString('hex'));

  // Let's create dummy nonce and ciphertext
  const nonce = crypto.randomBytes(12);
  const ciphertext = crypto.randomBytes(100);

  // Decrypt using node crypto
  const nodeIv = Buffer.alloc(16);
  nonce.copy(nodeIv, 0);
  nodeIv.writeUInt32BE(2, 12);

  const decipher = crypto.createDecipheriv('aes-256-ctr', nodeKey, nodeIv);
  let decryptedNode = decipher.update(ciphertext);
  decryptedNode = Buffer.concat([decryptedNode, decipher.final()]);

  // Decrypt using Web Crypto
  const webIv = new Uint8Array(16);
  webIv.set(nonce, 0);
  // Set counter BE 2 at index 12-15
  const view = new DataView(webIv.buffer);
  view.setUint32(12, 2, false); // false for big-endian

  const importedKey = await webCrypto.subtle.importKey(
    'raw',
    webKey,
    { name: 'AES-CTR' },
    false,
    ['decrypt']
  );

  const decryptedWebBuffer = await webCrypto.subtle.decrypt(
    { name: 'AES-CTR', counter: webIv, length: 64 },
    importedKey,
    ciphertext
  );
  const decryptedWeb = Buffer.from(decryptedWebBuffer);

  console.log("Decrypted match (length=64):", decryptedNode.toString('hex') === decryptedWeb.toString('hex'));

  // Let's also test length=128
  const decryptedWebBuffer128 = await webCrypto.subtle.decrypt(
    { name: 'AES-CTR', counter: webIv, length: 128 },
    importedKey,
    ciphertext
  );
  const decryptedWeb128 = Buffer.from(decryptedWebBuffer128);
  console.log("Decrypted match (length=128):", decryptedNode.toString('hex') === decryptedWeb128.toString('hex'));
}

test().catch(console.error);
