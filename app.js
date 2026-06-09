// ════════════════════════════════════════════════════════════
// WORKFLOW — app.js v3
// Firebase Realtime Database + Login propio + Carpetas/Proyectos/Tareas
// ════════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, push, onValue, update, remove, get }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ── Firebase ─────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyDijZ5KYg1OPcSJnDsQh9pxtH_cr_xobRU",
  authDomain:        "workflow-equipo.firebaseapp.com",
  databaseURL:       "https://workflow-equipo-default-rtdb.firebaseio.com",
  projectId:         "workflow-equipo",
  storageBucket:     "workflow-equipo.firebasestorage.app",
  messagingSenderId: "974073018957",
  appId:             "1:974073018957:web:9200142d312802f74d3a04"
};
const db = getDatabase(initializeApp(firebaseConfig));

// ── Estado global ────────────────────────────────────────────
const S = {
  user:      null,      // usuario logueado
  users:     {},        // todos los usuarios
  carpetas:  {},        // estructura completa
  view:      'carpetas',
  openFolders:  {},     // fid → bool
  openProjects: {},     // pid → bool
  calOffset:    0,
};

// ── Utilidades ───────────────────────────────────────────────
const esc  = s => !s ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const $    = id => document.getElementById(id);
const fmt  = iso => { if (!iso) return ''; const d = new Date(iso+'T00:00:00'); return d.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'2-digit'}); };
const over = iso => iso && new Date(iso+'T23:59:59') < new Date();
const stLbl= s => ({pendiente:'Pendiente',progreso:'En progreso',revision:'En revisión',listo:'Listo',bloqueado:'Bloqueado'}[s]||s);
const uNm  = uid => { const u=S.users[uid]; return u?(u.nombre||u.email):'Sin asignar'; };
const avgPct = p => { const t=Object.values(p.tareas||{}); return t.length?Math.round(t.reduce((a,x)=>a+(Number(x.avance)||0),0)/t.length):0; };
const COLORS = ['#4f7cff','#22c55e','#f59e0b','#ef4444','#a855f7','#06b6d4','#ec4899','#f97316'];

function hashPass(p) {
  let h=0; for(let i=0;i<p.length;i++){h=((h<<5)-h)+p.charCodeAt(i);h|=0;}
  return 'h_'+Math.abs(h).toString(36);
}

function toast(msg) {
  const t=$('toast'); t.textContent=msg; t.classList.remove('hidden');
  clearTimeout(t._t); t._t=setTimeout(()=>t.classList.add('hidden'),3000);
}

// ── Modal ────────────────────────────────────────────────────
window.closeModal = () => $('modal-overlay').classList.add('hidden');

function showModal(title, html) {
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = html;
  $('modal-overlay').classList.remove('hidden');
  setTimeout(()=>$('modal-body').querySelector('input,textarea')?.focus(), 60);
}

// ── Login ────────────────────────────────────────────────────
window.doLogin = async () => {
  const email = $('l-email').value.trim().toLowerCase();
  const pass  = $('l-pass').value;
  const errEl = $('l-err');
  const btn   = $('l-btn');
  errEl.textContent = '';
  if (!email || !pass) { errEl.textContent='Completá todos los campos'; return; }
  btn.disabled=true; btn.textContent='Verificando...';
  try {
    const snap  = await get(ref(db,'users'));
    const users = snap.val() || {};
    const hash  = hashPass(pass);
    const found = Object.entries(users).find(([,u])=>u.email===email && u.passwordHash===hash);
    if (!found) {
      errEl.textContent='Email o contraseña incorrectos';
      btn.disabled=false; btn.textContent='Ingresar'; return;
    }
    S.user = { uid: found[0], ...found[1] };
    sessionStorage.setItem('wf_u', JSON.stringify(S.user));
    bootApp();
  } catch(e) {
    errEl.textContent='Error de conexión. Revisá tu internet.';
    btn.disabled=false; btn.textContent='Ingresar';
  }
};

window.doLogout = () => { sessionStorage.removeItem('wf_u'); location.reload(); };

// ── Boot ─────────────────────────────────────────────────────
function bootApp() {
  $('login-screen').style.display = 'none';
  $('app').style.display = 'flex';

  const u = S.user;
  $('sidebar-user').innerHTML = `<strong>${esc(u.nombre||u.email)}</strong>${esc(u.email)}`;
  if (u.role==='admin') $('nav-admin').style.display='flex';

  onValue(ref(db,'users'),    snap=>{ S.users    = snap.val()||{}; refreshView(); });
  onValue(ref(db,'carpetas'), snap=>{ S.carpetas = snap.val()||{}; buildSidebarFolders(); refreshView(); });
}

