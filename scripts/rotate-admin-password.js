// BİR KERELİK betik: admin@crm.com hesabının şifresini Firebase Admin SDK
// ile doğrudan değiştirir. Bu hesabın gerçek bir e-posta kutusu olmadığı
// için normal "şifremi unuttum" e-posta akışı çalışmaz — bu yüzden bu betik
// gerekli.
//
// Kullanım (PowerShell):
//   $env:FIREBASE_SERVICE_ACCOUNT = Get-Content "C:\yol\indirilen-anahtar.json" -Raw
//   cd scripts
//   node rotate-admin-password.js
//   (yeni şifre terminalde sorulacak, kaydedilmez, sadece Firebase'e gönderilir)

const admin = require('firebase-admin');
const readline = require('readline');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

async function main() {
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!saJson) {
    console.error('Önce FIREBASE_SERVICE_ACCOUNT ortam değişkenini ayarlayın (yukarıdaki talimata bakın).');
    process.exit(1);
  }

  const newPassword = await ask('Yeni admin şifresi (en az 6 karakter): ');
  if (!newPassword || newPassword.trim().length < 6) {
    console.error('Şifre en az 6 karakter olmalı. Tekrar çalıştırıp deneyin.');
    process.exit(1);
  }

  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saJson)) });

  const user = await admin.auth().getUserByEmail('admin@crm.com');
  await admin.auth().updateUser(user.uid, { password: newPassword.trim() });
  console.log('✔ admin@crm.com şifresi başarıyla değiştirildi. Yeni şifreyi güvenli bir yerde saklayın.');
}

main().catch(e => {
  console.error('Hata:', e.message);
  process.exit(1);
});
