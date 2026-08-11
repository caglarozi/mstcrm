// WhatsApp Cloud API webhook alıcısı + telefon arama kaydı alıcısı + CRM
// içi asistan/kullanıcı yönetimi proxy'si (Cloudflare Worker).
// - Kök adres (/): Meta, gelen her WhatsApp mesajında POST isteği gönderir.
// - /call-log: Telefonda MacroDroid otomasyonu, her arama bittiğinde POST
//   isteği gönderir (giden/gelen fark etmez).
// - /call-recording: MacroDroid, telefonun kendi arayıcısının kaydettiği
//   ses dosyasını (varsa) her yeni kayıt oluştuğunda buraya yükler —
//   eşleşen yazarın "Dosyalar" bölümüne eklenir.
// - /chat: CRM içi "Linda" asistanı için Gemini API proxy'si.
// - /admin/update-user: Admin panelinden başka bir kullanıcının kullanıcı
//   adını (=e-posta) ve/veya şifresini değiştirir (Firebase client SDK bunu
//   başka bir kullanıcı için yapamadığından, servis hesabıyla Identity
//   Toolkit admin REST API'si çağrılıyor).
// İlk ikisi gönderenin/aranan kişinin telefon numarasını mevcut yazarlarla
// eşleştirip görüşme geçmişine ekliyor, eşleşme yoksa "Aday" statüsünde
// yeni bir yazar kaydı açıyor.
//
// Gerekli secret'lar (wrangler secret put ile eklenir, koda YAZILMAZ):
//   WHATSAPP_VERIFY_TOKEN     - Meta webhook doğrulama adımında kullanılan,
//                                kendi seçtiğimiz rastgele bir metin
//   FIREBASE_SERVICE_ACCOUNT  - Firebase servis hesabı JSON'ı (tek satır)
//   CALL_LOG_SECRET           - MacroDroid isteklerini doğrulamak için
//                                kendi seçtiğimiz rastgele bir metin
//   GEMINI_API_KEY             - Google Gemini API anahtarı (CRM içi asistan için)
// wrangler.toml içindeki [vars] altında (secret olmayan):
//   FIREBASE_PROJECT_ID       - "mst-crm"

function normalizePhone(phone) {
  if (!phone) return null;
  let p = String(phone).replace(/\D/g, "");
  if (p.startsWith("0")) p = "90" + p.substring(1);
  else if (p.length === 10 && p.startsWith("5")) p = "90" + p;
  return p;
}

// Yazar dokümanlarındaki "phoneNorm" alanıyla BİREBİR aynı kural: son 10
// hane. app.js içindeki normalizePhone ile aynı kalmalı — ikisi ayrışırsa
// gelen aramalar/mesajlar mevcut yazarla eşleşmez, mükerrer aday oluşur.
function phoneKey(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function base64url(input) {
  let bin;
  if (typeof input === "string") {
    bin = input;
  } else {
    const bytes = new Uint8Array(input);
    bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecodeToBytes(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64urlDecodeToString(str) {
  return new TextDecoder().decode(base64urlDecodeToBytes(str));
}

// CRM'den (tarayıcı) gelen isteklerin gerçekten giriş yapmış bir
// kullanıcıdan geldiğini doğrulamak için Firebase ID token'ını imza
// düzeyinde doğruluyoruz (Google'ın açık anahtarlarıyla).
async function verifyFirebaseToken(idToken, projectId) {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Geçersiz token formatı");
  const header = JSON.parse(base64urlDecodeToString(parts[0]));
  const payload = JSON.parse(base64urlDecodeToString(parts[1]));

  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) throw new Error("Token bu projeye ait değil");
  if (payload.iss !== "https://securetoken.google.com/" + projectId) throw new Error("Geçersiz issuer");
  if (payload.exp < now) throw new Error("Token süresi dolmuş");

  const jwksResp = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
  const jwks = await jwksResp.json();
  const jwk = (jwks.keys || []).find(k => k.kid === header.kid);
  if (!jwk) throw new Error("Eşleşen anahtar bulunamadı");

  const cryptoKey = await crypto.subtle.importKey(
    "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
  );

  const signedData = new TextEncoder().encode(parts[0] + "." + parts[1]);
  const signature = base64urlDecodeToBytes(parts[2]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, signature, signedData);
  if (!valid) throw new Error("İmza doğrulanamadı");

  return payload;
}

async function getAccessToken(env, scope) {
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: scope || "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;

  const pemContents = sa.private_key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", binaryDer.buffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(signingInput)
  );
  const jwt = `${signingInput}.${base64url(signature)}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error("Google access token alınamadı: " + JSON.stringify(data));
  return data.access_token;
}

function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (typeof v === "object") {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = toFirestoreValue(val);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

function fromFirestoreValue(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return parseInt(v.integerValue, 10);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  // updatedAt gibi sunucu damgalari ISO metin olarak dondurulur — /mcp'nin
  // fark sorgusu watermark'i bundan hesaplar (onceden null'a dusuyordu).
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromFirestoreValue);
  if ("mapValue" in v) {
    const out = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) out[k] = fromFirestoreValue(val);
    return out;
  }
  return null;
}

function docToObject(doc) {
  const out = { id: doc.name.split("/").pop() };
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = fromFirestoreValue(v);
  return out;
}

async function patchFirestoreDoc(projectId, token, path, data) {
  const fields = {};
  for (const [k, v] of Object.entries(data)) fields[k] = toFirestoreValue(v);
  const url = new URL(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`);
  Object.keys(data).forEach(k => url.searchParams.append("updateMask.fieldPaths", k));
  const resp = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields })
  });
  if (!resp.ok) throw new Error("Firestore güncelleme hatası: " + await resp.text());
}

// Çağıranın admin olup olmadığını kontrol eder — sabit admin@crm.com
// hesabı (uygulamadaki isBootstrapAdmin ile aynı mantık) ya da
// users/{uid} dokümanında role=admin + approved=true olan hesaplar.
async function isCallerAdmin(callerPayload, projectId, token) {
  if (callerPayload.email === "admin@crm.com") return true;
  const resp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${callerPayload.user_id}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!resp.ok) return false;
  const obj = docToObject(await resp.json());
  return obj.role === "admin" && obj.approved === true;
}

// Bir kullanıcının (kendi hesabı ya da admin ise başkasının) adını,
// kullanıcı adını ve/veya şifresini değiştirir. "Kullanıcı adı" hem
// Firestore'daki görünen isim alanı HEM DE (username@crm.com kalıbıyla)
// Firebase Auth'un giriş e-postası — ikisi birlikte güncelleniyor ki
// kullanıcı adını değiştiren biri bir sonraki girişte gerçekten o yeni
// kullanıcı adını kullanabilsin. Bu işlem client SDK ile YAPILAMAZ (client
// SDK'nın e-posta değiştirme metodu artık yeni adresin önce doğrulanmasını
// istiyor, bizim @crm.com adreslerimiz gerçek posta kutusu olmadığı için bu
// imkansız). Bu yüzden servis hesabının OAuth2 erişim jetonuyla Identity
// Toolkit'in admin REST yüzeyi (/v1/projects/{projectId}/accounts:update)
// çağrılıyor — Firebase Admin SDK'nın admin.auth().updateUser() ile aynı
// mekanizma, doğrulama gerektirmiyor çünkü ayrıcalıklı (privileged) bir işlem.
async function handleAdminUpdateUser(payload, env) {
  const targetUid = String(payload?.targetUid || "");
  if (!targetUid) throw new Error("targetUid zorunlu");
  const name = payload?.name != null ? String(payload.name).trim() : null;
  const username = payload?.username != null ? String(payload.username).trim().toLowerCase() : null;
  const password = payload?.password != null ? String(payload.password) : null;
  if (password && password.length < 6) throw new Error("Şifre en az 6 karakter olmalı");
  if (username === "admin") throw new Error("'admin' kullanıcı adı sistem hesabı için ayrılmış, kullanılamaz");

  const token = await getAccessToken(env, "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit");
  const projectId = env.FIREBASE_PROJECT_ID;

  let newEmail = null;
  if (username) newEmail = username.includes("@") ? username : username + "@crm.com";

  if (newEmail || password) {
    const idtBody = { localId: targetUid };
    if (newEmail) idtBody.email = newEmail;
    if (password) idtBody.password = password;
    const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(idtBody)
    });
    const data = await resp.json();
    if (!resp.ok) {
      const errMsg = data.error?.message || "";
      if (errMsg.includes("USER_NOT_FOUND")) {
        throw new Error("Bu kullanıcının gerçek bir giriş hesabı yok (bozuk/yarım kalmış bir kayıt). Silme butonuyla bu kaydı temizleyip kişinin yeniden kayıt olmasını sağlayabilirsin.");
      }
      if (errMsg.includes("EMAIL_EXISTS")) {
        throw new Error("Bu kullanıcı adı zaten başka bir hesap tarafından kullanılıyor. Farklı bir kullanıcı adı dene.");
      }
      if (errMsg.includes("INVALID_EMAIL")) {
        throw new Error("Geçersiz kullanıcı adı formatı.");
      }
      throw new Error("Kullanıcı güncellenemedi: " + (errMsg || "bilinmeyen hata"));
    }
  }

  const firestoreUpdates = {};
  if (name) firestoreUpdates.name = name;
  if (username) { firestoreUpdates.username = username; firestoreUpdates.email = newEmail; }
  if (Object.keys(firestoreUpdates).length) {
    await patchFirestoreDoc(projectId, token, `users/${targetUid}`, firestoreUpdates);
  }
}