// ── Routing ──────────────────────────────────────────────────
window.setView = v => {
  S.view = v;
  ['carpetas','calendario','mistareas','admin'].forEach(id=>{
    $('view-'+id).style.display = id===v?'':'none';
  });
  ['nav-carpetas','nav-calendario','nav-mistareas','nav-admin'].forEach(id=>{
    $(id)?.classList.toggle('active', id==='nav-'+v);
  });
  refreshView();
};

function refreshView() {
  if (S.view==='carpetas')   buildCarpetas();
  if (S.view==='calendario') buildCalendario();
  if (S.view==='mistareas')  buildMisTareas();
  if (S.view==='admin')      buildAdmin();
}

// ── Sidebar carpetas ─────────────────────────────────────────
function buildSidebarFolders() {
  const sec = $('sidebar-folders-section');
  const entries = Object.entries(S.carpetas);
  if (!entries.length) { sec.innerHTML=''; return; }
  sec.innerHTML = `
    <div class="nav-section-label" style="margin-top:6px">CARPETAS</div>
    ${entries.map(([fid,c])=>`
      <div class="sidebar-folder-item" onclick="jumpToFolder('${fid}')">
        <span class="sidebar-folder-dot" style="background:${esc(c.color||'#4f7cff')}"></span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.nombre)}</span>
      </div>`).join('')}`;
}

window.jumpToFolder = fid => {
  S.openFolders[fid] = true;
  setView('carpetas');
  setTimeout(()=>$('folder-'+fid)?.scrollIntoView({behavior:'smooth',block:'start'}),120);
};

// ══ VISTA: CARPETAS ══════════════════════════════════════════
function buildCarpetas() {
  const panel = $('view-carpetas');
  const entries = Object.entries(S.carpetas);

  panel.innerHTML = `
    <div class="page-header">
      <h2>Carpetas</h2>
      <div class="page-header-actions">
        <button class="btn-gmail" onclick="sendReport()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="4" width="20" height="16" rx="2"/>
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
          </svg>
          Enviar avance
        </button>
        <button class="btn btn-primary" onclick="modalNuevaCarpeta()">+ Nueva carpeta</button>
      </div>
    </div>
    <div class="content-area">
      ${entries.length
        ? entries.map(([fid,c])=>htmlFolderBlock(fid,c)).join('')
        : `<div class="empty-state"><div class="empty-icon">📁</div><p>No hay carpetas todavía.<br>Creá la primera.</p></div>`}
    </div>`;
}

function htmlFolderBlock(fid, c) {
  const isOpen    = !!S.openFolders[fid];
  const proyectos = Object.entries(c.proyectos||{});
  const allT  = proyectos.reduce((a,[,p])=>a+Object.keys(p.tareas||{}).length, 0);
  const doneT = proyectos.reduce((a,[,p])=>a+Object.values(p.tareas||{}).filter(t=>t.estado==='listo').length, 0);
  const pct   = allT ? Math.round(doneT/allT*100) : 0;

  return `
    <div class="folder-block" id="folder-${fid}">

      <div class="folder-block-header" onclick="toggleFolder('${fid}')">
        <span class="folder-arrow ${isOpen?'open':''}">▶</span>
        <span class="folder-color-strip" style="background:${esc(c.color||'#4f7cff')}"></span>
        <span class="folder-block-name">${esc(c.nombre)}</span>
        <span class="folder-block-meta">${proyectos.length} proyecto${proyectos.length!==1?'s':''} · ${doneT}/${allT} tareas</span>
        ${allT ? `
          <div class="pbar-wrap">
            <div class="pbar-fill ${pct===100?'full':''}" style="width:${pct}%"></div>
          </div>
          <span class="folder-block-pct">${pct}%</span>` : ''}
        <div class="folder-block-actions" onclick="event.stopPropagation()">
          <button class="btn btn-sm" onclick="modalEditCarpeta('${fid}')">✎</button>
          <button class="btn btn-sm btn-danger" onclick="deleteCarpeta('${fid}')">✕</button>
        </div>
      </div>

      ${isOpen ? `
        <div class="folder-block-body">
          <div class="folder-body-toolbar">
            <button class="btn btn-primary btn-sm" onclick="modalNuevoProyecto('${fid}')">+ Nuevo proyecto</button>
          </div>
          ${proyectos.length
            ? proyectos.map(([pid,p])=>htmlProjectCard(fid,pid,p)).join('')
            : `<div style="color:var(--text2);font-size:12px;padding:6px">Sin proyectos todavía.</div>`}
        </div>` : ''}
    </div>`;
}

