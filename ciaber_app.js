// ──────────────────────────────────────────────────────────────
//  CIABER · Gestión Harf-Tele  — ciaber_app.js
// ──────────────────────────────────────────────────────────────

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDijZ5KYg1OPcSJnDsQh9pxtH_cr_xobRU",
  authDomain: "workflow-equipo.firebaseapp.com",
  databaseURL: "https://workflow-equipo-default-rtdb.firebaseio.com",
  projectId: "workflow-equipo",
  storageBucket: "workflow-equipo.firebasestorage.app",
  messagingSenderId: "974073018957",
  appId: "1:974073018957:web:9200142d312802f74d3a04"
};
const DB_PATH    = 'ciaber/data';
const USERS_PATH = 'ciaber/usuarios';
const SUPER_ADMINS = ['mbottarelli@harf.com.ar'];

firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth();
const db   = firebase.database();

// ── Global state ─────────────────────────────────────────────
let clientes = [];
let usersDB = {};
let currentUserData = null;
let _unsubscribe = null;
let _usersUnsubscribe = null;
let history = [];
let selectedSet = new Set();
let _calVisible = false;
let _expandedProj = {};
let _vista = 'clientes';
let _clienteActual = null;

// ── Constants ─────────────────────────────────────────────────
const ESTADOS_CLIENTE = ['Activo','Inactivo','Prospecto','Lead'];
const GRUPOS_TRABAJO = [
  'Presupuestado','Esperando Aprobación','Aprobado de Palabra','Aprobar',
  'En Relevamiento','En Ejecución','En Ejecución sin Presupuesto',
  'Avanzado','Avanzado sin Presupuesto','Sin Iniciar',
  'Terminado','Terminado sin Presupuesto','Facturar','Cobrado','Presupuestar'
];
const PRIO_ORDER   = { 'Alta':0,'Media':1,'Baja':2,'':3 };
const STATUS_ORDER = { 'Pendiente':0,'En proceso':1,'Terminado':2 };
const PROJ_STATUS_ORDER = {
  'En Ejecución':0,'En Ejecución sin Presupuesto':0,
  'Avanzado':1,'Avanzado sin Presupuesto':1,
  'Esperando Aprobación':2,'Aprobado de Palabra':2,'Aprobar':2,
  'Presupuestado':3,'Presupuestar':3,
  'En Relevamiento':4,'Sin Iniciar':5,
  'Terminado':6,'Terminado sin Presupuesto':6,'Facturar':7,'Cobrado':8
};

// ── Helpers ───────────────────────────────────────────────────
function newId(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
function ESC(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function emailActual(){ return (auth.currentUser?.email||'').toLowerCase().trim(); }
function emailToKey(e){ return e.toLowerCase().replace(/[@.+]/g,'_'); }
function opt(arr,val){ return arr.map(s=>'<option value="'+ESC(s)+'"'+(s===val?' selected':'')+'>'+ESC(s)+'</option>').join(''); }

function sortByPriority(arr){
  return [...arr].sort((a,b)=>{
    const sd=(STATUS_ORDER[a.estado]??0)-(STATUS_ORDER[b.estado]??0);
    if(sd!==0) return sd;
    return (PRIO_ORDER[a.prioridad]??3)-(PRIO_ORDER[b.prioridad]??3);
  });
}
function sortProyectos(arr){
  return [...arr].sort((a,b)=>(PROJ_STATUS_ORDER[a.estadoTrabajo]??5)-(PROJ_STATUS_ORDER[b.estadoTrabajo]??5));
}
function fixClientes(arr){
  return (arr||[]).filter(Boolean).map(c=>({
    id:c.id||newId(),nombre:c.nombre||'Sin nombre',estado:c.estado||'Activo',
    nota:c.nota||'',color:c.color||null,abono:c.abono||null,archivos:c.archivos||[],
    proyectos:(c.proyectos||[]).filter(Boolean).map(p=>({
      id:p.id||newId(),nombre:p.nombre||'Sin nombre',
      estadoTrabajo:p.estadoTrabajo||'Sin Iniciar',
      owner:p.owner||null,compartidoCon:p.compartidoCon||[],
      monto:p.monto||'',moneda:p.moneda||'ARS',nota:p.nota||'',
      archivos:p.archivos||[],tareas:(p.tareas||[]).filter(Boolean)
    }))
  }));
}

// ── Roles & permissions ───────────────────────────────────────
function esAdmin(){
  if(SUPER_ADMINS.includes(emailActual())) return true;
  return currentUserData?.rol === 'admin';
}
function esOwnerProyecto(p){
  if(!p.owner) return true;
  return p.owner.toLowerCase() === emailActual();
}
function puedeVerProyecto(p){
  if(esAdmin()) return true;
  const em = emailActual();
  const ud = currentUserData;
  if(!p.owner) return true; // legacy
  if(p.owner.toLowerCase()===em) return true;
  if((p.compartidoCon||[]).map(e=>e.toLowerCase()).includes(em)) return true;
  if(ud&&(ud.proyectosAsignados||[]).includes(p.id)) return true;
  return false;
}
function puedeVerCliente(c){
  if(esAdmin()) return true;
  const ud = currentUserData;
  if(ud&&(ud.clientesAsignados||[]).includes(c.id)) return true;
  return (c.proyectos||[]).some(p=>puedeVerProyecto(p));
}

// ── Toast ─────────────────────────────────────────────────────
function toast(msg,type='info'){
  const tc=document.getElementById('toast-container'); if(!tc) return;
  const t=document.createElement('div'); t.className='toast '+type; t.textContent=msg;
  tc.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('show'));
  setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),400);},2800);
}