// Admin, birinin kendi kayıt olup onay beklemesine gerek kalmadan
// doğrudan yeni bir kullanıcı hesabı (personel/muhasebe/admin) açar.
// Hesap oluşturma, client SDK'nın herkese açık kayıt akışıyla AYNI
// (Identity Toolkit'in genel signUp uç noktası, gizli olmayan Web API
// anahtarıyla) — bu yüzden ayrıcalık gerektirmiyor. Ardından servis
// hesabının OAuth2 jetonuyla Firestore'daki users/{uid} profili
// role=... ve approved=true olarak (onay beklemeden) yazılıyor.
const FIREBASE_WEB_API_KEY = "AIzaSyDnqNrkeIi7SLHpk8LOXI94BtOU9mXems4";
async function handleAdminCreateUser(payload, env) {
  const name = String(payload?.name || "").trim();
  const username = String(payload?.username || "").trim().toLowerCase();
  const password = String(payload?.password || "");
  const role = String(payload?.role || "personel");
  if (!name) throw new Error("Ad soyad zorunlu");
  if (!username) throw new Error("Kullanıcı adı zorunlu");
  if (username === "admin") throw new Error("'admin' kullanıcı adı sistem hesabı için ayrılmış, kullanılamaz");
  if (!password || password.length < 6) throw new Error("Şifre en az 6 karakter olmalı");
  if (!["personel", "muhasebe", "admin"].includes(role)) throw new Error("Geçersiz rol");

  const email = username.includes("@") ? username : username + "@crm.com";

  const signupResp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_WEB_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: false })
  });
  const signupData = await signupResp.json();
  if (!signupResp.ok) {
    const errMsg = signupData.error?.message || "";
    if (errMsg.includes("EMAIL_EXISTS")) throw new Error("Bu kullanıcı adı zaten kullanılıyor. Farklı bir kullanıcı adı dene.");
    throw new Error("Kullanıcı oluşturulamadı: " + (errMsg || "bilinmeyen hata"));
  }
  const newUid = signupData.localId;

  const token = await getAccessToken(env, "https://www.googleapis.com/auth/datastore");
  const projectId = env.FIREBASE_PROJECT_ID;
  await patchFirestoreDoc(projectId, token, `users/${newUid}`, {
    name, username, email, role, approved: true
  });

  return { uid: newUid };
}

// Admin, kullanmadığı/test amaçlı bir kullanıcı hesabını tamamen siler:
// hem gerçek Firebase Auth hesabı (bir daha o kullanıcı adıyla giriş
// yapılamaz hale gelir) hem de Firestore'daki users/{uid} profili.
// Kendi hesabını (adminin kendisini) bu yoldan silmesine izin verilmiyor.
async function handleAdminDeleteUser(payload, env, callerPayload) {
  const targetUid = String(payload?.targetUid || "");
  if (!targetUid) throw new Error("targetUid zorunlu");
  if (targetUid === callerPayload.user_id) throw new Error("Kendi hesabını bu şekilde silemezsin.");

  const token = await getAccessToken(env, "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit");
  const projectId = env.FIREBASE_PROJECT_ID;

  const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:delete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ localId: targetUid })
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    const errMsg = data.error?.message || "";
    // Auth hesabı zaten yoksa (daha önce silinmiş ya da hiç tam
    // oluşmamış, yarım kalmış bir kayıt) sorun değil — asıl amaç
    // Firestore'daki profili temizlemek, devam ediyoruz. Başka bir
    // hatada (yetki/ağ sorunu vb.) işlemi durduruyoruz.
    if (!errMsg.includes("USER_NOT_FOUND")) {
      throw new Error("Hesap silinemedi: " + (errMsg || "bilinmeyen hata"));
    }
  }

  await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${targetUid}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
}

// Gelen numaraya karşılık gelen yazarı TEK bir indeksli sorguyla bulur.
//
// Önceden burada "authors" koleksiyonunun TAMAMI sayfa sayfa çekilip
// numaralar tek tek karşılaştırılıyordu. Yazar sayısı 800'ü geçtiği için
// her gelen WhatsApp mesajı, her arama kaydı ve her ses kaydı 800'den
// fazla doküman okuması demekti; günde birkaç düzine arama bile Firebase
// ücretsiz paketinin günlük 50.000 okuma kotasını öğleden sonra
// bitiriyordu. Kota bitince Firestore hem okumayı hem YAZMAYI reddediyor
// ve CRM'de "Veri kaydedilemedi" uyarısı çıkıyordu.
//
// Artık yazar dokümanındaki hazır "phoneNorm" alanına eşitlik sorgusu
// atılıyor: istek başına 800+ değil, 1 okuma.
async function findMatchingAuthor(projectId, token, incomingPhone) {
  const key = phoneKey(incomingPhone);
  if (!key) return null;
  const resp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "authors" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "phoneNorm" },
              op: "EQUAL",
              value: { stringValue: key }
            }
          },
          limit: 1
        }
      })
    }
  );
  if (!resp.ok) throw new Error("Yazar sorgusu başarısız: " + resp.status + " " + (await resp.text()).slice(0, 200));
  const data = await resp.json();
  const hit = (Array.isArray(data) ? data : []).find(row => row && row.document);
  return hit ? docToObject(hit.document) : null;
}

async function appendLog(projectId, token, authorId, logEntry) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`;
  const body = {
    writes: [{
      transform: {
        document: `projects/${projectId}/databases/(default)/documents/authors/${authorId}`,
        fieldTransforms: [
          { fieldPath: "logs", appendMissingElements: { values: [toFirestoreValue(logEntry)] } },
          // "Son değişiklik" damgası. CRM açılışta yalnızca damgası
          // ilerlemiş kayıtları çekiyor (bkz. app.js > loadAuthors); bu
          // damga basılmazsa webhook'un eklediği arama/mesaj kaydı
          // personelin ekranına hiç düşmez.
          { fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }
        ]
      }
    }]
  };
  await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function createLead(projectId, token, { name, phone, source, logEntry, addedBy, files }) {
  const id = uid();
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    id, name: name || phone, status: "aday", email: "", phone,
    // findMatchingAuthor'ın indeksli sorgusunun bu kaydı da bulabilmesi
    // için sadeleştirilmiş numara da yazılıyor — yoksa bu numaradan gelen
    // ikinci bir arama/mesaj eşleşmeyip mükerrer aday oluştururdu.
    phoneNorm: phoneKey(phone),
    genres: [], temp: 3, work: "", interviewDate: "", followup: "",
    source, notes: "", package: null,
    created: today,
    logs: logEntry ? [logEntry] : [],
    files: files || [],
    statusHistory: [{ status: "aday", date: today }],
    addedBy
  };
  const fields = {};
  for (const [k, v] of Object.entries(payload)) fields[k] = toFirestoreValue(v);
  // "Son değişiklik" damgası — CRM açılışta yalnızca damgası ilerlemiş
  // kayıtları çekiyor (bkz. app.js > loadAuthors). Bu doküman OLUŞTURMA
  // isteği olduğu için sunucu tarafı damga (setToServerValue) dönüşümü
  // kullanılamıyor; worker'ın saati ile yazılıyor. Küçük saat farkları
  // CRM tarafındaki DELTA_SAFETY_MS payı sayesinde sorun çıkarmaz.
  fields.updatedAt = { timestampValue: new Date().toISOString() };

  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/authors?documentId=${id}`;
  await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields })
  });
  return id;
}