window.toggleFolder = fid => { S.openFolders[fid]=!S.openFolders[fid]; refreshView(); };

function htmlProjectCard(fid, pid, p) {
  const isOpen = !!S.openProjects[pid];
  const tareas = Object.entries(p.tareas||{});
  const avg    = avgPct(p);
  const done   = tareas.filter(([,t])=>t.estado==='listo').length;

  return `
    <div class="project-card" id="proj-${pid}">

      <div class="project-card-header" onclick="toggleProject('${pid}')">
        <span class="project-arrow ${isOpen?'open':''}">▶</span>
        <span class="project-card-name">${esc(p.nombre)}</span>
        <div class="project-card-meta">
          <div class="pbar-wrap"><div class="pbar-fill ${avg===100?'full':''}" style="width:${avg}%"></div></div>
          <span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text2)">${avg}%</span>
          <span style="font-size:11px;color:var(--text2)">${done}/${tareas.length}</span>
        </div>
        <div class="project-card-actions" onclick="event.stopPropagation()">
          <button class="btn btn-sm" onclick="modalEditProyecto('${fid}','${pid}')">✎</button>
          <button class="btn btn-sm btn-danger" onclick="deleteProyecto('${fid}','${pid}')">✕</button>
        </div>
      </div>

      ${isOpen ? `
        <div class="project-card-body">
          ${p.descripcion?`<div class="project-desc-text">${esc(p.descripcion)}</div>`:''}
          <div class="tasks-section-header">
            <span class="tasks-section-label">Tareas (${tareas.length})</span>
            <button class="btn btn-primary btn-sm" onclick="modalNuevaTarea('${fid}','${pid}')">+ Tarea</button>
          </div>
          ${tareas.length
            ? `<div class="task-table">
                <div class="task-table-head">
                  <div>Tarea</div><div>Responsable</div><div>Estado</div><div>Avance</div><div>Vence</div><div></div>
                </div>
                ${tareas.map(([tid,t])=>htmlTaskRow(fid,pid,tid,t)).join('')}
              </div>`
            : `<div style="color:var(--text2);font-size:12px;padding:8px 4px">Sin tareas todavía.</div>`}
        </div>` : ''}
    </div>`;
}

window.toggleProject = pid => { S.openProjects[pid]=!S.openProjects[pid]; refreshView(); };

function htmlTaskRow(fid, pid, tid, t) {
  const isDone  = t.estado==='listo';
  const avance  = Number(t.avance)||0;
  const vence   = t.fechaLimite;
  const isOver  = !isDone && over(vence);
  const resp    = uNm(t.responsableUid);
  const stCls   = 's-'+(t.estado||'pendiente');

  return `
    <div class="task-table-row ${isDone?'task-done':''}" id="trow-${tid}">

      <div class="task-cell-main">
        <button class="task-check-btn ${isDone?'checked':''}"
          onclick="toggleDone('${fid}','${pid}','${tid}','${t.estado}')">✓</button>
        <div style="min-width:0">
          <div class="task-cell-title">${esc(t.titulo)}</div>
          ${t.descripcion?`<div class="task-cell-desc">${esc(t.descripcion)}</div>`:''}
        </div>
      </div>

      <div class="task-cell">
        <span class="chip chip-person" title="${esc(resp)}">👤 ${esc(resp.length>14?resp.slice(0,14)+'…':resp)}</span>
      </div>

      <div class="task-cell">
        <select class="status-sel ${stCls}"
          onchange="changeStatus('${fid}','${pid}','${tid}',this.value);this.className='status-sel s-'+this.value">
          ${['pendiente','progreso','revision','listo','bloqueado']
            .map(s=>`<option value="${s}" ${t.estado===s?'selected':''}>${stLbl(s)}</option>`).join('')}
        </select>
      </div>

      <div class="task-cell">
        <div class="avance-row">
          <input type="range" min="0" max="100" step="5" value="${avance}"
            class="avance-range"
            oninput="this.nextElementSibling.textContent=this.value+'%'"
            onchange="changeAvance('${fid}','${pid}','${tid}',this.value)">
          <span class="avance-label">${avance}%</span>
        </div>
      </div>

      <div class="task-cell">
        ${vence
          ? `<span class="chip ${isOver?'chip-overdue':'chip-date'}">📅 ${fmt(vence)}${isOver?' ⚠':''}</span>`
          : `<span style="font-size:11px;color:var(--muted)">—</span>`}
      </div>

      <div class="task-cell" style="gap:4px">
        <button class="btn btn-sm" onclick="modalEditTarea('${fid}','${pid}','${tid}')">✎</button>
        <button class="btn btn-sm btn-danger" onclick="deleteTarea('${fid}','${pid}','${tid}')">✕</button>
      </div>

    </div>`;
}