// ── Auth ──────────────────────────────────────────────────────
function showLogin(){ document.getElementById('login-screen').style.display='flex'; document.getElementById('app').style.display='none'; }
function showApp(){   document.getElementById('login-screen').style.display='none'; document.getElementById('app').style.display='block'; }

async function doLogin(){
  const email=document.getElementById('l-email').value.trim();
  const pass=document.getElementById('l-pass').value;
  const btn=document.getElementById('l-btn');
  const err=document.getElementById('l-err');
  err.textContent=''; btn.disabled=true; btn.textContent='Ingresando...';
  try{ await auth.signInWithEmailAndPassword(email,pass); }
  catch(e){ err.textContent='Email o contraseña incorrectos'; btn.disabled=false; btn.textContent='Ingresar'; }
}
function doLogout(){
  stopRealtimeSync(); stopUsersSync();
  auth.signOut();
  clientes=[]; usersDB={}; currentUserData=null; history=[];
  showLogin();
}

document.addEventListener('DOMContentLoaded',()=>{
  showLogin();
  const qi=document.getElementById('q');
  if(qi) qi.addEventListener('input',()=>renderVista());
  auth.onAuthStateChanged(async user=>{
    if(user){
      document.getElementById('user-email').textContent=user.email;
      showApp();
      await autoRegistrarUsuario(user.email);
      startRealtimeSync();
      startUsersSync();
    } else {
      stopRealtimeSync(); stopUsersSync(); showLogin();
    }
  });
});

// ── Users sync ────────────────────────────────────────────────
async function autoRegistrarUsuario(email){
  const key=emailToKey(email);
  const ref=db.ref(USERS_PATH+'/'+key);
  const snap=await ref.once('value');
  if(!snap.val()){
    const rol=SUPER_ADMINS.includes(email.toLowerCase())?'admin':'estandar';
    await ref.set({email:email.toLowerCase(),nombre:email.split('@')[0],rol,clientesAsignados:[],proyectosAsignados:[]});
  }
}
function startUsersSync(){
  const ref=db.ref(USERS_PATH);
  _usersUnsubscribe=ref.on('value',snap=>{
    usersDB=snap.val()||{};
    const key=emailToKey(emailActual());
    currentUserData=usersDB[key]||null;
    updateAdminUI();
    renderVista();
  });
}
function stopUsersSync(){
  if(_usersUnsubscribe){ db.ref(USERS_PATH).off('value',_usersUnsubscribe); _usersUnsubscribe=null; }
}
function updateAdminUI(){
  const btn=document.getElementById('btn-usuarios');
  if(btn) btn.style.display=esAdmin()?'':'none';
}

// ── Realtime sync ─────────────────────────────────────────────
function setSyncDot(state,label){
  const dot=document.getElementById('sync-dot');
  const lbl=document.getElementById('sync-label');
  if(!dot||!lbl) return;
  dot.className='sync-dot '+state;
  lbl.textContent=label; lbl.className='sync-label '+(state==='off'?'err':'');
}
function startRealtimeSync(){
  setSyncDot('loading','Cargando...');
  const ref=db.ref(DB_PATH);
  _unsubscribe=ref.on('value',snap=>{
    const data=snap.val();
    if(!data||!data.clientes||!data.clientes.length){
      clientes=[{id:newId(),nombre:'Harf-Tele',estado:'Activo',nota:'',color:null,proyectos:[]}];
      renderVista(); saveToDatabase();
    } else {
      clientes=fixClientes(data.clientes);
      renderVista();
      if(_calVisible) renderCal();
    }
    setSyncDot('on','');
  },()=>setSyncDot('off','Sin conexión'));
}
function stopRealtimeSync(){
  if(_unsubscribe){ db.ref(DB_PATH).off('value',_unsubscribe); _unsubscribe=null; }
}
function reconectar(){ stopRealtimeSync(); startRealtimeSync(); }
function recuperarDatos(){ reconectar(); toast('Recargando...','info'); }

// ── Save ──────────────────────────────────────────────────────
let _saveTimer=null;
function save(){ clearTimeout(_saveTimer); _saveTimer=setTimeout(saveToDatabase,600); showSaved(false); }
async function saveToDatabase(){
  try{ await db.ref(DB_PATH).set({clientes}); showSaved(true); }
  catch(e){ toast('Error al guardar','error'); }
}
function showSaved(ok){
  const s=document.getElementById('saved'); if(!s) return;
  if(ok){ s.textContent='✓ Guardado'; s.className='saved ok'; setTimeout(()=>{s.textContent='';s.className='saved';},2000); }
  else  { s.textContent='Guardando...'; s.className='saved pending'; }
}

// ── History ───────────────────────────────────────────────────
function pushHistory(){
  history.push(JSON.stringify(clientes));
  if(history.length>30) history.shift();
  const btn=document.getElementById('btn-undo');
  if(btn) btn.style.display='';
}
function undo(){
  if(!history.length){ toast('Nada para deshacer','warn'); return; }
  clientes=JSON.parse(history.pop());
  save(); renderVista();
  const btn=document.getElementById('btn-undo');
  if(btn&&!history.length) btn.style.display='none';
}

// ── Selection ─────────────────────────────────────────────────
function toggleSelect(e,id){
  e.stopPropagation();
  if(selectedSet.has(id)) selectedSet.delete(id); else selectedSet.add(id);
  document.getElementById('sel-count').textContent=selectedSet.size;
  document.getElementById('btn-del-sel').style.display=selectedSet.size?'':'none';
  renderVista();
}
function deleteSelected(){
  if(!selectedSet.size) return;
  pushHistory();
  if(_vista==='clientes') clientes=clientes.filter(c=>!selectedSet.has(c.id));
  else if(_clienteActual!==null) clientes[_clienteActual].proyectos=clientes[_clienteActual].proyectos.filter(p=>!selectedSet.has(p.id));
  selectedSet.clear();
  document.getElementById('sel-count').textContent='0';
  document.getElementById('btn-del-sel').style.display='none';
  save(); renderVista();
}

