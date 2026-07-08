const https = require('https');

const req = https.request({
  hostname: 'firestore.googleapis.com',
  path: '/v1/projects/mst-crm/databases/(default)/documents/users',
  method: 'GET'
}, res => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => {
    console.log("Status:", res.statusCode);
    console.log("Response:", body);
  });
});
req.end();