// ── Acciones de tarea en línea ───────────────────────────────
window.toggleDone = (fid,pid,tid,cur) => {
  const nuevo = cur==='listo'?'pendiente':'listo';
  update(ref(db,`carpetas/${fid}/proyectos/${pid}/tareas/${tid}`),
    { estado:nuevo, avance: nuevo==='listo'?100:undefined });
};

window.changeStatus = (fid,pid,tid,val) => {
  const upd = { estado:val };
  if (val==='listo') upd.avance=100;
  update(ref(db,`carpetas/${fid}/proyectos/${pid}/tareas/${tid}`), upd);
};

window.changeAvance = (fid,pid,tid,val) => {
  const n = Number(val);
  const upd = { avance:n };
  if (n===100) upd.estado='listo';
  else if (n>0 && n<100) upd.estado='progreso';
  else if (n===0) upd.estado='pendiente';
  update(ref(db,`carpetas/${fid}/proyectos/${pid}/tareas/${tid}`), upd);
};

// ══ MODALES: CARPETA ═════════════════════════════════════════
window.modalNuevaCarpeta = () => {
  showModal('Nueva carpeta', `
    <div class="form-group">
      <label>Nombre</label>
      <input id="m-nombre" placeholder="Ej: Harf-Tele">
    </div>
    <div class="form-group">
      <label>Color</label>
      <div class="color-picker">
        ${COLORS.map((c,i)=>`<div class="color-dot ${i===0?'selected':''}" style="background:${c}" data-c="${c}" onclick="pickColor(this)"></div>`).join('')}
      </div>
      <input type="hidden" id="m-color" value="${COLORS[0]}">
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveCarpeta()">Crear carpeta</button>
    </div>`);
};

window.pickColor = el => {
  document.querySelectorAll('.color-dot').forEach(d=>d.classList.remove('selected'));
  el.classList.add('selected');
  $('m-color').value = el.dataset.c;
};

window.saveCarpeta = () => {
  const nombre = $('m-nombre').value.trim();
  const color  = $('m-color').value;
  if (!nombre) { toast('Ingresá un nombre'); return; }
  push(ref(db,'carpetas'), { nombre, color });
  closeModal(); toast('Carpeta creada ✓');
};

window.modalEditCarpeta = fid => {
  const c = S.carpetas[fid];
  showModal('Editar carpeta', `
    <div class="form-group">
      <label>Nombre</label>
      <input id="m-nombre" value="${esc(c.nombre)}">
    </div>
    <div class="form-group">
      <label>Color</label>
      <div class="color-picker">
        ${COLORS.map(col=>`<div class="color-dot ${col===c.color?'selected':''}" style="background:${col}" data-c="${col}" onclick="pickColor(this)"></div>`).join('')}
      </div>
      <input type="hidden" id="m-color" value="${esc(c.color||COLORS[0])}">
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="updateCarpeta('${fid}')">Guardar</button>
    </div>`);
};

window.updateCarpeta = fid => {
  const nombre = $('m-nombre').value.trim();
  const color  = $('m-color').value;
  if (!nombre) { toast('Ingresá un nombre'); return; }
  update(ref(db,`carpetas/${fid}`), { nombre, color });
  closeModal(); toast('Carpeta actualizada ✓');
};

window.deleteCarpeta = fid => {
  if (!confirm('¿Eliminar esta carpeta y todos sus proyectos?')) return;
  remove(ref(db,`carpetas/${fid}`));
  toast('Carpeta eliminada');
};

// ══ MODALES: PROYECTO ════════════════════════════════════════
window.modalNuevoProyecto = fid => {
  showModal('Nuevo proyecto', `
    <div class="form-group">
      <label>Título</label>
      <input id="m-nombre" placeholder="Ej: Instalación red LAN">
    </div>
    <div class="form-group">
      <label>Descripción</label>
      <textarea id="m-desc" placeholder="Descripción del proyecto..."></textarea>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveProyecto('${fid}')">Crear proyecto</button>
    </div>`);
};

