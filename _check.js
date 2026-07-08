
/* ---------- Veri katmanı (localStorage) ---------- */
const KEY = "kalem_crm_v1";
const STATUS = {
  aday:{label:"Aday",color:"#9aa1b2"},
  gorusuluyor:{label:"Görüşülüyor",color:"#4aa8ff"},
  degerlendirme:{label:"Değerlendirmede",color:"#f4b740"},
  sozlesme:{label:"Sözleşme",color:"#a99bff"},
  yayinda:{label:"Yayında",color:"#37c98a"},
  arsiv:{label:"Arşiv",color:"#5b6070"}
};
const PIPELINE = ["aday","gorusuluyor","degerlendirme","sozlesme","yayinda"];

let db = load();
let currentView = "dashboard";
let filterStatus = "all";

function load(){
  const raw = localStorage.getItem(KEY);
  if(raw) return JSON.parse(raw);
  return seed();
}
function save(){ localStorage.setItem(KEY, JSON.stringify(db)); }

function seed(){
  const today = new Date();
  const d = (off)=>{const x=new Date(today);x.setDate(x.getDate()+off);return x.toISOString().slice(0,10);};
  const data = { authors:[
    {id:uid(),name:"Elif Kaya",status:"degerlendirme",email:"elif@mail.com",phone:"0532...",
     genres:["Roman","Kurgu"],temp:5,work:"Gece Yürüyüşleri",source:"Fuar/Etkinlik",
     followup:d(2),notes:"İkinci romanı. Üslubu güçlü, editör Ayşe ile eşleştirilecek.",
     created:d(-20),logs:[
       {type:"Yüz yüze",date:d(-20),text:"Kitap fuarı standımızda tanıştık, dosya istedik."},
       {type:"E-posta",date:d(-12),text:"Dosyanın ilk 3 bölümünü gönderdi."},
       {type:"Telefon",date:d(-3),text:"Değerlendirme sürecini anlattık, 2 hafta süre verdik."}
     ]},
    {id:uid(),name:"Mert Aydın",status:"aday",email:"mert@mail.com",phone:"0505...",
     genres:["Şiir"],temp:2,work:"Sessiz Limanlar",source:"E-posta başvurusu",
     followup:d(-1),notes:"İlk şiir dosyası. Olgunlaşması gerekiyor, nazik geri dönüş yapılacak.",
     created:d(-8),logs:[{type:"E-posta",date:d(-8),text:"Kör başvuru geldi, dosya alındı."}]},
    {id:uid(),name:"Zeynep Demir",status:"sozlesme",email:"zeynep@mail.com",phone:"0542...",
     genres:["Çocuk","Resimli Kitap"],temp:4,work:"Kırmızı Balık Serisi",source:"Ajans",
     followup:d(5),notes:"Ajansı üzerinden 3 kitaplık seri teklifi. Sözleşme hukuk onayında.",
     created:d(-45),logs:[
       {type:"Video görüşme",date:d(-30),text:"Seri konsepti sunuldu, çok beğenildi."},
       {type:"E-posta",date:d(-7),text:"Sözleşme taslağı ajansa iletildi."}
     ]},
    {id:uid(),name:"Can Öztürk",status:"yayinda",email:"can@mail.com",phone:"0533...",
     genres:["Kişisel Gelişim"],temp:5,work:"Sabahın Gücü",source:"Referans",
     followup:d(30),notes:"Yayınlandı, 2. baskıda. İkinci kitap için görüşme planlanacak.",
     created:d(-200),logs:[{type:"Etkinlik",date:d(-10),text:"İmza gününde 300 kitap satıldı."}]},
    {id:uid(),name:"Aslı Yıldız",status:"gorusuluyor",email:"asli@mail.com",phone:"0538...",
     genres:["Deneme"],temp:3,work:"Kentin Sesleri",source:"Sosyal medya",
     followup:d(0),notes:"Instagram üzerinden ulaştı, güçlü takipçi kitlesi var.",
     created:d(-5),logs:[{type:"Telefon",date:d(-5),text:"İlk tanışma, örnek metin isteyeceğiz."}]}
  ]};
  localStorage.setItem(KEY, JSON.stringify(data));
  return data;
}
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,6); }