// logs alanına yeni bir kayıt eklemekle aynı mantık (appendLog), ama
// yazarın dosya listesine (files) ekler — arama kayıtları CRM'deki
// "Dosyalar ve Belgeler" bölümünde diğer yüklenen dosyalarla aynı yerde,
// indirilebilir olarak görünür.
async function appendFile(projectId, token, authorId, fileMeta) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`;
  const body = {
    writes: [{
      transform: {
        document: `projects/${projectId}/databases/(default)/documents/authors/${authorId}`,
        fieldTransforms: [
          { fieldPath: "files", appendMissingElements: { values: [toFirestoreValue(fileMeta)] } },
          { fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" } // bkz. appendLog
        ]
      }
    }]
  };
  await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function handleChat(payload, env) {
  const question = String(payload?.question || "").slice(0, 2000);
  const context = payload?.context;
  if (!question) throw new Error("Soru boş olamaz");

  const systemPrompt = `Senin adın Linda. Mst CRM (bir yayınevi/ajans için yazar takip sistemi) için çalışan, kedi ` +
    `görünümlü bir personel asistanısın. Sana verilen JSON verisine bakarak Türkçe, net, kısa ve samimi cevaplar ver. ` +
    `Adın veya kimliğin sorulursa "Ben Linda" diye cevap ver.\n\n` +
    `Veri alanlarının anlamı:\n` +
    `- "stats": toplam yazar sayısı, duruma/kaynağa göre sayı, toplam tahsilat gibi ÖNCEDEN HESAPLANMIŞ sayısal ` +
    `değerler. Sayım/toplam sorularında bunları kullan, "authors" listesini kendin sayma (liste uzun olabilir, elle ` +
    `saymak hataya yol açar).\n` +
    `- "gecikenOdemeler": vadesi geçmiş, henüz tahsil edilmemiş ödemeler (kaçGunGecikti alanıyla). "hangi ödemeler ` +
    `gecikmiş/geç kalmış" gibi sorularda bunu kullan.\n` +
    `- "yaklasanOdemeler": önümüzdeki 7 gün içinde vadesi gelecek ödemeler.\n` +
    `- "ilgilenilmesiGerekenler": bugün veya yakında (3 gün içinde) takip tarihi olan, ilgilenilmesi gereken yazarlar. ` +
    `"kimlerle ilgilenmem lazım/kimleri aramam lazım" gibi sorularda bunu kullan.\n` +
    `- "authors" listesindeki "ilgiDuzeyi": 1 ile 5 arası bir sayı, yazarın sözleşmeye ne kadar sıcak baktığını ` +
    `gösterir (5 = en sıcak/istekli, 1 = en soğuk). "sözleşmeye en sıcak bakan kim" gibi sorularda bu alana göre ` +
    `authors listesini kendin sırala/filtrele (küçük bir liste için bu güvenlidir).\n` +
    `Tarih hesaplarını (kaç gün geçti/kaldı) kendin yapma, veride zaten hesaplanmış olarak geliyor, onu kullan.\n` +
    `"authors" listesinde SANA VERİLEN TÜM YAZARLARIN TAM VERİSİ var — hiçbir şey senden gizlenmedi/kısıtlanmadı, ` +
    `istediğin her soruyu bu tam listeye bakarak cevaplayabilirsin, sadece stats/gecikenOdemeler/ilgilenilmesiGerekenler ` +
    `sana hazır kısayollar olarak sunuldu (kullanman zorunlu değil, işini kolaylaştırmak için var). Cevabını asla ` +
    `yarıda kesme, listeyi tam ver.\n` +
    `Veride hiç bulunmayan bir konu sorulursa (ör. veride hiç olmayan bir alan) "bu bilgi elimde yok" de, ama ` +
    `"authors" listesinden çıkarılabilecek bir şeyi asla "elimde yok" deme, listeye bakıp bul.\n\nVeri:\n` +
    JSON.stringify(context).slice(0, 500000);

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: question }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 4000 }
      })
    }
  );
  const data = await resp.json();
  if (!resp.ok) throw new Error("Gemini hatası: " + JSON.stringify(data));
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "Cevap alınamadı.";
}

async function handleIncoming(payload, env) {
  const value = payload?.entry?.[0]?.changes?.[0]?.value;
  const messages = value?.messages;
  if (!messages || !messages.length) return; // durum güncellemesi (sent/delivered/read) - yok say

  const accessToken = await getAccessToken(env);
  const projectId = env.FIREBASE_PROJECT_ID;
  const contact = (value.contacts || [])[0];
  const profileName = contact?.profile?.name || null;

  for (const msg of messages) {
    const incomingPhone = normalizePhone(msg.from);
    if (!incomingPhone) continue;
    const text = msg.text?.body || `[${msg.type} mesajı]`;

    const matched = await findMatchingAuthor(projectId, accessToken, incomingPhone);
    const logEntry = { type: "Mesajlaşma", date: new Date().toISOString().slice(0, 10), text: "WhatsApp: " + text, staffId: "" };
    if (matched) {
      await appendLog(projectId, accessToken, matched.id, logEntry);
    } else {
      await createLead(projectId, accessToken, { name: profileName, phone: "+" + incomingPhone, source: "WhatsApp", logEntry, addedBy: "whatsapp-webhook" });
    }
  }
}

async function handleCallLog(payload, env) {
  const rawPhone = payload?.phone;
  const direction = payload?.direction === "incoming" ? "Gelen" : "Giden";
  const duration = parseInt(payload?.duration, 10) || 0;
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new Error("Geçersiz telefon numarası: " + rawPhone);

  const accessToken = await getAccessToken(env);
  const projectId = env.FIREBASE_PROJECT_ID;
  const durationText = duration ? `${Math.floor(duration / 60)} dk ${duration % 60} sn` : "cevapsız/kısa";
  const logEntry = {
    type: "Telefon",
    date: new Date().toISOString().slice(0, 10),
    text: `${direction} arama (10 07) - ${durationText}`,
    staffId: ""
  };

  const matched = await findMatchingAuthor(projectId, accessToken, phone);
  if (matched) {
    await appendLog(projectId, accessToken, matched.id, logEntry);
  } else {
    await createLead(projectId, accessToken, { name: "+" + phone, phone: "+" + phone, source: "Telefon", logEntry, addedBy: "call-log-webhook" });
  }
}

// Android'de MacroDroid, telefonun kendi arayıcısının kaydettiği ses
// dosyasını (data:audio/...;base64,... ya da salt base64) her yeni kayıt
// oluştuğunda buraya POST eder. Dosya, crm_files koleksiyonunda parçalara
// ayrılarak (chunked) saklanır — yazar dosyaları/paket sözleşmeleriyle
// aynı yöntem — ve numarası eşleşen yazarın "Dosyalar" listesine eklenir;
// eşleşme yoksa yeni bir "Aday" kaydı bu dosyayla birlikte oluşturulur.
async function handleCallRecording(payload, env) {
  const rawPhone = payload?.phone;
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new Error("Geçersiz telefon numarası: " + rawPhone);
  let audioDataUrl = payload?.audio;
  if (!audioDataUrl) throw new Error("Ses dosyası verisi (audio) eksik");
  if (!audioDataUrl.startsWith("data:")) audioDataUrl = "data:audio/mp4;base64," + audioDataUrl;
  // Base64 metni olarak ~15MB'a kadar (gerçek dosya boyutu biraz daha
  // küçük) — Worker istek gövdesi sınırını aşmamak ve tek bir arama
  // kaydının binlerce Firestore parçasına bölünmesini önlemek için.
  if (audioDataUrl.length > 15 * 1024 * 1024) throw new Error("Ses dosyası çok büyük (15MB sınırı aşıldı)");
  const fileName = String(payload?.fileName || `arama_${Date.now()}.m4a`);

  const accessToken = await getAccessToken(env, "https://www.googleapis.com/auth/datastore");
  const projectId = env.FIREBASE_PROJECT_ID;
  const approxSize = Math.round(audioDataUrl.length * 0.75);

  const chunkSize = 800000;
  const totalChunks = Math.ceil(audioDataUrl.length / chunkSize);
  const fileId = "callrec_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  for (let i = 0; i < totalChunks; i++) {
    const chunkData = audioDataUrl.slice(i * chunkSize, (i + 1) * chunkSize);
    await patchFirestoreDoc(projectId, accessToken, `crm_files/${fileId}_${i}`, { data: chunkData, index: i, fileId });
  }

  const fileMeta = {
    name: fileName, size: approxSize, date: new Date().toISOString().slice(0, 10),
    type: "Arama Kaydı", isChunked: true, fileId, totalChunks
  };
  const logEntry = { type: "Telefon", date: new Date().toISOString().slice(0, 10), text: "Arama kaydı yüklendi: " + fileName, staffId: "" };

  const matched = await findMatchingAuthor(projectId, accessToken, phone);
  if (matched) {
    await appendFile(projectId, accessToken, matched.id, fileMeta);
    await appendLog(projectId, accessToken, matched.id, logEntry);
  } else {
    await createLead(projectId, accessToken, { name: "+" + phone, phone: "+" + phone, source: "Telefon", logEntry, addedBy: "call-recording-webhook", files: [fileMeta] });
  }
}