window.saveProyecto = fid => {
  const nombre = $('m-nombre').value.trim();
  const desc   = $('m-desc').value.trim();
  if (!nombre) { toast('Ingresá un título'); return; }
  push(ref(db,`carpetas/${fid}/proyectos`), { nombre, descripcion:desc });
  S.openFolders[fid] = true;
  closeModal(); toast('Proyecto creado ✓');
};

window.modalEditProyecto = (fid,pid) => {
  const p = S.carpetas[fid]?.proyectos?.[pid];
  if (!p) return;
  showModal('Editar proyecto', `
    <div class="form-group">
      <label>Título</label>
      <input id="m-nombre" value="${esc(p.nombre)}">
    </div>
    <div class="form-group">
      <label>Descripción</label>
      <textarea id="m-desc">${esc(p.descripcion||'')}</textarea>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="updateProyecto('${fid}','${pid}')">Guardar</button>
    </div>`);
};

window.updateProyecto = (fid,pid) => {
  const nombre = $('m-nombre').value.trim();
  const desc   = $('m-desc').value.trim();
  if (!nombre) { toast('Ingresá un título'); return; }
  update(ref(db,`carpetas/${fid}/proyectos/${pid}`), { nombre, descripcion:desc });
  closeModal(); toast('Proyecto actualizado ✓');
};

window.deleteProyecto = (fid,pid) => {
  if (!confirm('¿Eliminar este proyecto y todas sus tareas?')) return;
  remove(ref(db,`carpetas/${fid}/proyectos/${pid}`));
  toast('Proyecto eliminado');
};

// ══ MODALES: TAREA ═══════════════════════════════════════════
function buildUserOptions(selUid='') {
  return `<option value="">— Sin asignar —</option>`
    + Object.entries(S.users)
        .map(([uid,u])=>`<option value="${uid}" ${uid===selUid?'selected':''}>${esc(u.nombre||u.email)}</option>`)
        .join('');
}

window.modalNuevaTarea = (fid,pid) => {
  showModal('Nueva tarea', `
    <div class="form-group">
      <label>Título</label>
      <input id="m-titulo" placeholder="Ej: Revisar cableado">
    </div>
    <div class="form-group">
      <label>Descripción</label>
      <textarea id="m-desc" placeholder="Detalle de la tarea..."></textarea>
    </div>
    <div class="form-group">
      <label>Responsable</label>
      <select id="m-resp">${buildUserOptions()}</select>
    </div>
    <div class="form-group">
      <label>Estado</label>
      <select id="m-estado">
        <option value="pendiente">Pendiente</option>
        <option value="progreso">En progreso</option>
        <option value="revision">En revisión</option>
        <option value="listo">Listo</option>
        <option value="bloqueado">Bloqueado</option>
      </select>
    </div>
    <div class="form-group">
      <label>Avance inicial</label>
      <div class="avance-row" style="margin-top:4px">
        <input type="range" min="0" max="100" step="5" value="0" id="m-avance" class="avance-range"
          oninput="document.getElementById('m-avlbl').textContent=this.value+'%'">
        <span id="m-avlbl" class="avance-label">0%</span>
      </div>
    </div>
    <div class="form-group">
      <label>Fecha límite</label>
      <input type="date" id="m-fecha">
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveTarea('${fid}','${pid}')">Crear tarea</button>
    </div>`);
};

window.saveTarea = (fid,pid) => {
  const titulo = $('m-titulo').value.trim();
  const desc   = $('m-desc').value.trim();
  const resp   = $('m-resp').value;
  const estado = $('m-estado').value;
  const avance = Number($('m-avance').value);
  const fecha  = $('m-fecha').value;
  if (!titulo) { toast('Ingresá un título'); return; }
  push(ref(db,`carpetas/${fid}/proyectos/${pid}/tareas`), {
    titulo, descripcion:desc,
    responsableUid: resp||null,
    estado, avance,
    fechaLimite: fecha||null,
    creadoEn: new Date().toISOString()
  });
  S.openProjects[pid] = true;
  closeModal(); toast('Tarea creada ✓');
};