// ── applyEdit ─────────────────────────────────────────────────
function applyEdit(type,ci,pi,ti,field,val){
  pushHistory();
  if(type==='c'){ clientes[ci][field]=val; if(field==='color') clientes[ci].color=val||null; }
  else if(type==='p') clientes[ci].proyectos[pi][field]=val;
  else if(type==='t') clientes[ci].proyectos[pi].tareas[ti][field]=val;
  save(); renderVista();
}

// ── Add/Delete ────────────────────────────────────────────────
function addItem(){
  if(_vista==='clientes'){
    pushHistory();
    clientes.unshift({id:newId(),nombre:'Nuevo Cliente',estado:'Activo',nota:'',color:null,proyectos:[]});
  } else if(_clienteActual!==null){
    pushHistory();
    clientes[_clienteActual].proyectos.unshift({
      id:newId(),nombre:'Nuevo Proyecto',estadoTrabajo:'Sin Iniciar',
      owner:emailActual(),compartidoCon:[],monto:'',moneda:'ARS',nota:'',archivos:[],tareas:[]
    });
  }
  save(); renderVista();
}
function delCliente(ci){ if(!confirm('¿Eliminar este cliente y todos sus proyectos?')) return; pushHistory(); clientes.splice(ci,1); save(); renderVista(); }
function delProyecto(ci,pi){ if(!confirm('¿Eliminar este proyecto?')) return; pushHistory(); clientes[ci].proyectos.splice(pi,1); save(); renderVista(); }
function addTarea(ci,pi){
  pushHistory();
  if(!clientes[ci].proyectos[pi].tareas) clientes[ci].proyectos[pi].tareas=[];
  clientes[ci].proyectos[pi].tareas.unshift({id:newId(),texto:'Nueva tarea',estado:'Pendiente',prioridad:'',responsable:'',vencimiento:''});
  save(); renderVista();
}
function delTarea(ci,pi,ti){ pushHistory(); clientes[ci].proyectos[pi].tareas.splice(ti,1); save(); renderVista(); }

// ── Files ─────────────────────────────────────────────────────
function icono(ext){ const m={pdf:'📄',png:'🖼',jpg:'🖼',jpeg:'🖼',gif:'🖼',webp:'🖼',xlsx:'📊',xls:'📊',docx:'📝',doc:'📝',pptx:'📋',zip:'📦',mp4:'🎬',mp3:'🎵'}; return m[ext]||'📎'; }
function fileToBase64(f){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=e=>res(e.target.result); r.onerror=rej; r.readAsDataURL(f); }); }
async function handleUpload(e,ci,pi){
  const file=e.target.files[0]; if(!file) return;
  if(file.size>4*1024*1024){ toast('Archivo muy grande (máx 4 MB)','warn'); return; }
  pushHistory();
  const b64=await fileToBase64(file);
  const ext=file.name.split('.').pop().toLowerCase();
  if(!clientes[ci].proyectos[pi].archivos) clientes[ci].proyectos[pi].archivos=[];
  clientes[ci].proyectos[pi].archivos.push({id:newId(),nombre:file.name,ext,data:b64,ts:Date.now()});
  save(); renderVista();
}
async function handleUploadCliente(e,ci){
  const file=e.target.files[0]; if(!file) return;
  if(file.size>4*1024*1024){ toast('Archivo muy grande (máx 4 MB)','warn'); return; }
  pushHistory();
  const b64=await fileToBase64(file);
  const ext=file.name.split('.').pop().toLowerCase();
  if(!clientes[ci].archivos) clientes[ci].archivos=[];
  clientes[ci].archivos.push({id:newId(),nombre:file.name,ext,data:b64,ts:Date.now()});
  save(); renderVista();
}
function openFile(data,nombre){ const a=document.createElement('a'); a.href=data; a.download=nombre; a.target='_blank'; a.click(); }
function delArchivo(ci,pi,ai){ pushHistory(); clientes[ci].proyectos[pi].archivos.splice(ai,1); save(); renderVista(); }
function delArchivoCliente(ci,ai){ pushHistory(); clientes[ci].archivos.splice(ai,1); save(); renderVista(); }
function openLb(src){ document.getElementById('lbi').src=src; document.getElementById('lb').classList.add('show'); }

// ── Sharing ───────────────────────────────────────────────────
function renderShareSection(p,ci,pi){
  const isOwner=esOwnerProyecto(p);
  const isAdm=esAdmin();
  if(!isOwner&&!isAdm){
    if(p.owner) return '<div class="share-info">👁 Compartido por <strong>@'+ESC(p.owner.split('@')[0])+'</strong></div>';
    return '';
  }
  const sharedEmails=p.compartidoCon||[];
  const chips=sharedEmails.length
    ? sharedEmails.map((e,i)=>'<span class="share-chip">@'+ESC(e.split('@')[0])+'<button onclick="quitarCompartido('+ci+','+pi+','+i+')">✕</button></span>').join('')
    : '<span class="share-empty">Solo vos podés verlo</span>';
  const availUsers=Object.values(usersDB)
    .filter(u=>u.email&&u.email!==emailActual()&&!sharedEmails.map(x=>x.toLowerCase()).includes(u.email.toLowerCase()));
  const userOpts=availUsers.map(u=>'<option value="'+ESC(u.email)+'">'+ESC(u.nombre||u.email.split('@')[0])+' ('+ESC(u.email)+')</option>').join('');
  const addSec=availUsers.length
    ? '<div class="share-add"><select id="share-sel-'+ci+'-'+pi+'"><option value="">— Seleccionar usuario —</option>'+userOpts+'</select><button onclick="agregarCompartido('+ci+','+pi+')">+ Agregar</button></div>'
    : '<div class="share-no-more">No hay más usuarios disponibles</div>';
  return '<div class="share-section"><div class="share-title">👥 Compartido con:</div><div class="share-chips">'+chips+'</div>'+addSec+'</div>';
}
function agregarCompartido(ci,pi){
  const sel=document.getElementById('share-sel-'+ci+'-'+pi);
  if(!sel||!sel.value){ toast('Seleccioná un usuario','warn'); return; }
  const email=sel.value.toLowerCase();
  const p=clientes[ci].proyectos[pi];
  if(!p.compartidoCon) p.compartidoCon=[];
  if(p.compartidoCon.map(e=>e.toLowerCase()).includes(email)){ toast('Ya tiene acceso','warn'); return; }
  pushHistory(); p.compartidoCon.push(email); save(); renderVista();
  toast('@'+email.split('@')[0]+' agregado','success');
}
function quitarCompartido(ci,pi,idx){ pushHistory(); clientes[ci].proyectos[pi].compartidoCon.splice(idx,1); save(); renderVista(); }

