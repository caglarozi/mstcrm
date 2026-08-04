const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = process.env.PORT || 4599;

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

/* WhatsApp Cloud API proxy */
function waRequest(phoneNumberId, accessToken, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      hostname: 'graph.facebook.com',
      port: 443,
      path: `/v21.0/${phoneNumberId}/messages`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const r = https.request(options, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    r.on('error', reject);
    r.write(data);
    r.end();
  });
}

http.createServer(async (req, res) => {
  /* --- CORS headers --- */
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  /* --- API: WhatsApp mesaj gönder --- */
  if (req.method === 'POST' && req.url === '/api/wa/send') {
    try {
      const { phoneNumberId, accessToken, to, message, templateName, templateLang, templateParams } = await parseBody(req);
      if (!phoneNumberId || !accessToken || !to) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'phoneNumberId, accessToken ve to alanları zorunlu.' }));
        return;
      }

      let payload;
      if (templateName) {
        // Template mesaj
        payload = {
          messaging_product: 'whatsapp',
          to: to.replace(/[^0-9]/g, ''),
          type: 'template',
          template: {
            name: templateName,
            language: { code: templateLang || 'tr' },
            components: templateParams ? [{ type: 'body', parameters: templateParams.map(p => ({ type: 'text', text: p })) }] : []
          }
        };
      } else {
        // Serbest metin mesaj (24 saat penceresi içinde)
        payload = {
          messaging_product: 'whatsapp',
          to: to.replace(/[^0-9]/g, ''),
          type: 'text',
          text: { preview_url: false, body: message || '' }
        };
      }

      const result = await waRequest(phoneNumberId, accessToken, payload);
      res.writeHead(result.status === 200 ? 200 : 502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: result.status === 200, ...result.data }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  /* --- API: Bağlantı testi --- */
  if (req.method === 'POST' && req.url === '/api/wa/test') {
    try {
      const { phoneNumberId, accessToken } = await parseBody(req);
      if (!phoneNumberId || !accessToken) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'phoneNumberId ve accessToken zorunlu.' }));
        return;
      }
      // Phone number bilgisini çek
      const options = {
        hostname: 'graph.facebook.com',
        path: `/v21.0/${phoneNumberId}`,
        headers: { 'Authorization': `Bearer ${accessToken}` }
      };
      const result = await new Promise((resolve, reject) => {
        https.get(options, r => {
          let body = '';
          r.on('data', c => body += c);
          r.on('end', () => { try { resolve({ status: r.statusCode, data: JSON.parse(body) }); } catch { resolve({ status: r.statusCode, data: body }); } });
        }).on('error', reject);
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: result.status === 200,
        phone: result.data.display_phone_number || null,
        name: result.data.verified_name || null,
        error: result.data.error ? result.data.error.message : null
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  /* --- API: Veri Yedekleme --- */
  if (req.method === 'POST' && req.url === '/api/backup') {
    try {
      const data = await parseBody(req);
      const backupPath = path.join(__dirname, 'CrmYedek.doc');
      
      let html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">';
      html += '<head><meta charset="utf-8"><title>Yedek</title><style>body { font-family: Arial, sans-serif; }</style></head><body>';
      html += '<h1>Mst CRM Veri Yedeği</h1>';
      html += '<p>Son Güncelleme: ' + new Date().toLocaleString('tr-TR') + '</p>';
      
      if (data.authors && data.authors.length > 0) {
        const getAuthorDate = (a) => {
            let latestDate = a.created || "Bilinmeyen Tarih";
            if (a.logs && a.logs.length > 0) {
              const maxLogDate = a.logs.map(l => l.date).reduce((a, b) => a > b ? a : b);
              if (maxLogDate > latestDate || latestDate === "Bilinmeyen Tarih") {
                latestDate = maxLogDate;
              }
            }
            return latestDate;
        };

        const groups = {};
        data.authors.forEach(a => {
           const d = getAuthorDate(a);
           if (!groups[d]) groups[d] = [];
           groups[d].push(a);
        });

        const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

        sortedDates.forEach(date => {
          html += '<h1 style="color: #4aa8ff; border-bottom: 2px solid #4aa8ff; padding-bottom: 5px; margin-top: 40px;">📅 ' + date + ' Tarihindeki Kayıtlar</h1>';
          groups[date].forEach(a => {
            html += '<h2>' + a.name + ' (' + a.status + ')</h2>';
            html += '<ul>';
            html += '<li><b>E-posta:</b> ' + (a.email || '-') + '</li>';
            html += '<li><b>Telefon:</b> ' + (a.phone || '-') + '</li>';
            html += '<li><b>Eser:</b> ' + (a.work || '-') + '</li>';
            html += '<li><b>Tür:</b> ' + (a.genres ? a.genres.join(', ') : '-') + '</li>';
            html += '<li><b>Kaynak:</b> ' + (a.source || '-') + '</li>';
            html += '<li><b>İlgi Düzeyi:</b> ' + (a.temp || 0) + '/5</li>';
            html += '<li><b>Kayıt Tarihi:</b> ' + (a.created || '-') + '</li>';
            html += '<li><b>Takip Tarihi:</b> ' + (a.followup || '-') + '</li>';
            html += '<li><b>Notlar:</b> ' + (a.notes || '-') + '</li>';
            html += '</ul>';
            if (a.logs && a.logs.length > 0) {
              html += '<h3>Görüşme Geçmişi</h3>';
              html += '<ul>';
              a.logs.forEach(l => {
                html += '<li><b>' + l.date + '</b> [' + l.type + ']: ' + l.text + '</li>';
              });
              html += '</ul>';
            }
            html += '<hr>';
          });
        });
      } else {
         html += '<p>Henüz kayıt bulunmamaktadır.</p>';
      }
      html += '</body></html>';

      fs.writeFileSync(backupPath, html, 'utf8');
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  /* --- Statik dosya sunucu --- */
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const f = path.join(__dirname, decodeURIComponent(p));
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); res.end('404'); return; }
    const ext = path.extname(f);
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
    res.end(d);
  });
}).listen(PORT, () => console.log(`serving on ${PORT}`));
