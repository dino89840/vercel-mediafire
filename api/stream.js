// api/stream.js
export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'url parameter is required' });
  }

  // MediaFire file page link ဟုတ်/မဟုတ် စစ်တယ်
  if (!/mediafire\.com\/file\//.test(url)) {
    return res.status(400).json({ error: 'Invalid MediaFire file link' });
  }

  try {
    const directLink = await getMediaFireDirectLink(url);

    if (!directLink) {
      return res
        .status(404)
        .json({ error: 'Could not extract direct download link' });
    }

    // 302 Redirect → APK player က fresh .mp4 link ဆီ တန်းရောက်သွားမယ်
    res.setHeader('Cache-Control', 'no-store');
    res.writeHead(302, { Location: directLink });
    res.end();
  } catch (err) {
    res.status(500).json({ error: 'Failed', detail: String(err) });
  }
}

async function getMediaFireDirectLink(pageUrl) {
  const resp = await fetch(pageUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  const html = await resp.text();

  // နည်းလမ်း ၁: download button ရဲ့ href (အဖြစ်အများဆုံး)
  let m = html.match(
    /href="((?:https?:)?\/\/download[^"]+)"[^>]*id="downloadButton"/i
  );
  if (m && m[1]) return m[1].replace(/^\/\//, 'https://');

  // နည်းလမ်း ၂: id="downloadButton" ရှေ့မှာ href ရှိတဲ့ပုံစံ
  m = html.match(
    /id="downloadButton"[^>]*href="((?:https?:)?\/\/download[^"]+)"/i
  );
  if (m && m[1]) return m[1].replace(/^\/\//, 'https://');

  // နည်းလမ်း ၃: scrambled data-scrambled-url (base64 encoded)
  m = html.match(/data-scrambled-url="([^"]+)"/i);
  if (m && m[1]) {
    try {
      const decoded = Buffer.from(m[1], 'base64').toString('utf-8');
      if (/^https?:\/\//.test(decoded)) return decoded;
    } catch (_) {}
  }

  // နည်းလမ်း ၄: page ထဲက download URL တိုက်ရိုက်ရှာ
  m = html.match(/https?:\/\/download[0-9]*\.mediafire\.com\/[^"'\s]+/i);
  if (m && m[0]) return m[0];

  return null;
}