/* ---------- Yardımcılar ---------- */
function initials(n){ return n.split(" ").map(w=>w[0]).slice(0,2).join("").toUpperCase(); }
function avatarColor(n){
  const colors=["#7c6cff","#4aa8ff","#37c98a","#f4b740","#f2617a","#a99bff","#22c1c3"];
  let s=0; for(const c of n) s+=c.charCodeAt(0);
  return colors[s%colors.length];
}
function fmtDate(s){ if(!s) return "—"; const d=new Date(s); return d.toLocaleDateString("tr-TR",{day:"2-digit",month:"short",year:"numeric"}); }
function daysUntil(s){ if(!s) return null; return Math.round((new Date(s)-new Date().setHours(0,0,0,0))/864e5); }

/* ---------- Navigasyon ---------- */
document.querySelectorAll(".nav button").forEach(b=>{
  b.onclick=()=>{
    document.querySelectorAll(".nav button").forEach(x=>x.classList.remove("active"));
    b.classList.add("active");
    currentView=b.dataset.view; filterStatus="all"; render();
  };
});
const TITLES={dashboard:["Panel","Genel bakış ve bugünkü işler"],
  authors:["Yazarlar","Tüm yazar ve adaylar"],
  pipeline:["Pipeline","Yazarların süreç aşamaları"],
  followups:["Takip Listesi","Yaklaşan ve geciken takipler"]};

/* ---------- Render ---------- */
function render(){
  document.getElementById("viewTitle").textContent=TITLES[currentView][0];
  document.getElementById("viewSub").textContent=TITLES[currentView][1];
  const c=document.getElementById("content");
  if(currentView==="dashboard") c.innerHTML=viewDashboard();
  else if(currentView==="authors") c.innerHTML=viewAuthors();
  else if(currentView==="pipeline") c.innerHTML=viewPipeline();
  else if(currentView==="followups") c.innerHTML=viewFollowups();
}

function searchTerm(){ return document.getElementById("search").value.toLowerCase().trim(); }
function filteredAuthors(){
  const t=searchTerm();
  return db.authors.filter(a=>{
    const hay=(a.name+" "+(a.genres||[]).join(" ")+" "+(a.work||"")+" "+(a.notes||"")).toLowerCase();
    return (!t || hay.includes(t)) && (filterStatus==="all" || a.status===filterStatus);
  });
}

function viewDashboard(){
  const a=db.authors;
  const total=a.length;
  const adaylar=a.filter(x=>["aday","gorusuluyor"].includes(x.status)).length;
  const aktif=a.filter(x=>["degerlendirme","sozlesme"].includes(x.status)).length;
  const yayinda=a.filter(x=>x.status==="yayinda").length;
  const overdue=a.filter(x=>{const d=daysUntil(x.followup);return d!==null&&d<0;}).length;
  const soon=a.filter(x=>{const d=daysUntil(x.followup);return d!==null&&d>=0&&d<=3;}).length;

  let stats=`<div class="grid stats" style="margin-bottom:16px">
    <div class="card stat"><div class="n">${total}</div><div class="l">Toplam kayıt</div></div>
    <div class="card stat"><div class="n">${adaylar}</div><div class="l">Aday & görüşülüyor</div><span class="chip" style="background:rgba(74,168,255,.15);color:#4aa8ff">Pipeline'da</span></div>
    <div class="card stat"><div class="n">${aktif}</div><div class="l">Aktif süreç</div><span class="chip" style="background:rgba(169,155,255,.15);color:#a99bff">Değerlendirme/Sözleşme</span></div>
    <div class="card stat"><div class="n">${yayinda}</div><div class="l">Yayında</div><span class="chip" style="background:rgba(55,201,138,.15);color:#37c98a">Aktif yazar</span></div>
  </div>`;

  // takip uyarıları
  const followList=a.filter(x=>{const d=daysUntil(x.followup);return d!==null&&d<=3;})
    .sort((x,y)=>daysUntil(x.followup)-daysUntil(y.followup));
  let follow=`<div class="card"><h4 style="margin:0 0 14px;color:var(--muted);text-transform:uppercase;font-size:12px;letter-spacing:.5px">🔔 Bugün ilgilenmen gerekenler ${overdue?`<span class="badge" style="background:rgba(242,97,122,.2);color:#f2617a">${overdue} gecikmiş</span>`:""}</h4>`;
  if(!followList.length) follow+=`<div class="empty">Yaklaşan takip yok. 🎉</div>`;
  else follow+=followList.map(x=>{
    const d=daysUntil(x.followup);
    const lbl=d<0?`${-d} gün gecikti`:d===0?"Bugün":`${d} gün sonra`;
    const col=d<0?"var(--red)":d===0?"var(--amber)":"var(--muted)";
    return `<div class="mini" onclick="openDrawer('${x.id}')" style="display:flex;justify-content:space-between;align-items:center">
      <div><span class="mn">${x.name}</span><div class="ms">${x.work||"—"} • ${STATUS[x.status].label}</div></div>
      <span style="color:${col};font-weight:600;font-size:12px">${lbl}</span></div>`;
  }).join("");
  follow+=`</div>`;

  // son etkinlikler
  const acts=[];
  a.forEach(x=>(x.logs||[]).forEach(l=>acts.push({...l,name:x.name,id:x.id})));
  acts.sort((p,q)=>new Date(q.date)-new Date(p.date));
  let recent=`<div class="card"><h4 style="margin:0 0 14px;color:var(--muted);text-transform:uppercase;font-size:12px;letter-spacing:.5px">🕑 Son etkileşimler</h4><div class="timeline">`;
  recent+=acts.slice(0,6).map(l=>`<div class="tl"><div class="tt">${fmtDate(l.date)} • ${l.name}</div><div class="tx"><span class="type">${l.type}</span>${l.text}</div></div>`).join("")||`<div class="empty">Kayıt yok</div>`;
  recent+=`</div></div>`;

  return stats+`<div class="grid" style="grid-template-columns:1fr 1fr;gap:16px">${follow}${recent}</div>`;
}

