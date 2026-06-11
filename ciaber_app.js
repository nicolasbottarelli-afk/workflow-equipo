// ============================================================
//  CIABER / HARF-TELE — App principal
//  Base de datos: Firebase Realtime Database
//  Autenticación: Firebase Auth (email/contraseña)
//  Proyectos privados: cada proyecto tiene owner + compartidoCon[]
// ============================================================

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDijZ5KYg1OPcSJnDsQh9pxtH_cr_xobRU",
  authDomain:        "workflow-equipo.firebaseapp.com",
  databaseURL:       "https://workflow-equipo-default-rtdb.firebaseio.com",
  projectId:         "workflow-equipo",
  storageBucket:     "workflow-equipo.firebasestorage.app",
  messagingSenderId: "974073018957",
  appId:             "1:974073018957:web:9200142d312802f74d3a04",
  measurementId:     "G-RG90F7RJSH"
};

firebase.initializeApp(FIREBASE_CONFIG);
const auth   = firebase.auth();
const db     = firebase.database();
const DB_PATH = 'ciaber/data';

// ── PERMISOS / PROYECTOS COMPARTIDOS ───────────────────────
function emailActual() {
  return (auth.currentUser?.email || '').toLowerCase().trim();
}
function esOwnerProyecto(p) {
  if (!p.owner) return true;
  return p.owner.toLowerCase().trim() === emailActual();
}
function puedeVerProyecto(p) {
  if (!p.owner) return true;
  const em = emailActual();
  if (p.owner.toLowerCase().trim() === em) return true;
  return (p.compartidoCon || []).map(e => e.toLowerCase().trim()).includes(em);
}
function puedeVerCliente(c) {
  const projs = c.proyectos || [];
  if (!projs.length) return true;
  return projs.some(p => puedeVerProyecto(p));
}

// ── CONSTANTES ──────────────────────────────────────────────
const ESTADOS_CLIENTE = ['Activo', 'Potencial', 'Inactivo', 'Suspendido'];
const EC_CLASS = { Activo:'ec-Activo', Potencial:'ec-Potencial', Inactivo:'ec-Inactivo', Suspendido:'ec-Suspendido' };
const GRUPOS_TRABAJO = [
  { g:'— Común —', e:['Sin Iniciar','En Relevamiento'] },
  { g:'— Camino 1: Con Presupuesto —', e:['Presupuestado','Esperando Aprobación','En Ejecución','Avanzado','Terminado','Facturar','Cobrado'] },
  { g:'— Camino 2: De Palabra —', e:['Aprobado de Palabra','En Ejecución sin Presupuesto','Avanzado sin Presupuesto','Terminado sin Presupuesto','Presupuestar','Aprobar','Facturar','Cobrado'] }
];
const ESTADOS_TRABAJO = [...new Set(GRUPOS_TRABAJO.flatMap(g => g.e))];
const ET_CLASS = {
  'Sin Iniciar':'etj-SinIniciar','En Relevamiento':'etj-Gris','Presupuestado':'etj-Presupuestado',
  'Esperando Aprobación':'etj-IniciadoSinAprobar','En Ejecución':'etj-Iniciado','Avanzado':'etj-AvanzadoFaltaTerminar',
  'Terminado':'etj-Terminado','Facturar':'etj-Cobrado','Cobrado':'etj-Cobrado',
  'Aprobado de Palabra':'etj-IniciadoSinAprobar','En Ejecución sin Presupuesto':'etj-AvanzadoFaltaTerminar',
  'Avanzado sin Presupuesto':'etj-AvanzadoFaltaTerminar','Terminado sin Presupuesto':'etj-Terminado',
  'Presupuestar':'etj-Presupuestado','Aprobar':'etj-Aprobado'
};
const COLOR_HEX = {
  amarillo:'#f59e0b',rojo:'#dc2626',verde:'#10b981',violeta:'#7c3aed',
  gris:'#475569',celeste:'#0ea5e9',naranja:'#f97316',turquesa:'#0d9488',esmeralda:'#059669'
};
const ET_COLOR = {
  'Sin Iniciar':null,'En Relevamiento':'gris','Presupuestado':'violeta','Esperando Aprobación':'amarillo',
  'En Ejecución':'celeste','Avanzado':'naranja','Terminado':'verde','Facturar':'turquesa','Cobrado':'turquesa',
  'Aprobado de Palabra':'amarillo','En Ejecución sin Presupuesto':'rojo','Avanzado sin Presupuesto':'naranja',
  'Terminado sin Presupuesto':'esmeralda','Presupuestar':'violeta','Aprobar':'esmeralda'
};
const OPCIONES_ABONO = ['Sin Abono','Abono'];
const ESTADOS = ['Pendiente','En proceso','Terminado'];
const PRIORIDADES = ['','Alta','Media','Baja'];

// ── ESTADO GLOBAL ───────────────────────────────────────────
let clientes=[], vistaActual='clientes', clienteActual=null;
let _saving=false, _pendingSave=false, _unsubscribe=null, _saveTimer=null;
let _calVisible=false, _calWeekOffset=0;
const _selected=new Set(), _history=[], expandedKeys=new Set();

