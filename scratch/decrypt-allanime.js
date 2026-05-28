const crypto = require('crypto');

const variables = {
  showId: "vkD8H5e7HsG2jctw9",
  translationType: "sub",
  episodeString: "1"
};

const extensions = {
  persistedQuery: {
    version: 1,
    sha256Hash: "d405d0edd690624b66baba3068e0edc3ac90f1597d898a1ec8db4e5c43c00fec"
  }
};

const url = `https://api.allanime.day/api?variables=${encodeURIComponent(JSON.stringify(variables))}&extensions=${encodeURIComponent(JSON.stringify(extensions))}`;

fetch(url, {
  headers: {
    "Origin": "https://youtu-chan.com",
    "Referer": "https://allmanga.to",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0"
  }
})
  .then(res => res.json())
  .then(json => {
    const tobeparsed = json.data.tobeparsed;
    console.log("tobeparsed length:", tobeparsed.length);

    // Decode base64
    const data = Buffer.from(tobeparsed, 'base64');
    console.log("data total bytes:", data.length);

    // Extract nonce (12 bytes from index 1 to 13)
    const nonce = data.subarray(1, 13);
    console.log("nonce hex:", nonce.toString('hex'));

    // Ciphertext: from index 13 to data.length - 16
    const ciphertext = data.subarray(13, data.length - 16);
    console.log("ciphertext bytes:", ciphertext.length);

    // Key: SHA-256 hash of "Xot36i3lK3:v1"
    const key = crypto.createHash('sha256').update("Xot36i3lK3:v1").digest();
    console.log("key hex:", key.toString('hex'));

    // IV/Counter: nonce (12 bytes) || 4-byte counter 0x00000002
    const iv = Buffer.alloc(16);
    nonce.copy(iv, 0);
    iv.writeUInt32BE(2, 12);
    console.log("iv hex:", iv.toString('hex'));

    // Decrypt AES-256-CTR
    const decipher = crypto.createDecipheriv('aes-256-ctr', key, iv);
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    const decryptedStr = decrypted.toString('utf8');
    console.log("Decrypted output (first 500 chars):");
    console.log(decryptedStr.slice(0, 500));

    // Parse the JSON
    try {
      const parsed = JSON.parse(decryptedStr);
      console.log("\nParsed successfully!");
      if (parsed.data && parsed.data.episode) {
        console.log("Source URLs:");
        console.log(JSON.stringify(parsed.data.episode.sourceUrls, null, 2));
      } else {
        console.log("Keys in parsed JSON:", Object.keys(parsed));
      }
    } catch (e) {
      console.error("\nFailed to parse JSON:", e.message);
    }
  })
  .catch(err => console.error(err));
