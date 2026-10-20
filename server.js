const express=require('express'),fs=require('fs'),path=require('path'),crypto=require('crypto'),QR=require('qrcode');
const app=express(),PORT=process.env.PORT||3000,DB=path.join(__dirname,'data','db.json');
app.set('trust proxy',true);app.use(express.json());app.use(express.urlencoded({extended:false}));
app.use(express.static(path.join(__dirname,'public')));

/* ---------- storage: in-memory, flushed to disk every 2s (keeps redirects fast) ---------- */
let db,dirty=false;const save=()=>{dirty=true};
const flush=()=>{if(!dirty)return;dirty=false;fs.mkdirSync(path.dirname(DB),{recursive:true});fs.writeFileSync(DB,JSON.stringify(db))};
setInterval(flush,2000);['SIGTERM','SIGINT'].forEach(s=>process.on(s,()=>{flush();process.exit()}));
const hash=(pw,salt=crypto.randomBytes(8).toString('hex'))=>({salt,hash:crypto.scryptSync(pw,salt,32).toString('hex')});
const pwOk=(pw,h)=>crypto.timingSafeEqual(Buffer.from(hash(pw,h.salt).hash),Buffer.from(h.hash));
const rnd=a=>a[Math.floor(Math.random()*a.length)];
function seed(){
  db={users:{},sessions:{},links:{},campaigns:{},clicks:[],blocklist:['phishing.example','malware-site.example']};
  db.users.admin={role:'admin',...hash('admin123')};db.users.demo={role:'user',...hash('demo123')};
  db.campaigns.c1={id:'c1',name:'Diwali Sale',owner:'demo'};db.campaigns.c2={id:'c2',name:'YouTube Shorts',owner:'demo'};
  const D=[['Mobile','Android','Chrome'],['Mobile','iOS','Safari'],['Desktop','Windows','Chrome'],['Desktop','macOS','Safari'],['Desktop','Windows','Edge']];
  [['diwali','https://example.com/diwali-offers','c1',['sale']],['shorts','https://youtube.com/@creator','c2',['video']],['portfolio','https://example.com/portfolio',null,[]]].forEach(([code,url,campaign,tags])=>{
    const l=db.links[code]={code,url,owner:'demo',campaign,tags,created:Date.now()-6*864e5,expires:code==='diwali'?Date.now()+3*864e5:null,maxClicks:code==='shorts'?60:null,pw:null,status:'active',count:0,vids:[]};
    for(let i=0;i<20+Math.floor(Math.random()*30);i++){const [device,os,browser]=rnd(D),vid='v'+Math.floor(Math.random()*14),bot=Math.random()<.08;
      db.clicks.push({code,t:Date.now()-Math.random()*6*864e5,device,os,browser,ref:rnd(['Direct','instagram.com','t.co','youtube.com']),src:Math.random()<.2?'QR code':'Link',vid,bot});
      if(!bot){l.count++;if(!l.vids.includes(vid))l.vids.push(vid)}}});
  save();
}
try{db=JSON.parse(fs.readFileSync(DB,'utf8'))}catch{seed()}