// ── TOAST ────────────────────────────────────────────────────
function toast(msg,type='info',duration=3000){
  const icons={success:'✓',error:'✕',warn:'⚠',info:'ℹ'};
  const el=document.createElement('div');
  el.className=`toast toast-${type}`;
  el.innerHTML=`<span>${icons[type]||'ℹ'}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  requestAnimationFrame(()=>el.classList.add('show'));
  setTimeout(()=>{el.classList.remove('show');setTimeout(()=>el.remove(),300);},duration);
}

// ── HELPERS ──────────────────────────────────────────────────
function newId(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
const ESC=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const opt=(arr,v)=>arr.map(o=>`<option value="${o}"${o===v?' selected':''}>${o||'—'}</option>`).join('');

function optTrabajo(val){
  return GRUPOS_TRABAJO.map(g=>
    `<optgroup label="${g.g}">${g.e.map(e=>`<option value="${e}"${e===val?' selected':''}>${e}</option>`).join('')}</optgroup>`
  ).join('');
}

function fixClientes(arr){
  if(!Array.isArray(arr))return[];
  arr.forEach(c=>{
    if(!c.id)c.id=newId();
    if(!c.estado)c.estado='Activo';
    if(!c.proyectos)c.proyectos=[];
    c.proyectos.forEach(p=>{
      if(!p.id)p.id=newId();
      if(!p.adjuntos)p.adjuntos=[];
      if(!p.tareas)p.tareas=[];
      if(!p.subpuntos)p.subpuntos=[];
      if(!p.compartidoCon)p.compartidoCon=[];
      if(p.fechaEstimada==null)p.fechaEstimada='';
      if(p.nroTicket==null)p.nroTicket='';
      p.tareas.forEach(t=>{
        if(!t.adjuntos)t.adjuntos=[];
        if(!t.subtareas)t.subtareas=[];
        if(t.fechaEstimada==null)t.fechaEstimada='';
        if(t.nroTicket==null)t.nroTicket='';
        t.subtareas.forEach(st=>{if(!st.adjuntos)st.adjuntos=[];if(st.fechaEstimada==null)st.fechaEstimada='';if(st.nroTicket==null)st.nroTicket='';});
      });
      p.subpuntos.forEach(s=>{
        if(!s.id)s.id=newId();
        if(!s.tareas)s.tareas=[];
        if(s.fechaEstimada==null)s.fechaEstimada='';
        s.tareas.forEach(t=>{
          if(!t.adjuntos)t.adjuntos=[];
          if(!t.subtareas)t.subtareas=[];
          if(t.fechaEstimada==null)t.fechaEstimada='';
          if(t.nroTicket==null)t.nroTicket='';
          t.subtareas.forEach(st=>{if(!st.adjuntos)st.adjuntos=[];if(st.fechaEstimada==null)st.fechaEstimada='';if(st.nroTicket==null)st.nroTicket='';});
        });
      });
    });
  });
  return arr;
}

// ── AUTH ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('q').oninput=renderVista;
  auth.onAuthStateChanged(user=>{
    if(user){showApp(user.email);startRealtimeSync();}
    else{stopRealtimeSync();showLogin();}
  });
});

function showLogin(){
  document.getElementById('login-screen').style.display='flex';
  document.getElementById('app').style.display='none';
  clientes=[];
}
function showApp(email){
  document.getElementById('login-screen').style.display='none';
  document.getElementById('app').style.display='block';
  document.getElementById('user-email').textContent=email;
}
async function doLogin(){
  const btn=document.getElementById('l-btn'),err=document.getElementById('l-err');
  const email=document.getElementById('l-email').value.trim(),pass=document.getElementById('l-pass').value;
  if(!email||!pass){err.textContent='Completá email y contraseña.';return;}
  btn.textContent='Ingresando...';btn.disabled=true;err.textContent='';
  try{await auth.signInWithEmailAndPassword(email,pass);}
  catch(e){
    const msgs={'auth/user-not-found':'Usuario no encontrado.','auth/wrong-password':'Contraseña incorrecta.',
      'auth/invalid-email':'Email inválido.','auth/too-many-requests':'Demasiados intentos.',
      'auth/invalid-credential':'Email o contraseña incorrectos.'};
    err.textContent=msgs[e.code]||('Error: '+e.message);
    btn.textContent='Ingresar';btn.disabled=false;
  }
}
async function doLogout(){
  stopRealtimeSync();clientes=[];await auth.signOut();
  document.getElementById('l-btn').textContent='Ingresar';
  document.getElementById('l-btn').disabled=false;
  document.getElementById('l-email').value='';
  document.getElementById('l-pass').value='';
  document.getElementById('l-err').textContent='';
}

// ── REALTIME DATABASE ─────────────────────────────────────────
function startRealtimeSync(){
  setSyncDot('loading','Cargando...');
  const ref=db.ref(DB_PATH);
  _unsubscribe=ref.on('value',snap=>{
    const data=snap.val();
    if(!data||!data.clientes||!data.clientes.length){
      clientes=[{id:newId(),nombre:'Harf-Tele',estado:'Activo',nota:'',color:null,proyectos:[]}];
      renderVista();saveToDatabase();
    }else{
      clientes=fixClientes(data.clientes);
      renderVista();
      if(_calVisible)renderCal();
    }
    setSyncDot('on','');
  },err=>{
    console.error('Realtime DB error:',err);
    setSyncDot('off','Sin conexión');
    toast('Error de conexión con Firebase','error');
  });
}
function stopRealtimeSync(){
  if(_unsubscribe){db.ref(DB_PATH).off('value',_unsubscribe);_unsubscribe=null;}
}
function reconectar(){stopRealtimeSync();setTimeout(()=>startRealtimeSync(),500);toast('Reconectando...','info');}
function recuperarDatos(){stopRealtimeSync();clientes=[];renderVista();startRealtimeSync();toast('Recargando datos...','info');}

async function saveToDatabase(){
  if(!auth.currentUser)return false;
  if(!clientes||!clientes.length)return false;
  if(_saving){_pendingSave=true;return false;}
  _saving=true;
  try{
    await db.ref(DB_PATH).set({clientes,updated_at:Date.now(),updated_by:auth.currentUser.email});
    setSyncDot('on','');showSaved('✓ Guardado '+new Date().toLocaleTimeString());
    _saving=false;if(_pendingSave){_pendingSave=false;saveToDatabase();}return true;
  }catch(e){
    console.error('Error guardando:',e);showSaved('⚠ Error al guardar');
    setSyncDot('off','Error al guardar');toast('No se pudo guardar: '+e.message,'error');
    _saving=false;return false;
  }
}
function save(){showSaved('⏳ Guardando...');clearTimeout(_saveTimer);_saveTimer=setTimeout(()=>saveToDatabase(),800);}

// ── ADJUNTOS ──────────────────────────────────────────────────
async function handleUpload(event,refTipo,refId,adjArr){
  const file=event.target.files[0];if(!file)return;
  event.target.value='';
  if(file.size>5*1024*1024){toast('Archivo muy grande (máx 5 MB)','error');return;}
  showSaved('⏳ Subiendo archivo...');
  try{
    const base64=await fileToBase64(file);
    adjArr.push({id:newId(),nombre:file.name,tipo_mime:file.type,base64,uploaded_at:new Date().toISOString()});
    save();renderVista();toast('Archivo adjuntado','success');
  }catch(e){toast('Error al adjuntar: '+e.message,'error');}
}
function fileToBase64(file){
  return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});
}
function openFile(storagePath,urlOrBase64){
  if(urlOrBase64&&urlOrBase64.startsWith('data:')){
    const w=window.open();w.document.write(`<iframe src="${urlOrBase64}" style="width:100%;height:100%;border:none"></iframe>`);return;
  }
  if(urlOrBase64){window.open(urlOrBase64,'_blank');return;}
  toast('Archivo no disponible','warn');
}
async function delArchivo(adjArr,idx){
  const adj=adjArr[idx];if(!adj)return;
  if(!confirm(`¿Eliminar "${adj.nombre}"?`))return;
  adjArr.splice(idx,1);save();renderVista();toast('Archivo eliminado','success');
}
function icono(mime){
  if(!mime)return'📎';if(mime.startsWith('image'))return'🖼️';if(mime.includes('pdf'))return'📄';
  if(mime.includes('word')||mime.includes('document'))return'📝';
  if(mime.includes('sheet')||mime.includes('excel'))return'📊';return'📎';
}

// ── UI HELPERS ────────────────────────────────────────────────
function showSaved(msg){
  const s=document.getElementById('saved');if(!s)return;
  s.textContent=msg;clearTimeout(window._st);
  if(!msg.startsWith('⏳'))window._st=setTimeout(()=>s.textContent='',3000);
}
function setSyncDot(state,msg){
  const d=document.getElementById('sync-dot'),l=document.getElementById('sync-label');if(!d)return;
  d.className='sync-dot';
  if(state==='warn')d.classList.add('warn');else if(state!=='on')d.classList.add('off');
  if(l){l.textContent=msg||'';l.className='sync-label'+(state==='off'?' err':state==='on'?' ok':'');}
}

// ── RENDER HELPERS ────────────────────────────────────────────
function pctOf(arr){let t=0,h=0;arr.forEach(x=>{t++;if(x.estado==='Terminado')h++;(x.subtareas||[]).forEach(s=>{t++;if(s.estado==='Terminado')h++;});});return t?Math.round(h*100/t):0;}
function allTareasProy(p){return[...(p.tareas||[]),...(p.subpuntos||[]).flatMap(s=>s.tareas||[])];}
function progressBar(pct){
  const color=pct===100?'#10b981':pct>50?'#3b82f6':'#f59e0b';
  return`<div class="progress-bar-wrap" title="${pct}% completado"><div class="progress-bar" style="width:${pct}%;background:${color}"></div></div>`;
}

// ── RENDER TAREAS ─────────────────────────────────────────────
function renderTareas(tareas,ci,pi,kind,si){
  const q=document.getElementById('q'),f=q?q.value.toLowerCase():'';
  let html=`<div class="tree">`;
  tareas.forEach((t,ti)=>{
    const vis=!f||t.tarea.toLowerCase().includes(f)||(t.subtareas||[]).some(st=>st.tarea.toLowerCase().includes(f));
    if(!vis)return;
    const base=kind==='s'?`${ci}|s|${pi}|${si}|${ti}`:`${ci}|t|${pi}|${ti}`;
    const refId=t.id||base;
    const adjRef=kind==='s'?`clientes[${ci}].proyectos[${pi}].subpuntos[${si}].tareas[${ti}].adjuntos`:`clientes[${ci}].proyectos[${pi}].tareas[${ti}].adjuntos`;
    const adjMini=(t.adjuntos||[]).length?`<div class="task-adj-mini">${(t.adjuntos||[]).map(a=>`<div class="task-adj-chip"><span>${icono(a.tipo_mime)}</span><a onclick="openFile('',${JSON.stringify(a.base64||a.url||'').replace(/"/g,'&quot;')})">${ESC(a.nombre)}</a></div>`).join('')}</div>`:'';
    const uploadId='tup_'+refId.replace(/\|/g,'_');
    const rowStyle=t.estado==='Terminado'?'background:#d1fae5;border-left:2px solid #10b981':t.estado==='En proceso'?'background:#fff7ed;border-left:2px solid #f97316':'';
    html+=`<div class="node task" style="${rowStyle}">
      <span class="tree-id">${ESC(t.id)}</span>
      <div class="tree-tx"><textarea class="txt" data-path="${base}" data-k="tarea">${ESC(t.tarea)}</textarea>${adjMini}</div>
      <div class="tree-meta">
        <input type="text" class="nro-ticket" data-path="${base}" data-k="nroTicket" value="${ESC(t.nroTicket||'')}" placeholder="Ticket">
        <input type="date" class="fecha-est" data-path="${base}" data-k="fechaEstimada" value="${ESC(t.fechaEstimada||'')}" title="Fecha estimada">
        <select class="est" data-path="${base}" data-k="estado">${opt(ESTADOS,t.estado)}</select>
        <select class="pri" data-path="${base}" data-k="prioridad">${opt(PRIORIDADES,t.prioridad)}</select>
        <button class="btn-sub" onclick="document.getElementById('${uploadId}').click()" title="Adjuntar">📎</button>
        <input type="file" id="${uploadId}" class="adj-upload-inp" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" onchange="handleUpload(event,'tarea','${refId}',${adjRef})">
        <button class="btn-save" onclick="guardarAhora(this)">✓</button>
        <button class="btn-sub" onclick="addSub('${base}')">+sub</button>
        <input type="checkbox" class="sel-cb" data-sel="t|${base}" onclick="toggleSel(this)" title="Seleccionar">
        <button class="del" onclick="delTarea('${base}')">✕</button>
      </div></div>`;
    if((t.subtareas||[]).length){
      html+=`<div style="margin-left:14px">`;
      t.subtareas.forEach((st,sti)=>{
        const spath=`${base}|${sti}`;
        const stStyle=st.estado==='Terminado'?'background:#d1fae5;border-left:2px solid #10b981':'';
        html+=`<div class="node subtask" style="${stStyle}">
          <span class="tree-id">${ESC(st.id||'└')}</span>
          <div class="tree-tx"><textarea class="txt" data-path="${spath}" data-k="tarea">${ESC(st.tarea)}</textarea></div>
          <div class="tree-meta">
            <input type="text" class="nro-ticket" data-path="${spath}" data-k="nroTicket" value="${ESC(st.nroTicket||'')}" placeholder="Ticket">
            <input type="date" class="fecha-est" data-path="${spath}" data-k="fechaEstimada" value="${ESC(st.fechaEstimada||'')}">
            <select class="est" data-path="${spath}" data-k="estado">${opt(ESTADOS,st.estado)}</select>
            <select class="pri" data-path="${spath}" data-k="prioridad">${opt(PRIORIDADES,st.prioridad)}</select>
            <input type="checkbox" class="sel-cb" data-sel="st|${spath}" onclick="toggleSel(this)">
            <button class="del" onclick="delSub('${spath}')">✕</button>
          </div></div>`;
      });
      html+=`</div>`;
    }
  });
  return html+`</div>`;
}

// ── SECCIÓN COMPARTIR ─────────────────────────────────────────
function renderShareSection(p,ci,pi){
  if(esOwnerProyecto(p)){
    const chips=(p.compartidoCon||[]).length
      ?(p.compartidoCon||[]).map((e,i)=>`<span class="share-chip">@${ESC(e.split('@')[0])}<button onclick="quitarCompartido(${ci},${pi},${i})" title="Quitar acceso">✕</button></span>`).join('')
      :`<span class="share-empty">Solo vos podés verlo</span>`;
    return`<div class="share-section">
      <div class="share-title">👥 Compartido con:</div>
      <div class="share-chips">${chips}</div>
      <div class="share-add">
        <input id="share-inp-${ci}-${pi}" type="email" placeholder="Email del colaborador..." onkeydown="if(event.key==='Enter')agregarCompartido(${ci},${pi})">
        <button onclick="agregarCompartido(${ci},${pi})">+ Agregar</button>
      </div>
    </div>`;
  }
  if(p.owner){return`<div class="share-info">👁 Compartido por <strong>@${ESC(p.owner.split('@')[0])}</strong></div>`;}
  return'';
}

// ── RENDER BODY PROYECTO ──────────────────────────────────────
function renderProyectoBody(p,ci,pi){
  const total=allTareasProy(p).length;
  const uploadId='pup_'+(p.id||pi);
  const adjRef=`clientes[${ci}].proyectos[${pi}].adjuntos`;
  const adjItems=(p.adjuntos||[]).map((a,i)=>`<div class="adj-item"><span>${icono(a.tipo_mime)}</span><a onclick="openFile('',${JSON.stringify(a.base64||a.url||'').replace(/"/g,'&quot;')})" title="${ESC(a.nombre)}">${ESC(a.nombre)}</a><span class="adj-del-btn" onclick="delArchivo(${adjRef},${i})">✕</span></div>`).join('');
  let tareasHtml;
  if(p.subpuntos&&p.subpuntos.length){
    tareasHtml=p.subpuntos.map((s,si)=>`
      <div class="subp-node">
        <div class="subp-head">
          <span class="toggle-sp" onclick="this.classList.toggle('col');this.parentElement.nextElementSibling.classList.toggle('collapsed-ch')">▼</span>
          <input data-path="${ci}|sp|${pi}|${si}" data-k="nombreSub" value="${ESC(s.nombre)}" placeholder="Nombre de la fase...">
          <input type="date" class="fecha-est" data-path="${ci}|sp|${pi}|${si}" data-k="fechaEstimada" value="${ESC(s.fechaEstimada||'')}">
          <button class="btn-save" onclick="guardarAhora(this)">✓</button>
          <button class="del" onclick="delSubpunto(${ci},${pi},${si})">✕</button>
        </div>
        <div>
          <div class="nota-box"><textarea data-path="${ci}|sp|${pi}|${si}" data-k="descSub" placeholder="Descripción de la fase...">${ESC(s.desc||'')}</textarea></div>
          ${renderTareas(s.tareas||[],ci,pi,'s',si)}
          <button class="add" style="margin:4px 0 0 10px" onclick="addTarea('s|${ci}|${pi}|${si}')">+ Nueva Tarea en fase</button>
        </div>
      </div>`).join('');
  }else{tareasHtml=renderTareas(p.tareas||[],ci,pi,'t');}
  return`
    ${renderShareSection(p,ci,pi)}
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
      <label style="font-size:11px;color:#6b7280;display:flex;align-items:center;gap:4px">📅 Fecha estimada
        <input type="date" class="fecha-est" data-path="${ci}|p|${pi}" data-k="fechaEstimada" value="${ESC(p.fechaEstimada||'')}">
      </label>
      <label style="font-size:11px;color:#6b7280;display:flex;align-items:center;gap:4px">🎫 Ticket
        <input type="text" class="nro-ticket" data-path="${ci}|p|${pi}" data-k="nroTicket" value="${ESC(p.nroTicket||'')}" placeholder="Sin ticket">
      </label>
    </div>
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
      <div class="tareas-toggle" data-tkey="tareas-${ci}-${pi}" onclick="toggleTareas(this)">
        <span class="t-arrow">▶</span> Tareas
        <span style="color:#9ca3af;font-weight:400">(${total})</span>
        <button class="add" style="font-size:11px;padding:1px 8px;margin-left:8px" onclick="event.stopPropagation();quickAddTarea(${ci},${pi})">+ Nueva Tarea</button>
      </div>
      <button class="add" style="font-size:11px;padding:2px 8px" onclick="addSubpunto(${ci},${pi})">+ Nueva Fase</button>
    </div>
    <div style="display:none">${tareasHtml}</div>
    <div class="nota-box"><textarea data-path="${ci}|p|${pi}" data-k="nota" placeholder="Notas del proyecto...">${ESC(p.nota||'')}</textarea></div>
    <div class="adj-section">
      <div class="adj-title">📎 Adjuntos del proyecto
        <button class="btn-adj" onclick="document.getElementById('${uploadId}').click()">+ Adjuntar</button>
        <input type="file" id="${uploadId}" class="adj-upload-inp" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip" onchange="handleUpload(event,'proyecto','${p.id||pi}',${adjRef})">
      </div>
      <div class="adj-list">${adjItems}</div>
    </div>`;
}