// Görev atanınca, atanan personelin fcm_tokens'ta kayıtlı tüm cihazlarına
// FCM (Firebase Cloud Messaging) push bildirimi gönderir. CRM arayüzü,
// görevi Firestore'a yazdıktan sonra burayı çağırır — FCM'e gönderim
// servis hesabı yetkisi gerektirdiğinden client'tan doğrudan yapılamıyor.
// Artık geçersiz olan (izin kapatılmış/tarayıcı verisi silinmiş) tokenlar
// gönderim hatasında otomatik temizlenir.
async function handleNotifyTask(payload, env) {
  const staffId = String(payload?.staffId || "");
  const title = String(payload?.title || "").slice(0, 200);
  if (!staffId || !title) throw new Error("staffId ve title zorunlu");
  const dueDate = payload?.dueDate ? String(payload.dueDate) : null;
  const taskId = String(payload?.taskId || "");

  const token = await getAccessToken(env, "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging");
  const projectId = env.FIREBASE_PROJECT_ID;

  // Personelin kayıtlı cihaz tokenlarını topla
  const tokens = [];
  let pageToken;
  do {
    const listUrl = new URL(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/fcm_tokens`);
    listUrl.searchParams.set("pageSize", "300");
    if (pageToken) listUrl.searchParams.set("pageToken", pageToken);
    const resp = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
    const data = await resp.json();
    for (const doc of data.documents || []) {
      const obj = docToObject(doc);
      if (obj.staffId === staffId && obj.token) tokens.push(obj.token);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  if (!tokens.length) return { sent: 0, reason: "kayıtlı cihaz yok" };

  const body = title + (dueDate ? ` — Son tarih: ${dueDate}` : "");
  let sent = 0;
  for (const t of tokens) {
    const resp = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token: t,
          notification: { title: "Yeni görev atandı", body },
          webpush: {
            notification: {
              icon: "https://mst-crm.web.app/logo.jpeg",
              // Aynı görev için sekme içi bildirimle çakışırsa tarayıcı
              // aynı tag'li ikisini tek bildirimde birleştirir.
              tag: taskId ? "task_" + taskId : "task_new"
            },
            fcm_options: { link: "https://mst-crm.web.app/" }
          }
        }
      })
    });
    if (resp.ok) { sent++; continue; }
    const errText = await resp.text().catch(() => "");
    console.error("FCM gönderim hatası:", resp.status, errText);
    if (resp.status === 404 || errText.includes("UNREGISTERED") || errText.includes("INVALID_ARGUMENT")) {
      await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/fcm_tokens/${encodeURIComponent(t)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
    }
  }
  return { sent };
}

function daysUntilTR(dateStr, todayStr) {
  if (!dateStr) return null;
  return Math.round((new Date(dateStr) - new Date(todayStr)) / 86400000);
}

// Her sabah otomatik çalışan zamanlanmış görev (bkz. wrangler.toml
// [triggers] crons): "Bugün ilgilenmen gerekenler" kutusuyla AYNI mantığı
// kullanarak (bkz. app.js viewDashboard) takip tarihi/randevu saati
// bugün, gecikmiş ya da 3 gün içinde olan yazar sayısını hesaplayıp,
// TÜM onaylı personelin kayıtlı cihazlarına özet bir push bildirimi
// gönderir. Liste boşsa hiç bildirim gönderilmez (bildirim yorgunluğunu
// önlemek için). Worker UTC'de çalışır; Türkiye DST uygulamadığı için
// (sabit UTC+3) "bugün"ü buna göre hesaplıyoruz.
async function handleDailyDigest(env) {
  const token = await getAccessToken(env, "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging");
  const projectId = env.FIREBASE_PROJECT_ID;

  const nowTR = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const todayStr = nowTR.toISOString().slice(0, 10);

  const authors = [];
  let pageToken;
  do {
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/authors`);
    url.searchParams.set("pageSize", "300");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await resp.json();
    for (const doc of data.documents || []) authors.push(docToObject(doc));
    pageToken = data.nextPageToken;
  } while (pageToken);

  const pending = authors.filter(a => {
    if (a.status === "sozlesme" || a.status === "yayinda" || a.status === "arsiv") return false;
    const dFollow = daysUntilTR(a.followup, todayStr);
    const dInterview = (a.interviewDate && a.interviewTime) ? daysUntilTR(a.interviewDate, todayStr) : null;
    const hasFollowup = dFollow !== null && dFollow <= 3;
    const hasUpcomingInterview = dInterview !== null && dInterview >= 0 && dInterview <= 3;
    return hasFollowup || hasUpcomingInterview;
  });

  if (!pending.length) return { sent: 0, reason: "bugün ilgilenilmesi gereken yok" };

  const body = pending.length === 1
    ? `${pending[0].name} ile ilgilenmen gerekiyor.`
    : `${pending.length} kişiyle ilgilenmen gerekiyor: ${pending.slice(0, 3).map(a => a.name).join(", ")}${pending.length > 3 ? "…" : ""}`;

  const tokens = [];
  let ftPageToken;
  do {
    const listUrl = new URL(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/fcm_tokens`);
    listUrl.searchParams.set("pageSize", "300");
    if (ftPageToken) listUrl.searchParams.set("pageToken", ftPageToken);
    const resp = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
    const data = await resp.json();
    for (const doc of data.documents || []) {
      const obj = docToObject(doc);
      if (obj.token) tokens.push(obj.token);
    }
    ftPageToken = data.nextPageToken;
  } while (ftPageToken);

  let sent = 0;
  for (const t of tokens) {
    const resp = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token: t,
          notification: { title: "Günaydın! Bugün ilgilenmen gerekenler var", body },
          webpush: {
            notification: { icon: "https://mst-crm.web.app/logo.jpeg", tag: "daily_digest_" + todayStr },
            fcm_options: { link: "https://mst-crm.web.app/" }
          }
        }
      })
    });
    if (resp.ok) { sent++; continue; }
    const errText = await resp.text().catch(() => "");
    console.error("Günlük özet FCM gönderim hatası:", resp.status, errText);
    if (resp.status === 404 || errText.includes("UNREGISTERED") || errText.includes("INVALID_ARGUMENT")) {
      await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/fcm_tokens/${encodeURIComponent(t)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
    }
  }
  return { sent, pendingCount: pending.length };
}

// Reklam iyileştirmeleri senkronu (bkz. PANEL-REKLAM-ENTEGRASYONU.md ve
// app.js'teki "Reklam İyileştirmeleri" kartı): Yazar yönetim panelinin
// (app.mstyayincilik.com) 115 kurallık Meta reklam denetimini panelin MCP
// ucundan çalıştırır ve sonucu CRM panosunun okuduğu crm/reklam_durumu
// dokümanına yazar. Denetim motoru ve Meta erişimi panelde kalır — bu
// worker yalnızca sonucu taşır. MST_PANEL_MCP_URL gizli tutulur (wrangler
// secret) çünkü adresteki ?key= panelin tüm yönetim araçlarına erişim verir.
async function handleReklamSync(env) {
  if (!env.MST_PANEL_MCP_URL) throw new Error("MST_PANEL_MCP_URL tanımlı değil");

  const resp = await fetch(env.MST_PANEL_MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "reklam_durumu", arguments: { gun: 7 } }
    })
  });
  if (!resp.ok) throw new Error("Panel MCP isteği başarısız: " + resp.status);
  const rpc = await resp.json();
  if (rpc.error) throw new Error("Panel MCP hatası: " + JSON.stringify(rpc.error));

  // MCP araç cevabı content bloklarına sarılı gelir; denetim JSON'ı ilk
  // text bloğundadır.
  const blok = ((rpc.result || {}).content || []).find(c => c.type === "text");
  if (!blok) throw new Error("Panel MCP cevabında içerik bloğu yok");
  const denetim = JSON.parse(blok.text);
  if (denetim.ok === false) throw new Error("Panel denetimi başarısız: " + (denetim.hata || "sebep belirtilmedi"));

  // Doküman şeması PANEL-REKLAM-ENTEGRASYONU.md'de. Kart 3-5 öneri
  // gösterecek şekilde tasarlandı — yalnızca uygulanabilir bulgular,
  // en fazla 5 tane; hepsini yazmak panoyu boğar.
  const doc = {
    guncellenme: new Date().toISOString(),
    donem: denetim.donem || "son 7 gün",
    ozet: denetim.ozet || {},
    trend: denetim.trend || {},
    sayilar: {
      toplamKural: denetim.toplamKural || 0,
      kontrolEdilen: denetim.kontrolEdilen || 0,
      ihlal: denetim.ihlalSayisi || 0,
      temiz: denetim.temizSayisi || 0,
      uygulanabilir: denetim.uygulanabilirSayi || 0
    },
    bulgular: (denetim.ihlaller || [])
      .filter(x => x.uygulanabilir)
      .slice(0, 5)
      .map(x => ({
        no: x.no || 0,
        grup: x.grup || "",
        aksiyon: x.aksiyon || "",
        olcum: x.olcum || "",
        neden: x.neden || "",
        etki: x.etki || ""
      }))
  };

  const token = await getAccessToken(env);
  await patchFirestoreDoc(env.FIREBASE_PROJECT_ID, token, "crm/reklam_durumu", doc);
  return { yazildi: true, bulgu: doc.bulgular.length };
}

/* ================================================================
 * /mcp — Yazar CRM claude.ai bağlayıcısı (SALT OKUNUR)
 * ================================================================
 * Bilgisayardaki yerel mst-crm-mcp sunucusunun internet sürümü: aynı
 * araçlar, aynı mantık (kaynak: mst-crm-mcp/index.js + crm.js), ama
 * claude.ai'ye özel bağlayıcı olarak eklenebilsin diye HTTP üzerinden.
 * Adres: https://<worker>/mcp?key=CRM_MCP_KEY   (anahtar wrangler secret)
 *
 * SALT OKUNUR: hiçbir araç Firestore'a yazmaz/silmez.
 *
 * KOTA: yerel sürümdeki "sadece değişenleri oku" düzeninin aynısı, yerel
 * dosya yerine KV ile (CRM_MCP_KV): yazar listesi KV'de tutulur, her
 * soruda yalnızca updatedAt > watermark olan kayıtlar çekilir; kopya en
 * geç 24 saatte bir baştan alınır. crm_kota bilerek yok — o araç
 * kullanıcının bilgisayarındaki firebase oturumunu gerektirir, yalnızca
 * yerel bağlantıda çalışır.
 * ================================================================ */
const CRM_MCP_ARACLAR = [
  {
    name: "crm_ozet",
    description: "CRM'in genel durumu: toplam kayit, duruma gore dagilim, bugun eklenenler, bugunku gorusme sayisi, bekleyen tahsilat toplami. 'CRM'de durum ne', 'kac aday var' gibi sorularda ilk buraya bak.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "crm_gun_raporu",
    description: "Belirli bir gunun raporu: her personel icin gorusme/kacirilan arama/olumlu/olumsuz sayilari VE o gun kimle ne konusuldugunun tam dokumu (gorusme notlari). 'Bugun ne yapildi', 'dun Nilay kimlerle gorustu' sorularinin cevabi.",
    inputSchema: {
      type: "object",
      properties: {
        tarih: { type: "string", description: "YYYY-AA-GG. Bos birakilirsa bugun." },
        personel: { type: "string", description: "Personel adi (ornegin 'Nilay'). Bos birakilirsa herkes." }
      }
    }
  },
  {
    name: "crm_yazar_ara",
    description: "Yazar/aday arar: ad, telefon ya da not icerigine gore. Ozet bilgi doner (en fazla 25 sonuc). Bir kisi hakkinda soru sorulunca once bunu cagirip kimligini bul.",
    inputSchema: {
      type: "object",
      properties: { sorgu: { type: "string", description: "Aranacak ad, telefon parcasi ya da kelime" } },
      required: ["sorgu"]
    }
  },
  {
    name: "crm_yazar_detay",
    description: "Tek bir yazarin TAM kaydi: durum gecmisi, butun gorusme notlari, odemeleri, dosyalari, kimin ekledigi. Once crm_yazar_ara ile kimligi bulun.",
    inputSchema: {
      type: "object",
      properties: { sorgu: { type: "string", description: "Yazar adi ya da telefonu (tam veya parca)" } },
      required: ["sorgu"]
    }
  },
  {
    name: "crm_gecikmis_takipler",
    description: "Takip tarihi gecmis ama hala aranmamis adaylar — 'kimler unutulmus', 'gecikmis is var mi' sorusunun cevabi. En cok gecikenden basa dogru siralar.",
    inputSchema: {
      type: "object",
      properties: {
        personel: { type: "string", description: "Personel adi. Bos birakilirsa herkes." },
        limit: { type: "number", description: "Kac kayit donsun (varsayilan 30)" }
      }
    }
  },
  {
    name: "crm_odemeler",
    description: "Odeme/tahsilat listesi ve toplamlari. Bekleyen tutar, tahsil edilen tutar, taksitler.",
    inputSchema: {
      type: "object",
      properties: {
        durum: { type: "string", enum: ["hepsi", "bekleyen", "odendi"], description: "Varsayilan 'bekleyen'" },
        limit: { type: "number", description: "Kac kayit donsun (varsayilan 40)" }
      }
    }
  },
  {
    name: "crm_personel_performans",
    description: "Son N gunde personel bazli performans: gorusme, kacirilan arama, sozlesmeye donen, arsivlenen sayilari.",
    inputSchema: {
      type: "object",
      properties: { gun: { type: "number", description: "Kac gun geriye bakilsin (varsayilan 7)" } }
    }
  }
];

const CRM_DURUM = {
  aday: "Aday", gorusuluyor: "Görüşülüyor", degerlendirme: "Değerlendirme",
  eseryaziyor: "Eser Yazıyor", sozlesme: "Sözleşme", yayinda: "Yayında", arsiv: "Arşiv"
};
const CRM_AKTIF_DURUMLAR = ["aday", "gorusuluyor", "degerlendirme", "eseryaziyor"];

/* Tarih yardımcıları — Türkiye saati (sabit UTC+3, DST yok) */
function crmBugun() {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}
function crmGunEkle(tarih, gun) {
  const d = new Date(tarih + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + gun);
  return d.toISOString().slice(0, 10);
}
function crmDamgaMs(u) {
  if (!u) return 0;
  const ms = new Date(u).getTime();
  if (!Number.isFinite(ms)) return 0;
  // Geleceğe düşmüş tek bir damga watermark'i ileri fırlatmasın
  if (ms > Date.now() + 3600 * 1000) return 0;
  return ms;
}
function crmPersonelAdi(liste, id) {
  if (id === "admin") return "Sistem Yöneticisi";
  if (id === "onenote-import") return "OneNote aktarımı";
  const s = liste.find(x => x.id === id);
  return s ? s.name : (id || "—");
}

/* Gün raporu mantığı — app.js ve yerel MCP ile birebir aynı */
function crmGunIstatistigi(list, staffKey, tarih) {
  const kayitlar = list.filter(a => {
    const bugunEklendi = a.created === tarih && (a.addedBy || "admin") === staffKey;
    const bugunNot = (a.logs || []).some(l => l.date === tarih && (l.staffId || "admin") === staffKey);
    return bugunEklendi || bugunNot;
  });
  const olumlu = kayitlar.filter(a => a.status === "sozlesme" || a.status === "yayinda").length;
  const olumsuz = kayitlar.filter(a => a.status === "arsiv").length;
  const kacirilan = list.filter(a => {
    if (!CRM_AKTIF_DURUMLAR.includes(a.status)) return false;
    if ((a.addedBy || "admin") !== staffKey) return false;
    const aranmaliydi = (a.followup && a.followup <= tarih) || (a.interviewDate === tarih);
    if (!aranmaliydi) return false;
    return !(a.logs || []).some(l => l.date === tarih);
  }).length;
  const sonuclanan = olumlu + olumsuz;
  return {
    gorusme: kayitlar.length, kacirilan, olumlu, olumsuz,
    devamEden: kayitlar.length - olumlu - olumsuz,
    basariYuzde: sonuclanan > 0 ? Math.round(olumlu / sonuclanan * 100) : null
  };
}
function crmGunDokumu(list, staffKey, tarih) {
  return list.map(a => {
    const notlar = (a.logs || []).filter(l => l.date === tarih && (l.staffId || "admin") === staffKey);
    const bugunEklendi = a.created === tarih && (a.addedBy || "admin") === staffKey;
    if (!notlar.length && !bugunEklendi) return null;
    return {
      yazar: a.name, telefon: a.phone || null,
      durum: CRM_DURUM[a.status] || a.status,
      bugunEklendi,
      notlar: notlar.map(l => ({ tur: l.type || "Not", metin: (l.text || "").trim() }))
    };
  }).filter(Boolean).sort((x, y) => y.notlar.length - x.notlar.length);
}

/* Yazar listesi: KV kopyası + fark sorgusu. sayac.okuma'ya maliyet işlenir. */
async function crmYazarlariGetir(env, token, sayac) {
  const simdi = Date.now();
  const proje = env.FIREBASE_PROJECT_ID;
  let eski = null;
  if (env.CRM_MCP_KV) {
    try { eski = await env.CRM_MCP_KV.get("authors", "json"); } catch (e) { /* kopyasız devam */ }
  }
  if (eski && (!Array.isArray(eski.authors) || !eski.authors.length || !eski.watermark ||
    !eski.savedAt || simdi - eski.savedAt > 24 * 3600 * 1000)) eski = null;

  if (eski) {
    const esik = new Date(Math.max(0, eski.watermark - 60 * 1000)).toISOString();
    const resp = await fetch(`https://firestore.googleapis.com/v1/projects/${proje}/databases/(default)/documents:runQuery`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "authors" }],
          where: { fieldFilter: { field: { fieldPath: "updatedAt" }, op: "GREATER_THAN", value: { timestampValue: esik } } }
        }
      })
    });
    const satirlar = await resp.json();
    if (!resp.ok) throw new Error("Firestore fark sorgusu hatası: " + JSON.stringify(satirlar).slice(0, 300));
    const harita = new Map(eski.authors.map(a => [a.id, a]));
    let wm = eski.watermark;
    let degisen = 0;
    (Array.isArray(satirlar) ? satirlar : []).forEach(r => {
      if (!r.document) return;
      const a = docToObject(r.document);
      degisen++;
      wm = Math.max(wm, crmDamgaMs(a.updatedAt));
      if (a.deleted === true) harita.delete(a.id); else harita.set(a.id, a);
    });
    sayac.okuma += degisen;
    const authors = [...harita.values()];
    // Değişiklik yoksa KV'ye yeniden yazmayız (savedAt eski kalır ve kopya
    // 24 saatte bir kendiliğinden baştan alınır — yerel sürümle aynı düzen).
    if (degisen && env.CRM_MCP_KV) {
      try { await env.CRM_MCP_KV.put("authors", JSON.stringify({ watermark: wm, savedAt: eski.savedAt, authors })); } catch (e) { /* pahalılaşır ama çalışır */ }
    }
    return authors;
  }

  // Kopya yok ya da bayat: tek seferlik tam okuma (sayfalı)
  const authors = [];
  let wm = 0;
  let pageToken;
  do {
    const u = new URL(`https://firestore.googleapis.com/v1/projects/${proje}/databases/(default)/documents/authors`);
    u.searchParams.set("pageSize", "300");
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const resp = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
    const data = await resp.json();
    if (!resp.ok) throw new Error("Firestore okuma hatası: " + JSON.stringify(data).slice(0, 300));
    (data.documents || []).forEach(d => {
      const a = docToObject(d);
      sayac.okuma++;
      wm = Math.max(wm, crmDamgaMs(a.updatedAt));
      if (a.deleted !== true) authors.push(a);
    });
    pageToken = data.nextPageToken;
  } while (pageToken);
  if (env.CRM_MCP_KV) {
    try { await env.CRM_MCP_KV.put("authors", JSON.stringify({ watermark: wm, savedAt: simdi, authors })); } catch (e) { /* pahalılaşır ama çalışır */ }
  }
  return authors;
}