// ── Render helpers ────────────────────────────────────────────
function pctOf(t){ if(!t||!t.length) return 0; return Math.round(t.filter(x=>x.estado==='Terminado').length/t.length*100); }
function progressBar(pct){ const col=pct===100?'#22c55e':pct>=60?'#3b82f6':pct>=30?'#f59e0b':'#e5e7eb'; return '<div class="prog-bar"><div class="prog-fill" style="width:'+pct+'%;background:'+col+'"></div></div>'; }
function estadoClass(s){ const m={'En Ejecución':'estado-activo','En Ejecución sin Presupuesto':'estado-activo','Avanzado':'estado-avanzado','Avanzado sin Presupuesto':'estado-avanzado','Terminado':'estado-terminado','Terminado sin Presupuesto':'estado-terminado','Cobrado':'estado-cobrado','Facturar':'estado-facturar','Esperando Aprobación':'estado-espera','Aprobado de Palabra':'estado-espera','Sin Iniciar':'estado-sinini','Presupuestado':'estado-presu','Presupuestar':'estado-presu','En Relevamiento':'estado-relev','Aprobar':'estado-espera'}; return m[s]||''; }

// ── Render Tareas (ordenadas por prioridad) ───────────────────
function renderTareas(p,ci,pi){
  const tareas=sortByPriority([...(p.tareas||[])]);
  if(!tareas.length) return '<div class="no-tareas">Sin tareas. <button onclick="addTarea('+ci+','+pi+')">+ Agregar primera</button></div>';
  const rows=tareas.map(t=>{
    const oi=p.tareas.findIndex(x=>x.id===t.id);
    const pr=t.prioridad||''; const done=t.estado==='Terminado';
    return '<div class="tarea-row'+(done?' done':'')+' prio-'+(pr.toLowerCase()||'none')+'">'
      +'<div class="tarea-check-wrap"><input type="checkbox"'+(done?' checked':'')
      +' onchange="applyEdit(\'t\','+ci+','+pi+','+oi+',\'estado\',this.checked?\'Terminado\':\'Pendiente\')"></div>'
      +'<div class="tarea-body">'
      +'<input class="tarea-txt'+(done?' done-txt':'')+'" value="'+ESC(t.texto)+'" onchange="applyEdit(\'t\','+ci+','+pi+','+oi+',\'texto\',this.value)">'
      +'<div class="tarea-meta">'
      +'<select class="tarea-prio '+pr.toLowerCase()+'" onchange="applyEdit(\'t\','+ci+','+pi+','+oi+',\'prioridad\',this.value)">'
      +'<option value=""'+(!pr?' selected':'')+'>— Prioridad</option>'
      +'<option value="Alta"'+(pr==='Alta'?' selected':'')+'>🔴 Alta</option>'
      +'<option value="Media"'+(pr==='Media'?' selected':'')+'>🟡 Media</option>'
      +'<option value="Baja"'+(pr==='Baja'?' selected':'')+'>🟢 Baja</option>'
      +'</select>'
      +'<input class="tarea-resp" value="'+ESC(t.responsable||'')+'" placeholder="Responsable" onchange="applyEdit(\'t\','+ci+','+pi+','+oi+',\'responsable\',this.value)">'
      +'<input class="tarea-venc" type="date" value="'+ESC(t.vencimiento||'')+'" onchange="applyEdit(\'t\','+ci+','+pi+','+oi+',\'vencimiento\',this.value)">'
      +'<button class="tarea-del" onclick="delTarea('+ci+','+pi+','+oi+')">✕</button>'
      +'</div></div></div>';
  }).join('');
  return '<div class="tareas-list">'+rows+'<button class="btn-add-tarea" onclick="addTarea('+ci+','+pi+')">+ Tarea</button></div>';
}