window.modalEditTarea = (fid,pid,tid) => {
  const t = S.carpetas[fid]?.proyectos?.[pid]?.tareas?.[tid];
  if (!t) return;
  const av = Number(t.avance)||0;
  showModal('Editar tarea', `
    <div class="form-group">
      <label>Título</label>
      <input id="m-titulo" value="${esc(t.titulo)}">
    </div>
    <div class="form-group">
      <label>Descripción</label>
      <textarea id="m-desc">${esc(t.descripcion||'')}</textarea>
    </div>
    <div class="form-group">
      <label>Responsable</label>
      <select id="m-resp">${buildUserOptions(t.responsableUid||'')}</select>
    </div>
    <div class="form-group">
      <label>Estado</label>
      <select id="m-estado">
        ${['pendiente','progreso','revision','listo','bloqueado']
          .map(s=>`<option value="${s}" ${t.estado===s?'selected':''}>${stLbl(s)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>Avance</label>
      <div class="avance-row" style="margin-top:4px">
        <input type="range" min="0" max="100" step="5" value="${av}" id="m-avance" class="avance-range"
          oninput="document.getElementById('m-avlbl').textContent=this.value+'%'">
        <span id="m-avlbl" class="avance-label">${av}%</span>
      </div>
    </div>
    <div class="form-group">
      <label>Fecha límite</label>
      <input type="date" id="m-fecha" value="${esc(t.fechaLimite||'')}">
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="updateTarea('${fid}','${pid}','${tid}')">Guardar</button>
    </div>`);
};

window.updateTarea = (fid,pid,tid) => {
  const titulo = $('m-titulo').value.trim();
  const desc   = $('m-desc').value.trim();
  const resp   = $('m-resp').value;
  const estado = $('m-estado').value;
  const avance = Number($('m-avance').value);
  const fecha  = $('m-fecha').value;
  if (!titulo) { toast('Ingresá un título'); return; }
  update(ref(db,`carpetas/${fid}/proyectos/${pid}/tareas/${tid}`),{
    titulo, descripcion:desc,
    responsableUid: resp||null,
    estado, avance,
    fechaLimite: fecha||null
  });
  closeModal(); toast('Tarea actualizada ✓');
};

window.deleteTarea = (fid,pid,tid) => {
  if (!confirm('¿Eliminar esta tarea?')) return;
  remove(ref(db,`carpetas/${fid}/proyectos/${pid}/tareas/${tid}`));
  toast('Tarea eliminada');
};

// ══ VISTA: MIS TAREAS ════════════════════════════════════════
function buildMisTareas() {
  const panel = $('view-mistareas');
  const uid   = S.user.uid;
  const mine  = [];

  Object.entries(S.carpetas).forEach(([fid,c])=>{
    Object.entries(c.proyectos||{}).forEach(([pid,p])=>{
      Object.entries(p.tareas||{}).forEach(([tid,t])=>{
        if (t.responsableUid===uid)
          mine.push({ fid,pid,tid,t, carpNombre:c.nombre, projNombre:p.nombre });
      });
    });
  });

  const pending = mine.filter(x=>x.t.estado!=='listo');
  const done    = mine.filter(x=>x.t.estado==='listo');

  panel.innerHTML = `
    <div class="page-header"><h2>Mis tareas</h2></div>
    <div class="content-area">
      ${!mine.length
        ? `<div class="empty-state"><div class="empty-icon">✅</div><p>No tenés tareas asignadas.</p></div>`
        : ''}
      ${pending.length ? `
        <div class="mis-section-title">PENDIENTES (${pending.length})</div>
        <div class="task-table">
          <div class="task-table-head">
            <div>Tarea</div><div>Proyecto</div><div>Estado</div><div>Avance</div><div>Vence</div><div></div>
          </div>
          ${pending.map(x=>`
            ${htmlTaskRow(x.fid,x.pid,x.tid,x.t)}
          `).join('')}
        </div>` : ''}
      ${done.length ? `
        <div class="mis-section-title">COMPLETADAS (${done.length})</div>
        <div class="task-table">
          <div class="task-table-head">
            <div>Tarea</div><div>Proyecto</div><div>Estado</div><div>Avance</div><div>Vence</div><div></div>
          </div>
          ${done.map(x=>htmlTaskRow(x.fid,x.pid,x.tid,x.t)).join('')}
        </div>` : ''}
    </div>`;
}

// ══ VISTA: CALENDARIO ════════════════════════════════════════
function buildCalendario() {
  const panel = $('view-calendario');
  const today = new Date();
  const base  = new Date(today);
  base.setDate(today.getDate() - ((today.getDay()+6)%7) + S.calOffset*7);
  const days  = Array.from({length:7},(_,i)=>{ const d=new Date(base); d.setDate(base.getDate()+i); return d; });
  const DIAS  = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

  // recolectar eventos por fecha
  const evs = {};
  Object.values(S.carpetas).forEach(c=>{
    Object.values(c.proyectos||{}).forEach(p=>{
      Object.values(p.tareas||{}).forEach(t=>{
        if (!t.fechaLimite) return;
        evs[t.fechaLimite] = evs[t.fechaLimite]||[];
        evs[t.fechaLimite].push({ titulo:t.titulo, estado:t.estado, proyecto:p.nombre });
      });
    });
  });

  const todayIso = today.toISOString().slice(0,10);
  const week = `${days[0].toLocaleDateString('es-AR',{day:'2-digit',month:'short'})} – ${days[6].toLocaleDateString('es-AR',{day:'2-digit',month:'short',year:'numeric'})}`;

  panel.innerHTML = `
    <div class="page-header"><h2>Calendario</h2></div>
    <div class="cal-container">
      <div class="cal-nav">
        <button class="btn" onclick="S.calOffset--;setView('calendario')">← Anterior</button>
        <h3>${week}</h3>
        <button class="btn" onclick="S.calOffset=0;setView('calendario')">Hoy</button>
        <button class="btn" onclick="S.calOffset++;setView('calendario')">Siguiente →</button>
      </div>
      <div class="cal-grid">
        ${DIAS.map(d=>`<div class="cal-head">${d}</div>`).join('')}
        ${days.map(d=>{
          const iso   = d.toISOString().slice(0,10);
          const isToday = iso===todayIso;
          const dayEvs = evs[iso]||[];
          return `
            <div class="cal-cell ${isToday?'today':''}">
              <div class="cal-date-num">${d.getDate()}</div>
              ${dayEvs.map(e=>`
                <div class="cal-ev ${e.estado==='listo'?'cal-ev-done': over(iso)?'cal-ev-over':'cal-ev-due'}"
                  title="${esc(e.proyecto+' → '+e.titulo)}">
                  ${esc(e.titulo.length>22?e.titulo.slice(0,22)+'…':e.titulo)}
                </div>`).join('')}
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

// ══ VISTA: ADMIN / USUARIOS ══════════════════════════════════
function buildAdmin() {
  if (S.user?.role!=='admin') {
    $('view-admin').innerHTML='<div class="empty-state"><p>Acceso denegado</p></div>'; return;
  }
  const panel = $('view-admin');
  const users = Object.entries(S.users);

  panel.innerHTML = `
    <div class="page-header">
      <h2>Usuarios</h2>
      <div class="page-header-actions">
        <button class="btn btn-primary" onclick="modalNuevoUsuario()">+ Nuevo usuario</button>
      </div>
    </div>
    <div class="content-area">
      <div class="users-grid">
        ${users.map(([uid,u])=>`
          <div class="user-card">
            <div class="user-avatar">${(u.nombre||u.email||'?')[0].toUpperCase()}</div>
            <div class="user-card-info">
              <div class="user-card-name">${esc(u.nombre||'—')}</div>
              <div class="user-card-email">${esc(u.email)}</div>
            </div>
            <span class="role-badge ${u.role==='admin'?'role-admin':'role-user'}">${u.role==='admin'?'Admin':'Usuario'}</span>
            ${uid!==S.user.uid
              ? `<button class="btn btn-sm" onclick="modalEditUsuario('${uid}')">Editar</button>
                 <button class="btn btn-sm btn-danger" onclick="deleteUsuario('${uid}')">Eliminar</button>`
              : `<span style="font-size:11px;color:var(--text2)">(vos)</span>`}
          </div>`).join('')}
      </div>
    </div>`;
}

window.modalNuevoUsuario = () => {
  showModal('Nuevo usuario', `
    <div class="form-group"><label>Nombre</label><input id="m-nombre" placeholder="Ej: María García"></div>
    <div class="form-group"><label>Email</label><input id="m-email" type="email" placeholder="maria@empresa.com"></div>
    <div class="form-group"><label>Contraseña</label><input id="m-pass" type="password" placeholder="Mínimo 6 caracteres"></div>
    <div class="form-group"><label>Rol</label>
      <select id="m-role">
        <option value="user">Usuario</option>
        <option value="admin">Admin</option>
      </select>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveUsuario()">Crear usuario</button>
    </div>`);
};

window.saveUsuario = async () => {
  const nombre = $('m-nombre').value.trim();
  const email  = $('m-email').value.trim().toLowerCase();
  const pass   = $('m-pass').value;
  const role   = $('m-role').value;
  if (!nombre||!email||!pass) { toast('Completá todos los campos'); return; }
  if (pass.length<6) { toast('Contraseña: mínimo 6 caracteres'); return; }
  if (Object.values(S.users).some(u=>u.email===email)) { toast('Ya existe un usuario con ese email'); return; }
  await push(ref(db,'users'), { nombre, email, role, passwordHash:hashPass(pass) });
  closeModal(); toast('Usuario creado ✓');
};

window.modalEditUsuario = uid => {
  const u = S.users[uid];
  showModal('Editar usuario', `
    <div class="form-group"><label>Nombre</label><input id="m-nombre" value="${esc(u.nombre||'')}"></div>
    <div class="form-group"><label>Email</label><input id="m-email" type="email" value="${esc(u.email)}"></div>
    <div class="form-group">
      <label>Nueva contraseña <span style="color:var(--text2);font-weight:400">(vacío = no cambiar)</span></label>
      <input id="m-pass" type="password" placeholder="Nueva contraseña...">
    </div>
    <div class="form-group"><label>Rol</label>
      <select id="m-role">
        <option value="user" ${u.role==='user'?'selected':''}>Usuario</option>
        <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
      </select>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="updateUsuario('${uid}')">Guardar</button>
    </div>`);
};

window.updateUsuario = async uid => {
  const nombre = $('m-nombre').value.trim();
  const email  = $('m-email').value.trim().toLowerCase();
  const pass   = $('m-pass').value;
  const role   = $('m-role').value;
  if (!nombre||!email) { toast('Nombre y email son obligatorios'); return; }
  const upd = { nombre, email, role };
  if (pass) {
    if (pass.length<6) { toast('Mínimo 6 caracteres'); return; }
    upd.passwordHash = hashPass(pass);
  }
  await update(ref(db,`users/${uid}`), upd);
  closeModal(); toast('Usuario actualizado ✓');
};

window.deleteUsuario = uid => {
  if (!confirm('¿Eliminar este usuario?')) return;
  remove(ref(db,`users/${uid}`));
  toast('Usuario eliminado');
};

// ══ GMAIL REPORT ═════════════════════════════════════════════
window.sendReport = () => {
  const lines = [];
  const now = new Date().toLocaleDateString('es-AR',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  lines.push('REPORTE DE AVANCE — WORKFLOW EQUIPO');
  lines.push(now); lines.push('');

  let totalT=0, totalD=0;
  Object.values(S.carpetas).forEach(c=>{
    lines.push(`📁 ${c.nombre}`);
    Object.values(c.proyectos||{}).forEach(p=>{
      const tareas = Object.values(p.tareas||{});
      const done   = tareas.filter(t=>t.estado==='listo').length;
      totalT+=tareas.length; totalD+=done;
      lines.push(`  📋 ${p.nombre} — Avance promedio: ${avgPct(p)}% (${done}/${tareas.length})`);
      tareas.forEach(t=>{
        const resp = uNm(t.responsableUid);
        lines.push(`    • [${t.avance||0}%] ${t.titulo} | ${stLbl(t.estado)} | ${resp}${t.fechaLimite?' | Vence: '+fmt(t.fechaLimite):''}`);
      });
    });
    lines.push('');
  });
  lines.push(`TOTAL: ${totalD}/${totalT} tareas completadas`);

  const subject = `Avance del equipo — ${new Date().toLocaleDateString('es-AR')}`;
  window.open(
    `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`,
    '_blank'
  );
  toast('Abriendo Gmail ✓');
};

// ══ INIT ═════════════════════════════════════════════════════
async function init() {
  // Restaurar sesión
  const saved = sessionStorage.getItem('wf_u');
  if (saved) {
    try { S.user=JSON.parse(saved); bootApp(); return; } catch(e){}
  }
  // Primera vez: crear admin por defecto
  const snap = await get(ref(db,'users'));
  if (!snap.val()) {
    await push(ref(db,'users'), {
      nombre: 'Administrador',
      email:  'admin@workflow.com',
      role:   'admin',
      passwordHash: hashPass('admin123')
    });
    $('l-err').innerHTML = '<span style="color:#22c55e">Primera vez: admin@workflow.com / admin123</span>';
  }
}

init();