function viewAuthors(){
  const counts={all:db.authors.length};
  Object.keys(STATUS).forEach(s=>counts[s]=db.authors.filter(a=>a.status===s).length);
  let bar=`<div class="toolbar"><span class="pill ${filterStatus==='all'?'active':''}" onclick="setFilter('all')">Tümü (${counts.all})</span>`;
  bar+=Object.entries(STATUS).map(([k,v])=>`<span class="pill ${filterStatus===k?'active':''}" onclick="setFilter('${k}')">${v.label} (${counts[k]})</span>`).join("");
  bar+=`</div>`;
  const list=filteredAuthors();
  if(!list.length) return bar+`<div class="empty">Kayıt bulunamadı.</div>`;
  const cards=list.map(a=>{
    const st=STATUS[a.status];
    const temp=Array.from({length:5},(_,i)=>`<span style="background:${i<a.temp?'#f4b740':'var(--line)'}"></span>`).join("");
    const d=daysUntil(a.followup);
    const fl=d===null?"":d<0?`<span style="color:var(--red)">⚠ ${-d}g gecikti</span>`:d<=3?`<span style="color:var(--amber)">🔔 ${d===0?'bugün':d+'g sonra'}</span>`:`📅 ${fmtDate(a.followup)}`;
    return `<div class="card author" onclick="openDrawer('${a.id}')">
      <div class="head">
        <div class="avatar" style="background:${avatarColor(a.name)}">${initials(a.name)}</div>
        <div style="flex:1">
          <div class="name">${a.name}</div>
          <div class="role">${a.work||"—"}</div>
        </div>
        <span class="badge" style="background:${st.color}22;color:${st.color}">${st.label}</span>
      </div>
      <div class="tags">${(a.genres||[]).map(g=>`<span class="tag">${g}</span>`).join("")}</div>
      <div class="meta-row">
        <div class="temp" title="İlgi düzeyi">${temp}</div>
        <div>${fl}</div>
      </div>
    </div>`;
  }).join("");
  return bar+`<div class="grid authors">${cards}</div>`;
}

function setFilter(s){ filterStatus=s; render(); }

