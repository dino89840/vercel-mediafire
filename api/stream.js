// api/stream.js

// File တစ်ခုချင်းစီရဲ့ direct link ကို memory ထဲ ယာယီသိမ်းမယ်
// (Vercel serverless instance က warm ဖြစ်နေသရွေ့ ဒီ cache အလုပ်လုပ်မယ်)
const CACHE = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 မိနစ်

export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'url parameter is required' });
  }

  if (!/mediafire\.com\/file\//.test(url)) {
    return res.status(400).json({ error: 'Invalid MediaFire file link' });
  }

  try {
    // ----- Cache စစ်တယ် -----
    const cached = CACHE.get(url);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      return redirect(res, cached.link, true);
    }

    const directLink = await getMediaFireDirectLink(url);

    if (!directLink) {
      return res
        .status(404)
        .json({ error: 'Could not extract direct download link' });
    }

    // ----- Cache ထဲ သိမ်းတယ် -----
    CACHE.set(url, { link: directLink, time: Date.now() });

    redirect(res, directLink, false);
  } catch (err) {
    const status = err.name === 'AbortError' ? 504 : 500;
    res.status(status).json({ error: 'Failed', detail: String(err.message || err) });
  }
}

function redirect(res, location, fromCache) {
  // CDN/Vercel Edge မှာ 60s cache, browser မှာ မ cache
  // (direct link က သက်တမ်းကုန်တတ်လို့ ကြာရှည်မထား)
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
  res.setHeader('X-Cache', fromCache ? 'HIT' : 'MISS');
  res.writeHead(302, { Location: location });
  res.end();
}

async function getMediaFireDirectLink(pageUrl) {
  // ----- Timeout ထည့်တယ် (10 စက္ကန့်) -----
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  let resp;
  try {
    resp = await fetch(pageUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        // gzip ခွင့်ပြုရင် ပိုမြန်တယ် (fetch က auto-decode လုပ်ပေးတယ်)
        'Accept-Encoding': 'gzip, deflate, br',
      },
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!resp.ok) {
    throw new Error(`MediaFire returned ${resp.status}`);
  }

  // ----- HTML အကုန်မစောင့်ဘဲ download button တွေ့တာနဲ့ ရပ်တယ် -----
  const link = await streamParse(resp);
  return link;
}

// Response body ကို chunk တစ်ခုချင်း ဖတ်ပြီး link တွေ့တာနဲ့ ချက်ချင်းရပ်တယ်
async function streamParse(resp) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // chunk တိုင်းမှာ link ရှိ/မရှိ စစ်တယ်
      const link = extractLink(buffer);
      if (link) {
        // တွေ့ပြီဆို download ရပ်ပြီး connection ပိတ်တယ်
        reader.cancel().catch(() => {});
        return link;
      }

      // buffer ကြီးလွန်းရင် ရှေ့ပိုင်းဖြတ်ထား (memory ထိန်းဖို့)
      if (buffer.length > 200000) {
        buffer = buffer.slice(-50000);
      }
    }
  } finally {
    reader.releaseLock?.();
  }

  // body အကုန်ဖတ်ပြီးမှ နောက်ဆုံး တစ်ခါစစ်
  return extractLink(buffer);
}

// link ထုတ်တဲ့ logic အားလုံးကို ဒီနေရာမှာ စုထား
function extractLink(html) {
  // နည်းလမ်း ၁: download button ရဲ့ href
  let m = html.match(
    /href="((?:https?:)?\/\/download[^"]+)"[^>]*id="downloadButton"/i
  );
  if (m && m[1]) return normalize(m[1]);

  // နည်းလမ်း ၂: id="downloadButton" ရှေ့မှာ href ရှိတဲ့ပုံစံ
  m = html.match(
    /id="downloadButton"[^>]*href="((?:https?:)?\/\/download[^"]+)"/i
  );
  if (m && m[1]) return normalize(m[1]);

  // နည်းလမ်း ၃: scrambled data-scrambled-url (base64)
  m = html.match(/data-scrambled-url="([^"]+)"/i);
  if (m && m[1]) {
    try {
      const decoded = Buffer.from(m[1], 'base64').toString('utf-8');
      if (/^https?:\/\//.test(decoded)) return decoded;
    } catch (_) {}
  }

  // နည်းလမ်း ၄: page ထဲက download URL တိုက်ရိုက်
  m = html.match(/https?:\/\/download[0-9]*\.mediafire\.com\/[^"'\s]+/i);
  if (m && m[0]) return m[0];

  return null;
}

function normalize(u) {
  return u.replace(/^\/\//, 'https://');
}