/* ---------- helpers ---------- */
const RESERVED=['api','admin','login','css','js','static','assets','favicon'];
const BOT=/bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|curl|wget|python-requests|headless/i;
function parseUA(ua=''){
  return{device:/tablet|ipad/i.test(ua)?'Tablet':/mobi|android|iphone/i.test(ua)?'Mobile':'Desktop',
  os:/windows/i.test(ua)?'Windows':/android/i.test(ua)?'Android':/iphone|ipad|ios/i.test(ua)?'iOS':/mac os/i.test(ua)?'macOS':/linux/i.test(ua)?'Linux':'Other',
  browser:/edg\//i.test(ua)?'Edge':/opr\/|opera/i.test(ua)?'Opera':/chrome|crios/i.test(ua)?'Chrome':/firefox|fxios/i.test(ua)?'Firefox':/safari/i.test(ua)?'Safari':'Other'};
}
const base=r=>`${r.protocol}://${r.get('host')}`;
const state=l=>l.status==='disabled'?'disabled':l.expires&&Date.now()>l.expires?'expired':l.maxClicks&&l.count>=l.maxClicks?'limit reached':'active';
const sum=(r,l)=>({code:l.code,short:base(r)+'/'+l.code,url:l.url,owner:l.owner,campaign:l.campaign&&db.campaigns[l.campaign]?db.campaigns[l.campaign].name:null,tags:l.tags,status:state(l),clicks:l.count,visits:l.vids.length,expires:l.expires,maxClicks:l.maxClicks,locked:!!l.pw,created:l.created});
const tally=(a,k)=>a.reduce((o,x)=>(o[x[k]]=(o[x[k]]||0)+1,o),{});
const rl=new Map();const limited=k=>{const n=Date.now(),a=(rl.get(k)||[]).filter(t=>n-t<6e4);a.push(n);rl.set(k,a);return a.length>10};

const auth=role=>(req,res,next)=>{
  const name=db.sessions[(req.get('authorization')||'').slice(7)],u=name&&db.users[name];
  if(!u)return res.status(401).json({error:'Please log in'});
  if(role&&u.role!==role)return res.status(403).json({error:'Admins only'});
  req.user={name,role:u.role};next();
};
const visible=req=>Object.values(db.links).filter(l=>req.user.role==='admin'||l.owner===req.user.name);
const getLink=(req,res)=>{const l=db.links[req.params.code];if(!l||(req.user.role!=='admin'&&l.owner!==req.user.name)){res.status(404).json({error:'Link not found'});return null}return l};

/* ---------- validation + creation (business logic lives here) ---------- */
function validate(req,b,owner){
  const errors=[],warnings=[];let url=(b.url||'').trim(),u;
  if(!/^https?:\/\//i.test(url))url='https://'+url;
  try{u=new URL(url);if(!u.hostname.includes('.'))throw 0}catch{u=null;errors.push('Enter a valid URL, for example https://example.com')}
  if(u){
    if(db.blocklist.some(d=>u.hostname===d||u.hostname.endsWith('.'+d)))errors.push('This domain is on the blocklist');
    if(u.host===req.get('host'))errors.push('You cannot shorten a link to this site');
    if(u.protocol==='http:')warnings.push('This destination is not HTTPS');
    if(Object.values(db.links).some(l=>l.owner===owner&&l.url===u.href))warnings.push('You already have a short link for this URL');
  }
  const alias=(b.alias||'').trim();
  if(alias){if(!/^[A-Za-z0-9_-]{3,30}$/.test(alias))errors.push('Alias must be 3 to 30 letters, numbers, - or _');
    else if(RESERVED.includes(alias.toLowerCase())||db.links[alias])errors.push('This alias is already taken')}
  if(b.expires&&!(new Date(b.expires)>Date.now()))errors.push('Expiry date must be in the future');
  if(b.maxClicks&&!(parseInt(b.maxClicks)>0))errors.push('Click limit must be a positive number');
  if(b.campaign&&!(db.campaigns[b.campaign]&&db.campaigns[b.campaign].owner===owner))errors.push('Campaign not found');
  return{errors,warnings,url:u?u.href:url,alias};
}
function create(req,b,owner){
  const v=validate(req,b,owner);if(v.errors.length)return{errors:v.errors};
  let code=v.alias;while(!code||db.links[code]||RESERVED.includes(code))code=crypto.randomBytes(5).toString('base64url').slice(0,6);
  const tags=(Array.isArray(b.tags)?b.tags:String(b.tags||'').split(/[,;]/)).map(t=>t.trim()).filter(Boolean).slice(0,8);
  db.links[code]={code,url:v.url,owner,campaign:b.campaign||null,tags,created:Date.now(),expires:b.expires?new Date(b.expires).getTime():null,
    maxClicks:b.maxClicks?parseInt(b.maxClicks):null,pw:b.password?hash(b.password):null,status:'active',count:0,vids:[]};
  save();return{link:db.links[code],warnings:v.warnings};
}

/* ---------- API ---------- */
app.post('/api/register',(req,res)=>{
  const{username,password}=req.body;
  if(!/^[a-z0-9_]{3,20}$/i.test(username||'')||(password||'').length<6)return res.status(400).json({error:'Username: 3 to 20 letters/numbers. Password: at least 6 characters.'});
  if(db.users[username])return res.status(400).json({error:'Username already taken'});
  db.users[username]={role:'user',...hash(password)};save();login(res,username);
});
app.post('/api/login',(req,res)=>{const u=db.users[req.body.username];
  if(!u||!pwOk(req.body.password||'',u))return res.status(401).json({error:'Wrong username or password'});login(res,req.body.username)});
function login(res,name){const token=crypto.randomBytes(24).toString('hex');db.sessions[token]=name;save();res.json({token,name,role:db.users[name].role})}
app.get('/api/me',auth(),(req,res)=>res.json(req.user));

app.post('/api/validate',auth(),(req,res)=>{const v=validate(req,req.body,req.user.name);res.json({errors:v.errors,warnings:v.warnings})});
app.post('/api/links',auth(),(req,res)=>{
  if(limited(req.user.name))return res.status(429).json({error:'Too many links created. Wait a minute and try again.'});
  const r=create(req,req.body,req.user.name);if(r.errors)return res.status(400).json({error:r.errors[0],errors:r.errors});
  res.json({...sum(req,r.link),warnings:r.warnings});
});
app.get('/api/links',auth(),(req,res)=>res.json(visible(req).map(l=>sum(req,l)).sort((a,b)=>b.created-a.created)));
app.get('/api/links/:code',auth(),(req,res)=>{
  const l=getLink(req,res);if(!l)return;const ev=db.clicks.filter(c=>c.code===l.code),ok=ev.filter(c=>!c.bot);
  res.json({...sum(req,l),devices:Object.keys(tally(ok,'device')),os:Object.keys(tally(ok,'os')),browsers:Object.keys(tally(ok,'browser')),
    sources:tally(ok,'ref'),qrScans:ok.filter(c=>c.src==='QR code').length,botsFiltered:ev.length-ok.length,
    recent:ok.sort((a,b)=>b.t-a.t).slice(0,15)});
});
app.post('/api/links/:code/status',auth(),(req,res)=>{const l=getLink(req,res);if(!l)return;
  l.status=req.body.status==='disabled'?'disabled':'active';save();res.json({status:state(l)})});
app.get('/api/links/:code/qr',auth(),async(req,res)=>{const l=getLink(req,res);if(!l)return;
  res.json({dataUrl:await QR.toDataURL(`${base(req)}/${l.code}?s=qr`,{margin:1,width:320}),short:`${base(req)}/${l.code}`})});

app.get('/api/campaigns',auth(),(req,res)=>res.json(Object.values(db.campaigns).filter(c=>req.user.role==='admin'||c.owner===req.user.name).map(c=>{
  const ls=Object.values(db.links).filter(l=>l.campaign===c.id);
  const top=ls.sort((a,b)=>b.count-a.count)[0];
  return{id:c.id,name:c.name,links:ls.length,clicks:ls.reduce((s,l)=>s+l.count,0),top:top?top.code:null}})));
app.post('/api/campaigns',auth(),(req,res)=>{const name=(req.body.name||'').trim();
  if(!name)return res.status(400).json({error:'Enter a campaign name'});
  if(Object.values(db.campaigns).some(c=>c.owner===req.user.name&&c.name.toLowerCase()===name.toLowerCase()))return res.status(400).json({error:'Campaign already exists'});
  const id=crypto.randomBytes(3).toString('hex');db.campaigns[id]={id,name,owner:req.user.name};save();res.json({id,name})});

app.post('/api/import',auth(),(req,res)=>{
  const rows=String(req.body.csv||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(rows.length&&/^url\b/i.test(rows[0]))rows.shift();
  if(rows.length>200)return res.status(400).json({error:'Import up to 200 rows at a time'});
  const seen=new Set();
  res.json(rows.map((line,i)=>{
    const[url,alias,camp,tags]=line.split(',').map(s=>s.trim());
    const c=camp&&Object.values(db.campaigns).find(x=>x.owner===req.user.name&&x.name.toLowerCase()===camp.toLowerCase());
    if(camp&&!c)return{row:i+1,url,status:'error',message:'Campaign "'+camp+'" does not exist'};
    const key=(url||'').toLowerCase();if(seen.has(key))return{row:i+1,url,status:'duplicate',message:'Duplicate row in this file'};seen.add(key);
    const r=create(req,{url,alias,campaign:c?c.id:null,tags},req.user.name);
    return r.errors?{row:i+1,url,status:'error',message:r.errors[0]}:{row:i+1,url,status:'imported',short:base(req)+'/'+r.link.code}}));
});

app.get('/api/dashboard',auth(),(req,res)=>{
  const ls=visible(req),codes=new Set(ls.map(l=>l.code)),all=db.clicks.filter(c=>codes.has(c.code)),ev=all.filter(c=>!c.bot);
  const days=[...Array(7)].map((_,i)=>{const d=new Date(Date.now()-(6-i)*864e5);d.setHours(0,0,0,0);const s=d.getTime();
    return{label:d.toLocaleDateString('en',{weekday:'short'}),n:ev.filter(c=>c.t>=s&&c.t<s+864e5).length}});
  const alerts=[];ls.forEach(l=>{const s=state(l);
    if(s==='disabled')alerts.push(`/${l.code} is disabled. Its analytics are kept.`);
    else if(s==='expired')alerts.push(`/${l.code} has expired.`);
    else if(s==='limit reached')alerts.push(`/${l.code} reached its click limit.`);
    else{if(l.expires&&l.expires-Date.now()<7*864e5)alerts.push(`/${l.code} expires in ${Math.ceil((l.expires-Date.now())/864e5)} day(s).`);
      if(l.maxClicks&&l.count>=l.maxClicks*.8)alerts.push(`/${l.code} used ${l.count} of ${l.maxClicks} clicks.`)}});
  if(all.length-ev.length)alerts.push(`${all.length-ev.length} bot click(s) were filtered out.`);
  res.json({links:ls.length,active:ls.filter(l=>state(l)==='active').length,clicks:ev.length,visitors:ls.reduce((s,l)=>s+l.vids.length,0),days,
    top:ls.sort((a,b)=>b.count-a.count).slice(0,5).map(l=>({code:l.code,url:l.url,clicks:l.count})),alerts});
});

app.get('/api/blocklist',auth('admin'),(req,res)=>res.json(db.blocklist));
app.post('/api/blocklist',auth('admin'),(req,res)=>{const d=(req.body.domain||'').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/.*$/,'');
  if(!d.includes('.'))return res.status(400).json({error:'Enter a domain like bad-site.com'});
  if(!db.blocklist.includes(d))db.blocklist.push(d);
  Object.values(db.links).forEach(l=>{try{const h=new URL(l.url).hostname;if(h===d||h.endsWith('.'+d))l.status='disabled'}catch{}});
  save();res.json(db.blocklist)});
app.delete('/api/blocklist/:d',auth('admin'),(req,res)=>{db.blocklist=db.blocklist.filter(x=>x!==req.params.d);save();res.json(db.blocklist)});

/* ---------- redirect engine: status -> expiry -> click limit -> password -> log -> redirect ---------- */
const page=(res,code,msg,form='')=>res.status(code).send(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><body style="font-family:system-ui;max-width:420px;margin:15vh auto;padding:0 20px;color:#10201d"><h2>${msg}</h2>${form}`);
const pwForm=err=>`<form method=post><p style="color:#c0392b">${err||''}</p><input type=password name=pw placeholder=Password autofocus style="padding:10px;font-size:1rem;width:100%;margin:8px 0"><button style="padding:10px 18px;font-size:1rem;background:#3d3bf3;color:#fff;border:0;border-radius:8px">Open link</button></form>`;
function handle(req,res){
  const l=db.links[req.params.code];
  if(!l)return page(res,404,'Link not found');
  const s=state(l);
  if(s==='disabled')return page(res,410,'This link has been disabled');
  if(s==='expired')return page(res,410,'This link has expired');
  if(s==='limit reached')return page(res,410,'This link has reached its click limit');
  if(l.pw){if(req.method==='GET')return page(res,401,'This link is password protected',pwForm());
    if(!pwOk(req.body.pw||'',l.pw))return page(res,401,'This link is password protected',pwForm('Wrong password'))}
  const ua=req.get('user-agent')||'',bot=BOT.test(ua);if(!bot)l.count++;
  const vid=crypto.createHash('sha256').update(req.ip+ua).digest('hex').slice(0,12);
  let ref='Direct';try{ref=new URL(req.get('referer')).hostname}catch{}
  setImmediate(()=>{if(!bot&&!l.vids.includes(vid))l.vids.push(vid);
    db.clicks.push({code:l.code,t:Date.now(),...parseUA(ua),ref,src:req.query.s==='qr'?'QR code':'Link',vid,bot});save()});
  res.redirect(l.url);
}
app.get('/:code([A-Za-z0-9_-]{3,30})',handle);
app.post('/:code([A-Za-z0-9_-]{3,30})',handle);
app.listen(PORT,()=>console.log(`LinkPulse is running at http://localhost:${PORT}`));