function viewPipeline(){
  const t=searchTerm();
  const cols=PIPELINE.map(st=>{
    const items=db.authors.filter(a=>a.status===st && (!t||(a.name+a.work+(a.genres||[]).join()).toLowerCase().includes(t)));
    const cards=items.map(a=>`<div class="mini" onclick="openDrawer('${a.id}')">
      <div class="mn">${a.name}</div><div class="ms">${a.work||"—"} • ${(a.genres||[]).join(", ")}</div></div>`).join("")||`<div class="ms" style="color:var(--line)">—</div>`;
    return `<div class="col"><h3>${STATUS[st].label} <span class="count">${items.length}</span></h3>${cards}</div>`;
  }).join("");
  return `<p class="sub" style="color:var(--muted);margin-top:-8px">Yazarları süreçteki yerine göre gör. Kart tıklanınca detay açılır.</p><div class="pipe">${cols}</div>`;
}

function viewFollowups(){
  const list=db.authors.filter(a=>a.followup).sort((x,y)=>new Date(x.followup)-new Date(y.followup));
  if(!list.length) return `<div class="empty">Planlanmış takip yok.</div>`;
  const rows=list.map(a=>{
    const d=daysUntil(a.followup);
    const lbl=d<0?`${-d} gün gecikti`:d===0?"Bugün":`${d} gün sonra`;
    const col=d<0?"var(--red)":d===0?"var(--amber)":"var(--green)";
    return `<div class="card" style="display:flex;align-items:center;gap:14px;margin-bottom:10px;cursor:pointer" onclick="openDrawer('${a.id}')">
      <div class="avatar" style="background:${avatarColor(a.name)}">${initials(a.name)}</div>
      <div style="flex:1"><div class="name" style="font-weight:600">${a.name}</div><div class="role" style="color:var(--muted);font-size:12px">${a.work||"—"} • ${STATUS[a.status].label}</div></div>
      <div style="text-align:right"><div style="color:${col};font-weight:600">${lbl}</div><div style="color:var(--muted);font-size:12px">${fmtDate(a.followup)}</div></div>
    </div>`;
  }).join("");
  return rows;
}

/* ---------- Detay Drawer ---------- */
function openDrawer(id){
  const a=db.authors.find(x=>x.id===id); if(!a) return;
  const st=STATUS[a.status];
  const logs=(a.logs||[]).slice().sort((p,q)=>new Date(q.date)-new Date(p.date));
  const tl=logs.map(l=>`<div class="tl"><div class="tt">${fmtDate(l.date)}</div><div class="tx"><span class="type">${l.type}</span>${l.text}</div></div>`).join("")||`<div class="empty" style="padding:16px">Henüz görüşme kaydı yok.</div>`;
  document.getElementById("drawer").innerHTML=`
    <div class="dh">
      <button class="close" onclick="closeDrawer()">×</button>
      <div style="display:flex;gap:14px;align-items:center">
        <div class="avatar" style="width:54px;height:54px;font-size:20px;background:${avatarColor(a.name)}">${initials(a.name)}</div>
        <div><div style="font-size:19px;font-weight:700">${a.name}</div>
        <div style="color:var(--muted);font-size:13px">${a.work||"—"}</div></div>
      </div>
      <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
        <span class="badge" style="background:${st.color}22;color:${st.color}">${st.label}</span>
        ${(a.genres||[]).map(g=>`<span class="tag">${g}</span>`).join("")}
      </div>
      <div style="margin-top:14px;display:flex;gap:8px">
        <button class="btn" style="flex:1" onclick="openLogModal('${a.id}')">+ Görüşme Ekle</button>
        <button class="btn ghost" onclick="openAuthorModal('${a.id}')">✏️ Düzenle</button>
        <button class="btn ghost" onclick="delAuthor('${a.id}')" title="Sil">🗑</button>
      </div>
    </div>
    <div class="db">
      <div class="section"><h4>İletişim & Bilgi</h4>
        <div class="kv"><span>E-posta</span><span>${a.email||"—"}</span></div>
        <div class="kv"><span>Telefon</span><span>${a.phone||"—"}</span></div>
        <div class="kv"><span>Kaynak</span><span>${a.source||"—"}</span></div>
        <div class="kv"><span>İlgi düzeyi</span><span>${"🔥".repeat(a.temp||0)||"—"}</span></div>
        <div class="kv"><span>Sonraki takip</span><span>${fmtDate(a.followup)}</span></div>
        <div class="kv"><span>İlk kayıt</span><span>${fmtDate(a.created)}</span></div>
      </div>
      <div class="section"><h4>Notlar</h4>
        <div style="background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:12px;font-size:13px;line-height:1.5;white-space:pre-wrap">${a.notes||"—"}</div>
      </div>
      <div class="section"><h4>Görüşme Geçmişi (${logs.length})</h4>
        <div class="timeline">${tl}</div>
      </div>
    </div>`;
  document.getElementById("drawer").classList.add("open");
  document.getElementById("overlay").classList.add("open");
}
function closeDrawer(){document.getElementById("drawer").classList.remove("open");document.getElementById("overlay").classList.remove("open");}

