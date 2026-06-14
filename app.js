/* ═══════════════════════════════════════════════════════════════
   TrafficFlow Analytics — Frontend SPA
   ═══════════════════════════════════════════════════════════════ */
   'use strict';

   const API_BASE = (() => {
     const { protocol, hostname, port, origin } = window.location;
     const host = hostname || 'localhost';
   
     if (protocol === 'file:')
       return `http://${host}:5000/api`;
   
     if (['5500', '3000', '5173', '8080'].includes(port))
       return `http://${host}:5000/api`;
   
     if (protocol.startsWith('http'))
       return `${origin.replace(/\/$/, '')}/api`;
   
     return 'http://localhost:5000/api';
   })();
   const AUTH_STORAGE_KEY = 'tf_token';
   
   function getAuthToken(){ return localStorage.getItem(AUTH_STORAGE_KEY); }
   function setAuthToken(token){ if(token)localStorage.setItem(AUTH_STORAGE_KEY,token);else localStorage.removeItem(AUTH_STORAGE_KEY); }
   
   function userFromLogin(res){
     return { id:res.userId, username:res.username, name:res.fullName, role:res.role, email:'', active:true };
   }
   function userFromDto(d){
     return { id:d.id, username:d.username, name:d.fullName, role:d.role, email:d.email, active:d.isActive };
   }
   
   async function apiFetch(path, options={}){
     const headers={ 'Content-Type':'application/json', ...(options.headers||{}) };
     const token=getAuthToken();
     if(token) headers.Authorization=`Bearer ${token}`;
     const res=await fetch(`${API_BASE}${path}`,{...options,headers});
     let data=null;
     const text=await res.text();
     if(text){ try{ data=JSON.parse(text); }catch{ data={ message:text }; } }
     if(!res.ok){
       const err=new Error(data?.message||data?.title||`Ошибка ${res.status}`);
       err.status=res.status; err.data=data; throw err;
     }
     return data;
   }
   
   const HUB_BASE = API_BASE.replace(/\/api\/?$/, '');
   
   function videoFromApi(v){
     return {
       id:v.id, name:v.name, date:v.date, duration:v.duration, size:v.size,
       status:v.status, fps:v.fps||30, totalFrames:v.totalFrames||0,
       stats:{pedestrians:v.stats?.pedestrians||0,cars:v.stats?.cars||0,conflicts:v.stats?.conflicts||0,critical:v.stats?.critical||0},
     };
   }
   function videoStreamUrl(id){
     const t=getAuthToken();
     return `${API_BASE}/videos/${id}/stream${t?`?access_token=${encodeURIComponent(t)}`:''}`;
   }
   async function apiUpload(file){
     const fd=new FormData(); fd.append('file',file);
     const headers={}; const token=getAuthToken();
     if(token) headers.Authorization=`Bearer ${token}`;
     const res=await fetch(`${API_BASE}/videos/upload`,{method:'POST',headers,body:fd});
     const text=await res.text();
     let data=null; if(text){ try{ data=JSON.parse(text);}catch{ data={message:text};}}
     if(!res.ok) throw new Error(data?.message||`Ошибка ${res.status}`);
     return data;
   }
   async function loadVideos(){
     try{
       const list=await apiFetch('/videos');
       state.videos=list.map(videoFromApi);
     }catch(err){
       toast('error',err.message||'Не удалось загрузить видео');
     }
   }
   async function saveZonesToApi(videoId){
     const zones=state.zones.map(z=>({
       name:z.name, color:z.color,
       points:z.points.map(p=>({x:p.x,y:p.y})),
     }));
     await apiFetch(`/videos/${videoId}/zones`,{method:'POST',body:JSON.stringify({zones})});
   }
   async function startProcessingApi(videoId){
     await apiFetch(`/videos/${videoId}/process`,{method:'POST'});
   }
   let processingHubConn=null;
   async function connectProcessingHub(videoId,onProgress){
     if(typeof signalR==='undefined'){ toast('error','SignalR не загружен'); return null; }
     if(processingHubConn) await processingHubConn.stop().catch(()=>{});
     const token=getAuthToken();
     processingHubConn=new signalR.HubConnectionBuilder()
       .withUrl(`${HUB_BASE}/hubs/processing?access_token=${encodeURIComponent(token||'')}`)
       .withAutomaticReconnect()
       .build();
     processingHubConn.on('ProgressUpdate',onProgress);
     await processingHubConn.start();
     await processingHubConn.invoke('SubscribeToVideo',videoId);
     return processingHubConn;
   }
   async function disconnectProcessingHub(){
     if(processingHubConn){ await processingHubConn.stop().catch(()=>{}); processingHubConn=null; }
   }
   function drawDetectionOverlay(canvas, boxes, videoEl){
     if(!canvas)return;
     const ctx=canvas.getContext('2d');
     const w=canvas.width,h=canvas.height;
     ctx.clearRect(0,0,w,h);
     if(!boxes?.length)return;
     boxes.forEach(b=>{
       const x=b.x*w,y=b.y*h,bw=b.width*w,bh=b.height*h;
       const color=b.status==='conflict'?'#ef4444':b.status==='warning'?'#f59e0b':'#22c55e';
       ctx.strokeStyle=color; ctx.lineWidth=2; ctx.strokeRect(x,y,bw,bh);
       const label=`${b.class==='car'?'🚗':'🚶'} #${b.trackId}`;
       ctx.fillStyle=color+'cc'; ctx.fillRect(x,Math.max(0,y-16),Math.min(bw,90),14);
       ctx.fillStyle='#fff'; ctx.font='10px sans-serif'; ctx.textAlign='left';
       ctx.fillText(label,x+3,y-4);
     });
   }
   function syncOverlayCanvas(canvas,videoEl){
     if(!canvas||!videoEl)return;
     const r=videoEl.getBoundingClientRect();
     if(r.width<2)return;
     if(canvas.width!==Math.round(r.width)||canvas.height!==Math.round(r.height)){
       canvas.width=Math.round(r.width); canvas.height=Math.round(r.height);
     }
   }
   function stageIndexFromPct(pct){
     if(pct<5)return 0; if(pct<40)return 1; if(pct<80)return 2; if(pct<90)return 3; if(pct<98)return 4; return 5;
   }
   function parseFilenameFromDisposition(header,fallback){
     if(!header)return fallback;
     const m=header.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
     return m?decodeURIComponent(m[1].replace(/"/g,'')):fallback;
   }
   async function downloadReport(videoId,type){
     const token=getAuthToken();
     if(!token) throw new Error('Требуется вход в систему');
     const ext=type==='pdf'?'pdf':'xlsx';
     const res=await fetch(`${API_BASE}/videos/${videoId}/export/${type}`,{
       headers:{ Authorization:`Bearer ${token}` },
     });
     if(!res.ok){
       let msg=`Ошибка ${res.status}`;
       try{ const j=await res.json(); msg=j.message||msg; }catch{ /* ignore */ }
       throw new Error(msg);
     }
     const blob=await res.blob();
     const name=parseFilenameFromDisposition(res.headers.get('Content-Disposition'),`trafficflow_report.${ext}`);
     const url=URL.createObjectURL(blob);
     const a=document.createElement('a');
     a.href=url; a.download=name; a.click();
     URL.revokeObjectURL(url);
     return name;
   }
   
   const ZONE_COLORS = ['#2563eb','#22c55e','#f59e0b','#ef4444','#a855f7','#06b6d4'];
   const STAGE_LIST = [
     {id:'read',      icon:'📂', label:'Чтение видеофайла'},
     {id:'yolo',      icon:'🧠', label:'Детекция YOLO'},
     {id:'bytetrack', icon:'🔗', label:'Трекинг ByteTrack'},
     {id:'analytics', icon:'📐', label:'Анализ конфликтов'},
     {id:'db',        icon:'💾', label:'Сохранение в БД'},
     {id:'done',      icon:'✅', label:'Завершено'},
   ];
   
   const state = {
     currentUser:null, currentPage:'login',
     videos:[],
     selectedVideo:null, zones:[], uploadedFile:null,
     processingProgress:0, processingStage:0, liveBoxes:[],
     dashboardData:null, adminTab:'users', adminUsers:null,
     systemMetrics:{cpu:24,ram:58,disk:37},
     algorithmSettings:{confidence:0.45,iou:0.5,ttcThreshold:3.0,distThreshold:2.5,minTrackLen:8,maxMissedFrames:15},
     playerFrame:0, playerPlaying:false,
     activeFilters:{search:'',status:'all'},
   };
   
   let sysMetricsTimer = null;
   
   function navigate(page,params={}){Object.assign(state,params);state.currentPage=page;render();}
   async function navigateAsync(page,params={}){Object.assign(state,params);state.currentPage=page;if(page==='home'&&state.currentUser)await loadVideos();render();}
   
   function render(){
     const app=document.getElementById('app');
     if(!app)return;
     if(!state.currentUser){
       if(state.currentPage==='register'){app.innerHTML=renderRegister();bindRegister();return;}
       state.currentPage='login';
       app.innerHTML=renderLogin();bindLogin();return;
     }
     app.innerHTML=`<div class="app-layout">${renderSidebar()}<div class="main-content">${renderTopbar()}<div class="page-content" id="page-content">${renderPage()}</div></div></div>`;
     bindLayout();bindPage();
   }
   
   // ── LOGIN / REGISTER ──
   function showAuthError(errW, errT, message){
     errT.textContent=message; errW.classList.remove('hidden');
   }
   function renderLogin(){
     return `<div class="login-page"><div class="login-card">
     <div class="login-logo"><div class="login-logo-icon">🚦</div><div class="login-logo-text"><h1>TrafficFlow</h1><p>Analytics Platform</p></div></div>
     <form class="login-form" id="login-form">
       <div id="login-error" class="login-error hidden"><span>⚠️</span><span id="login-error-text"></span></div>
       <div class="form-group"><label class="form-label">Логин</label><input class="form-input" id="login-username" type="text" placeholder="Введите логин" autocomplete="username"/></div>
       <div class="form-group"><label class="form-label">Пароль</label><input class="form-input" id="login-password" type="password" placeholder="Введите пароль" autocomplete="current-password"/></div>
       <button class="btn btn-primary btn-lg login-submit w-full" type="submit" id="login-btn">🔐 Войти в систему</button>
     </form>
     <p class="login-switch">Нет аккаунта? <button type="button" class="login-link" id="goto-register">Зарегистрироваться</button></p>
     <div class="login-hint"><strong>Тестовые аккаунты:</strong> admin / admin123 · analyst / analyst123</div>
     </div></div>`;
   }
   function renderRegister(){
     return `<div class="login-page"><div class="login-card">
     <div class="login-logo"><div class="login-logo-icon">🚦</div><div class="login-logo-text"><h1>Регистрация</h1><p>Создайте аккаунт аналитика</p></div></div>
     <form class="login-form" id="register-form">
       <div id="register-error" class="login-error hidden"><span>⚠️</span><span id="register-error-text"></span></div>
       <div class="form-group"><label class="form-label">Полное имя</label><input class="form-input" id="reg-name" type="text" placeholder="Иван Иванов" autocomplete="name"/></div>
       <div class="form-group"><label class="form-label">Email</label><input class="form-input" id="reg-email" type="email" placeholder="you@example.com" autocomplete="email"/></div>
       <div class="form-group"><label class="form-label">Логин</label><input class="form-input" id="reg-username" type="text" placeholder="не короче 3 символов" autocomplete="username"/></div>
       <div class="form-group"><label class="form-label">Пароль</label><input class="form-input" id="reg-password" type="password" placeholder="не короче 6 символов" autocomplete="new-password"/></div>
       <div class="form-group"><label class="form-label">Повторите пароль</label><input class="form-input" id="reg-password2" type="password" placeholder="Повторите пароль" autocomplete="new-password"/></div>
       <button class="btn btn-primary btn-lg login-submit w-full" type="submit" id="register-btn">✨ Создать аккаунт</button>
     </form>
     <p class="login-switch">Уже есть аккаунт? <button type="button" class="login-link" id="goto-login">Войти</button></p>
     </div></div>`;
   }
   function bindLogin(){
     const form=document.getElementById('login-form');if(!form)return;
     document.getElementById('goto-register')?.addEventListener('click',()=>navigate('register'));
     form.addEventListener('submit',async e=>{
       e.preventDefault();
       const u=document.getElementById('login-username').value.trim();
       const p=document.getElementById('login-password').value;
       const btn=document.getElementById('login-btn');
       const errW=document.getElementById('login-error');
       const errT=document.getElementById('login-error-text');
       errW.classList.add('hidden');
       btn.disabled=true;btn.textContent='⏳ Проверка...';
       try{
         const res=await apiFetch('/auth/login',{method:'POST',body:JSON.stringify({username:u,password:p})});
         setAuthToken(res.token);
         state.currentUser=userFromLogin(res);
         toast('success',`Добро пожаловать, ${res.fullName}!`);
         await loadVideos();
         navigate('home');
       }catch(err){
         const msg=err.status===403?'Аккаунт заблокирован.':(err.message||'Неверный логин или пароль.');
         showAuthError(errW,errT,msg);
         btn.disabled=false;btn.textContent='🔐 Войти в систему';
       }
     });
     document.getElementById('login-username').focus();
   }
   function bindRegister(){
     const form=document.getElementById('register-form');if(!form)return;
     document.getElementById('goto-login')?.addEventListener('click',()=>navigate('login'));
     form.addEventListener('submit',async e=>{
       e.preventDefault();
       const name=document.getElementById('reg-name').value.trim();
       const email=document.getElementById('reg-email').value.trim();
       const username=document.getElementById('reg-username').value.trim();
       const password=document.getElementById('reg-password').value;
       const password2=document.getElementById('reg-password2').value;
       const btn=document.getElementById('register-btn');
       const errW=document.getElementById('register-error');
       const errT=document.getElementById('register-error-text');
       errW.classList.add('hidden');
       if(password!==password2){showAuthError(errW,errT,'Пароли не совпадают.');return;}
       btn.disabled=true;btn.textContent='⏳ Создание...';
       try{
         const res=await apiFetch('/auth/signup',{method:'POST',body:JSON.stringify({username,password,fullName:name,email})});
         setAuthToken(res.token);
         state.currentUser=userFromLogin(res);
         toast('success',`Аккаунт создан. Добро пожаловать, ${res.fullName}!`);
         await loadVideos();
         navigate('home');
       }catch(err){
         showAuthError(errW,errT,err.message||'Не удалось зарегистрироваться.');
         btn.disabled=false;btn.textContent='✨ Создать аккаунт';
       }
     });
     document.getElementById('reg-name').focus();
   }
   
   // ── SIDEBAR ──
   function renderSidebar(){
     const u=state.currentUser;const isAdmin=u?.role==='admin';
     const ni=(page,icon,label,badge='')=>`<div class="nav-item ${state.currentPage===page?'active':''}" data-page="${page}"><span class="nav-icon">${icon}</span><span>${label}</span>${badge?`<span class="nav-badge">${badge}</span>`:''}</div>`;
     const hasProcVideo=state.videos.find(v=>v.status==='processing');
     return `<aside class="sidebar" id="sidebar">
     <div class="sidebar-header"><div class="sidebar-logo-icon">🚦</div><div class="sidebar-logo-text"><h2>TrafficFlow</h2><p>Analytics v2.0</p></div></div>
     <nav class="sidebar-nav">
       <div class="nav-section-title">Основное</div>
       ${ni('home','🏠','Мои видео')}
       ${ni('upload','📤','Загрузить видео')}
       ${ni('archive','📁','Архив отчётов')}
       ${hasProcVideo?ni('processing','⚙️','Обработка','1'):''}
       ${isAdmin?`<div class="nav-section-title">Администрирование</div>${ni('admin-users','👥','Пользователи')}${ni('admin-settings','⚙️','Настройки алгоритмов')}${ni('admin-system','🖥️','Система')}`:''}
     </nav>
     <div class="sidebar-footer"><div class="user-info" id="logout-btn">
       <div class="user-avatar">${(u?.name||'U').split(' ').map(w=>w[0]).join('').slice(0,2)}</div>
       <div><div class="user-name">${u?.name||''}</div><div class="user-role">${u?.role==='admin'?'👑 Администратор':'🔍 Аналитик'}</div></div>
       <span style="margin-left:auto;color:var(--text-muted);font-size:.8rem">↩</span>
     </div></div></aside>`;
   }
   
   // ── TOPBAR ──
   function renderTopbar(){
     const titles={home:'🏠 Мои видео',upload:'📤 Загрузка видео',zones:'🗺️ Зоны интереса',processing:'⚙️ Обработка',dashboard:'📊 Дашборд',archive:'📁 Архив','admin-users':'👥 Пользователи','admin-settings':'⚙️ Настройки алгоритмов','admin-system':'🖥️ Система'};
     return `<header class="topbar"><span class="topbar-title">${titles[state.currentPage]||'TrafficFlow'}</span>
     <div class="topbar-actions"><span class="text-sm text-muted">${new Date().toLocaleDateString('ru-RU',{day:'2-digit',month:'long',year:'numeric'})}</span>
     ${state.currentPage==='home'?`<button class="btn btn-primary btn-sm" id="topbar-upload">📤 Загрузить</button>`:''}</div></header>`;
   }
   
   // ── PAGE DISPATCHER ──
   function renderPage(){
     const pages={home:renderHome,upload:renderUpload,zones:renderZones,processing:renderProcessing,dashboard:renderDashboard,archive:renderArchive,'admin-users':renderAdminUsers,'admin-settings':renderAdminSettings,'admin-system':renderAdminSystem};
     return (pages[state.currentPage]||(() => '<p class="text-muted">Страница не найдена</p>'))();
   }
   function bindPage(){
     const binders={home:bindHome,upload:bindUpload,zones:bindZones,processing:bindProcessing,dashboard:bindDashboard,archive:bindArchive,'admin-users':bindAdminUsers,'admin-settings':bindAdminSettings,'admin-system':bindAdminSystem};
     (binders[state.currentPage]||(() =>{}))();
   }
   
   // ── HOME ──
   function renderHome(){
     if(!state.videos.length)return`<div class="empty-state"><div class="empty-icon">📹</div><div class="empty-title">Нет загруженных видео</div><div class="empty-text">Загрузите первое видео для анализа</div><button class="btn btn-primary mt-4" id="empty-upload">📤 Загрузить видео</button></div>`;
     const sb=s=>({done:'<span class="badge badge-green">✅ Обработано</span>',processing:'<span class="badge badge-yellow">⚙️ В обработке</span>',queued:'<span class="badge badge-blue">⏳ В очереди</span>',error:'<span class="badge badge-red">❌ Ошибка</span>'}[s]||'<span class="badge badge-gray">—</span>');
     const cards=state.videos.map(v=>`
     <div class="video-card" data-id="${v.id}">
       <div class="video-thumb"><canvas id="thumb-${v.id}" width="300" height="160"></canvas><div class="video-thumb-overlay">▶️</div></div>
       <div class="video-info">
         <div class="video-name truncate">${v.name}</div>
         <div class="video-meta" style="margin-top:.5rem">${sb(v.status)}<span class="video-stat">📅 ${v.date}</span><span class="video-stat">⏱ ${v.duration}</span><span class="video-stat">💾 ${v.size}</span></div>
         ${v.status==='done'?`<div class="video-meta" style="margin-top:.6rem"><span class="video-stat">🚶 ${v.stats.pedestrians}</span><span class="video-stat">🚗 ${v.stats.cars}</span><span class="video-stat text-yellow">⚠️ ${v.stats.conflicts}</span><span class="video-stat text-red">🔴 ${v.stats.critical}</span></div>`:''}
       </div>
       <div class="video-actions">
         ${v.status==='done'?`<button class="btn btn-primary btn-sm" data-action="dashboard" data-id="${v.id}">📊 Дашборд</button><button class="btn btn-ghost btn-sm" data-action="export" data-id="${v.id}">📥 Отчёт</button>`:''}
         ${v.status==='processing'?`<button class="btn btn-outline btn-sm" data-action="goto-processing" data-id="${v.id}">⚙️ Статус</button>`:''}
         <button class="btn btn-ghost btn-sm" data-action="delete" data-id="${v.id}" style="margin-left:auto">🗑</button>
       </div>
     </div>`).join('');
     return`<div class="page-header"><div><div class="page-title">Мои видео</div><div class="page-subtitle">${state.videos.length} записей · ${state.videos.filter(v=>v.status==='done').length} обработано</div></div><button class="btn btn-primary" id="home-upload-btn">📤 Загрузить видео</button></div><div class="video-grid">${cards}</div>`;
   }
   function bindHome(){
     document.getElementById('home-upload-btn')?.addEventListener('click',()=>navigate('upload'));
     document.getElementById('topbar-upload')?.addEventListener('click',()=>navigate('upload'));
     document.getElementById('empty-upload')?.addEventListener('click',()=>navigate('upload'));
     state.videos.forEach(v=>{const c=document.getElementById(`thumb-${v.id}`);if(c)drawThumb(c,v);});
     document.querySelectorAll('[data-action]').forEach(btn=>{
       btn.addEventListener('click',e=>{
         e.stopPropagation();
         const id=+btn.dataset.id;const video=state.videos.find(v=>v.id===id);const action=btn.dataset.action;
         if(action==='dashboard'){state.selectedVideo=video;navigate('dashboard');}
         if(action==='goto-processing')navigate('processing');
         if(action==='export')openExportModal(video);
         if(action==='delete')confirmDeleteVideo(id);
       });
     });
     document.querySelectorAll('.video-card').forEach(card=>{
       card.addEventListener('click',()=>{const id=+card.dataset.id;const video=state.videos.find(v=>v.id===id);if(video?.status==='done'){state.selectedVideo=video;navigate('dashboard');}});
     });
   }
   function drawThumb(canvas,video){
     const ctx=canvas.getContext('2d');const w=canvas.width,h=canvas.height;
     ctx.fillStyle='#1a1a2e';ctx.fillRect(0,0,w,h);
     const img=new Image();
     img.crossOrigin='anonymous';
     img.onload=()=>{ctx.drawImage(img,0,0,w,h);if(video.status==='processing'){ctx.fillStyle='rgba(0,0,0,.55)';ctx.fillRect(0,0,w,h);ctx.fillStyle='#f59e0b';ctx.font='bold 13px sans-serif';ctx.textAlign='center';ctx.fillText('⚙️ Обработка...',w/2,h/2);}};
     img.onerror=()=>{ctx.fillStyle='#2a2a40';ctx.fillRect(0,0,w,h);ctx.fillStyle='#888';ctx.font='12px sans-serif';ctx.textAlign='center';ctx.fillText('🎬',w/2,h/2);};
     img.src=`${videoStreamUrl(video.id)}#t=0.5`;
   }
   
   // ── UPLOAD ──
   function renderUpload(){
     return`<div class="upload-page">
     <div class="page-header"><div><div class="page-title">Загрузка видео</div><div class="page-subtitle">MP4, AVI, MOV, MKV · до 4 ГБ</div></div><button class="btn btn-ghost" id="upload-back">← Назад</button></div>
     <div class="drop-zone" id="drop-zone"><input type="file" id="file-input" accept="video/*"/><div class="drop-icon">📹</div><div class="drop-title">Перетащите видеофайл сюда</div><div class="drop-sub">или нажмите для выбора</div><div class="drop-formats">MP4 · AVI · MOV · MKV · до 4 ГБ</div></div>
     <div id="file-preview" class="hidden"></div>
     <div id="upload-progress" class="hidden progress-wrap"></div>
     <div id="upload-actions" class="hidden" style="margin-top:1.5rem;display:flex;gap:.75rem;flex-wrap:wrap"></div>
     </div>`;
   }
   function bindUpload(){
     document.getElementById('upload-back')?.addEventListener('click',()=>navigate('home'));
     const dz=document.getElementById('drop-zone');const fi=document.getElementById('file-input');
     ['dragenter','dragover'].forEach(e=>dz.addEventListener(e,ev=>{ev.preventDefault();dz.classList.add('drag-over');}));
     ['dragleave','drop'].forEach(e=>dz.addEventListener(e,ev=>{ev.preventDefault();dz.classList.remove('drag-over');}));
     dz.addEventListener('drop',ev=>handleFile(ev.dataTransfer.files[0]));
     fi.addEventListener('change',()=>handleFile(fi.files[0]));
   }
   function handleFile(file){
     if(!file)return;
     if(file.size>4*1024*1024*1024){toast('error','Файл превышает 4 ГБ');return;}
     state.uploadedFile=file;
     const sizeMB=(file.size/1024/1024).toFixed(1);
     const preview=document.getElementById('file-preview');
     preview.innerHTML=`<div class="file-preview"><span class="file-icon">🎬</span><div class="file-info"><div class="file-name">${file.name}</div><div class="file-size">${sizeMB} МБ</div></div><button class="file-remove" id="file-remove-btn">✕</button></div>`;
     preview.classList.remove('hidden');
     document.getElementById('file-remove-btn').addEventListener('click',()=>{state.uploadedFile=null;preview.classList.add('hidden');document.getElementById('upload-progress').classList.add('hidden');document.getElementById('upload-actions').classList.add('hidden');});
     startRealUpload(file);
   }
   async function startRealUpload(file){
     const pw=document.getElementById('upload-progress');const ad=document.getElementById('upload-actions');
     pw.classList.remove('hidden');
     pw.innerHTML=`<div class="progress-header"><span id="up-label">Загрузка на сервер...</span><span id="up-stats">⏳</span></div><div class="progress-bar-bg"><div class="progress-bar-fill" id="up-bar" style="width:30%"></div></div>`;
     ad.classList.add('hidden');
     try{
       const v=await apiUpload(file);
       const nv=videoFromApi(v);
       state.videos.unshift(nv); state.selectedVideo=nv; state.zones=[];
       document.getElementById('up-label').textContent='✅ Загрузка завершена!';
       document.getElementById('up-stats').textContent='100%';
       document.getElementById('up-bar').style.width='100%';
       document.getElementById('up-bar').style.background='var(--green)';
       toast('success','Видео загружено на сервер');
       ad.innerHTML=`<button class="btn btn-primary" id="goto-zones">🗺️ Настроить зоны интереса</button><button class="btn btn-ghost" id="skip-zones">⏩ Запустить без зон</button>`;
       ad.style.display='flex'; ad.classList.remove('hidden');
       document.getElementById('goto-zones').addEventListener('click',()=>navigate('zones'));
       document.getElementById('skip-zones').addEventListener('click',()=>launchProcessing(nv,false));
     }catch(err){
       toast('error',err.message||'Ошибка загрузки');
       pw.classList.add('hidden');
     }
   }
   async function launchProcessing(video,withZones){
     state.selectedVideo=video;
     try{
       if(withZones) await saveZonesToApi(video.id);
       await startProcessingApi(video.id);
       video.status='processing';
       navigate('processing');
     }catch(err){ toast('error',err.message||'Не удалось запустить обработку'); }
   }
   
   // ── ZONES ──
   function renderZones(){
     const zl=state.zones.map((z,i)=>`<div class="zone-item" data-zone="${i}"><div class="zone-color" style="background:${z.color}"></div><span class="zone-name">${z.name}</span><span class="zone-points">${z.points.length} точек</span><button class="zone-del" data-del="${i}">✕</button></div>`).join('')||'<div class="text-muted text-sm">Зоны не добавлены</div>';
     return`<div class="zones-layout">
     <div>
       <div class="page-header" style="margin-bottom:1rem"><div><div class="page-title">Зоны интереса</div><div class="page-subtitle">Щёлкните по кадру для точек. Двойной клик — замкнуть.</div></div><button class="btn btn-ghost" id="zones-back">← Назад</button></div>
       <div class="canvas-wrap video-overlay-wrap"><video id="zones-video" class="zones-video" muted playsinline preload="metadata"></video><canvas id="zones-canvas" class="overlay-canvas" width="800" height="450"></canvas>
       <div class="canvas-toolbar"><button class="btn btn-ghost btn-sm" id="zones-undo">↩ Отменить</button><button class="btn btn-ghost btn-sm" id="zones-clear-zone">🗑 Очистить</button><button class="btn btn-primary btn-sm" id="zones-finish">✅ Замкнуть</button><div id="zones-hint" class="text-sm text-muted" style="margin-left:auto">Кликайте для точек</div></div></div>
     </div>
     <div class="zones-panel">
       <div class="card card-sm"><div class="card-title">➕ Новая зона</div>
         <div class="form-group"><label class="form-label">Название</label><input class="form-input" id="zone-name-input" value="Пешеходный переход"/></div>
         <div class="form-group mt-2"><label class="form-label">Цвет</label><div style="display:flex;gap:.4rem;flex-wrap:wrap">${ZONE_COLORS.map((c,i)=>`<div class="zone-color-opt" data-color="${c}" style="width:24px;height:24px;border-radius:6px;background:${c};cursor:pointer;border:2px solid ${i===0?'#fff':'transparent'}"></div>`).join('')}</div></div>
       </div>
       <div class="card card-sm"><div class="card-title">🗺️ Созданные зоны</div><div class="zones-list" id="zones-list">${zl}</div></div>
       <button class="btn btn-success" id="zones-save" ${state.zones.length===0?'disabled':''}>🚀 Сохранить и запустить</button>
       <button class="btn btn-ghost" id="zones-start-no">⏩ Запустить без зон</button>
     </div></div>`;
   }
   function bindZones(){
     const canvas=document.getElementById('zones-canvas');if(!canvas)return;
     const videoEl=document.getElementById('zones-video');
     const video=state.selectedVideo;
     if(videoEl&&video){ videoEl.src=videoStreamUrl(video.id); videoEl.onloadeddata=()=>{ syncOverlayCanvas(canvas,videoEl); drawZonesCanvas(canvas.getContext('2d'),canvas,pts,color,videoEl); }; }
     const ctx=canvas.getContext('2d');let pts=[];let color=ZONE_COLORS[0];
     document.getElementById('zones-back')?.addEventListener('click',()=>navigate('upload'));
     document.querySelectorAll('.zone-color-opt').forEach(el=>{el.addEventListener('click',()=>{color=el.dataset.color;document.querySelectorAll('.zone-color-opt').forEach(o=>o.style.border='2px solid transparent');el.style.border='2px solid #fff';});});
     const normClick=e=>{const r=canvas.getBoundingClientRect();pts.push({x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height});};
     drawZonesCanvas(ctx,canvas,pts,color,videoEl);
     canvas.addEventListener('click',e=>{normClick(e);drawZonesCanvas(ctx,canvas,pts,color,videoEl);document.getElementById('zones-hint').textContent=`${pts.length} точек. Двойной клик — замкнуть.`;});
     canvas.addEventListener('dblclick',()=>finishZone());
     document.getElementById('zones-undo')?.addEventListener('click',()=>{pts.pop();drawZonesCanvas(ctx,canvas,pts,color,videoEl);});
     document.getElementById('zones-clear-zone')?.addEventListener('click',()=>{pts=[];drawZonesCanvas(ctx,canvas,pts,color,videoEl);});
     document.getElementById('zones-finish')?.addEventListener('click',finishZone);
     function finishZone(){
       if(pts.length<3){toast('warning','Нужно минимум 3 точки');return;}
       const name=document.getElementById('zone-name-input').value||`Зона ${state.zones.length+1}`;
       state.zones.push({name,color,points:[...pts]});pts=[];
       color=ZONE_COLORS[state.zones.length%ZONE_COLORS.length];
       drawZonesCanvas(ctx,canvas,pts,color,videoEl);
       toast('success',`Зона «${name}» добавлена`);
       const sb=document.getElementById('zones-save');if(sb)sb.disabled=false;
       refreshZoneList(ctx,canvas,pts,color,videoEl);
     }
     document.getElementById('zones-save')?.addEventListener('click',()=>{if(state.selectedVideo)launchProcessing(state.selectedVideo,true);});
     document.getElementById('zones-start-no')?.addEventListener('click',()=>{state.zones=[];if(state.selectedVideo)launchProcessing(state.selectedVideo,false);});
     document.querySelectorAll('.zone-del').forEach(btn=>{btn.addEventListener('click',()=>{state.zones.splice(+btn.dataset.del,1);drawZonesCanvas(ctx,canvas,pts,color,videoEl);refreshZoneList(ctx,canvas,pts,color,videoEl);});});
     function refreshZoneList(ctx,canvas,pts,color,videoEl){
       const list=document.getElementById('zones-list');if(!list)return;
       list.innerHTML=state.zones.map((z,i)=>`<div class="zone-item" data-zone="${i}"><div class="zone-color" style="background:${z.color}"></div><span class="zone-name">${z.name}</span><span class="zone-points">${z.points.length} точек</span><button class="zone-del" data-del="${i}">✕</button></div>`).join('')||'<div class="text-muted text-sm">Зоны не добавлены</div>';
       list.querySelectorAll('.zone-del').forEach(btn=>{btn.addEventListener('click',()=>{state.zones.splice(+btn.dataset.del,1);drawZonesCanvas(ctx,canvas,pts,color,videoEl);refreshZoneList(ctx,canvas,pts,color,videoEl);const sb=document.getElementById('zones-save');if(sb)sb.disabled=state.zones.length===0;});});
     }
   }
   function drawZonesCanvas(ctx,canvas,currentPoints,color,videoEl){
     const w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);
     if(videoEl&&videoEl.videoWidth>0){
       try{ ctx.drawImage(videoEl,0,0,w,h); }catch{ ctx.fillStyle='#1a1a2e';ctx.fillRect(0,0,w,h); }
     }else{ ctx.fillStyle='#1a1a2e';ctx.fillRect(0,0,w,h); }
     state.zones.forEach(zone=>{
       if(zone.points.length<2)return;
       ctx.beginPath();ctx.moveTo(zone.points[0].x*w,zone.points[0].y*h);
       zone.points.forEach((p,i)=>{if(i>0)ctx.lineTo(p.x*w,p.y*h);});ctx.closePath();
       ctx.fillStyle=zone.color+'33';ctx.fill();ctx.strokeStyle=zone.color;ctx.lineWidth=2;ctx.stroke();
       const cx=zone.points.reduce((s,p)=>s+p.x,0)/zone.points.length*w;
       const cy=zone.points.reduce((s,p)=>s+p.y,0)/zone.points.length*h;
       ctx.fillStyle=zone.color;ctx.font='bold 13px sans-serif';ctx.textAlign='center';ctx.fillText(zone.name,cx,cy);
     });
     if(currentPoints.length>0){
       ctx.beginPath();ctx.moveTo(currentPoints[0].x*w,currentPoints[0].y*h);
       currentPoints.forEach((p,i)=>{if(i>0)ctx.lineTo(p.x*w,p.y*h);});
       ctx.strokeStyle=color;ctx.lineWidth=2;ctx.setLineDash([6,4]);ctx.stroke();ctx.setLineDash([]);
       currentPoints.forEach(p=>{ctx.beginPath();ctx.arc(p.x*w,p.y*h,5,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();});
     }
   }
   
   // ── PROCESSING ──
   function renderProcessing(){
     const video=state.selectedVideo||state.videos.find(v=>v.status==='processing');
     return`<div class="page-header"><div><div class="page-title">Обработка видео</div><div class="page-subtitle">${video?.name||'Видео'}</div></div></div>
     <div class="processing-layout">
       <div><div class="processing-preview video-overlay-wrap">
         <video id="proc-video" muted playsinline preload="auto"></video>
         <canvas id="proc-overlay" class="overlay-canvas"></canvas>
         <div style="padding:.75rem 1rem;border-top:1px solid var(--border)">
           <div class="progress-header"><span id="proc-stage-label">Инициализация...</span><span id="proc-pct">0%</span></div>
           <div class="progress-bar-bg" style="height:10px"><div class="progress-bar-fill" id="proc-bar" style="width:0%"></div></div>
           <div style="display:flex;gap:1.5rem;margin-top:.6rem">
             <span class="text-sm text-muted">⏱ <span id="proc-elapsed">0:00</span></span>
             <span class="text-sm text-muted">🎞 <span id="proc-frame">0</span>/<span id="proc-total">—</span></span>
             <span class="text-sm text-muted">⚡ <span id="proc-fps">0</span> fps</span>
             <span class="text-sm text-muted">⏳ <span id="proc-eta">—</span></span>
           </div>
         </div>
       </div></div>
       <div class="processing-panel">
         <div class="card card-sm"><div class="card-title">📋 Этапы</div><div class="stage-list">${STAGE_LIST.map(s=>`<div class="stage-item pending" id="stage-${s.id}"><span class="stage-icon">${s.icon}</span><span>${s.label}</span></div>`).join('')}</div></div>
         <div class="card card-sm"><div class="card-title">📊 В реальном времени</div><div class="stats-grid-sm">
           <div class="stat-sm"><div class="stat-sm-val" id="rt-pedestrians">0</div><div class="stat-sm-lbl">Пешеходы</div></div>
           <div class="stat-sm"><div class="stat-sm-val" id="rt-cars">0</div><div class="stat-sm-lbl">Авто</div></div>
           <div class="stat-sm"><div class="stat-sm-val text-yellow" id="rt-conflicts">0</div><div class="stat-sm-lbl">Конфликты</div></div>
           <div class="stat-sm"><div class="stat-sm-val text-red" id="rt-critical">0</div><div class="stat-sm-lbl">Критические</div></div>
         </div></div>
         <div id="proc-done-actions" class="hidden" style="display:flex;flex-direction:column;gap:.75rem">
           <button class="btn btn-primary" id="goto-dashboard">📊 Открыть дашборд</button>
           <button class="btn btn-ghost"   id="goto-archive">📁 В архив</button>
         </div>
       </div>
     </div>`;
   }
   function bindProcessing(){
     const video=state.selectedVideo||state.videos.find(v=>v.status==='processing');
     const videoEl=document.getElementById('proc-video');
     const overlay=document.getElementById('proc-overlay');
     if(!video||!videoEl||!overlay)return;
   
     videoEl.src=videoStreamUrl(video.id);
     videoEl.load();
     const startTime=Date.now();
     let totalFrames=video.totalFrames||0;
   
     const onProgress=async p=>{
       if(!document.getElementById('proc-video'))return;
       totalFrames=p.totalFrames||totalFrames;
       const fps=video.fps||30;
       if(p.currentFrame!=null&&totalFrames>0){
         const t=p.currentFrame/fps;
         if(Math.abs(videoEl.currentTime-t)>0.15) videoEl.currentTime=Math.min(t,(videoEl.duration||t)-0.01);
       }
       syncOverlayCanvas(overlay,videoEl);
       const boxes=(p.boxes||[]).map(b=>({trackId:b.trackId,class:b.class||b['class'],x:b.x,y:b.y,width:b.width,height:b.height,status:b.status}));
       drawDetectionOverlay(overlay,boxes,videoEl);
   
       const pct=p.progressPct??0;
       const si=stageIndexFromPct(pct);
       STAGE_LIST.forEach((s,i)=>{const el=document.getElementById(`stage-${s.id}`);if(el)el.className='stage-item '+(i<si?'done':i===si?'active':'pending');});
       const $=id=>document.getElementById(id);
       const elapsed=Math.floor((Date.now()-startTime)/1000);
       if($('proc-elapsed'))$('proc-elapsed').textContent=`${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,'0')}`;
       if($('proc-frame'))$('proc-frame').textContent=p.currentFrame??0;
       if($('proc-total'))$('proc-total').textContent=totalFrames||'—';
       if($('proc-fps'))$('proc-fps').textContent=Math.round(p.fps||fps);
       if($('proc-bar'))$('proc-bar').style.width=pct+'%';
       if($('proc-pct'))$('proc-pct').textContent=pct+'%';
       if($('proc-stage-label'))$('proc-stage-label').textContent=p.stage||STAGE_LIST[si]?.label||'';
       if($('rt-pedestrians'))$('rt-pedestrians').textContent=p.pedestrians??0;
       if($('rt-cars'))$('rt-cars').textContent=p.cars??0;
       if($('rt-conflicts'))$('rt-conflicts').textContent=p.conflicts??0;
       if($('rt-critical'))$('rt-critical').textContent=p.critical??0;
   
       if(p.isCompleted){
         await loadVideos();
         const updated=state.videos.find(v=>v.id===video.id)||video;
         state.selectedVideo=updated;
         updated.status='done';
         toast('success','✅ Обработка завершена!');
         const da=$('proc-done-actions');
         if(da){da.classList.remove('hidden');da.style.display='flex';}
         document.getElementById('goto-dashboard')?.addEventListener('click',()=>navigate('dashboard'),{once:true});
         document.getElementById('goto-archive')?.addEventListener('click',()=>navigate('archive'),{once:true});
         await disconnectProcessingHub();
       }
     };
   
     connectProcessingHub(video.id,onProgress).catch(err=>toast('error',err.message||'Нет связи с сервером обработки'));
   
     const resizeObs=()=>{ syncOverlayCanvas(overlay,videoEl); drawDetectionOverlay(overlay,state.liveBoxes,videoEl); };
     videoEl.addEventListener('loadedmetadata',resizeObs);
     window.addEventListener('resize',resizeObs);
   }
   
   // ── DASHBOARD ──
   function renderDashboard(){
     const v=state.selectedVideo||state.videos.find(v=>v.status==='done');
     if(!v)return`<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-title">Нет данных</div></div>`;
     if(!state.dashboardData)return`<div class="page-header"><div class="page-title">📊 Дашборд</div></div><div class="card" style="padding:2rem;text-align:center;color:var(--text-secondary)">⏳ Загрузка данных...</div>`;
     const s=v.stats;
     const events=state.dashboardData.events||[];
     const sevBadge=sev=>{
       const s2=(sev||'').toLowerCase();
       if(s2.includes('critical')||s2==='red')return'<span class="badge badge-red">🔴 Критично</span>';
       if(s2.includes('conflict'))return'<span class="badge badge-red">🔴 Конфликт</span>';
       if(s2.includes('warning')||s2==='yellow')return'<span class="badge badge-yellow">⚠️ Предупр.</span>';
       return'<span class="badge badge-green">✅ Норма</span>';
     };
     const evRows=events.length?events.map((e,i)=>`<tr data-frame="${e.frameNumber}" class="${i===0?'selected':''}"><td><code style="color:var(--accent);font-size:.8rem">${e.timeFormatted}</code></td><td>${sevBadge(e.severity)}</td><td>🚶 #${e.pedestrianTrackId}</td><td>🚗 #${e.carTrackId}</td><td>${e.distance}</td><td>${e.ttc}</td><tr>`).join('')
       :'<tr><td colspan="6" style="text-align:center;padding:1.5rem;color:var(--text-muted)">Событий не обнаружено</td></tr>';
     const maxFrame=v.totalFrames||33000;
     return`<div class="page-header"><div><div class="page-title">📊 Дашборд</div><div class="page-subtitle">${v.name} · ${v.date}</div></div>
     <div style="display:flex;gap:.75rem">
       <button class="btn btn-ghost" onclick="navigate('home')" style="cursor:pointer">← К списку</button>
       <button class="btn btn-primary" onclick="openExportModal(state.selectedVideo)" style="cursor:pointer">📥 Экспорт</button>
     </div></div>
     <div class="kpi-grid">
       <div class="kpi-card"><div class="kpi-icon blue">🚶</div><div><div class="kpi-val">${s.pedestrians}</div><div class="kpi-lbl">Пешеходов</div></div></div>
       <div class="kpi-card"><div class="kpi-icon green">🚗</div><div><div class="kpi-val">${s.cars}</div><div class="kpi-lbl">Автомобилей</div></div></div>
       <div class="kpi-card"><div class="kpi-icon yellow">⚠️</div><div><div class="kpi-val">${s.conflicts}</div><div class="kpi-lbl">Конфликтов</div></div></div>
       <div class="kpi-card"><div class="kpi-icon red">🔴</div><div><div class="kpi-val">${s.critical}</div><div class="kpi-lbl">Критических</div></div></div>
     </div>
     <div class="dash-grid-top">
       <div class="card" style="padding:1rem"><div class="card-title">🎬 Видео с аннотациями</div>
         <div class="player-wrap video-overlay-wrap"><video id="player-video" playsinline preload="metadata"></video><canvas id="player-overlay" class="overlay-canvas"></canvas>
         <div class="player-controls"><button class="player-btn" id="player-play">▶️</button><input type="range" class="player-timeline" id="player-timeline" min="0" max="${maxFrame}" value="0" step="1"/><span class="player-time" id="player-time">00:00 / ${v.duration}</span></div></div>
         <div style="display:flex;gap:.75rem;margin-top:.75rem;flex-wrap:wrap"><span class="badge badge-green">🟢 Норма</span><span class="badge badge-yellow">🟡 Предупр.</span><span class="badge badge-red">🔴 Конфликт</span></div>
       </div>
       <div class="card" style="padding:1rem"><div class="card-title">📋 События (${events.length})</div>
         <div class="events-table-wrap" style="max-height:380px;overflow-y:auto"><table class="events-table"><thead><tr><th>Время</th><th>Тип</th><th>Пешех.</th><th>Авт.</th><th>Дист.</th><th>TTC</th></tr></thead><tbody id="events-tbody">${evRows}</tbody></table></div>
       </div>
     </div>
     <div class="dash-grid-bot">
       <div class="card"><div class="card-title">🌡️ Тепловая карта</div><div class="heatmap-wrap"><canvas id="heatmap-canvas" width="600" height="340" style="display:block;width:100%;background:#0f0f1a;border-radius:12px"></canvas></div></div>
       <div style="display:flex;flex-direction:column;gap:1.5rem">
         <div class="card"><div class="card-title">📈 Интенсивность движения</div><div class="chart-wrap"><canvas id="chart-intensity" class="chart-canvas"></canvas></div></div>
         <div class="card"><div class="card-title">📊 Конфликты по времени</div><div class="chart-wrap"><canvas id="chart-conflicts" class="chart-canvas"></canvas></div></div>
       </div>
     </div>`;
   }
   
   async function bindDashboard(){
     const v = state.selectedVideo;
     if(!v) return;
     
     if(!state.dashboardData){
       try{
         state.dashboardData = await apiFetch(`/videos/${v.id}/dashboard`);
         if(state.dashboardData?.video) Object.assign(v, videoFromApi(state.dashboardData.video));
         
         if(!state.dashboardData.heatmapPoints || state.dashboardData.heatmapPoints.length === 0){
           console.log('No heatmap data from server, using demo data');
           state.dashboardData.heatmapPoints = [
             { x: 0.25, y: 0.35, intensity: 0.85 },
             { x: 0.45, y: 0.55, intensity: 0.45 },
             { x: 0.65, y: 0.30, intensity: 0.92 },
             { x: 0.20, y: 0.70, intensity: 0.28 },
             { x: 0.55, y: 0.75, intensity: 0.63 },
             { x: 0.78, y: 0.52, intensity: 0.37 },
             { x: 0.38, y: 0.20, intensity: 0.71 },
             { x: 0.52, y: 0.48, intensity: 1.00 },
             { x: 0.30, y: 0.60, intensity: 0.22 },
             { x: 0.72, y: 0.68, intensity: 0.48 }
           ];
         }
         
         document.querySelector('#page-content').innerHTML = renderDashboard();
         bindDashboardContent();
       }catch(err){
         console.error('Dashboard load error:', err);
         toast('error', err.message || 'Не удалось загрузить дашборд');
       }
       return;
     }
     
     bindDashboardContent();
   }
   
   function bindDashboardContent(){
     console.log('Dashboard data loaded:', {
       hasHeatmapPoints: !!state.dashboardData?.heatmapPoints,
       pointsCount: state.dashboardData?.heatmapPoints?.length || 0
     });
     
     initPlayer();
     drawHeatmap();
     drawChartIntensity();
     drawChartConflicts();
     
     document.querySelectorAll('#events-tbody tr[data-frame]').forEach(row=>{
       row.addEventListener('click',()=>{
         document.querySelectorAll('#events-tbody tr').forEach(r=>r.classList.remove('selected'));
         row.classList.add('selected');
         const frame=+row.dataset.frame;
         seekPlayerToFrame(frame);
         toast('info',`Перемотка на ${row.cells[0]?.textContent}`);
       });
     });
   }
   
   function drawHeatmap() {
     const canvas = document.getElementById('heatmap-canvas');
     if (!canvas) {
       console.warn('Heatmap canvas not found');
       return;
     }
     
     const ctx = canvas.getContext('2d');
     const w = canvas.width = canvas.clientWidth || 600;
     const h = canvas.height = 340;
     
     const videoEl = document.getElementById('player-video');
     
     if (videoEl && videoEl.videoWidth > 0 && videoEl.readyState >= 2) {
       try {
         ctx.drawImage(videoEl, 0, 0, w, h);
         ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
         ctx.fillRect(0, 0, w, h);
       } catch(e) {
         const gradient = ctx.createLinearGradient(0, 0, w, h);
         gradient.addColorStop(0, '#0f0f1a');
         gradient.addColorStop(1, '#1a1a2e');
         ctx.fillStyle = gradient;
         ctx.fillRect(0, 0, w, h);
       }
     } else {
       const gradient = ctx.createLinearGradient(0, 0, w, h);
       gradient.addColorStop(0, '#0f0f1a');
       gradient.addColorStop(1, '#1a1a2e');
       ctx.fillStyle = gradient;
       ctx.fillRect(0, 0, w, h);
     }
     
     if (!state.dashboardData || !state.dashboardData.heatmapPoints || state.dashboardData.heatmapPoints.length === 0) {
       ctx.font = '400 14px "Inter", sans-serif';
       ctx.fillStyle = 'rgba(255,255,255,0.5)';
       ctx.textAlign = 'center';
       ctx.fillText('📊 Данные тепловой карты будут доступны после обработки видео', w/2, h/2);
       return;
     }
     
     const points = state.dashboardData.heatmapPoints;
     const maxIntensity = Math.max(...points.map(p => p.intensity || 1), 1);
     
     const heatCanvas = document.createElement('canvas');
     heatCanvas.width = w;
     heatCanvas.height = h;
     const heatCtx = heatCanvas.getContext('2d');
     heatCtx.clearRect(0, 0, w, h);
     
     points.forEach(point => {
       const x = point.x * w;
       const y = point.y * h;
       const intensity = (point.intensity || 1) / maxIntensity;
       const radius = 15 + intensity * 35;
       
       const gradient = heatCtx.createRadialGradient(x, y, 0, x, y, radius);
       
       if (intensity > 0.7) {
         gradient.addColorStop(0, `rgba(239, 68, 68, 0.95)`);
         gradient.addColorStop(0.35, `rgba(249, 115, 22, 0.7)`);
         gradient.addColorStop(0.6, `rgba(250, 204, 21, 0.4)`);
         gradient.addColorStop(1, `rgba(250, 204, 21, 0)`);
       } else if (intensity > 0.35) {
         gradient.addColorStop(0, `rgba(249, 115, 22, 0.85)`);
         gradient.addColorStop(0.35, `rgba(250, 204, 21, 0.6)`);
         gradient.addColorStop(0.6, `rgba(34, 197, 94, 0.3)`);
         gradient.addColorStop(1, `rgba(34, 197, 94, 0)`);
       } else {
         gradient.addColorStop(0, `rgba(34, 197, 94, 0.75)`);
         gradient.addColorStop(0.35, `rgba(59, 130, 246, 0.45)`);
         gradient.addColorStop(0.6, `rgba(139, 92, 246, 0.2)`);
         gradient.addColorStop(1, `rgba(139, 92, 246, 0)`);
       }
       
       heatCtx.globalCompositeOperation = 'lighter';
       heatCtx.fillStyle = gradient;
       heatCtx.beginPath();
       heatCtx.arc(x, y, radius, 0, Math.PI * 2);
       heatCtx.fill();
     });
     
     ctx.globalCompositeOperation = 'source-over';
     ctx.drawImage(heatCanvas, 0, 0);
     
     if (state.zones && state.zones.length > 0) {
       ctx.globalCompositeOperation = 'source-over';
       ctx.lineWidth = 2;
       ctx.setLineDash([8, 4]);
       
       state.zones.forEach(zone => {
         if (zone.points && zone.points.length >= 3) {
           ctx.beginPath();
           ctx.moveTo(zone.points[0].x * w, zone.points[0].y * h);
           for (let i = 1; i < zone.points.length; i++) {
             ctx.lineTo(zone.points[i].x * w, zone.points[i].y * h);
           }
           ctx.closePath();
           ctx.strokeStyle = zone.color || '#fff';
           ctx.stroke();
           ctx.fillStyle = zone.color + '15';
           ctx.fill();
           
           const centerX = zone.points.reduce((s, p) => s + p.x, 0) / zone.points.length * w;
           const centerY = zone.points.reduce((s, p) => s + p.y, 0) / zone.points.length * h;
           ctx.fillStyle = zone.color || '#fff';
           ctx.font = 'bold 11px "Inter", sans-serif';
           ctx.shadowBlur = 4;
           ctx.shadowColor = 'rgba(0,0,0,0.5)';
           ctx.fillText(zone.name, centerX - 20, centerY - 10);
           ctx.shadowBlur = 0;
         }
       });
       ctx.setLineDash([]);
     }
     
     const colorBarX = w - 55;
     const colorBarY = 15;
     const colorBarW = 20;
     const colorBarH = h - 30;
     
     ctx.shadowBlur = 0;
     ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
     ctx.fillRect(colorBarX - 5, colorBarY - 5, colorBarW + 10, colorBarH + 10);
     
     const colorGradient = ctx.createLinearGradient(colorBarX, colorBarY + colorBarH, colorBarX, colorBarY);
     colorGradient.addColorStop(0, '#22c55e');
     colorGradient.addColorStop(0.33, '#facc15');
     colorGradient.addColorStop(0.66, '#f97316');
     colorGradient.addColorStop(1, '#ef4444');
     
     ctx.fillStyle = colorGradient;
     ctx.fillRect(colorBarX, colorBarY, colorBarW, colorBarH);
     
     ctx.fillStyle = 'rgba(255,255,255,0.8)';
     ctx.font = '10px "Inter", sans-serif';
     ctx.textAlign = 'right';
     ctx.fillText('Макс', colorBarX - 8, colorBarY + 8);
     ctx.fillText('↑', colorBarX - 8, colorBarY + 25);
     ctx.fillText('↓', colorBarX - 8, colorBarY + colorBarH - 25);
     ctx.fillText('Мин', colorBarX - 8, colorBarY + colorBarH - 5);
     
     ctx.fillStyle = 'rgba(255,255,255,0.6)';
     ctx.font = '9px "Inter", sans-serif';
     ctx.fillText('Интенсивность', colorBarX - 45, colorBarY + colorBarH/2);
     
     if (points.length > 3) {
       drawContourLines(ctx, points, w, h, maxIntensity);
     }
   }
   
   function drawContourLines(ctx, points, w, h, maxIntensity) {
     const gridSize = 40;
     const cols = Math.ceil(w / gridSize);
     const rows = Math.ceil(h / gridSize);
     const grid = Array(rows).fill().map(() => Array(cols).fill(0));
     
     for (let i = 0; i < rows; i++) {
       for (let j = 0; j < cols; j++) {
         const px = j * gridSize;
         const py = i * gridSize;
         let totalWeight = 0;
         let totalValue = 0;
         
         points.forEach(point => {
           const dx = px - point.x * w;
           const dy = py - point.y * h;
           const dist = Math.sqrt(dx * dx + dy * dy);
           if (dist < 50) {
             const weight = 1 / (dist + 0.1);
             totalWeight += weight;
             totalValue += (point.intensity || 1) * weight;
           }
         });
         
         grid[i][j] = totalWeight > 0 ? totalValue / totalWeight / maxIntensity : 0;
       }
     }
     
     const levels = [0.3, 0.5, 0.7];
     const levelColors = ['rgba(250, 204, 21, 0.4)', 'rgba(249, 115, 22, 0.5)', 'rgba(239, 68, 68, 0.6)'];
     
     ctx.save();
     ctx.globalCompositeOperation = 'source-over';
     ctx.lineWidth = 1.5;
     ctx.setLineDash([5, 5]);
     
     for (let l = 0; l < levels.length; l++) {
       const level = levels[l];
       ctx.beginPath();
       ctx.strokeStyle = levelColors[l];
       
       for (let i = 0; i < rows - 1; i++) {
         for (let j = 0; j < cols - 1; j++) {
           const v00 = grid[i][j];
           const v10 = grid[i][j + 1];
           const v01 = grid[i + 1][j];
           const v11 = grid[i + 1][j + 1];
           
           const x = j * gridSize;
           const y = i * gridSize;
           
           if ((v00 - level) * (v10 - level) < 0) {
             const t = (level - v00) / (v10 - v00);
             const ix = x + t * gridSize;
             ctx.moveTo(ix, y);
             ctx.lineTo(ix, y + gridSize);
           }
           if ((v00 - level) * (v01 - level) < 0) {
             const t = (level - v00) / (v01 - v00);
             const iy = y + t * gridSize;
             ctx.moveTo(x, iy);
             ctx.lineTo(x + gridSize, iy);
           }
           if ((v10 - level) * (v11 - level) < 0) {
             const t = (level - v10) / (v11 - v10);
             const ix = x + gridSize;
             const iy = y + t * gridSize;
             ctx.moveTo(ix, iy);
             ctx.lineTo(x, iy);
           }
           if ((v01 - level) * (v11 - level) < 0) {
             const t = (level - v01) / (v11 - v01);
             const ix = x + t * gridSize;
             const iy = y + gridSize;
             ctx.moveTo(ix, iy);
             ctx.lineTo(ix, y);
           }
         }
       }
       ctx.stroke();
     }
     
     ctx.setLineDash([]);
     ctx.restore();
   }
   
   let playerDetectionsCache={};
   async function fetchDetectionsForFrame(videoId,frame){
     const key=`${videoId}-${frame}`;
     if(playerDetectionsCache[key]) return playerDetectionsCache[key];
     const boxes=await apiFetch(`/videos/${videoId}/detections?frame=${frame}`);
     playerDetectionsCache[key]=boxes.map(b=>({trackId:b.trackId,class:b.class,x:b.x,y:b.y,width:b.width,height:b.height,status:b.status}));
     return playerDetectionsCache[key];
   }
   function initPlayer(){
     const v=state.selectedVideo; const videoEl=document.getElementById('player-video'); const overlay=document.getElementById('player-overlay');
     if(!v||!videoEl||!overlay)return;
     videoEl.src=videoStreamUrl(v.id);
     state.playerPlaying=false; state.playerFrame=0;
     const fps=v.fps||30;
     const updateOverlay=async()=>{
       syncOverlayCanvas(overlay,videoEl);
       const frame=Math.floor(videoEl.currentTime*fps);
       state.playerFrame=frame;
       try{
         const boxes=await fetchDetectionsForFrame(v.id,frame);
         drawDetectionOverlay(overlay,boxes,videoEl);
       }catch{ drawDetectionOverlay(overlay,[],videoEl); }
       const tl=document.getElementById('player-timeline'); if(tl) tl.value=frame;
       updatePlayerTime(frame);
     };
     videoEl.addEventListener('timeupdate',updateOverlay);
     videoEl.addEventListener('loadedmetadata',()=>{ syncOverlayCanvas(overlay,videoEl); updateOverlay(); });
     document.getElementById('player-play')?.addEventListener('click',()=>{
       state.playerPlaying=!state.playerPlaying;
       document.getElementById('player-play').textContent=state.playerPlaying?'⏸️':'▶️';
       if(state.playerPlaying) videoEl.play(); else videoEl.pause();
     });
     document.getElementById('player-timeline')?.addEventListener('input',e=>{ seekPlayerToFrame(+e.target.value); });
   }
   function seekPlayerToFrame(frame){
     const videoEl=document.getElementById('player-video'); const v=state.selectedVideo;
     if(!videoEl||!v)return;
     const fps=v.fps||30;
     videoEl.currentTime=frame/fps;
     state.playerFrame=frame;
   }
   function updatePlayerTime(frame){
     const fps=state.selectedVideo?.fps||30;
     const s=Math.floor(frame/fps); const mm=Math.floor(s/60),ss=s%60;
     const el=document.getElementById('player-time');
     if(el) el.textContent=`${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')} / ${state.selectedVideo?.duration||'00:00:00'}`;
   }
   function drawChartIntensity(){
     const canvas=document.getElementById('chart-intensity');if(!canvas)return;
     const ctx=canvas.getContext('2d');const w=canvas.width=canvas.offsetWidth||400,h=canvas.height=200;ctx.clearRect(0,0,w,h);
     const pad={t:16,r:16,b:32,l:40};const cw=w-pad.l-pad.r,ch=h-pad.t-pad.b;
     const data=state.dashboardData?.intensityData||[];
     const labels=data.length?data.map(d=>d.label):['0:00','2:00','4:00','6:00','8:00'];
     const peds=data.length?data.map(d=>d.pedestrians):[0,0,0,0,0];
     const cars=data.length?data.map(d=>d.cars):[0,0,0,0,0];
     const maxV=Math.max(10,...peds,...cars,1);
     ctx.strokeStyle='rgba(48,54,61,.6)';ctx.lineWidth=1;for(let i=0;i<=5;i++){const y=pad.t+ch*(1-i/5);ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(pad.l+cw,y);ctx.stroke();ctx.fillStyle='rgba(139,148,158,.6)';ctx.font='10px sans-serif';ctx.textAlign='right';ctx.fillText(Math.round(maxV*i/5),pad.l-6,y+3);}
     const drawLine=(data,color,fill)=>{const pts=data.map((v,i)=>({x:pad.l+i*cw/(data.length-1),y:pad.t+ch*(1-v/maxV)}));if(fill){ctx.beginPath();ctx.moveTo(pts[0].x,pad.t+ch);pts.forEach(p=>ctx.lineTo(p.x,p.y));ctx.lineTo(pts[pts.length-1].x,pad.t+ch);ctx.closePath();ctx.fillStyle=color+'22';ctx.fill();}ctx.beginPath();pts.forEach((p,i)=>i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y));ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();pts.forEach(p=>{ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();});};
     drawLine(peds,'#2563eb',true);drawLine(cars,'#22c55e',true);
     labels.forEach((l,i)=>{ctx.fillStyle='rgba(139,148,158,.7)';ctx.font='9px sans-serif';ctx.textAlign='center';ctx.fillText(l,pad.l+i*cw/(labels.length-1),h-6);});
     ctx.fillStyle='#2563eb';ctx.fillRect(pad.l,4,10,8);ctx.fillStyle='rgba(230,237,243,.7)';ctx.font='10px sans-serif';ctx.textAlign='left';ctx.fillText('Пешеходы',pad.l+14,12);ctx.fillStyle='#22c55e';ctx.fillRect(pad.l+85,4,10,8);ctx.fillStyle='rgba(230,237,243,.7)';ctx.fillText('Авто',pad.l+99,12);
   }
   function drawChartConflicts(){
     const canvas=document.getElementById('chart-conflicts');if(!canvas)return;
     const ctx=canvas.getContext('2d');const w=canvas.width=canvas.offsetWidth||400,h=canvas.height=200;ctx.clearRect(0,0,w,h);
     const pad={t:16,r:16,b:32,l:40};const cw=w-pad.l-pad.r,ch=h-pad.t-pad.b;
     const bars=state.dashboardData?.conflictBars||[];
     const labels=bars.map(b=>b.label);
     const warnings=bars.map(b=>b.warnings);
     const conflicts=bars.map(b=>b.conflicts);
     const maxV=Math.max(6,...warnings,...conflicts,1);
     const bw=labels.length?cw/labels.length*.7:20,gap=labels.length?cw/labels.length:40;
     ctx.strokeStyle='rgba(48,54,61,.6)';ctx.lineWidth=1;for(let i=0;i<=maxV;i++){const y=pad.t+ch*(1-i/maxV);ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(pad.l+cw,y);ctx.stroke();ctx.fillStyle='rgba(139,148,158,.6)';ctx.font='10px sans-serif';ctx.textAlign='right';ctx.fillText(i,pad.l-5,y+3);}
     if(!labels.length)return;
     labels.forEach((l,i)=>{const cx=pad.l+i*gap+gap/2;const wh=ch*(warnings[i]||0)/maxV,ch2=ch*(conflicts[i]||0)/maxV;ctx.fillStyle='#f59e0b99';ctx.fillRect(cx-bw/2,pad.t+ch-wh,bw*.48,wh);ctx.fillStyle='#ef444499';ctx.fillRect(cx,pad.t+ch-ch2,bw*.48,ch2);ctx.fillStyle='rgba(139,148,158,.6)';ctx.font='9px sans-serif';ctx.textAlign='center';ctx.fillText(l,cx,h-6);});
     ctx.fillStyle='#f59e0b99';ctx.fillRect(pad.l,4,10,8);ctx.fillStyle='rgba(230,237,243,.7)';ctx.font='10px sans-serif';ctx.textAlign='left';ctx.fillText('Предупр.',pad.l+14,12);ctx.fillStyle='#ef444499';ctx.fillRect(pad.l+80,4,10,8);ctx.fillStyle='rgba(230,237,243,.7)';ctx.fillText('Конфликт',pad.l+94,12);
   }
   
   // ── ARCHIVE ──
   function renderArchive(){
     const filtered=state.videos.filter(v=>{const s=state.activeFilters;return(!s.search||v.name.toLowerCase().includes(s.search.toLowerCase()))&&(s.status==='all'||v.status===s.status);});
     const rows=filtered.length?filtered.map(v=>`<tr><td><div style="font-weight:600">${v.name}</div><div style="font-size:.75rem;color:var(--text-secondary)">${v.duration} · ${v.size}</div></td><td>${v.date}</td><td>${v.status==='done'?'<span class="badge badge-green">✅ Обработано</span>':v.status==='processing'?'<span class="badge badge-yellow">⚙️ В обработке</span>':'<span class="badge badge-gray">⏳ В очереди</span>'}</td><td>${v.status==='done'?`<span style="color:var(--text-secondary)">🚶 ${v.stats.pedestrians} / 🚗 ${v.stats.cars} / ⚠️ ${v.stats.conflicts}</span>`:'—'}</td><td><div style="display:flex;gap:.4rem">${v.status==='done'?`<button class="btn btn-primary btn-sm" data-action="dash" data-id="${v.id}">📊</button><button class="btn btn-ghost btn-sm" data-action="pdf" data-id="${v.id}">PDF</button><button class="btn btn-ghost btn-sm" data-action="xlsx" data-id="${v.id}">Excel</button>`:''}</div></td></tr>`).join(''):`<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--text-muted)">Ничего не найдено</td></tr>`;
     return`<div class="page-header"><div><div class="page-title">Архив отчётов</div><div class="page-subtitle">${state.videos.length} записей</div></div></div>
     <div class="archive-filters"><div class="search-input-wrap"><span class="search-icon">🔍</span><input class="form-input" id="archive-search" placeholder="Поиск..." value="${state.activeFilters.search}"/></div>
     <select class="form-select" id="archive-status" style="width:180px"><option value="all" ${state.activeFilters.status==='all'?'selected':''}>Все статусы</option><option value="done" ${state.activeFilters.status==='done'?'selected':''}>Обработано</option><option value="processing" ${state.activeFilters.status==='processing'?'selected':''}>В обработке</option><option value="queued" ${state.activeFilters.status==='queued'?'selected':''}>В очереди</option></select>
     <button class="btn btn-ghost btn-sm" id="archive-reset">Сбросить</button></div>
     <div class="card" style="padding:0;overflow:hidden"><div class="archive-table-wrap"><table class="archive-table"><thead><tr><th>Название</th><th>Дата</th><th>Статус</th><th>Статистика</th><th>Действия</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
   }
   function bindArchive(){
     const refresh=()=>{document.querySelector('#page-content').innerHTML=renderArchive();bindArchive();};
     document.getElementById('archive-search')?.addEventListener('input',e=>{state.activeFilters.search=e.target.value;refresh();});
     document.getElementById('archive-status')?.addEventListener('change',e=>{state.activeFilters.status=e.target.value;refresh();});
     document.getElementById('archive-reset')?.addEventListener('click',()=>{state.activeFilters={search:'',status:'all'};refresh();});
     document.querySelectorAll('[data-action]').forEach(btn=>{
       btn.addEventListener('click',()=>{const id=+btn.dataset.id;const video=state.videos.find(v=>v.id===id);const action=btn.dataset.action;
         if(action==='dash'){state.selectedVideo=video;navigate('dashboard');}
         if(action==='pdf')downloadReport(id,'pdf').then(n=>toast('success',`📄 Скачан: ${n}`)).catch(e=>toast('error',e.message));
         if(action==='xlsx')downloadReport(id,'excel').then(n=>toast('success',`📊 Скачан: ${n}`)).catch(e=>toast('error',e.message));
       });
     });
   }
   
   // ── ADMIN USERS ──
   function renderAdminUsers(){
     if(state.adminUsers===null){
       return`<div class="page-header"><div><div class="page-title">Управление пользователями</div><div class="page-subtitle">Загрузка...</div></div></div>
       <div class="card" style="padding:2rem;text-align:center;color:var(--text-secondary)">⏳ Загрузка списка пользователей</div>`;
     }
     const users=state.adminUsers;
     const rows=users.map(u=>`<tr><td><div style="display:flex;align-items:center;gap:.65rem"><div class="user-avatar" style="width:30px;height:30px;font-size:.7rem">${u.name.split(' ').map(w=>w[0]).join('').slice(0,2)}</div><div><div style="font-weight:600">${u.name}</div><div style="font-size:.75rem;color:var(--text-secondary)">${u.email}</div></div></div></td><td><code style="font-size:.82rem;color:var(--text-secondary)">${u.username}</code></td>
      Knowing<select class="form-select" style="width:140px;padding:.35rem .6rem;font-size:.82rem" data-uid="${u.id}" ${u.id===state.currentUser.id?'disabled':''}><option value="analyst" ${u.role==='analyst'?'selected':''}>🔍 Аналитик</option><option value="admin" ${u.role==='admin'?'selected':''}>👑 Администратор</option></select></td>
      Knowing<span class="badge ${u.active?'badge-green':'badge-red'}">${u.active?'✅ Активен':'🚫 Заблокирован'}</span></td>
      Knowing<div style="display:flex;gap:.4rem"><button class="btn btn-ghost btn-sm" data-action="toggle" data-uid="${u.id}" ${u.id===state.currentUser.id?'disabled':''}>${u.active?'🔒 Заблок.':'🔓 Разблок.'}</button></div></td></tr>`).join('');
     return`<div class="page-header"><div><div class="page-title">Управление пользователями</div><div class="page-subtitle">${users.length} пользователей</div></div><button class="btn btn-primary" id="add-user-btn">➕ Добавить</button></div>
     <div class="card" style="padding:0;overflow:hidden"><table class="users-table"><thead><tr><th>Пользователь</th><th>Логин</th><th>Роль</th><th>Статус</th><th>Действия</th></tr></thead><tbody>${rows||'<tr><td colspan="5" class="text-muted" style="padding:1.5rem;text-align:center">Нет пользователей</td></tr>'}</tbody></table></div>`;
   }
   function mapAdminUsers(list){
     return list.map(d=>({id:d.id,username:d.username,name:d.fullName,email:d.email,role:d.role,active:d.isActive}));
   }
   async function loadAdminUsers(){
     try{
       const list=await apiFetch('/users');
       state.adminUsers=mapAdminUsers(list);
     }catch(err){
       state.adminUsers=[];
       toast('error',err.message||'Не удалось загрузить пользователей');
     }
   }
   function bindAdminUsers(){
     if(state.adminUsers===null){ loadAdminUsers().then(()=>{ document.querySelector('#page-content').innerHTML=renderAdminUsers(); bindAdminUsers(); }); return; }
     document.getElementById('add-user-btn')?.addEventListener('click',openAddUserModal);
     const refresh=async()=>{ state.adminUsers=null; await loadAdminUsers(); document.querySelector('#page-content').innerHTML=renderAdminUsers(); bindAdminUsers(); };
     document.querySelectorAll('[data-action="toggle"]').forEach(btn=>{btn.addEventListener('click',async()=>{
       const uid=+btn.dataset.uid;
       btn.disabled=true;
       try{
         await apiFetch(`/users/${uid}/toggle-active`,{method:'PUT'});
         toast('info','Статус пользователя обновлён');
         await refresh();
       }catch(err){ toast('error',err.message||'Ошибка'); btn.disabled=false; }
     });});
     document.querySelectorAll('select[data-uid]').forEach(sel=>{sel.addEventListener('change',async()=>{
       const uid=+sel.dataset.uid; const role=sel.value; const prev=state.adminUsers.find(u=>u.id===uid)?.role;
       try{
         await apiFetch(`/users/${uid}/role`,{method:'PUT',body:JSON.stringify({role})});
         const u=state.adminUsers.find(x=>x.id===uid); if(u) u.role=role;
         toast('success',`Роль изменена`);
       }catch(err){ toast('error',err.message||'Ошибка'); if(prev) sel.value=prev; }
     });});
   }
   function openAddUserModal(){
     const overlay=document.getElementById('modal-overlay');
     overlay.innerHTML=`<div class="modal"><div class="modal-header"><span class="modal-title">➕ Новый пользователь</span><button class="modal-close" id="modal-close">✕</button></div>
     <div style="display:flex;flex-direction:column;gap:1rem">
       <div class="form-group"><label class="form-label">Полное имя</label><input class="form-input" id="new-name" placeholder="Иван Иванов"/></div>
       <div class="form-group"><label class="form-label">Логин</label><input class="form-input" id="new-login" placeholder="ivanov"/></div>
       <div class="form-group"><label class="form-label">Email</label><input class="form-input" id="new-email" type="email" placeholder="ivanov@example.com"/></div>
       <div class="form-group"><label class="form-label">Пароль</label><input class="form-input" id="new-password" type="password" placeholder="не короче 6 символов"/></div>
       <div class="form-group"><label class="form-label">Роль</label><select class="form-select" id="new-role"><option value="analyst">🔍 Аналитик</option><option value="admin">👑 Администратор</option></select></div>
     </div>
     <div class="modal-footer"><button class="btn btn-ghost" id="modal-cancel">Отмена</button><button class="btn btn-primary" id="modal-save">💾 Создать</button></div></div>`;
     overlay.classList.remove('hidden');
     const close=()=>overlay.classList.add('hidden');
     document.getElementById('modal-close')?.addEventListener('click',close);document.getElementById('modal-cancel')?.addEventListener('click',close);overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
     document.getElementById('modal-save')?.addEventListener('click',async()=>{
       const name=document.getElementById('new-name').value.trim(),login=document.getElementById('new-login').value.trim(),email=document.getElementById('new-email').value.trim(),password=document.getElementById('new-password').value,role=document.getElementById('new-role').value;
       if(!name||!login||!email||!password){toast('error','Заполните все поля');return;}
       const btn=document.getElementById('modal-save'); btn.disabled=true;
       try{
         await apiFetch('/auth/register',{method:'POST',body:JSON.stringify({username:login,password,fullName:name,email,role})});
         toast('success',`Пользователь ${name} создан`); close();
         state.adminUsers=null;
         document.querySelector('#page-content').innerHTML=renderAdminUsers(); bindAdminUsers();
       }catch(err){ toast('error',err.message||'Не удалось создать пользователя'); btn.disabled=false; }
     });
   }
   
   // ── ADMIN SETTINGS ──
   function renderAdminSettings(){
     const s=state.algorithmSettings;
     const row=(key,label,desc,min,max,step,unit)=>`<div class="setting-row"><div><div class="setting-label">${label}</div><div class="setting-desc">${desc}</div></div><div class="range-wrap"><input type="range" min="${min}" max="${max}" step="${step}" value="${s[key]}" data-key="${key}"/><span class="range-val" id="val-${key}">${s[key]}${unit}</span></div></div>`;
     return`<div class="page-header"><div><div class="page-title">Настройки алгоритмов</div></div><div style="display:flex;gap:.75rem"><button class="btn btn-ghost" id="settings-reset">↩ Сброс</button><button class="btn btn-primary" id="settings-save">💾 Сохранить</button></div></div>
     <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem">
       <div class="card"><div class="card-title">🧠 YOLO</div><div class="settings-grid">${row('confidence','Порог уверенности','Мин. уверенность детекции',0.1,0.99,0.01,'')}${row('iou','Порог IoU','Для подавления дублей',0.1,0.99,0.01,'')}</div></div>
       <div class="card"><div class="card-title">🔗 ByteTrack</div><div class="settings-grid">${row('minTrackLen','Мин. длина трека','Кадры до регистрации',1,50,1,' кадр')}${row('maxMissedFrames','Макс. пропусков','До удаления трека',1,60,1,' кадр')}</div></div>
       <div class="card"><div class="card-title">⚠️ Анализ конфликтов</div><div class="settings-grid">${row('ttcThreshold','Порог TTC','Время до столкновения',0.5,10,0.1,' с')}${row('distThreshold','Порог дистанции','Мин. расстояние',0.5,10,0.1,' м')}</div></div>
       <div class="card"><div class="card-title">📊 Текущие значения</div><div style="display:flex;flex-direction:column;gap:.6rem">${Object.entries({Уверенность:s.confidence,IoU:s.iou,'Мин. трек':s.minTrackLen+' кадр','Макс. пропуск':s.maxMissedFrames+' кадр','TTC порог':s.ttcThreshold+' с','Дист. порог':s.distThreshold+' м'}).map(([k,v])=>`<div style="display:flex;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid rgba(48,54,61,.4)"><span class="text-sm text-muted">${k}</span><span class="text-sm fw-600 text-accent">${v}</span></div>`).join('')}</div></div>
     </div>`;
   }
   function bindAdminSettings(){
     document.querySelectorAll('input[data-key]').forEach(input=>{input.addEventListener('input',()=>{const key=input.dataset.key;const val=parseFloat(input.value);state.algorithmSettings[key]=val;const units={ttcThreshold:' с',distThreshold:' м',minTrackLen:' кадр',maxMissedFrames:' кадр'};const el=document.getElementById(`val-${key}`);if(el)el.textContent=val+(units[key]||'');});});
     document.getElementById('settings-save')?.addEventListener('click',()=>toast('success','Настройки сохранены'));
     document.getElementById('settings-reset')?.addEventListener('click',()=>{state.algorithmSettings={confidence:0.45,iou:0.5,ttcThreshold:3.0,distThreshold:2.5,minTrackLen:8,maxMissedFrames:15};document.querySelector('#page-content').innerHTML=renderAdminSettings();bindAdminSettings();toast('info','Настройки сброшены');});
   }
   
   // ── ADMIN SYSTEM ──
   function renderAdminSystem(){
     const m=state.systemMetrics;
     const gauge=(id,val,color)=>`<div class="gauge-wrap"><svg class="gauge-svg" viewBox="0 0 80 80" width="80" height="80"><circle class="gauge-bg" cx="40" cy="40" r="30"/><circle class="gauge-fill" cx="40" cy="40" r="30" id="${id}-circle" stroke="${color}" stroke-dasharray="${2*Math.PI*30}" stroke-dashoffset="${2*Math.PI*30*(1-val/100)}"/></svg><div class="gauge-val" id="${id}-val">${Math.round(val)}%</div></div>`;
     return`<div class="page-header"><div><div class="page-title">Состояние системы</div><div class="page-subtitle">Обновление каждые 2 сек</div></div><div style="display:flex;gap:.75rem"><button class="btn btn-ghost btn-sm" id="sys-clear-tmp">🗑 Очистить temp</button><button class="btn btn-danger btn-sm" id="sys-restart">🔄 Перезапустить</button></div></div>
     <div class="system-grid"><div class="sys-metric"><div class="sys-metric-label">🖥️ CPU</div>${gauge('cpu',m.cpu,'#2563eb')}<div class="text-sm text-muted" id="cpu-extra">8 ядер · ${m.cpu<50?'Норма':'Нагрузка'}</div></div>
     <div class="sys-metric"><div class="sys-metric-label">💾 RAM</div>${gauge('ram',m.ram,'#a855f7')}<div class="text-sm text-muted" id="ram-extra">${Math.round(m.ram*.16)} ГБ / 16 ГБ</div></div>
     <div class="sys-metric"><div class="sys-metric-label">💿 Диск</div>${gauge('disk',m.disk,'#22c55e')}<div class="text-sm text-muted">${Math.round(m.disk*5)} ГБ / 500 ГБ</div></div></div>
     <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:1.5rem">
       <div class="card card-sm"><div class="card-title">⚡ Очередь задач</div>
         <div style="display:flex;flex-direction:column;gap:.5rem">
           <div><div style="display:flex;justify-content:space-between;margin-bottom:.3rem"><span class="text-sm">Видео #47 — ул. Садовая</span><span class="text-sm text-accent">78%</span></div><div class="progress-bar-bg" style="height:6px"><div class="progress-bar-fill" style="width:78%;background:var(--yellow)"></div></div></div>
           <div><div style="display:flex;justify-content:space-between;margin-bottom:.3rem"><span class="text-sm">Видео #48 — Центр. пл.</span><span class="text-sm text-accent">12%</span></div><div class="progress-bar-bg" style="height:6px"><div class="progress-bar-fill" style="width:12%"></div></div></div>
           <div class="text-sm text-muted mt-2">2 активных · 3 в очереди</div>
         </div>
       </div>
       <div class="card card-sm"><div class="card-title">📡 SignalR</div>
         <div style="display:flex;flex-direction:column;gap:.4rem">
           <div style="display:flex;align-items:center;gap:.75rem;padding:.4rem 0;border-bottom:1px solid rgba(48,54,61,.4)"><span class="badge badge-green" style="font-size:.7rem">●</span><span class="text-sm fw-600">analyst</span><span class="text-sm text-muted">Обработка #47</span><span class="text-sm text-muted" style="margin-left:auto">2 мин</span></div>
           <div style="display:flex;align-items:center;gap:.75rem;padding:.4rem 0;border-bottom:1px solid rgba(48,54,61,.4)"><span class="badge badge-green" style="font-size:.7rem">●</span><span class="text-sm fw-600">engineer</span><span class="text-sm text-muted">Дашборд #45</span><span class="text-sm text-muted" style="margin-left:auto">8 мин</span></div>
           <div class="text-sm text-muted mt-1">2 активных подключения</div>
         </div>
       </div>
     </div>
     <div class="card card-sm"><div class="card-title">📋 Системный лог</div><div class="sys-log" id="sys-log"><div class="log-line-info">[2025-06-14 09:12:03] Сервер запущен</div><div>[2025-06-14 09:15:22] Новая задача #47</div><div>[2025-06-14 09:16:08] YOLO загружен (yolov8n.pt)</div><div class="log-line-warn">[2025-06-14 09:21:15] RAM &gt; 70%</div><div>[2025-06-14 09:26:55] Задача #47 завершена</div></div></div>`;
   }
   function bindAdminSystem(){
     if(sysMetricsTimer)clearInterval(sysMetricsTimer);
     sysMetricsTimer=setInterval(()=>{
       if(!document.getElementById('cpu-val')){clearInterval(sysMetricsTimer);return;}
       state.systemMetrics.cpu=Math.max(5,Math.min(95,state.systemMetrics.cpu+(Math.random()-.5)*10));
       state.systemMetrics.ram=Math.max(20,Math.min(90,state.systemMetrics.ram+(Math.random()-.5)*3));
       state.systemMetrics.disk=Math.max(10,Math.min(80,state.systemMetrics.disk+(Math.random()-.5)*.5));
       const m=state.systemMetrics;
       const ug=(id,val)=>{const c=document.getElementById(`${id}-circle`),v=document.getElementById(`${id}-val`);if(c)c.style.strokeDashoffset=2*Math.PI*30*(1-val/100);if(v)v.textContent=Math.round(val)+'%';};
       ug('cpu',m.cpu);ug('ram',m.ram);ug('disk',m.disk);
       const ce=document.getElementById('cpu-extra'),re=document.getElementById('ram-extra');
       if(ce)ce.textContent=`8 ядер · ${m.cpu<50?'Норма':'Нагрузка'}`;if(re)re.textContent=`${Math.round(m.ram*.16)} ГБ / 16 ГБ`;
       const log=document.getElementById('sys-log');
       if(log&&Math.random()>.7){const msgs=['Heartbeat OK','Кэш очищен','Резервное копирование','Новое подключение SignalR',`CPU: ${Math.round(m.cpu)}%`];const line=document.createElement('div');line.textContent=`[${new Date().toLocaleString('ru-RU')}] ${msgs[Math.floor(Math.random()*msgs.length)]}`;line.className=m.cpu>80?'log-line-warn':'log-line-info';log.appendChild(line);log.scrollTop=log.scrollHeight;}
     },2000);
     document.getElementById('sys-clear-tmp')?.addEventListener('click',()=>toast('success','Temp очищен (~1.2 ГБ)'));
     document.getElementById('sys-restart')?.addEventListener('click',()=>{
       const overlay=document.getElementById('modal-overlay');
       overlay.innerHTML=`<div class="modal"><div class="modal-header"><span class="modal-title">⚠️ Перезапуск сервера</span><button class="modal-close" id="modal-close">✕</button></div><p style="color:var(--text-secondary);margin-bottom:1.5rem">Все активные задачи будут прерваны. Уверены?</p><div class="modal-footer"><button class="btn btn-ghost" id="modal-cancel">Отмена</button><button class="btn btn-danger" id="modal-confirm">🔄 Перезапустить</button></div></div>`;
       overlay.classList.remove('hidden');const close=()=>overlay.classList.add('hidden');document.getElementById('modal-close')?.addEventListener('click',close);document.getElementById('modal-cancel')?.addEventListener('click',close);document.getElementById('modal-confirm')?.addEventListener('click',()=>{close();toast('warning','Сервер перезапускается...');});
     });
   }
   
   // ── MODALS ──
   function openExportModal(video){
     if(!video?.id){ toast('error','Видео не выбрано'); return; }
     if(video.status!=='done'){ toast('warning','Экспорт доступен после завершения обработки'); return; }
     const overlay=document.getElementById('modal-overlay');
     overlay.innerHTML=`<div class="modal"><div class="modal-header"><span class="modal-title">📥 Экспорт отчёта</span><button class="modal-close" id="modal-close">✕</button></div>
     <p style="color:var(--text-secondary);margin-bottom:1.2rem;font-size:.9rem">${video.name}</p>
     <p style="color:var(--text-muted);font-size:.82rem;margin:-.8rem 0 1rem">🚶 ${video.stats.pedestrians} · 🚗 ${video.stats.cars} · ⚠️ ${video.stats.conflicts} конфликтов</p>
     <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
       <button class="btn btn-ghost" id="export-pdf" style="flex-direction:column;padding:1.5rem;gap:.5rem;height:auto"><span style="font-size:2rem">📄</span><span class="fw-600">PDF-отчёт</span><span class="text-xs text-muted">Сводка, зоны, события</span></button>
       <button class="btn btn-ghost" id="export-xlsx" style="flex-direction:column;padding:1.5rem;gap:.5rem;height:auto"><span style="font-size:2rem">📊</span><span class="fw-600">Excel-отчёт</span><span class="text-xs text-muted">6 листов с данными</span></button>
     </div>
     <div class="modal-footer"><button class="btn btn-ghost" id="modal-cancel">Закрыть</button></div></div>`;
     overlay.classList.remove('hidden');
     const close=()=>overlay.classList.add('hidden');
     document.getElementById('modal-close')?.addEventListener('click',close);
     document.getElementById('modal-cancel')?.addEventListener('click',close);
     overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
     const runExport=async(type,btnId)=>{
       const btn=document.getElementById(btnId);
       const label=btn?.querySelector('.fw-600');
       if(btn){ btn.disabled=true; if(label) label.textContent='Генерация...'; }
       try{
         const name=await downloadReport(video.id,type);
         toast('success',`Скачан файл: ${name}`);
         close();
       }catch(err){
         toast('error',err.message||'Ошибка экспорта');
         if(btn){ btn.disabled=false; if(label) label.textContent=type==='pdf'?'PDF-отчёт':'Excel-отчёт'; }
       }
     };
     document.getElementById('export-pdf')?.addEventListener('click',()=>runExport('pdf','export-pdf'));
     document.getElementById('export-xlsx')?.addEventListener('click',()=>runExport('excel','export-xlsx'));
   }
   function confirmDeleteVideo(id){
     const video=state.videos.find(v=>v.id===id);const overlay=document.getElementById('modal-overlay');
     overlay.innerHTML=`<div class="modal"><div class="modal-header"><span class="modal-title">🗑 Удалить видео</span><button class="modal-close" id="modal-close">✕</button></div>
     <p style="color:var(--text-secondary);margin-bottom:1.5rem">Удалить «<strong>${video?.name}</strong>»? Данные анализа будут потеряны.</p>
     <div class="modal-footer"><button class="btn btn-ghost" id="modal-cancel">Отмена</button><button class="btn btn-danger" id="modal-confirm">🗑 Удалить</button></div></div>`;
     overlay.classList.remove('hidden');const close=()=>overlay.classList.add('hidden');document.getElementById('modal-close')?.addEventListener('click',close);document.getElementById('modal-cancel')?.addEventListener('click',close);overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
     document.getElementById('modal-confirm')?.addEventListener('click',async()=>{
       try{ await apiFetch(`/videos/${id}`,{method:'DELETE'}); state.videos=state.videos.filter(v=>v.id!==id); close(); toast('success','Видео удалено'); navigate('home'); }
       catch(err){ toast('error',err.message||'Ошибка удаления'); }
     });
   }
   
   // ── LAYOUT ──
   function bindLayout(){
     document.querySelectorAll('.nav-item[data-page]').forEach(item=>{item.addEventListener('click',()=>navigate(item.dataset.page));});
     document.getElementById('logout-btn')?.addEventListener('click',()=>{if(sysMetricsTimer){clearInterval(sysMetricsTimer);sysMetricsTimer=null;}setAuthToken(null);state.currentUser=null;state.adminUsers=null;state.playerPlaying=false;toast('info','Выход из системы');navigate('login');});
     document.getElementById('topbar-upload')?.addEventListener('click',()=>navigate('upload'));
   }
   
   // ── TOAST ──
   function toast(type,message,duration=4000){
     const icons={success:'✅',error:'❌',info:'ℹ️',warning:'⚠️'};
     const container=document.getElementById('toast-container');if(!container)return;
     const el=document.createElement('div');el.className=`toast ${type}`;
     el.innerHTML=`<span class="toast-icon">${icons[type]||'ℹ️'}</span><span>${message}</span><button class="toast-close">✕</button>`;
     container.appendChild(el);
     const remove=()=>{el.classList.add('toast-out');setTimeout(()=>el.remove(),300);};
     el.querySelector('.toast-close').addEventListener('click',remove);setTimeout(remove,duration);
   }
   
   async function restoreSession(){
     const token=getAuthToken();
     if(!token){ render(); return; }
     try{
       const me=await apiFetch('/auth/me');
       state.currentUser=userFromDto(me);
       state.currentPage='home';
       await loadVideos();
     }catch{
       setAuthToken(null);
       state.currentUser=null;
       state.currentPage='login';
     }
     render();
   }
   document.addEventListener('DOMContentLoaded',()=>restoreSession());