// ── Render Proyecto Body ──────────────────────────────────────
function renderProyectoBody(p,ci,pi){
  const shareSection=renderShareSection(p,ci,pi);
  const archivos=p.archivos||[];
  const archHtml=archivos.map((a,ai)=>{
    const isImg=['png','jpg','jpeg','gif','webp'].includes(a.ext);
    const clickFn=isImg?'openLb(\''+a.data+'\')':'openFile(\''+a.data+'\',\''+ESC(a.nombre)+'\')';
    return '<span class="arch-chip" title="'+ESC(a.nombre)+'">'
      +'<span onclick="'+clickFn+'" style="cursor:pointer">'+icono(a.ext)+' '+ESC(a.nombre.slice(0,20))+(a.nombre.length>20?'…':'')+'</span>'
      +'<button onclick="delArchivo('+ci+','+pi+','+ai+')">✕</button></span>';
  }).join('');
  const pct=pctOf(p.tareas);
  return '<div class="proj-body">'
    +'<div class="proj-fields">'
    +'<div class="field-group"><label>Estado de trabajo</label>'
    +'<select onchange="applyEdit(\'p\','+ci+','+pi+',0,\'estadoTrabajo\',this.value)">'+opt(GRUPOS_TRABAJO,p.estadoTrabajo)+'</select></div>'
    +'<div class="field-group"><label>Monto</label><div style="display:flex;gap:4px">'
    +'<select style="width:68px" onchange="applyEdit(\'p\','+ci+','+pi+',0,\'moneda\',this.value)">'
    +'<option value="ARS"'+(p.moneda==='ARS'?' selected':'')+'>ARS</option>'
    +'<option value="USD"'+(p.moneda==='USD'?' selected':'')+'>USD</option></select>'
    +'<input type="number" value="'+ESC(p.monto||'')+'" placeholder="0" onchange="applyEdit(\'p\','+ci+','+pi+',0,\'monto\',this.value)"></div></div>'
    +'<div class="field-group" style="grid-column:1/-1"><label>Notas</label>'
    +'<textarea rows="2" onchange="applyEdit(\'p\','+ci+','+pi+',0,\'nota\',this.value)">'+ESC(p.nota||'')+'</textarea></div>'
    +'</div>'
    +shareSection
    +'<div class="tareas-header"><span>Tareas '+(pct>0?'<span class="pct-badge">'+pct+'%</span>':'')+'</span>'+progressBar(pct)+'</div>'
    +renderTareas(p,ci,pi)
    +'<div class="archivos-section"><div class="archivos-chips">'+archHtml+'</div>'
    +'<label class="btn-upload">📎 Adjuntar<input type="file" style="display:none" onchange="handleUpload(event,'+ci+','+pi+')"></label>'
    +'</div></div>';
}

// ── Share badge ───────────────────────────────────────────────
function shareBadge(p){
  if(!p.owner) return '';
  if(esAdmin()) return '<span class="proj-share-badge admin" title="Sos admin">👑</span>';
  const em=emailActual();
  if(p.owner===em){
    const n=(p.compartidoCon||[]).length;
    if(n) return '<span class="proj-share-badge shared">👥 '+n+'</span>';
    return '<span class="proj-share-badge solo">🔒</span>';
  }
  return '<span class="proj-share-badge">👁</span>';
}

// ── Render Proyectos ──────────────────────────────────────────
function renderProyectos(ci){
  const c=clientes[ci];
  const q=(document.getElementById('q')?.value||'').toLowerCase();
  const filtE=document.getElementById('filtroEstado')?.value||'';
  let projs=sortProyectos((c.proyectos||[]).filter(p=>{
    if(!puedeVerProyecto(p)) return false;
    if(q&&!p.nombre.toLowerCase().includes(q)&&!p.estadoTrabajo.toLowerCase().includes(q)) return false;
    if(filtE&&p.estadoTrabajo!==filtE) return false;
    return true;
  }));
  if(!projs.length) return '<div class="no-items">No hay proyectos visibles.</div>';
  return projs.map(p=>{
    const pi=c.proyectos.indexOf(p);
    const key=ci+'-'+pi;
    const open=!!_expandedProj[key];
    const pct=pctOf(p.tareas);
    const sel=selectedSet.has(p.id);
    return '<div class="proj-row'+(sel?' selected':'')+'">'
      +'<div class="proj-header" onclick="toggleProjExpand('+ci+','+pi+')">'
      +'<input type="checkbox" class="sel-check"'+(sel?' checked':'')+' onclick="toggleSelect(event,\''+p.id+'\')">'
      +'<span class="proj-arrow">'+(open?'▼':'▶')+'</span>'
      +'<input class="proj-name-inp" value="'+ESC(p.nombre)+'" onclick="event.stopPropagation()" onchange="applyEdit(\'p\','+ci+','+pi+',0,\'nombre\',this.value)">'
      +'<span class="proj-status-tag '+estadoClass(p.estadoTrabajo)+'">'+ESC(p.estadoTrabajo)+'</span>'
      +shareBadge(p)
      +(pct>0?'<span class="pct-badge">'+pct+'%</span>':'')
      +(p.monto?'<span class="monto-tag">'+ESC(p.moneda||'ARS')+' '+ESC(p.monto)+'</span>':'')
      +'<button class="btn-del-item" onclick="event.stopPropagation();delProyecto('+ci+','+pi+')">🗑</button>'
      +'</div>'
      +(open?renderProyectoBody(p,ci,pi):'')
      +'</div>';
  }).join('');
}
function toggleProjExpand(ci,pi){ const k=ci+'-'+pi; _expandedProj[k]=!_expandedProj[k]; renderVista(); }

