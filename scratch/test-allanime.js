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

console.log("Fetching URL:", url);

fetch(url, {
  headers: {
    "Origin": "https://youtu-chan.com",
    "Referer": "https://allmanga.to",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0"
  }
})
  .then(res => res.json())
  .then(json => {
    console.log("Response Keys:", Object.keys(json));
    console.log("Response Data Keys:", Object.keys(json.data || {}));
    console.log("Episode Data:", JSON.stringify(json.data?.episode, null, 2));
  })
  .catch(err => console.error(err));