// ── RENDER CLIENTES ───────────────────────────────────────────
function renderClientes(){
  document.getElementById('btn-add').textContent='+ Nuevo Cliente';
  document.getElementById('filtroAbono').style.display='none';
  const filtroSel=document.getElementById('filtroEstado');
  if(filtroSel.options.length<=1){ESTADOS_CLIENTE.forEach(e=>{const o=document.createElement('option');o.value=e;o.textContent=e;filtroSel.appendChild(o);});}
  const q=document.getElementById('q').value.toLowerCase(),fv=filtroSel.value;
  const lista=clientes.filter(c=>puedeVerCliente(c)&&(!fv||(c.estado||'Activo')===fv)&&(!q||c.nombre.toLowerCase().includes(q)));
  document.getElementById('filtroCount').textContent=fv?`${lista.length} cliente${lista.length!==1?'s':''}`:' ';
  document.getElementById('breadcrumb').innerHTML=`<span class="cur">Clientes</span>`;
  if(!lista.length){document.getElementById('root').innerHTML=`<div class="empty"><div class="empty-icon">🏢</div><p>No hay clientes. Hacé clic en <b>+ Nuevo Cliente</b>.</p></div>`;return;}
  document.getElementById('root').innerHTML=`<div class="lista-c">${lista.map(c=>{
    const ci=clientes.indexOf(c),strip=COLOR_HEX[c.color]||'#305496';
    const visProjs=(c.proyectos||[]).filter(p=>puedeVerProyecto(p)).length;
    return`<div class="it-wrap" data-ek="c-${ci}">
      <div class="it-row" onclick="if(event.target.tagName==='INPUT'||event.target.tagName==='BUTTON'||event.target.tagName==='SELECT')return;abrirCliente(${ci})">
        <div class="it-strip" style="background:${strip}"></div>
        <span class="it-arrow" style="transform:rotate(90deg);cursor:default">▶</span>
        <input class="nm-c" data-path="${ci}|c" data-k="nombre" value="${ESC(c.nombre)}" onclick="event.stopPropagation()">
        <div class="it-meta">
          <select class="est-cliente ${EC_CLASS[c.estado||'Activo']}" data-path="${ci}|c" data-k="estadoCliente" onclick="event.stopPropagation()">${opt(ESTADOS_CLIENTE,c.estado||'Activo')}</select>
          <span class="it-count">${visProjs} proy.</span>
          <button class="del it-del" onclick="event.stopPropagation();delCliente(${ci})">✕</button>
        </div>
      </div>
    </div>`;
  }).join('')}</div>`;
  bindEvents();
}