// ── Render Clientes ───────────────────────────────────────────
function renderClientes(){
  const q=(document.getElementById('q')?.value||'').toLowerCase();
  const filtE=document.getElementById('filtroEstado')?.value||'';
  const filtA=document.getElementById('filtroAbono')?.value||'';
  let vis=clientes.filter(c=>{
    if(!puedeVerCliente(c)) return false;
    if(q&&!c.nombre.toLowerCase().includes(q)) return false;
    if(filtE&&c.estado!==filtE) return false;
    if(filtA==='Abono'&&c.abono!=='Abono') return false;
    if(filtA==='Sin Abono'&&c.abono==='Abono') return false;
    return true;
  });
  const cnt=document.getElementById('filtroCount');
  if(cnt) cnt.textContent=vis.length+' cliente'+(vis.length!==1?'s':'');
  if(!vis.length) return '<div class="no-items">No hay clientes.</div>';
  return vis.map(c=>{
    const ci=clientes.indexOf(c);
    const sel=selectedSet.has(c.id);
    const bStyle=c.color?'border-left:4px solid '+c.color+';':'';
    const archivos=c.archivos||[];
    const archHtml=archivos.map((a,ai)=>{
      const isImg=['png','jpg','jpeg','gif','webp'].includes(a.ext);
      const clickFn=isImg?'openLb(\''+a.data+'\')':'openFile(\''+a.data+'\',\''+ESC(a.nombre)+'\')';
      return '<span class="arch-chip"><span onclick="'+clickFn+'" style="cursor:pointer">'+icono(a.ext)+' '+ESC(a.nombre.slice(0,20))+'</span><button onclick="event.stopPropagation();delArchivoCliente('+ci+','+ai+')">✕</button></span>';
    }).join('');
    const nProj=(c.proyectos||[]).filter(p=>puedeVerProyecto(p)).length;
    return '<div class="cliente-card'+(sel?' selected':'')+'" style="'+bStyle+'">'
      +'<div class="cliente-header" onclick="abrirCliente('+ci+')">'
      +'<input type="checkbox" class="sel-check"'+(sel?' checked':'')+' onclick="toggleSelect(event,\''+c.id+'\')">'
      +'<div class="cliente-info">'
      +'<input class="cliente-name-inp" value="'+ESC(c.nombre)+'" onclick="event.stopPropagation()" onchange="applyEdit(\'c\','+ci+',0,0,\'nombre\',this.value)">'
      +'<div class="cliente-meta">'
      +'<select class="estado-sel" onclick="event.stopPropagation()" onchange="applyEdit(\'c\','+ci+',0,0,\'estado\',this.value)">'+opt(ESTADOS_CLIENTE,c.estado)+'</select>'
      +'<select class="abono-sel" onclick="event.stopPropagation()" onchange="applyEdit(\'c\','+ci+',0,0,\'abono\',this.value)"><option value=""'+(!c.abono?' selected':'')+'>Sin Abono</option><option value="Abono"'+(c.abono==='Abono'?' selected':'')+'>Abono</option></select>'
      +'<input type="color" class="color-pick" value="'+(c.color||'#94a3b8')+'" onclick="event.stopPropagation()" onchange="applyEdit(\'c\','+ci+',0,0,\'color\',this.value)">'
      +'</div></div>'
      +'<span class="proj-count-badge">'+nProj+' proy.</span>'
      +'<button class="btn-del-item" onclick="event.stopPropagation();delCliente('+ci+')">🗑</button>'
      +'</div></div>';
  }).join('');
}

function abrirCliente(ci){
  _vista='proyectos'; _clienteActual=ci;
  const btn=document.getElementById('btn-add'); if(btn) btn.textContent='+ Nuevo Proyecto';
  updateBreadcrumb(); populateFiltroEstado();
  const fa=document.getElementById('filtroAbono'); if(fa) fa.style.display='none';
  renderVista();
}
function volverClientes(){
  _vista='clientes'; _clienteActual=null;
  const btn=document.getElementById('btn-add'); if(btn) btn.textContent='+ Nuevo Cliente';
  const fa=document.getElementById('filtroAbono'); if(fa) fa.style.display='';
  updateBreadcrumb(); populateFiltroEstado(); renderVista();
}
function updateBreadcrumb(){
  const bc=document.getElementById('breadcrumb'); if(!bc) return;
  if(_vista==='clientes') bc.innerHTML='<span class="cur">Clientes</span>';
  else bc.innerHTML='<span class="link" onclick="volverClientes()">Clientes</span> / <span class="cur">'+ESC(clientes[_clienteActual]?.nombre||'Cliente')+'</span>';
}
function populateFiltroEstado(){
  const sel=document.getElementById('filtroEstado'); if(!sel) return;
  sel.innerHTML='<option value="">📋 Todos los estados</option>';
  const states=_vista==='clientes'?ESTADOS_CLIENTE:GRUPOS_TRABAJO;
  states.forEach(s=>{ const o=document.createElement('option'); o.value=s; o.textContent=s; sel.appendChild(o); });
}

function renderVista(){
  const root=document.getElementById('root'); if(!root) return;
  updateAdminUI();
  if(_vista==='clientes') root.innerHTML=renderClientes();
  else if(_clienteActual!==null) root.innerHTML=renderProyectos(_clienteActual);
}

// ── Calendar ──────────────────────────────────────────────────
function toggleCal(){
  _calVisible=!_calVisible;
  const panel=document.getElementById('cal-panel');
  const btn=document.getElementById('btn-cal');
  if(!panel||!btn) return;
  panel.style.display=_calVisible?'block':'none';
  btn.textContent=_calVisible?'✕ Cerrar':'📅 Semana';
  if(_calVisible) renderCal();
}
function renderCal(){
  const panel=document.getElementById('cal-panel'); if(!panel) return;
  const today=new Date();
  const dow=today.getDay();
  const mon=new Date(today); mon.setDate(today.getDate()-(dow===0?6:dow-1));
  const days=[]; for(let i=0;i<7;i++){ const d=new Date(mon); d.setDate(mon.getDate()+i); days.push(d); }
  const fmt=d=>d.toISOString().split('T')[0];
  const dayNames=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
  const cols=days.map((d,i)=>{
    const iso=fmt(d); const isToday=iso===fmt(today);
    const tasks=clientes.flatMap(c=>(c.proyectos||[]).filter(p=>puedeVerProyecto(p))
      .flatMap(p=>(p.tareas||[]).filter(t=>t.vencimiento===iso&&t.estado!=='Terminado').map(t=>({...t,cNombre:c.nombre}))));
    const items=tasks.map(t=>'<div class="cal-task prio-'+(t.prioridad||'').toLowerCase()+'">'+ESC(t.texto)+' <span style="opacity:.6;font-size:9px">'+ESC(t.cNombre)+'</span></div>').join('');
    return '<div class="cal-col'+(isToday?' today':'')+'"><div class="cal-day-label">'+dayNames[i]+'<br><span>'+d.getDate()+'</span></div><div class="cal-tasks">'+items+'</div></div>';
  }).join('');
  panel.innerHTML='<div class="cal-grid">'+cols+'</div>';
}

