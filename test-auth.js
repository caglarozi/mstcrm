const https = require('https');
const API_KEY = "AIzaSyDnqNrkeIi7SLHpk8LOXI94BtOU9mXems4";

const data = JSON.stringify({
  email: "admin@crm.com",
  password: "admin123",
  returnSecureToken: true
});

const req = https.request({
  hostname: 'identitytoolkit.googleapis.com',
  path: '/v1/accounts:signInWithPassword?key=' + API_KEY,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
}, res => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => {
    console.log("Status:", res.statusCode);
    console.log("Response:", JSON.parse(body));
  });
});
req.write(data);
req.end();