// ── RENDER PROYECTOS ──────────────────────────────────────────
function renderProyectos(ci){
  const c=clientes[ci];if(!c){vistaActual='clientes';clienteActual=null;renderClientes();return;}
  document.getElementById('btn-add').textContent='+ Nuevo Proyecto';
  document.getElementById('filtroAbono').style.display='';
  const filtroSel=document.getElementById('filtroEstado'),savedFv=filtroSel.value;
  filtroSel.innerHTML='<option value="">📋 Todos los estados</option>';
  GRUPOS_TRABAJO.forEach(g=>{const og=document.createElement('optgroup');og.label=g.g;g.e.forEach(e=>{const o=document.createElement('option');o.value=e;o.textContent=e;og.appendChild(o);});filtroSel.appendChild(og);});
  if(savedFv)filtroSel.value=savedFv;
  const q=document.getElementById('q').value.toLowerCase(),fv=filtroSel.value,fAb=document.getElementById('filtroAbono').value;
  const lista=c.proyectos.filter(p=>{
    if(!puedeVerProyecto(p))return false;
    if(fv&&(p.estadoTrabajo||'Sin Iniciar')!==fv)return false;
    if(fAb&&(p.abono||'Sin Abono')!==fAb)return false;
    if(q&&!p.nombre.toLowerCase().includes(q))return false;
    return true;
  });
  document.getElementById('filtroCount').textContent=(fv||fAb)?`${lista.length} proyecto${lista.length!==1?'s':''}`:' ';
  document.getElementById('breadcrumb').innerHTML=`<a onclick="volverClientes()">Clientes</a><span class="sep">›</span><span class="cur">${ESC(c.nombre)}</span>`;
  if(!lista.length){document.getElementById('root').innerHTML=`<div class="empty"><div class="empty-icon">📁</div><p>No hay proyectos. Hacé clic en <b>+ Nuevo Proyecto</b>.</p></div>`;return;}
  document.getElementById('root').innerHTML=`<div class="lista-c">${lista.map(p=>{
    const pi=c.proyectos.indexOf(p),t=allTareasProy(p);
    const total=t.length+t.reduce((a,x)=>a+(x.subtareas||[]).length,0),pct=pctOf(t);
    const strip=COLOR_HEX[p.color]||'#305496';
    const etCls=ET_CLASS[p.estadoTrabajo||'Sin Iniciar']||'etj-SinIniciar';
    const abCls=(p.abono||'Sin Abono')==='Abono'?'abono-Con':'abono-Sin';
    const shareIndicator=p.owner
      ?(esOwnerProyecto(p)
        ?((p.compartidoCon||[]).length?`<span class="proj-share-badge" title="Compartido con ${(p.compartidoCon||[]).map(e=>'@'+e.split('@')[0]).join(', ')}">👥 ${(p.compartidoCon||[]).length}</span>`:`<span class="proj-share-badge solo" title="Solo vos">🔒</span>`)
        :`<span class="proj-share-badge shared" title="Compartido por @${(p.owner||'').split('@')[0]}">👁</span>`)
      :'';
    return`<div class="it-wrap" data-ek="p-${ci}-${pi}">
      <div class="it-row">
        <div class="it-strip" style="background:${strip}"></div>
        <span class="it-arrow" onclick="toggleExpand(event)" style="cursor:pointer;padding:12px 6px">▶</span>
        <input class="nm-c" data-path="${ci}|p|${pi}" data-k="nombre" value="${ESC(p.nombre)}" onclick="event.stopPropagation()">
        <div class="it-meta">
          ${shareIndicator}
          <select class="est-trabajo ${etCls}" data-path="${ci}|p|${pi}" data-k="estadoTrabajo" onclick="event.stopPropagation()">${optTrabajo(p.estadoTrabajo||'Sin Iniciar')}</select>
          <select class="est-abono ${abCls}" data-path="${ci}|p|${pi}" data-k="abono" onclick="event.stopPropagation()">${opt(OPCIONES_ABONO,p.abono||'Sin Abono')}</select>
          ${progressBar(pct)}
          <span class="it-pct">${pct}% · ${total}t</span>
          ${p.fechaTerminado?`<span class="it-fecha">✓ ${p.fechaTerminado}</span>`:''}
          <button class="btn-save it-del" onclick="event.stopPropagation();guardarAhora(this)" title="Guardar">✓</button>
          <button class="add it-del" style="font-size:10px;padding:2px 6px" onclick="event.stopPropagation();quickAddTarea(${ci},${pi})">+Tarea</button>
          <input type="checkbox" class="sel-cb it-del" data-sel="p|${ci}|${pi}" onclick="event.stopPropagation();toggleSel(this)">
          <button class="del it-del" onclick="event.stopPropagation();delProyecto(${ci},${pi})">✕</button>
        </div>
      </div>
      <div class="it-body" style="display:none">${renderProyectoBody(p,ci,pi)}</div>
    </div>`;
  }).join('')}</div>`;
  bindEvents();
}

