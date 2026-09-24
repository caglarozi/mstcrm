// Yalnızca web sitesi randevularını (/randevu) karşılayan küçük worker.
//
// Neden ayrı: ana worker (index.js) başka bir Cloudflare hesabında duruyor.
// Bu dosya aynı kodu kullanır ama dışarıya YALNIZCA /randevu ucunu açar ve
// zamanlanmış görev (sabah özeti, reklam senkronu) içermez — ana worker'la
// yan yana çalışınca çift bildirim/çift iş olmaz.
// Yayınlama: npx wrangler deploy -c wrangler-randevu.toml
// Gerekli secret'lar (aynı -c ile): RANDEVU_SECRET, FIREBASE_SERVICE_ACCOUNT
import worker from "./index.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/randevu") return worker.fetch(request, env, ctx);
    return new Response("Not found", { status: 404 });
  }
};