// ── Backup / Import ───────────────────────────────────────────
function exportJSON(){ const blob=new Blob([JSON.stringify({clientes},null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='ciaber_backup_'+Date.now()+'.json'; a.click(); }
function importJSON(e){ const file=e.target.files[0]; if(!file) return; const r=new FileReader(); r.onload=ev=>{ try{ const d=JSON.parse(ev.target.result); if(d.clientes){ pushHistory(); clientes=fixClientes(d.clientes); save(); renderVista(); toast('Importado','success'); } else toast('Archivo inválido','error'); }catch{ toast('Error al importar','error'); } }; r.readAsText(file); }

// ── Excel ─────────────────────────────────────────────────────
async function exportarExcel(){
  if(typeof ExcelJS==='undefined'){ toast('ExcelJS no disponible','error'); return; }
  const wb=new ExcelJS.Workbook(); wb.creator='CIABER'; wb.created=new Date();
  const ws=wb.addWorksheet('Proyectos');
  ws.columns=[{header:'Cliente',key:'c',width:24},{header:'Proyecto',key:'p',width:28},{header:'Estado',key:'e',width:22},{header:'Monto',key:'m',width:12},{header:'Moneda',key:'mo',width:8},{header:'Total Tareas',key:'tt',width:13},{header:'Tareas OK',key:'tok',width:12},{header:'% Avance',key:'pct',width:11},{header:'Notas',key:'n',width:36}];
  ws.getRow(1).eachCell(cell=>{ cell.font={bold:true,color:{argb:'FFFFFFFF'}}; cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1E3A6E'}}; cell.alignment={vertical:'middle',horizontal:'center'}; });
  clientes.forEach(c=>{ (c.proyectos||[]).filter(p=>puedeVerProyecto(p)).forEach(p=>{ const pct=pctOf(p.tareas); const row=ws.addRow({c:c.nombre,p:p.nombre,e:p.estadoTrabajo,m:p.monto||'',mo:p.moneda||'ARS',tt:(p.tareas||[]).length,tok:(p.tareas||[]).filter(t=>t.estado==='Terminado').length,pct:pct+'%',n:p.nota||''}); if(pct===100) row.getCell('pct').font={color:{argb:'FF16A34A'},bold:true}; }); });
  const buf=await wb.xlsx.writeBuffer();
  const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='ciaber_'+Date.now()+'.xlsx'; a.click();
  toast('Excel generado','success');
}

// ── USUARIOS ABM ──────────────────────────────────────────────
function toggleUsersPanel(){
  if(!esAdmin()){ toast('Solo administradores','warn'); return; }
  const m=document.getElementById('users-modal'); if(!m) return;
  m.classList.toggle('show');
  if(m.classList.contains('show')) renderUsersPanel();
}
function closeUsersPanel(){ document.getElementById('users-modal')?.classList.remove('show'); }
function toggleUserBody(key){ const b=document.getElementById('ubody-'+key); if(b) b.classList.toggle('open'); }

function renderUsersPanel(){
  if(!esAdmin()) return;
  const body=document.getElementById('users-modal-body'); if(!body) return;
  const users=Object.entries(usersDB).sort((a,b)=>{
    if(a[1].rol==='admin'&&b[1].rol!=='admin') return -1;
    if(b[1].rol==='admin'&&a[1].rol!=='admin') return 1;
    return (a[1].nombre||a[1].email||'').localeCompare(b[1].nombre||b[1].email||'');
  });
  if(!users.length){ body.innerHTML='<div style="padding:24px;text-align:center;color:#6b7280">Los usuarios aparecen aquí al iniciar sesión por primera vez.</div>'; return; }
  let html='<div class="users-list">';
  users.forEach(([key,u])=>{
    const init=(u.nombre||u.email||'?').charAt(0).toUpperCase();
    const isCurrent=u.email===emailActual();
    const clientesAsig=(u.clientesAsignados||[]).map(id=>clientes.find(c=>c.id===id)).filter(Boolean);
    const proyAsig=(u.proyectosAsignados||[]).flatMap(id=>{ for(const c of clientes){ const p=(c.proyectos||[]).find(p=>p.id===id); if(p) return [{...p,cNombre:c.nombre}]; } return []; });
    const clienteOpts=clientes.filter(c=>!(u.clientesAsignados||[]).includes(c.id)).map(c=>'<option value="'+ESC(c.id)+'">'+ESC(c.nombre)+'</option>').join('');
    const proyOpts=clientes.flatMap(c=>(c.proyectos||[]).filter(p=>!(u.proyectosAsignados||[]).includes(p.id)).map(p=>'<option value="'+ESC(p.id)+'">'+ESC(c.nombre)+' / '+ESC(p.nombre)+'</option>')).join('');
    const canChange=!SUPER_ADMINS.includes(u.email);
    const changeBtn=canChange?(u.rol==='admin'
      ?'<button class="btn-rol-change" onclick="event.stopPropagation();cambiarRol(\''+key+'\',\'estandar\')">→ Estándar</button>'
      :'<button class="btn-rol-change" onclick="event.stopPropagation();cambiarRol(\''+key+'\',\'admin\')">→ Admin</button>'):'';
    html+='<div class="user-item">'
      +'<div class="user-item-header" onclick="toggleUserBody(\''+key+'\')">'
      +'<div class="user-avatar">'+init+'</div>'
      +'<div class="user-info">'
      +'<div class="user-nombre">'+ESC(u.nombre||u.email)+(isCurrent?' <span class="you-tag">(vos)</span>':'')+'</div>'
      +'<div class="user-email">'+ESC(u.email)+'</div>'
      +'</div>'
      +'<span class="user-rol-badge '+(u.rol||'estandar')+'">'+(u.rol==='admin'?'Admin':'Estándar')+'</span>'
      +changeBtn
      +'<span class="user-arrow">▶</span></div>';
    if((u.rol||'estandar')!=='admin'){
      html+='<div class="user-item-body" id="ubody-'+key+'">'
        +'<div class="user-assign-section">'
        +'<div class="user-assign-title">Clientes asignados</div>'
        +'<div class="user-assign-chips">'
        +(clientesAsig.map(c=>'<span class="user-assign-chip">'+ESC(c.nombre)+'<button onclick="quitarClienteUsuario(\''+key+'\',\''+c.id+'\')">✕</button></span>').join('')||'<span class="no-asig">Ninguno</span>')
        +'</div>'
        +'<div class="user-assign-add">'
        +'<select id="sel-c-'+key+'"><option value="">— Seleccionar cliente —</option>'+clienteOpts+'</select>'
        +'<button onclick="asignarClienteUsuario(\''+key+'\')">+ Asignar</button>'
        +'</div></div>'
        +'<div class="user-assign-section">'
        +'<div class="user-assign-title">Proyectos asignados</div>'
        +'<div class="user-assign-chips">'
        +(proyAsig.map(p=>'<span class="user-assign-chip">'+ESC(p.cNombre)+' / '+ESC(p.nombre)+'<button onclick="quitarProyectoUsuario(\''+key+'\',\''+p.id+'\')">✕</button></span>').join('')||'<span class="no-asig">Ninguno</span>')
        +'</div>'
        +'<div class="user-assign-add">'
        +'<select id="sel-p-'+key+'"><option value="">— Seleccionar proyecto —</option>'+proyOpts+'</select>'
        +'<button onclick="asignarProyectoUsuario(\''+key+'\')">+ Asignar</button>'
        +'</div></div>'
        +'</div>';
    }
    html+='</div>';
  });
  html+='</div>'
    +'<div class="users-add-form">'
    +'<input id="new-user-email" type="email" placeholder="Email del usuario...">'
    +'<input id="new-user-nombre" type="text" placeholder="Nombre...">'
    +'<select id="new-user-rol"><option value="estandar">Estándar</option><option value="admin">Admin</option></select>'
    +'<button onclick="agregarUsuario()">+ Agregar</button>'
    +'</div>';
  body.innerHTML=html;
}

async function cambiarRol(key,nuevoRol){
  if(!esAdmin()) return;
  const u=usersDB[key]; if(!u) return;
  if(SUPER_ADMINS.includes(u.email)){ toast('No se puede cambiar el super admin','warn'); return; }
  await db.ref(USERS_PATH+'/'+key+'/rol').set(nuevoRol);
  toast('Rol cambiado a '+nuevoRol,'success');
}
async function asignarClienteUsuario(key){
  if(!esAdmin()) return;
  const sel=document.getElementById('sel-c-'+key); if(!sel||!sel.value) return;
  const id=sel.value; const u=usersDB[key]; if(!u) return;
  const arr=[...(u.clientesAsignados||[])]; if(arr.includes(id)){ toast('Ya asignado','warn'); return; }
  arr.push(id); await db.ref(USERS_PATH+'/'+key+'/clientesAsignados').set(arr); toast('Cliente asignado','success');
}
async function quitarClienteUsuario(key,id){
  if(!esAdmin()) return;
  const u=usersDB[key]; if(!u) return;
  await db.ref(USERS_PATH+'/'+key+'/clientesAsignados').set((u.clientesAsignados||[]).filter(x=>x!==id));
  toast('Cliente removido','success');
}
async function asignarProyectoUsuario(key){
  if(!esAdmin()) return;
  const sel=document.getElementById('sel-p-'+key); if(!sel||!sel.value) return;
  const id=sel.value; const u=usersDB[key]; if(!u) return;
  const arr=[...(u.proyectosAsignados||[])]; if(arr.includes(id)){ toast('Ya asignado','warn'); return; }
  arr.push(id); await db.ref(USERS_PATH+'/'+key+'/proyectosAsignados').set(arr); toast('Proyecto asignado','success');
}
async function quitarProyectoUsuario(key,id){
  if(!esAdmin()) return;
  const u=usersDB[key]; if(!u) return;
  await db.ref(USERS_PATH+'/'+key+'/proyectosAsignados').set((u.proyectosAsignados||[]).filter(x=>x!==id));
  toast('Proyecto removido','success');
}
async function agregarUsuario(){
  if(!esAdmin()) return;
  const email=(document.getElementById('new-user-email')?.value||'').trim().toLowerCase();
  const nombre=(document.getElementById('new-user-nombre')?.value||'').trim();
  const rol=document.getElementById('new-user-rol')?.value||'estandar';
  if(!email||!email.includes('@')){ toast('Email inválido','warn'); return; }
  const key=emailToKey(email);
  if(usersDB[key]){ toast('Usuario ya existe','warn'); return; }
  await db.ref(USERS_PATH+'/'+key).set({email,nombre:nombre||email.split('@')[0],rol,clientesAsignados:[],proyectosAsignados:[]});
  document.getElementById('new-user-email').value='';
  document.getElementById('new-user-nombre').value='';
  toast('@'+email.split('@')[0]+' agregado','success');
}