function renderVista(){
  if(vistaActual==='proyectos'&&clienteActual!=null)renderProyectos(clienteActual);
  else renderClientes();
  restoreExpanded();
  if(_calVisible)renderCal();
}
function abrirCliente(ci){vistaActual='proyectos';clienteActual=ci;renderVista();}
function volverClientes(){
  vistaActual='clientes';clienteActual=null;
  document.getElementById('filtroEstado').innerHTML='<option value="">📋 Todos los estados</option>';
  document.getElementById('filtroAbono').style.display='none';
  renderVista();
}

// ── EXPANDIR ──────────────────────────────────────────────────
function restoreExpanded(){
  document.querySelectorAll('.it-wrap[data-ek]').forEach(w=>{
    if(expandedKeys.has(w.dataset.ek)){
      const row=w.querySelector('.it-row'),body=w.querySelector('.it-body');
      if(row)row.classList.add('it-open');if(body)body.style.display='block';
    }
  });
  document.querySelectorAll('.tareas-toggle[data-tkey]').forEach(tog=>{
    if(expandedKeys.has(tog.dataset.tkey)){
      tog.classList.add('t-open');const sib=tog.parentElement?.nextElementSibling;if(sib)sib.style.display='block';
    }
  });
}
function toggleExpand(ev){
  ev.stopPropagation();
  const wrap=ev.currentTarget.closest('.it-wrap'),row=wrap.querySelector('.it-row'),body=wrap.querySelector('.it-body');
  const isOpen=row.classList.contains('it-open');
  row.classList.toggle('it-open',!isOpen);if(body)body.style.display=isOpen?'none':'block';
  if(!isOpen)expandedKeys.add(wrap.dataset.ek);else expandedKeys.delete(wrap.dataset.ek);
}
function toggleTareas(tog){
  const key=tog.dataset.tkey,isOpen=tog.classList.contains('t-open');
  tog.classList.toggle('t-open',!isOpen);
  const tareasDiv=tog.parentElement?.nextElementSibling;if(tareasDiv)tareasDiv.style.display=isOpen?'none':'block';
  if(!isOpen)expandedKeys.add(key);else expandedKeys.delete(key);
}

// ── EVENTOS ───────────────────────────────────────────────────
function _onRootChange(ev){const t=ev.target;if(!t.dataset.path)return;applyEdit(t.dataset.path,t.dataset.k,t.value);save();renderVista();}
function _onRootInput(ev){const t=ev.target;if(!t.dataset.path||t.tagName==='SELECT')return;applyEdit(t.dataset.path,t.dataset.k,t.value);clearTimeout(window._it);window._it=setTimeout(save,8000);}
let _eventsBound=false;
function bindEvents(){
  if(_eventsBound)return;
  const root=document.getElementById('root');
  root.addEventListener('change',_onRootChange);root.addEventListener('input',_onRootInput);
  _eventsBound=true;
}