async function crmPersonelGetir(env, token, sayac) {
  const resp = await fetch(
    `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/crm/staff`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  sayac.okuma += 1;
  if (resp.status === 404) return [];
  const doc = await resp.json();
  if (!resp.ok) throw new Error("Personel okuma hatası: " + JSON.stringify(doc).slice(0, 200));
  const obj = docToObject(doc);
  return obj.staff || [];
}

/* Araç gövdeleri — yerel mst-crm-mcp/index.js'teki islem.* ile birebir */
const CRM_MCP_ISLEM = {
  async crm_ozet({ list, staff }) {
    const bugun = crmBugun();
    const durumlar = {};
    list.forEach(a => {
      const d = CRM_DURUM[a.status] || a.status || "—";
      durumlar[d] = (durumlar[d] || 0) + 1;
    });
    let bekleyenTutar = 0, tahsilEdilen = 0;
    list.forEach(a => (a.payments || []).forEach(p => {
      const t = Number(p.amount) || 0;
      if (p.status === "Bekliyor") bekleyenTutar += t; else tahsilEdilen += t;
    }));
    return {
      tarih: bugun,
      toplamKayit: list.length,
      durumDagilimi: durumlar,
      bugunEklenenKayit: list.filter(a => a.created === bugun).length,
      bugunGorusulenKayit: list.filter(a => (a.logs || []).some(l => l.date === bugun)).length,
      gecikmisTakip: list.filter(a => CRM_AKTIF_DURUMLAR.includes(a.status) && a.followup && a.followup < bugun).length,
      bekleyenTahsilat: Math.round(bekleyenTutar),
      tahsilEdilenToplam: Math.round(tahsilEdilen),
      personelSayisi: staff.length
    };
  },

  async crm_gun_raporu({ list, staff, args }) {
    const t = args.tarih || crmBugun();
    let anahtarlar = staff.map(s => s.id).concat(["admin"]);
    if (args.personel) {
      const bulunan = staff.filter(s => (s.name || "").toLowerCase().includes(args.personel.toLowerCase()));
      if (!bulunan.length) return { hata: `"${args.personel}" adinda personel bulunamadi.`, personeller: staff.map(s => s.name) };
      anahtarlar = bulunan.map(s => s.id);
    }
    const satirlar = anahtarlar.map(k => ({
      personel: crmPersonelAdi(staff, k),
      ...crmGunIstatistigi(list, k, t),
      dokum: crmGunDokumu(list, k, t)
    })).filter(r => r.gorusme > 0 || r.kacirilan > 0);
    return {
      tarih: t,
      not: satirlar.length ? undefined : "Bu tarihte hicbir personelin kaydi yok.",
      personeller: satirlar
    };
  },

  async crm_yazar_ara({ list, staff, args }) {
    const q = String(args.sorgu || "").toLowerCase().trim();
    const rakam = q.replace(/\D/g, "");
    const bulunan = list.filter(a => {
      const ad = (a.name || "").toLowerCase();
      const tel = String(a.phone || "").replace(/\D/g, "");
      const notlar = (a.logs || []).map(l => l.text || "").join(" ").toLowerCase();
      return ad.includes(q) ||
        (rakam.length >= 4 && tel.includes(rakam)) ||
        (q.length >= 4 && notlar.includes(q));
    });
    return {
      bulunan: bulunan.length,
      gosterilen: Math.min(bulunan.length, 25),
      sonuclar: bulunan.slice(0, 25).map(a => ({
        ad: a.name, telefon: a.phone || null,
        durum: CRM_DURUM[a.status] || a.status,
        gorusmeSayisi: (a.logs || []).length,
        sonGorusme: (a.logs || []).map(l => l.date).sort().pop() || null,
        kayitTarihi: a.created,
        gorusmeci: crmPersonelAdi(staff, a.addedBy)
      }))
    };
  },

  async crm_yazar_detay({ list, staff, args }) {
    const r = await CRM_MCP_ISLEM.crm_yazar_ara({ list, staff, args });
    if (!r.bulunan) return { hata: `"${args.sorgu}" icin kayit bulunamadi.` };
    const q = String(args.sorgu).toLowerCase().trim();
    const rakam = q.replace(/\D/g, "");
    const a = list.find(x => (x.name || "").toLowerCase() === q) ||
      list.find(x => rakam.length >= 7 && String(x.phone || "").replace(/\D/g, "").includes(rakam)) ||
      list.find(x => (x.name || "").toLowerCase().includes(q));
    if (!a) return { hata: "Kayit secilemedi.", adaylar: r.sonuclar.map(s => s.ad) };
    const digerEslesmeler = r.bulunan > 1
      ? r.sonuclar.map(s => s.ad).filter(n => n !== a.name).slice(0, 8) : undefined;
    return {
      ad: a.name, telefon: a.phone || null, eposta: a.email || null,
      durum: CRM_DURUM[a.status] || a.status,
      kayitTarihi: a.created,
      gorusmeci: crmPersonelAdi(staff, a.addedBy),
      kaynak: a.source || null, paket: a.package || null,
      sozlesmeTarihi: a.contractDate || null,
      takipTarihi: a.followup || null,
      randevu: a.interviewDate ? `${a.interviewDate}${a.interviewTime ? " " + a.interviewTime : ""}` : null,
      notlar: a.notes || null,
      durumGecmisi: (a.statusHistory || []).map(h => `${h.date}: ${CRM_DURUM[h.status] || h.status}`),
      gorusmeler: (a.logs || []).map(l => ({
        tarih: l.date, tur: l.type || "Not",
        gorusmeci: crmPersonelAdi(staff, l.staffId || "admin"),
        metin: (l.text || "").trim()
      })),
      odemeler: (a.payments || []).map(p => ({
        tutar: p.amount, tarih: p.date, durum: p.status,
        aciklama: p.notes || null, ekleyen: crmPersonelAdi(staff, p.addedBy)
      })),
      dosyalar: (a.files || []).map(f => ({ ad: f.name, tur: f.type, tarih: f.date })),
      digerEslesmeler
    };
  },

  async crm_gecikmis_takipler({ list, staff, args }) {
    const bugun = crmBugun();
    let sonuc = list.filter(a =>
      CRM_AKTIF_DURUMLAR.includes(a.status) && a.followup && a.followup < bugun);
    if (args.personel) {
      const p = staff.filter(s => (s.name || "").toLowerCase().includes(args.personel.toLowerCase())).map(s => s.id);
      if (!p.length) return { hata: `"${args.personel}" adinda personel bulunamadi.` };
      sonuc = sonuc.filter(a => p.includes(a.addedBy));
    }
    sonuc.sort((x, y) => String(x.followup).localeCompare(String(y.followup)));
    const n = args.limit || 30;
    return {
      toplamGecikmis: sonuc.length,
      gosterilen: Math.min(sonuc.length, n),
      kayitlar: sonuc.slice(0, n).map(a => ({
        ad: a.name, telefon: a.phone || null,
        durum: CRM_DURUM[a.status] || a.status,
        takipTarihi: a.followup,
        gecikmeGun: Math.round((new Date(bugun) - new Date(a.followup)) / 864e5),
        gorusmeci: crmPersonelAdi(staff, a.addedBy),
        sonGorusme: (a.logs || []).map(l => l.date).sort().pop() || null
      }))
    };
  },

  async crm_odemeler({ list, staff, args }) {
    const hepsi = list.flatMap(a => (a.payments || []).map(p => ({ ...p, yazar: a.name })));
    const d = args.durum || "bekleyen";
    let sec = hepsi;
    if (d === "bekleyen") sec = hepsi.filter(p => p.status === "Bekliyor");
    else if (d === "odendi") sec = hepsi.filter(p => p.status !== "Bekliyor");
    sec.sort((x, y) => String(x.date).localeCompare(String(y.date)));
    const n = args.limit || 40;
    const topla = arr => Math.round(arr.reduce((s, p) => s + (Number(p.amount) || 0), 0));
    return {
      filtre: d,
      toplamKayit: sec.length,
      toplamTutar: topla(sec),
      genelBekleyen: topla(hepsi.filter(p => p.status === "Bekliyor")),
      genelTahsilEdilen: topla(hepsi.filter(p => p.status !== "Bekliyor")),
      gosterilen: Math.min(sec.length, n),
      odemeler: sec.slice(0, n).map(p => ({
        yazar: p.yazar, tutar: p.amount, tarih: p.date, durum: p.status,
        aciklama: p.notes || null, ekleyen: crmPersonelAdi(staff, p.addedBy)
      }))
    };
  },

  async crm_personel_performans({ list, staff, args }) {
    const n = args.gun || 7;
    const bugun = crmBugun();
    const gunler = [];
    for (let i = 0; i < n; i++) gunler.push(crmGunEkle(bugun, -i));
    const anahtarlar = staff.map(s => s.id).concat(["admin"]);
    const satirlar = anahtarlar.map(k => {
      const top = { gorusme: 0, kacirilan: 0, olumlu: 0, olumsuz: 0 };
      gunler.forEach(g => {
        const s = crmGunIstatistigi(list, k, g);
        top.gorusme += s.gorusme; top.kacirilan += s.kacirilan;
        top.olumlu += s.olumlu; top.olumsuz += s.olumsuz;
      });
      return { personel: crmPersonelAdi(staff, k), ...top };
    }).filter(r => r.gorusme > 0 || r.kacirilan > 0)
      .sort((a, b) => b.gorusme - a.gorusme);
    return { donem: `${gunler[gunler.length - 1]} → ${bugun} (${n} gun)`, personeller: satirlar };
  }
};

async function handleCrmMcp(request, env) {
  const url = new URL(request.url);
  const yanit = (obj, status) => new Response(JSON.stringify(obj), {
    status: status || 200, headers: { "Content-Type": "application/json" }
  });

  // ÖNEMLİ: yetkisizlikte HTTP 401 DÖNMÜYORUZ, 200 + JSON-RPC hata dönüyoruz.
  // claude.ai bir MCP ucundan 401 görürse "OAuth girişi gerekiyor" varsayıp
  // dinamik istemci kaydı (DCR) deniyor ve "Couldn't register with ... sign-in
  // service" hatası veriyor. Anahtar zaten adresteki ?key= ile geçiyor; erişim
  // denetimi aynen sürüyor, sadece HTTP durum kodu OAuth akışını tetiklemiyor
  // (çalışan mst-app bağlayıcısı da bu davranışta).
  if (!env.CRM_MCP_KEY || url.searchParams.get("key") !== env.CRM_MCP_KEY) {
    return yanit({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Yetkisiz. Bağlantı adresinin sonuna ?key=TOKEN eklenmeli." } });
  }
  // GET (claude.ai'nin SSE/keşif denemesi) OAuth tetiklememeli — 405 yerine
  // boş 200 ile "burada bekleyen olay yok" deriz; asıl protokol POST'ta yürür.
  if (request.method === "GET") return new Response("", { status: 200, headers: { "Content-Type": "text/plain" } });
  if (request.method !== "POST") return new Response("Yalnızca POST", { status: 405 });

  let rpc;
  try { rpc = await request.json(); } catch (e) {
    return yanit({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Geçersiz JSON" } }, 400);
  }
  const id = rpc.id;
  // Bildirimler (id'siz — örn. notifications/initialized) cevap istemez
  if (id === undefined || id === null) return new Response(null, { status: 202 });

  try {
    if (rpc.method === "initialize") {
      return yanit({
        jsonrpc: "2.0", id,
        result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "yazar-crm", version: "1.0.0" } }
      });
    }
    if (rpc.method === "ping") return yanit({ jsonrpc: "2.0", id, result: {} });
    if (rpc.method === "tools/list") return yanit({ jsonrpc: "2.0", id, result: { tools: CRM_MCP_ARACLAR } });

    if (rpc.method === "tools/call") {
      const ad = rpc.params && rpc.params.name;
      const args = (rpc.params && rpc.params.arguments) || {};
      const fn = CRM_MCP_ISLEM[ad];
      if (!fn) {
        return yanit({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: `Bilinmeyen araç: ${ad}` }] } });
      }
      const sayac = { okuma: 0 };
      const token = await getAccessToken(env);
      const list = await crmYazarlariGetir(env, token, sayac);
      const staff = await crmPersonelGetir(env, token, sayac);
      const sonuc = await fn({ list, staff, args });
      return yanit({
        jsonrpc: "2.0", id,
        result: { content: [{ type: "text", text: JSON.stringify({ ...sonuc, _firestoreOkuma: sayac.okuma }, null, 2) }] }
      });
    }
    return yanit({ jsonrpc: "2.0", id, error: { code: -32601, message: "Bilinmeyen metot: " + rpc.method } });
  } catch (e) {
    const kotaHatasi = /RESOURCE_EXHAUSTED|Quota exceeded/i.test(String(e.message));
    return yanit({
      jsonrpc: "2.0", id,
      result: {
        isError: true,
        content: [{
          type: "text",
          text: kotaHatasi
            ? "Firestore günlük kotası dolmuş (RESOURCE_EXHAUSTED). Bu bir internet sorunu DEĞİL; kota her gün 10:00'da (TR) sıfırlanır."
            : "Hata: " + e.message
        }]
      }
    });
  }
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // claude.ai bağlayıcı eklerken origin'de OAuth keşif adreslerini yoklar.
    // Bunlara TEMİZ 404 dönmeliyiz ki "OAuth yok, doğrudan bağlan" sonucuna
    // varsın. Eskiden bu yollar bilinmeyen GET olarak WhatsApp doğrulama
    // koluna düşüp 403 dönüyordu; claude.ai 403'ü "OAuth var ama erişemedim"
    // sanıp dinamik istemci kaydı (DCR) deniyor ve "Couldn't register with …
    // sign-in service" hatası veriyordu. Çalışan mst-app da 404 dönüyor.
    if (url.pathname.startsWith("/.well-known/")) {
      return new Response("Not found", { status: 404 });
    }

    // claude.ai bağlayıcısı: Yazar CRM'e salt okunur MCP erişimi
    if (url.pathname === "/mcp") {
      return handleCrmMcp(request, env);
    }

    if (url.pathname === "/chat" && request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/chat" && request.method === "POST") {
      const authHeader = request.headers.get("Authorization") || "";
      const idToken = authHeader.replace(/^Bearer\s+/i, "");
      if (!idToken) {
        return new Response(JSON.stringify({ error: "Giriş yapılmamış" }), { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
      try {
        await verifyFirebaseToken(idToken, env.FIREBASE_PROJECT_ID);
      } catch (e) {
        return new Response(JSON.stringify({ error: "Geçersiz oturum: " + e.message }), { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
      let payload;
      try {
        payload = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: "Bad request" }), { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
      try {
        const answer = await handleChat(payload, env);
        return new Response(JSON.stringify({ answer }), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      } catch (e) {
        console.error("Chat işleme hatası:", e);
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
    }

    if (url.pathname === "/notify-task" && request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/notify-task" && request.method === "POST") {
      const authHeader = request.headers.get("Authorization") || "";
      const idToken = authHeader.replace(/^Bearer\s+/i, "");
      if (!idToken) {
        return new Response(JSON.stringify({ error: "Giriş yapılmamış" }), { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
      try {
        await verifyFirebaseToken(idToken, env.FIREBASE_PROJECT_ID);
      } catch (e) {
        return new Response(JSON.stringify({ error: "Geçersiz oturum: " + e.message }), { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
      let payload;
      try {
        payload = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: "Bad request" }), { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
      try {
        const result = await handleNotifyTask(payload, env);
        return new Response(JSON.stringify(result), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      } catch (e) {
        console.error("Görev bildirimi hatası:", e);
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
    }

    if (url.pathname === "/admin/update-user" && request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/admin/update-user" && request.method === "POST") {
      const authHeader = request.headers.get("Authorization") || "";
      const idToken = authHeader.replace(/^Bearer\s+/i, "");
      if (!idToken) {
        return new Response(JSON.stringify({ error: "Giriş yapılmamış" }), { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
      let callerPayload;
      try {
        callerPayload = await verifyFirebaseToken(idToken, env.FIREBASE_PROJECT_ID);
      } catch (e) {
        return new Response(JSON.stringify({ error: "Geçersiz oturum: " + e.message }), { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
      let payload;
      try {
        payload = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: "Bad request" }), { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
      try {
        const isSelf = payload && String(payload.targetUid || "") === callerPayload.user_id;
        if (!isSelf) {
          const checkToken = await getAccessToken(env);
          const isAdmin = await isCallerAdmin(callerPayload, env.FIREBASE_PROJECT_ID, checkToken);
          if (!isAdmin) {
            return new Response(JSON.stringify({ error: "Bu işlem için yönetici yetkisi gerekli" }), { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
          }
        }
        await handleAdminUpdateUser(payload, env);
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      } catch (e) {
        console.error("Kullanıcı güncelleme hatası:", e);
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
    }

    if (url.pathname === "/admin/create-user" && request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/admin/create-user" && request.method === "POST") {
      const authHeader = request.headers.get("Authorization") || "";
      const idToken = authHeader.replace(/^Bearer\s+/i, "");
      if (!idToken) {
        return new Response(JSON.stringify({ error: "Giriş yapılmamış" }), { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
      let callerPayload;
      try {
        callerPayload = await verifyFirebaseToken(idToken, env.FIREBASE_PROJECT_ID);
      } catch (e) {
        return new Response(JSON.stringify({ error: "Geçersiz oturum: " + e.message }), { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
      let payload;
      try {
        payload = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: "Bad request" }), { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
      try {
        const checkToken = await getAccessToken(env);
        const isAdmin = await isCallerAdmin(callerPayload, env.FIREBASE_PROJECT_ID, checkToken);
        if (!isAdmin) {
          return new Response(JSON.stringify({ error: "Bu işlem için yönetici yetkisi gerekli" }), { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
        }
        const result = await handleAdminCreateUser(payload, env);
        return new Response(JSON.stringify({ ok: true, ...result }), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      } catch (e) {
        console.error("Kullanıcı oluşturma hatası:", e);
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
    }

    if (url.pathname === "/admin/delete-user" && request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/admin/delete-user" && request.method === "POST") {
      const authHeader = request.headers.get("Authorization") || "";
      const idToken = authHeader.replace(/^Bearer\s+/i, "");
      if (!idToken) {
        return new Response(JSON.stringify({ error: "Giriş yapılmamış" }), { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
      let callerPayload;
      try {
        callerPayload = await verifyFirebaseToken(idToken, env.FIREBASE_PROJECT_ID);
      } catch (e) {
        return new Response(JSON.stringify({ error: "Geçersiz oturum: " + e.message }), { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
      let payload;
      try {
        payload = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: "Bad request" }), { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
      try {
        const checkToken = await getAccessToken(env);
        const isAdmin = await isCallerAdmin(callerPayload, env.FIREBASE_PROJECT_ID, checkToken);
        if (!isAdmin) {
          return new Response(JSON.stringify({ error: "Bu işlem için yönetici yetkisi gerekli" }), { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
        }
        await handleAdminDeleteUser(payload, env, callerPayload);
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      } catch (e) {
        console.error("Kullanıcı silme hatası:", e);
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      }
    }

    if (url.pathname === "/call-log" && request.method === "POST") {
      const secret = url.searchParams.get("secret") || request.headers.get("X-Call-Log-Secret");
      if (!env.CALL_LOG_SECRET || secret !== env.CALL_LOG_SECRET) {
        return new Response("Forbidden", { status: 403 });
      }
      let payload;
      try {
        payload = await request.json();
      } catch {
        return new Response("Bad request", { status: 400 });
      }
      try {
        await handleCallLog(payload, env);
      } catch (e) {
        console.error("Arama kaydı işleme hatası:", e);
        return new Response("Hata: " + e.message, { status: 500 });
      }
      return new Response("OK", { status: 200 });
    }

    if (url.pathname === "/call-recording" && request.method === "POST") {
      const secret = url.searchParams.get("secret") || request.headers.get("X-Call-Log-Secret");
      if (!env.CALL_LOG_SECRET || secret !== env.CALL_LOG_SECRET) {
        return new Response("Forbidden", { status: 403 });
      }
      let payload;
      const contentType = request.headers.get("Content-Type") || "";
      if (contentType.includes("application/json")) {
        try {
          payload = await request.json();
        } catch {
          return new Response("Bad request", { status: 400 });
        }
      } else {
        // MacroDroid dosyayı doğrudan (binary) gövde olarak gönderir;
        // telefon numarası ve dosya adı query parametresinden gelir.
        const buf = await request.arrayBuffer();
        if (!buf.byteLength) return new Response("Bad request: boş dosya", { status: 400 });
        if (buf.byteLength > 11 * 1024 * 1024) return new Response("Hata: dosya çok büyük (11MB sınırı)", { status: 413 });
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.length; i += 32768) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
        }
        payload = {
          phone: url.searchParams.get("phone"),
          fileName: url.searchParams.get("name") || undefined,
          audio: btoa(binary)
        };
      }
      try {
        await handleCallRecording(payload, env);
      } catch (e) {
        console.error("Arama kaydı yükleme hatası:", e);
        return new Response("Hata: " + e.message, { status: 500 });
      }
      return new Response("OK", { status: 200 });
    }

    if (request.method === "GET") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (mode === "subscribe" && token === env.WHATSAPP_VERIFY_TOKEN) {
        return new Response(challenge, { status: 200 });
      }
      return new Response("Forbidden", { status: 403 });
    }

    if (request.method === "POST") {
      let payload;
      try {
        payload = await request.json();
      } catch {
        return new Response("Bad request", { status: 400 });
      }
      try {
        await handleIncoming(payload, env);
      } catch (e) {
        console.error("Webhook işleme hatası:", e);
        // Meta'nın webhook'u devre dışı bırakmaması için yine de 200 dönüyoruz.
      }
      return new Response("OK", { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  },

  // wrangler.toml [triggers] crons ile zamanlanmış görevler. Hangi işin
  // çalışacağını tetikleyen cron ifadesi belirler: 6 saatte bir reklam
  // senkronu (handleReklamSync), her sabah günlük özet (handleDailyDigest).
  async scheduled(event, env, ctx) {
    if (event.cron === "30 */6 * * *") {
      ctx.waitUntil(handleReklamSync(env).catch(e => console.error("Reklam senkron hatası:", e)));
    } else {
      ctx.waitUntil(handleDailyDigest(env).catch(e => console.error("Günlük özet hatası:", e)));
    }
  }
};