/* ---------- Yazar CRUD ---------- */
function openAuthorModal(id){
  const m=document.getElementById("authorModal");
  const g=v=>document.getElementById(v);
  if(id){
    const a=db.authors.find(x=>x.id===id);
    document.getElementById("modalTitle").textContent="Yazarı Düzenle";
    g("f_id").value=a.id; g("f_name").value=a.name; g("f_status").value=a.status;
    g("f_email").value=a.email||""; g("f_phone").value=a.phone||"";
    g("f_genres").value=(a.genres||[]).join(", "); g("f_temp").value=a.temp||3;
    g("f_work").value=a.work||""; g("f_followup").value=a.followup||""; g("f_source").value=a.source||"Diğer";
    g("f_notes").value=a.notes||"";
  }else{
    document.getElementById("modalTitle").textContent="Yeni Yazar";
    ["f_id","f_name","f_email","f_phone","f_genres","f_work","f_followup","f_notes"].forEach(v=>g(v).value="");
    g("f_status").value="aday"; g("f_temp").value="3"; g("f_source").value="E-posta başvurusu";
  }
  m.classList.add("open");
}
function closeModal(){document.getElementById("authorModal").classList.remove("open");}
function saveAuthor(){
  const g=v=>document.getElementById(v).value.trim();
  const name=g("f_name");
  if(!name){alert("Ad Soyad zorunlu.");return;}
  const id=g("f_id");
  const payload={
    name,status:g("f_status"),email:g("f_email"),phone:g("f_phone"),
    genres:g("f_genres").split(",").map(s=>s.trim()).filter(Boolean),
    temp:+g("f_temp"),work:g("f_work"),followup:g("f_followup"),source:g("f_source"),notes:g("f_notes")
  };
  if(id){ Object.assign(db.authors.find(x=>x.id===id),payload); }
  else{ payload.id=uid(); payload.created=new Date().toISOString().slice(0,10); payload.logs=[]; db.authors.push(payload); }
  save(); closeModal(); render();
  if(id) openDrawer(id);
}
function delAuthor(id){
  if(!confirm("Bu yazar ve tüm kayıtları silinsin mi?"))return;
  db.authors=db.authors.filter(x=>x.id!==id); save(); closeDrawer(); render();
}

/* ---------- Görüşme kaydı ---------- */
function openLogModal(authorId){
  document.getElementById("l_authorId").value=authorId;
  document.getElementById("l_type").value="Telefon";
  document.getElementById("l_date").value=new Date().toISOString().slice(0,10);
  document.getElementById("l_text").value="";
  document.getElementById("logModal").classList.add("open");
}
function closeLogModal(){document.getElementById("logModal").classList.remove("open");}
function saveLog(){
  const id=document.getElementById("l_authorId").value;
  const text=document.getElementById("l_text").value.trim();
  if(!text){alert("Özet zorunlu.");return;}
  const a=db.authors.find(x=>x.id===id);
  a.logs=a.logs||[];
  a.logs.push({type:document.getElementById("l_type").value,date:document.getElementById("l_date").value,text});
  save(); closeLogModal(); openDrawer(id); render();
}

/* ---------- Yedek al / yükle ---------- */
function exportData(){
  const blob=new Blob([JSON.stringify(db,null,2)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="kalem-crm-yedek-"+new Date().toISOString().slice(0,10)+".json";
  a.click();
}
function importData(e){
  const f=e.target.files[0]; if(!f)return;
  const r=new FileReader();
  r.onload=()=>{try{db=JSON.parse(r.result);save();render();alert("Yedek yüklendi.");}catch{alert("Geçersiz dosya.");}};
  r.readAsText(f); e.target.value="";
}

render();