function applyEdit(path,k,val){
  try{
    const p=path.split('|'),ci=+p[0],c=clientes[ci];if(!c)return;
    if(p[1]==='c'){if(k==='nombre')c.nombre=val;else if(k==='estadoCliente')c.estado=val;else if(k==='notaCliente')c.nota=val;return;}
    if(p[1]==='p'){
      const pi=+p[2],pr=c.proyectos[pi];if(!pr)return;
      if(k==='nombre')pr.nombre=val;else if(k==='nota')pr.nota=val;
      else if(k==='estadoTrabajo'){pr.estadoTrabajo=val;const col=ET_COLOR[val];if(col)pr.color=col;else delete pr.color;if(['Cobrado','Terminado','Terminado sin Presupuesto'].includes(val))pr.fechaTerminado=new Date().toLocaleDateString('es-AR');}
      else if(k==='abono')pr.abono=val;else pr[k]=val;return;
    }
    if(p[1]==='sp'){const pi=+p[2],si=+p[3],s=c.proyectos[pi]?.subpuntos[si];if(!s)return;if(k==='nombreSub')s.nombre=val;else if(k==='descSub')s.desc=val;else s[k]=val;return;}
    if(p[1]==='t'){const pi=+p[2],ti=+p[3],t=c.proyectos[pi]?.tareas[ti];if(!t)return;if(p.length===4)t[k]=val;else if(p.length===5){const st=t.subtareas[+p[4]];if(st)st[k]=val;}return;}
    if(p[1]==='s'){const pi=+p[2],si=+p[3],ti=+p[4],t=c.proyectos[pi]?.subpuntos[si]?.tareas[ti];if(!t)return;if(p.length===5)t[k]=val;else if(p.length===6){const st=t.subtareas[+p[5]];if(st)st[k]=val;}return;}
  }catch(e){console.warn('applyEdit:',e.message);}
}

// ── HISTORIAL ─────────────────────────────────────────────────
function pushHistory(){_history.push(JSON.stringify({clientes:JSON.parse(JSON.stringify(clientes)),vistaActual,clienteActual}));if(_history.length>25)_history.shift();updateUndoBtn();}
function undo(){if(!_history.length)return;const prev=JSON.parse(_history.pop());clientes=fixClientes(prev.clientes);vistaActual=prev.vistaActual;clienteActual=prev.clienteActual;updateUndoBtn();save();renderVista();toast('Cambio deshecho','info');}
function updateUndoBtn(){const b=document.getElementById('btn-undo');if(b)b.style.display=_history.length?'':'none';}

// ── SELECCIÓN ─────────────────────────────────────────────────
function toggleSel(cb){const k=cb.dataset.sel;if(cb.checked)_selected.add(k);else _selected.delete(k);const n=_selected.size;const btn=document.getElementById('btn-del-sel'),cnt=document.getElementById('sel-count');btn.style.display=n?'':'none';if(cnt)cnt.textContent=n;}
function deleteSelected(){
  if(!_selected.size)return;if(!confirm(`¿Eliminar ${_selected.size} elemento(s)?`))return;pushHistory();
  const projs=[],tareas=[],subs=[];
  _selected.forEach(k=>{const p=k.split('|');if(p[0]==='p')projs.push({ci:+p[1],pi:+p[2]});else if(p[0]==='t'){const pp=p[1].split('|');if(p[1].includes('|t|'))tareas.push({ci:+pp[0],pi:+pp[2],ti:+pp[3],kind:'t'});else if(p[1].includes('|s|'))tareas.push({ci:+pp[0],pi:+pp[2],si:+pp[3],ti:+pp[4],kind:'s'});}else if(p[0]==='st'){const pp=p[1].split('|');if(pp[1]==='t')subs.push({ci:+pp[0],pi:+pp[2],ti:+pp[3],sti:+pp[4],kind:'t'});else if(pp[1]==='s')subs.push({ci:+pp[0],pi:+pp[2],si:+pp[3],ti:+pp[4],sti:+pp[5],kind:'s'});}});
  subs.sort((a,b)=>b.sti-a.sti).forEach(x=>{const t=x.kind==='t'?clientes[x.ci].proyectos[x.pi].tareas[x.ti]:clientes[x.ci].proyectos[x.pi].subpuntos[x.si].tareas[x.ti];if(t)t.subtareas.splice(x.sti,1);});
  tareas.sort((a,b)=>b.ti-a.ti).forEach(x=>{const arr=x.kind==='t'?clientes[x.ci].proyectos[x.pi].tareas:clientes[x.ci].proyectos[x.pi].subpuntos[x.si].tareas;if(arr)arr.splice(x.ti,1);});
  projs.sort((a,b)=>b.pi-a.pi).forEach(x=>clientes[x.ci].proyectos.splice(x.pi,1));
  _selected.clear();document.getElementById('btn-del-sel').style.display='none';save();renderVista();toast('Elementos eliminados','success');
}

