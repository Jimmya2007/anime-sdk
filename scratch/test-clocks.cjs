const crypto = require('crypto');

const hexSubstitutionTable = {
  // Uppercase letters
  "79": "A", "7a": "B", "7b": "C", "7c": "D", "7d": "E", "7e": "F", "7f": "G",
  "70": "H", "71": "I", "72": "J", "73": "K", "74": "L", "75": "M", "76": "N", "77": "O",
  "68": "P", "69": "Q", "6a": "R", "6b": "S", "6c": "T", "6d": "U", "6e": "V", "6f": "W",
  "60": "X", "61": "Y", "62": "Z",
  // Lowercase letters
  "59": "a", "5a": "b", "5b": "c", "5c": "d", "5d": "e", "5e": "f", "5f": "g",
  "50": "h", "51": "i", "52": "j", "53": "k", "54": "l", "55": "m", "56": "n", "57": "o",
  "48": "p", "49": "q", "4a": "r", "4b": "s", "4c": "t", "4d": "u", "4e": "v", "4f": "w",
  "40": "x", "41": "y", "42": "z",
  // Digits
  "08": "0", "09": "1", "0a": "2", "0b": "3", "0c": "4", "0d": "5", "0e": "6", "0f": "7",
  "00": "8", "01": "9",
  // Special characters
  "15": "-", "16": ".", "67": "_", "46": "~",
  "02": ":", "17": "/", "07": "?", "1b": "#",
  "63": "[", "65": "]", "78": "@",
  "19": "!", "1c": "$", "1e": "&",
  "10": "(", "11": ")", "12": "*", "13": "+", "14": ",",
  "03": ";", "05": "=", "1d": "%",
};

function decodeSourceURL(encoded) {
  let result = '';
  for (let i = 0; i < encoded.length; i += 2) {
    const pair = encoded.slice(i, i + 2);
    if (hexSubstitutionTable[pair] !== undefined) {
      result += hexSubstitutionTable[pair];
    } else {
      result += pair;
    }
  }
  result = result.replace(/\/clock/g, '/clock.json');
  if (result.startsWith('/')) {
    result = 'https://allanime.day' + result;
  }
  return result;
}

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
  .then(async json => {
    const tobeparsed = json.data.tobeparsed;
    const data = Buffer.from(tobeparsed, 'base64');
    const nonce = data.subarray(1, 13);
    const ciphertext = data.subarray(13, data.length - 16);
    const key = crypto.createHash('sha256').update("Xot36i3lK3:v1").digest();
    const iv = Buffer.alloc(16);
    nonce.copy(iv, 0);
    iv.writeUInt32BE(2, 12);

    const decipher = crypto.createDecipheriv('aes-256-ctr', key, iv);
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    const decryptedStr = decrypted.toString('utf8');
    const parsed = JSON.parse(decryptedStr);

    const clockSources = parsed.episode.sourceUrls.filter(src => src.sourceUrl.startsWith('--'));
    console.log(`Found ${clockSources.length} clock sources.`);

    for (const src of clockSources) {
      const decodedUrl = decodeSourceURL(src.sourceUrl.slice(2));
      console.log(`Fetching ${src.sourceName} URL: ${decodedUrl.slice(0, 80)}...`);
      try {
        const start = Date.now();
        const res = await fetch(decodedUrl, {
          headers: {
            "Referer": "https://allmanga.to",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0"
          }
        });
        console.log(`Result: ${src.sourceName} -> ${res.status} (took ${Date.now() - start}ms)`);
        const json = await res.json();
        console.log(`Links found: ${json.links?.length || 0}`);
      } catch (err) {
        console.error(`Error for ${src.sourceName}: ${err.message}`);
      }
    }
  })
  .catch(err => console.error(err));