// ── ACCIONES ──────────────────────────────────────────────────
function guardarAhora(btn){clearTimeout(window._it);clearTimeout(_saveTimer);if(btn){btn.classList.add('guardado');btn.textContent='✓ Guardado';setTimeout(()=>{if(btn){btn.classList.remove('guardado');btn.textContent='✓';}},1500);}saveToDatabase();}
function addItem(){
  pushHistory();
  if(vistaActual==='clientes'){clientes.push({id:newId(),nombre:'Nuevo Cliente',estado:'Activo',nota:'',color:null,proyectos:[]});}
  else{
    if(clienteActual==null)return;const ci=clienteActual;
    clientes[ci].proyectos.push({id:newId(),nombre:'Nuevo Proyecto',owner:emailActual(),compartidoCon:[],estadoTrabajo:'Sin Iniciar',abono:'Sin Abono',color:null,nota:'',adjuntos:[],fechaTerminado:null,fechaEstimada:'',nroTicket:'',tareas:[],subpuntos:[]});
    expandedKeys.add('p-'+ci+'-'+(clientes[ci].proyectos.length-1));
  }
  save();renderVista();
}
function delCliente(ci){if(!confirm(`¿Eliminar cliente "${clientes[ci].nombre}" y todos sus proyectos?`))return;pushHistory();clientes.splice(ci,1);save();renderVista();toast('Cliente eliminado','success');}
function delProyecto(ci,pi){const p=clientes[ci].proyectos[pi];if(!esOwnerProyecto(p)){toast('Solo el dueño puede eliminar este proyecto','warn');return;}if(!confirm(`¿Eliminar proyecto "${p.nombre}"?`))return;pushHistory();clientes[ci].proyectos.splice(pi,1);save();renderVista();toast('Proyecto eliminado','success');}
function quickAddTarea(ci,pi){
  pushHistory();const p=clientes[ci].proyectos[pi];
  const arr=(p.subpuntos&&p.subpuntos.length)?p.subpuntos[p.subpuntos.length-1].tareas:p.tareas;
  const nid=(arr.length+1).toString().padStart(2,'0');
  arr.push({id:nid,tarea:'Nueva tarea',estado:'Pendiente',prioridad:'Media',fechaEstimada:'',nroTicket:'',adjuntos:[],subtareas:[]});
  expandedKeys.add('p-'+ci+'-'+pi);expandedKeys.add('tareas-'+ci+'-'+pi);
  save();renderVista();
  setTimeout(()=>{const txts=document.querySelectorAll('.tree .task textarea.txt');if(txts.length){const l=txts[txts.length-1];l.focus();l.select();}},60);
}
function addSubpunto(ci,pi){
  pushHistory();const p=clientes[ci].proyectos[pi];if(!p.subpuntos)p.subpuntos=[];
  if(!p.subpuntos.length&&p.tareas&&p.tareas.length&&confirm('¿Mover tareas actuales a una fase "General"?')){p.subpuntos.push({id:newId(),nombre:'General',desc:'',fechaEstimada:'',tareas:p.tareas});p.tareas=[];}
  p.subpuntos.push({id:newId(),nombre:'Nueva Fase',desc:'',fechaEstimada:'',tareas:[]});
  expandedKeys.add('p-'+ci+'-'+pi);expandedKeys.add('tareas-'+ci+'-'+pi);save();renderVista();
}
function delSubpunto(ci,pi,si){const p=clientes[ci].proyectos[pi];if(!confirm(`¿Eliminar fase "${p.subpuntos[si].nombre}"?`))return;pushHistory();p.subpuntos.splice(si,1);if(!p.subpuntos.length)p.subpuntos=[];save();renderVista();}
function addTarea(addPath){
  pushHistory();const p=addPath.split('|'),ci=+p[1],pi=+p[2];
  const arr=p[0]==='s'?clientes[ci].proyectos[pi].subpuntos[+p[3]].tareas:clientes[ci].proyectos[pi].tareas;
  const nid=(arr.length+1).toString().padStart(2,'0');
  arr.push({id:nid,tarea:'Nueva tarea',estado:'Pendiente',prioridad:'Media',fechaEstimada:'',nroTicket:'',adjuntos:[],subtareas:[]});
  expandedKeys.add('p-'+ci+'-'+pi);expandedKeys.add('tareas-'+ci+'-'+pi);save();renderVista();
  setTimeout(()=>{const txts=document.querySelectorAll('.tree .task textarea.txt');if(txts.length){const l=txts[txts.length-1];l.focus();l.select();}},30);
}
function delTarea(path){const p=path.split('|'),ci=+p[0];if(p[1]==='t'){const arr=clientes[ci].proyectos[+p[2]].tareas;if(!confirm('¿Eliminar tarea?'))return;pushHistory();arr.splice(+p[3],1);}else if(p[1]==='s'){const arr=clientes[ci].proyectos[+p[2]].subpuntos[+p[3]].tareas;if(!confirm('¿Eliminar tarea?'))return;pushHistory();arr.splice(+p[4],1);}save();renderVista();}
function addSub(path){
  pushHistory();const p=path.split('|'),ci=+p[0];let t;
  if(p[1]==='t')t=clientes[ci].proyectos[+p[2]].tareas[+p[3]];else if(p[1]==='s')t=clientes[ci].proyectos[+p[2]].subpuntos[+p[3]].tareas[+p[4]];
  if(!t)return;if(!t.subtareas)t.subtareas=[];
  t.subtareas.push({id:String.fromCharCode(97+t.subtareas.length),tarea:'Nueva subtarea',estado:'Pendiente',prioridad:'Media',fechaEstimada:'',nroTicket:'',adjuntos:[]});
  save();renderVista();
}
function delSub(path){const p=path.split('|'),ci=+p[0];let t;if(p[1]==='t')t=clientes[ci].proyectos[+p[2]].tareas[+p[3]];else if(p[1]==='s')t=clientes[ci].proyectos[+p[2]].subpuntos[+p[3]].tareas[+p[4]];if(t&&confirm('¿Eliminar subtarea?')){pushHistory();t.subtareas.splice(+p[p.length-1],1);}save();renderVista();}

// ── COMPARTIR ─────────────────────────────────────────────────
function agregarCompartido(ci,pi){
  const inp=document.getElementById(`share-inp-${ci}-${pi}`);if(!inp)return;
  const email=inp.value.trim().toLowerCase();if(!email)return;
  if(!email.includes('@')){toast('Ingresá un email válido','warn');return;}
  const p=clientes[ci].proyectos[pi];
  if(!esOwnerProyecto(p)){toast('Solo el dueño puede compartir este proyecto','warn');return;}
  if(!p.compartidoCon)p.compartidoCon=[];
  if(p.compartidoCon.map(e=>e.toLowerCase().trim()).includes(email)){toast('@'+email.split('@')[0]+' ya tiene acceso','warn');return;}
  if(email===emailActual()){toast('No podés compartirte el proyecto a vos mismo','warn');return;}
  pushHistory();p.compartidoCon.push(email);inp.value='';save();renderVista();
  toast('@'+email.split('@')[0]+' fue agregado al proyecto','success');
}
function quitarCompartido(ci,pi,idx){
  const p=clientes[ci].proyectos[pi];
  if(!esOwnerProyecto(p)){toast('Solo el dueño puede quitar acceso','warn');return;}
  if(!(p.compartidoCon||[]).length)return;
  const email=p.compartidoCon[idx];
  if(!confirm(`¿Quitar el acceso a @${email.split('@')[0]}?`))return;
  pushHistory();p.compartidoCon.splice(idx,1);save();renderVista();toast('Acceso removido','success');
}

// ── BACKUP / IMPORTAR ─────────────────────────────────────────
function exportJSON(){
  const blob=new Blob([JSON.stringify({clientes,exported_at:new Date().toISOString()},null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='ciaber_backup_'+new Date().toISOString().slice(0,10)+'.json';a.click();toast('Backup descargado','success');
}
function importJSON(ev){
  const f=ev.target.files[0];if(!f)return;const r=new FileReader();
  r.onload=e=>{try{const d=JSON.parse(e.target.result);if(!confirm('¿Importar datos? Esto reemplazará todo el contenido actual.'))return;pushHistory();if(d.clientes)clientes=fixClientes(d.clientes);else if(Array.isArray(d))clientes=migrarDesdeFormatoViejo(d);else throw new Error('Formato no reconocido');save();renderVista();toast('Datos importados correctamente','success');}catch(err){toast('Archivo inválido: '+err.message,'error');}};
  r.readAsText(f);ev.target.value='';
}
function migrarDesdeFormatoViejo(viejos){
  const c={id:newId(),nombre:'Ciaber',estado:'Activo',nota:'',color:null,proyectos:[]};
  c.proyectos=viejos.map(p=>({id:newId(),nombre:p.nombre||'',estadoTrabajo:p.estadoTrabajo||'Sin Iniciar',abono:p.abono||'Sin Abono',color:p.color||null,nota:p.nota||'',adjuntos:[],compartidoCon:[],fechaTerminado:p.fechaTerminado||null,fechaEstimada:'',nroTicket:'',tareas:(p.tareas||[]).map(t=>({id:t.id,tarea:t.tarea||'',estado:t.estado||'Pendiente',prioridad:t.prioridad||'',fechaEstimada:'',nroTicket:'',adjuntos:[],subtareas:(t.subtareas||[]).map(st=>({id:st.id,tarea:st.tarea||'',estado:st.estado||'Pendiente',prioridad:st.prioridad||'',fechaEstimada:'',nroTicket:'',adjuntos:[]}))})),subpuntos:(p.subpuntos||[]).map(s=>({id:newId(),nombre:s.nombre||'',desc:s.desc||'',fechaEstimada:'',tareas:(s.tareas||[]).map(t=>({id:t.id,tarea:t.tarea||'',estado:t.estado||'Pendiente',prioridad:t.prioridad||'',fechaEstimada:'',nroTicket:'',adjuntos:[],subtareas:(t.subtareas||[]).map(st=>({id:st.id,tarea:st.tarea||'',estado:st.estado||'Pendiente',prioridad:st.prioridad||'',fechaEstimada:'',nroTicket:'',adjuntos:[]}))}))}))}));
  return[c];
}

// ── EXCEL ─────────────────────────────────────────────────────
async function exportarExcel(){
  if(typeof ExcelJS==='undefined'){toast('ExcelJS no disponible','error');return;}
  toast('Generando Excel...','info');
  const wb=new ExcelJS.Workbook();wb.creator='CIABER';wb.created=new Date();
  const ws=wb.addWorksheet('Proyectos');
  ws.columns=[{header:'Cliente',key:'cliente',width:22},{header:'Proyecto',key:'proyecto',width:28},{header:'Estado',key:'estado',width:22},{header:'Abono',key:'abono',width:12},{header:'Tarea',key:'tarea',width:32},{header:'Est. Tarea',key:'estadoT',width:14},{header:'Prioridad',key:'prioridad',width:10},{header:'Fecha Est.',key:'fechaT',width:13},{header:'Dueño',key:'owner',width:24}];
  const hFill={type:'pattern',pattern:'solid',fgColor:{argb:'FF305496'}};
  const hFont={bold:true,color:{argb:'FFFFFFFF'},size:11};
  const b={style:'thin',color:{argb:'FFD1D5DB'}};
  const borders={top:b,left:b,bottom:b,right:b};
  ws.getRow(1).eachCell(cell=>{cell.fill=hFill;cell.font=hFont;cell.border=borders;});
  ws.getRow(1).height=22;
  clientes.forEach(c=>{
    (c.proyectos||[]).filter(p=>puedeVerProyecto(p)).forEach(p=>{
      const tareas=allTareasProy(p);
      const base={cliente:c.nombre,proyecto:p.nombre,estado:p.estadoTrabajo||'Sin Iniciar',abono:p.abono||'Sin Abono',owner:p.owner||''};
      if(!tareas.length){ws.addRow(base).eachCell(cell=>{cell.border=borders;});}
      else{tareas.forEach(t=>{ws.addRow({...base,tarea:t.tarea,estadoT:t.estado,prioridad:t.prioridad,fechaT:t.fechaEstimada}).eachCell(cell=>{cell.border=borders;});(t.subtareas||[]).forEach(st=>{ws.addRow({...base,tarea:'  └ '+st.tarea,estadoT:st.estado,prioridad:st.prioridad,fechaT:st.fechaEstimada}).eachCell(cell=>{cell.border=borders;});});});}
    });
  });
  ws.views=[{state:'frozen',ySplit:1}];
  const buf=await wb.xlsx.writeBuffer();
  const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='ciaber_'+new Date().toISOString().slice(0,10)+'.xlsx';a.click();toast('Excel descargado','success');
}

// ── CALENDARIO ────────────────────────────────────────────────
const DIAS=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
const MESES=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
function toggleCal(){
  _calVisible=!_calVisible;const panel=document.getElementById('cal-panel'),btn=document.getElementById('btn-cal');
  panel.style.display=_calVisible?'block':'none';if(btn)btn.style.background=_calVisible?'rgba(255,255,255,.3)':'';
  if(_calVisible)renderCal();
}
function getWeekDays(offset){const now=new Date(),dow=now.getDay(),mon=new Date(now);mon.setDate(now.getDate()-((dow+6)%7)+offset*7);mon.setHours(0,0,0,0);return Array.from({length:7},(_,i)=>{const d=new Date(mon);d.setDate(mon.getDate()+i);return d;});}
function toYMD(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function priNum(p){return p==='Alta'?0:p==='Media'?1:p==='Baja'?2:3;}
function getItemsForDate(dateStr){
  const items=[];
  clientes.forEach((c,ci)=>{(c.proyectos||[]).filter(p=>puedeVerProyecto(p)).forEach((p,pi)=>{
    if(p.fechaEstimada===dateStr)items.push({tipo:'proyecto',label:p.nombre,sub:c.nombre,estado:p.estadoTrabajo,pri:null,ci,pi});
    const addT=arr=>arr.forEach(t=>{if(t.fechaEstimada===dateStr)items.push({tipo:'tarea',label:t.tarea,sub:p.nombre+' · '+c.nombre,pri:t.prioridad||'',estado:t.estado,ci,pi});(t.subtareas||[]).forEach(st=>{if(st.fechaEstimada===dateStr)items.push({tipo:'tarea',label:st.tarea,sub:p.nombre+' · '+c.nombre,pri:st.prioridad||'',estado:st.estado,ci,pi});});});
    addT(p.tareas||[]);(p.subpuntos||[]).forEach(s=>addT(s.tareas||[]));
  });});
  items.sort((a,b)=>{if(a.tipo==='tarea'&&b.tipo!=='tarea')return-1;if(b.tipo==='tarea'&&a.tipo!=='tarea')return 1;return priNum(a.pri)-priNum(b.pri);});
  return items;
}
function renderCal(){
  const panel=document.getElementById('cal-panel');if(!panel)return;
  const days=getWeekDays(_calWeekOffset),todayS=toYMD(new Date());
  const label=DIAS[0]+' '+days[0].getDate()+' '+MESES[days[0].getMonth()]+' — '+DIAS[6]+' '+days[6].getDate()+' '+MESES[days[6].getMonth()]+' '+days[0].getFullYear();
  const colsHtml=days.map((d,i)=>{
    const dStr=toYMD(d),isHoy=dStr===todayS,items=getItemsForDate(dStr);
    const chips=items.length?items.map(it=>{const done=['Terminado','Cobrado','Terminado sin Presupuesto'].includes(it.estado);const cls=(it.tipo==='proyecto'?'cal-chip tipo-proyecto':`cal-chip tipo-tarea pri-${it.pri}`)+(done?' terminado':'');return`<button class="${cls}" onclick="abrirCliente(${it.ci})" title="${ESC(it.sub)}">${ESC(it.label)}</button>`;}).join(''):`<span class="cal-chip cal-empty">—</span>`;
    return`<div class="cal-day${isHoy?' today':''}"><div class="cal-day-label">${DIAS[i]} <span class="cal-num">${d.getDate()}</span></div>${chips}</div>`;
  }).join('');
  panel.innerHTML=`<div class="cal-header"><button class="cal-nav" onclick="_calWeekOffset--;renderCal()">‹ Anterior</button><h3>📅 ${label}</h3><button class="cal-nav" onclick="_calWeekOffset=0;renderCal()">Hoy</button><button class="cal-nav" onclick="_calWeekOffset++;renderCal()">Siguiente ›</button></div><div class="cal-grid">${colsHtml}</div>`;
}
function openImage(url){const lb=document.getElementById('lb'),lbi=document.getElementById('lbi');if(lb&&lbi){lbi.src=url;lb.classList.add('show');}}
