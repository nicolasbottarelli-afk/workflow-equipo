// ============================================================
// WORKFLOW — app.js
// Firebase Realtime Database + Auth con usuarios propios
// ============================================================

import { initializeApp }       from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, push, onValue, update, remove, set, get }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ── Firebase config ─────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDijZ5KYg1OPcSJnDsQh9pxtH_cr_xobRU",
  authDomain: "workflow-equipo.firebaseapp.com",
  databaseURL: "https://workflow-equipo-default-rtdb.firebaseio.com",
  projectId: "workflow-equipo",
  storageBucket: "workflow-equipo.firebasestorage.app",
  messagingSenderId: "974073018957",
  appId: "1:974073018957:web:9200142d312802f74d3a04"
};

const fbApp = initializeApp(firebaseConfig);
const db    = getDatabase(fbApp);

// ── State ────────────────────────────────────────────────────
let state = {
  currentUser: null,   // { uid, email, nombre, role }
  users:       {},     // uid → { email, nombre, role, passwordHash }
  carpetas:    {},     // id  → { nombre, color, proyectos:{} }
  view:        'carpetas',
  openFolder:  null,
  openProject: null,
  calWeekOffset: 0,
};

// ── Helpers ──────────────────────────────────────────────────
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function uid() { return '_' + Math.random().toString(36).slice(2,10); }
function toast(msg, dur=3000) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.add('hidden'), dur);
}
function hashPass(pass) {
  // Simple hash — for production use a real auth system
  let h = 0;
  for (let i=0; i<pass.length; i++) { h = ((h<<5)-h)+pass.charCodeAt(i); h|=0; }
  return 'h_' + Math.abs(h).toString(36);
}
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'2-digit' });
}
function isOverdue(iso) {
  if (!iso) return false;
  return new Date(iso) < new Date() && iso;
}
function statusLabel(s) {
  return { pendiente:'Pendiente', progreso:'En progreso', revision:'En revisión', listo:'Listo', bloqueado:'Bloqueado' }[s] || s;
}
const FOLDER_COLORS = ['#4f7cff','#22c55e','#f59e0b','#ef4444','#a855f7','#06b6d4','#ec4899','#84cc16'];

// ── Modal ────────────────────────────────────────────────────
window.closeModal = () => document.getElementById('modal-overlay').classList.add('hidden');
function openModal(title, bodyHTML, onConfirm) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  document.getElementById('modal-overlay').classList.remove('hidden');
  if (onConfirm) window._modalConfirm = onConfirm;
}

// ── Auth / Login ─────────────────────────────────────────────
window.doLogin = async () => {
  const email = document.getElementById('l-email').value.trim().toLowerCase();
  const pass  = document.getElementById('l-pass').value;
  const errEl = document.getElementById('l-err');
  const btn   = document.getElementById('l-btn');
  if (!email || !pass) { errEl.textContent = 'Completá todos los campos'; return; }
  btn.disabled = true; btn.textContent = 'Verificando...';
  errEl.textContent = '';
  try {
    const snap = await get(ref(db, 'users'));
    const users = snap.val() || {};
    const hash = hashPass(pass);
    const found = Object.entries(users).find(([,u]) => u.email === email && u.passwordHash === hash);
    if (!found) {
      errEl.textContent = 'Email o contraseña incorrectos';
      btn.disabled = false; btn.textContent = 'Ingresar';
      return;
    }
    const [uid, userData] = found;
    state.currentUser = { uid, ...userData };
    sessionStorage.setItem('wf_user', JSON.stringify(state.currentUser));
    startApp();
  } catch(e) {
    errEl.textContent = 'Error de conexión. Revisá tu internet.';
    btn.disabled = false; btn.textContent = 'Ingresar';
  }
};

window.doLogout = () => {
  sessionStorage.removeItem('wf_user');
  location.reload();
};

// ── Start App ────────────────────────────────────────────────
function startApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

  const u = state.currentUser;
  document.getElementById('sidebar-user').innerHTML = `<strong>${esc(u.nombre || u.email)}</strong>${esc(u.email)}`;
  if (u.role === 'admin') document.getElementById('nav-admin').style.display = 'flex';

  // Listen to Firebase
  onValue(ref(db, 'users'), snap => {
    state.users = snap.val() || {};
    renderCurrentView();
  });
  onValue(ref(db, 'carpetas'), snap => {
    state.carpetas = snap.val() || {};
    renderSidebarFolders();
    renderCurrentView();
  });
}

// ── View routing ─────────────────────────────────────────────
window.setView = (v, folderId=null, projectId=null) => {
  state.view = v;
  if (folderId !== null) state.openFolder = folderId;
  if (projectId !== null) state.openProject = projectId;
  ['carpetas','calendario','mistareas','admin'].forEach(id => {
    document.getElementById('view-' + id).style.display = id === v ? '' : 'none';
  });
  ['nav-carpetas','nav-calendario','nav-mistareas','nav-admin'].forEach(id => {
    document.getElementById(id)?.classList.toggle('active', id === 'nav-' + v);
  });
  renderCurrentView();
};

function renderCurrentView() {
  const v = state.view;
  if (v === 'carpetas')   renderCarpetas();
  if (v === 'calendario') renderCalendario();
  if (v === 'mistareas')  renderMisTareas();
  if (v === 'admin')      renderAdmin();
}

// ── Sidebar folders ──────────────────────────────────────────
function renderSidebarFolders() {
  const el = document.getElementById('sidebar-folders');
  const items = Object.entries(state.carpetas);
  if (!items.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="nav-label" style="margin-top:4px">CARPETAS</div>` +
    items.map(([id,c]) => `
      <div class="folder-nav-item ${state.openFolder===id?'active':''}" onclick="setView('carpetas','${id}')">
        <span class="folder-dot" style="background:${esc(c.color||'#4f7cff')}"></span>
        ${esc(c.nombre)}
      </div>
    `).join('');
}

// ── CARPETAS VIEW ────────────────────────────────────────────
function renderCarpetas() {
  const el = document.getElementById('view-carpetas');
  if (state.openFolder && state.carpetas[state.openFolder]) {
    renderFolder(el, state.openFolder);
  } else {
    renderFolderList(el);
  }
}

function renderFolderList(el) {
  const entries = Object.entries(state.carpetas);
  el.innerHTML = `
    <div class="page-header">
      <div style="flex:1">
        <div class="breadcrumb" style="margin-bottom:4px">
          <span class="bc-cur" style="color:var(--muted2)">Inicio</span>
        </div>
        <h2>Carpetas</h2>
      </div>
      <button class="btn-gmail" onclick="sendGmailReport()">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
        Enviar avance
      </button>
      <button class="btn btn-primary" onclick="modalNuevaCarpeta()">+ Nueva carpeta</button>
    </div>
    <div class="content-pad">
      ${entries.length ? `<div class="folders-grid">${entries.map(([id,c]) => folderCard(id,c)).join('')}</div>`
        : `<div class="empty"><div class="empty-icon">📁</div><p>No hay carpetas todavía.<br>Creá la primera.</p></div>`}
    </div>`;
}

function folderCard(id, c) {
  const proyectos = Object.values(c.proyectos || {});
  const totalTareas = proyectos.reduce((a,p) => a + Object.keys(p.tareas||{}).length, 0);
  const doneTareas  = proyectos.reduce((a,p) => a + Object.values(p.tareas||{}).filter(t=>t.estado==='listo').length, 0);
  return `
    <div class="folder-card" onclick="setView('carpetas','${id}')">
      <div class="folder-strip" style="background:${esc(c.color||'#4f7cff')}"></div>
      <div class="folder-card-actions">
        <button class="btn btn-sm" onclick="event.stopPropagation();modalEditCarpeta('${id}')" title="Editar">✎</button>
        <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();deleteCarpeta('${id}')" title="Eliminar">✕</button>
      </div>
      <div class="folder-card-icon">📁</div>
      <div class="folder-card-name">${esc(c.nombre)}</div>
      <div class="folder-card-meta">${proyectos.length} proyecto${proyectos.length!==1?'s':''} · ${totalTareas} tarea${totalTareas!==1?'s':''}</div>
      ${totalTareas>0 ? `
        <div style="margin-top:8px">
          <div class="progress-bar-wrap" style="width:100%">
            <div class="progress-bar-fill ${doneTareas===totalTareas?'full':''}" style="width:${Math.round(doneTareas/totalTareas*100)}%"></div>
          </div>
        </div>` : ''}
    </div>`;
}

function renderFolder(el, folderId) {
  const c = state.carpetas[folderId];
  if (!c) { setView('carpetas'); return; }
  const proyectos = Object.entries(c.proyectos || {});
  el.innerHTML = `
    <div class="page-header">
      <div style="flex:1">
        <div class="breadcrumb" style="margin-bottom:4px">
          <span class="bc-link" onclick="setView('carpetas',null)">Inicio</span>
          <span class="bc-sep">›</span>
          <span>${esc(c.nombre)}</span>
        </div>
        <h2 style="display:flex;align-items:center;gap:8px">
          <span style="width:10px;height:10px;border-radius:50%;background:${esc(c.color||'#4f7cff')};display:inline-block"></span>
          ${esc(c.nombre)}
        </h2>
      </div>
      <button class="btn-gmail" onclick="sendGmailReport('${folderId}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
        Enviar avance
      </button>
      <button class="btn btn-primary" onclick="modalNuevoProyecto('${folderId}')">+ Nuevo proyecto</button>
    </div>
    <div class="content-pad">
      ${proyectos.length
        ? `<div class="projects-list">${proyectos.map(([pid,p]) => projectCard(folderId, pid, p)).join('')}</div>`
        : `<div class="empty"><div class="empty-icon">📋</div><p>No hay proyectos en esta carpeta.<br>Creá el primero.</p></div>`}
    </div>`;

  // Re-attach open state for projects
  proyectos.forEach(([pid]) => {
    const body = document.getElementById(`proj-body-${pid}`);
    const arrow = document.getElementById(`proj-arrow-${pid}`);
    if (state.openProject === pid && body) {
      body.style.display = ''; arrow?.classList.add('open');
    }
  });
}

function projectCard(folderId, pid, p) {
  const tareas = Object.entries(p.tareas || {});
  const done = tareas.filter(([,t]) => t.estado === 'listo').length;
  const pct  = tareas.length ? Math.round(done/tareas.length*100) : 0;
  return `
    <div class="project-card" id="proj-${pid}">
      <div class="project-header" onclick="toggleProject('${pid}')">
        <span class="project-arrow" id="proj-arrow-${pid}">▶</span>
        <span class="project-name">${esc(p.nombre)}</span>
        <div class="project-meta">
          <div class="progress-bar-wrap">
            <div class="progress-bar-fill ${pct===100?'full':''}" style="width:${pct}%"></div>
          </div>
          <span style="font-size:11px;color:var(--muted2);font-family:'JetBrains Mono',monospace">${pct}%</span>
          <span style="font-size:11px;color:var(--muted2)">${done}/${tareas.length}</span>
          <button class="btn btn-sm" onclick="event.stopPropagation();modalEditProyecto('${folderId}','${pid}')" title="Editar">✎</button>
          <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();deleteProyecto('${folderId}','${pid}')" title="Eliminar">✕</button>
        </div>
      </div>
      <div class="project-body" id="proj-body-${pid}" style="display:none">
        ${p.descripcion ? `<div class="project-desc">${esc(p.descripcion)}</div>` : ''}
        <div class="tasks-header">
          <span class="tasks-title">Tareas (${tareas.length})</span>
          <button class="btn btn-sm btn-primary" onclick="modalNuevaTarea('${folderId}','${pid}')">+ Tarea</button>
        </div>
        ${tareas.length
          ? tareas.map(([tid,t]) => taskRow(folderId, pid, tid, t)).join('')
          : `<div style="color:var(--muted2);font-size:12px;padding:8px 10px">Sin tareas todavía.</div>`}
      </div>
    </div>`;
}

function taskRow(folderId, pid, tid, t) {
  const isDone = t.estado === 'listo';
  const overdue = !isDone && isOverdue(t.fechaLimite);
  const responsable = t.responsableUid ? (state.users[t.responsableUid]?.nombre || state.users[t.responsableUid]?.email || '—') : null;
  return `
    <div class="task-row ${isDone?'done-task':''}" id="task-${tid}">
      <div class="task-check ${isDone?'done':''}" onclick="toggleTaskDone('${folderId}','${pid}','${tid}','${t.estado}')">
        ${isDone ? '✓' : ''}
      </div>
      <div class="task-info">
        <div class="task-title-text">${esc(t.titulo)}</div>
        ${t.descripcion ? `<div class="task-desc-text">${esc(t.descripcion)}</div>` : ''}
        <div class="task-chips">
          <span class="chip chip-${esc(t.estado||'pendiente')}">${statusLabel(t.estado||'pendiente')}</span>
          ${responsable ? `<span class="chip chip-person">👤 ${esc(responsable)}</span>` : ''}
          ${t.fechaLimite ? `<span class="chip chip-date ${overdue?'overdue':''}">📅 ${fmtDate(t.fechaLimite)}${overdue?' ⚠':''}</span>` : ''}
        </div>
      </div>
      <div class="task-actions">
        <button class="btn btn-sm" onclick="modalEditTarea('${folderId}','${pid}','${tid}')" title="Editar">✎</button>
        <button class="btn btn-sm btn-danger" onclick="deleteTarea('${folderId}','${pid}','${tid}')" title="Eliminar">✕</button>
      </div>
    </div>`;
}

window.toggleProject = (pid) => {
  const body  = document.getElementById(`proj-body-${pid}`);
  const arrow = document.getElementById(`proj-arrow-${pid}`);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : '';
  arrow?.classList.toggle('open', !isOpen);
  state.openProject = isOpen ? null : pid;
};

window.toggleTaskDone = (folderId, pid, tid, currentStatus) => {
  const newStatus = currentStatus === 'listo' ? 'pendiente' : 'listo';
  update(ref(db, `carpetas/${folderId}/proyectos/${pid}/tareas/${tid}`), { estado: newStatus });
};

// ── MODALES — Carpeta ────────────────────────────────────────
window.modalNuevaCarpeta = () => {
  openModal('Nueva carpeta', `
    <div class="modal-body">
      <div class="form-group"><label>Nombre</label><input id="m-nombre" placeholder="Ej: Harf-Tele"></div>
      <div class="form-group"><label>Color</label>
        <div class="tag-color-picker">${FOLDER_COLORS.map((c,i)=>`<div class="color-dot ${i===0?'selected':''}" style="background:${c}" data-color="${c}" onclick="selectColor(this)"></div>`).join('')}</div>
        <input type="hidden" id="m-color" value="${FOLDER_COLORS[0]}">
      </div>
      <div class="modal-actions">
        <button class="btn" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="saveCarpeta()">Crear carpeta</button>
      </div>
    </div>`);
};

window.selectColor = (el) => {
  document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('m-color').value = el.dataset.color;
};

window.saveCarpeta = () => {
  const nombre = document.getElementById('m-nombre').value.trim();
  const color  = document.getElementById('m-color').value;
  if (!nombre) { toast('Ingresá un nombre'); return; }
  push(ref(db, 'carpetas'), { nombre, color, proyectos: {} });
  closeModal(); toast('Carpeta creada ✓');
};

window.modalEditCarpeta = (id) => {
  const c = state.carpetas[id];
  openModal('Editar carpeta', `
    <div class="modal-body">
      <div class="form-group"><label>Nombre</label><input id="m-nombre" value="${esc(c.nombre)}"></div>
      <div class="form-group"><label>Color</label>
        <div class="tag-color-picker">${FOLDER_COLORS.map(col=>`<div class="color-dot ${col===c.color?'selected':''}" style="background:${col}" data-color="${col}" onclick="selectColor(this)"></div>`).join('')}</div>
        <input type="hidden" id="m-color" value="${esc(c.color||FOLDER_COLORS[0])}">
      </div>
      <div class="modal-actions">
        <button class="btn" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="updateCarpeta('${id}')">Guardar</button>
      </div>
    </div>`);
};

window.updateCarpeta = (id) => {
  const nombre = document.getElementById('m-nombre').value.trim();
  const color  = document.getElementById('m-color').value;
  if (!nombre) { toast('Ingresá un nombre'); return; }
  update(ref(db, `carpetas/${id}`), { nombre, color });
  closeModal(); toast('Carpeta actualizada ✓');
};

window.deleteCarpeta = (id) => {
  if (!confirm('¿Eliminar esta carpeta y todos sus proyectos?')) return;
  remove(ref(db, `carpetas/${id}`));
  if (state.openFolder === id) state.openFolder = null;
  toast('Carpeta eliminada');
};

// ── MODALES — Proyecto ───────────────────────────────────────
window.modalNuevoProyecto = (folderId) => {
  openModal('Nuevo proyecto', `
    <div class="modal-body">
      <div class="form-group"><label>Título</label><input id="m-nombre" placeholder="Ej: Instalación red LAN"></div>
      <div class="form-group"><label>Descripción</label><textarea id="m-desc" placeholder="Descripción del proyecto..."></textarea></div>
      <div class="modal-actions">
        <button class="btn" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="saveProyecto('${folderId}')">Crear proyecto</button>
      </div>
    </div>`);
};

window.saveProyecto = (folderId) => {
  const nombre = document.getElementById('m-nombre').value.trim();
  const desc   = document.getElementById('m-desc').value.trim();
  if (!nombre) { toast('Ingresá un título'); return; }
  push(ref(db, `carpetas/${folderId}/proyectos`), { nombre, descripcion: desc, tareas: {} });
  closeModal(); toast('Proyecto creado ✓');
};

window.modalEditProyecto = (folderId, pid) => {
  const p = state.carpetas[folderId]?.proyectos?.[pid];
  if (!p) return;
  openModal('Editar proyecto', `
    <div class="modal-body">
      <div class="form-group"><label>Título</label><input id="m-nombre" value="${esc(p.nombre)}"></div>
      <div class="form-group"><label>Descripción</label><textarea id="m-desc">${esc(p.descripcion||'')}</textarea></div>
      <div class="modal-actions">
        <button class="btn" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="updateProyecto('${folderId}','${pid}')">Guardar</button>
      </div>
    </div>`);
};

window.updateProyecto = (folderId, pid) => {
  const nombre = document.getElementById('m-nombre').value.trim();
  const desc   = document.getElementById('m-desc').value.trim();
  if (!nombre) { toast('Ingresá un título'); return; }
  update(ref(db, `carpetas/${folderId}/proyectos/${pid}`), { nombre, descripcion: desc });
  closeModal(); toast('Proyecto actualizado ✓');
};

window.deleteProyecto = (folderId, pid) => {
  if (!confirm('¿Eliminar este proyecto y todas sus tareas?')) return;
  remove(ref(db, `carpetas/${folderId}/proyectos/${pid}`));
  toast('Proyecto eliminado');
};

// ── MODALES — Tarea ──────────────────────────────────────────
function userOptions(selectedUid='') {
  return Object.entries(state.users)
    .map(([uid,u]) => `<option value="${uid}" ${uid===selectedUid?'selected':''}>${esc(u.nombre||u.email)}</option>`)
    .join('');
}

window.modalNuevaTarea = (folderId, pid) => {
  openModal('Nueva tarea', `
    <div class="modal-body">
      <div class="form-group"><label>Título</label><input id="m-titulo" placeholder="Ej: Revisar cableado"></div>
      <div class="form-group"><label>Descripción</label><textarea id="m-desc" placeholder="Detalle de la tarea..."></textarea></div>
      <div class="form-group"><label>Responsable</label>
        <select id="m-responsable"><option value="">— Sin asignar —</option>${userOptions()}</select>
      </div>
      <div class="form-group"><label>Estado</label>
        <select id="m-estado">
          <option value="pendiente">Pendiente</option>
          <option value="progreso">En progreso</option>
          <option value="revision">En revisión</option>
          <option value="listo">Listo</option>
          <option value="bloqueado">Bloqueado</option>
        </select>
      </div>
      <div class="form-group"><label>Fecha límite</label><input type="date" id="m-fecha"></div>
      <div class="modal-actions">
        <button class="btn" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="saveTarea('${folderId}','${pid}')">Crear tarea</button>
      </div>
    </div>`);
};

window.saveTarea = (folderId, pid) => {
  const titulo   = document.getElementById('m-titulo').value.trim();
  const desc     = document.getElementById('m-desc').value.trim();
  const respUid  = document.getElementById('m-responsable').value;
  const estado   = document.getElementById('m-estado').value;
  const fecha    = document.getElementById('m-fecha').value;
  if (!titulo) { toast('Ingresá un título'); return; }
  push(ref(db, `carpetas/${folderId}/proyectos/${pid}/tareas`), {
    titulo, descripcion: desc,
    responsableUid: respUid || null,
    estado, fechaLimite: fecha || null,
    creadoEn: new Date().toISOString()
  });
  closeModal(); toast('Tarea creada ✓');
};

window.modalEditTarea = (folderId, pid, tid) => {
  const t = state.carpetas[folderId]?.proyectos?.[pid]?.tareas?.[tid];
  if (!t) return;
  openModal('Editar tarea', `
    <div class="modal-body">
      <div class="form-group"><label>Título</label><input id="m-titulo" value="${esc(t.titulo)}"></div>
      <div class="form-group"><label>Descripción</label><textarea id="m-desc">${esc(t.descripcion||'')}</textarea></div>
      <div class="form-group"><label>Responsable</label>
        <select id="m-responsable"><option value="">— Sin asignar —</option>${userOptions(t.responsableUid||'')}</select>
      </div>
      <div class="form-group"><label>Estado</label>
        <select id="m-estado">
          ${['pendiente','progreso','revision','listo','bloqueado'].map(s=>`<option value="${s}" ${t.estado===s?'selected':''}>${statusLabel(s)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Fecha límite</label><input type="date" id="m-fecha" value="${esc(t.fechaLimite||'')}"></div>
      <div class="modal-actions">
        <button class="btn" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="updateTarea('${folderId}','${pid}','${tid}')">Guardar</button>
      </div>
    </div>`);
};

window.updateTarea = (folderId, pid, tid) => {
  const titulo  = document.getElementById('m-titulo').value.trim();
  const desc    = document.getElementById('m-desc').value.trim();
  const respUid = document.getElementById('m-responsable').value;
  const estado  = document.getElementById('m-estado').value;
  const fecha   = document.getElementById('m-fecha').value;
  if (!titulo) { toast('Ingresá un título'); return; }
  update(ref(db, `carpetas/${folderId}/proyectos/${pid}/tareas/${tid}`), {
    titulo, descripcion: desc,
    responsableUid: respUid || null,
    estado, fechaLimite: fecha || null
  });
  closeModal(); toast('Tarea actualizada ✓');
};

window.deleteTarea = (folderId, pid, tid) => {
  if (!confirm('¿Eliminar esta tarea?')) return;
  remove(ref(db, `carpetas/${folderId}/proyectos/${pid}/tareas/${tid}`));
  toast('Tarea eliminada');
};

// ── MIS TAREAS ───────────────────────────────────────────────
function renderMisTareas() {
  const el = document.getElementById('view-mistareas');
  const uid = state.currentUser.uid;
  const tasks = [];
  Object.entries(state.carpetas).forEach(([fid,c]) => {
    Object.entries(c.proyectos||{}).forEach(([pid,p]) => {
      Object.entries(p.tareas||{}).forEach(([tid,t]) => {
        if (t.responsableUid === uid) tasks.push({ fid, pid, tid, t, carpeta: c.nombre, proyecto: p.nombre });
      });
    });
  });
  const pending = tasks.filter(x => x.t.estado !== 'listo');
  const done    = tasks.filter(x => x.t.estado === 'listo');
  el.innerHTML = `
    <div class="page-header"><h2>Mis tareas</h2></div>
    <div class="content-pad">
      ${!tasks.length ? `<div class="empty"><div class="empty-icon">✅</div><p>No tenés tareas asignadas.</p></div>` : ''}
      ${pending.length ? `
        <div style="margin-bottom:1.5rem">
          <div class="tasks-title" style="margin-bottom:8px">PENDIENTES (${pending.length})</div>
          ${pending.map(x => `
            <div class="task-row ${x.t.estado==='listo'?'done-task':''}">
              <div class="task-check ${x.t.estado==='listo'?'done':''}" onclick="toggleTaskDone('${x.fid}','${x.pid}','${x.tid}','${x.t.estado}')">
                ${x.t.estado==='listo'?'✓':''}
              </div>
              <div class="task-info">
                <div class="task-title-text">${esc(x.t.titulo)}</div>
                <div class="task-chips">
                  <span class="chip chip-${esc(x.t.estado)}">${statusLabel(x.t.estado)}</span>
                  <span style="font-size:10px;color:var(--muted2)">${esc(x.carpeta)} › ${esc(x.proyecto)}</span>
                  ${x.t.fechaLimite?`<span class="chip chip-date ${isOverdue(x.t.fechaLimite)?'overdue':''}">📅 ${fmtDate(x.t.fechaLimite)}</span>`:''}
                </div>
              </div>
            </div>`).join('')}
        </div>` : ''}
      ${done.length ? `
        <div>
          <div class="tasks-title" style="margin-bottom:8px">COMPLETADAS (${done.length})</div>
          ${done.map(x => `
            <div class="task-row done-task">
              <div class="task-check done" onclick="toggleTaskDone('${x.fid}','${x.pid}','${x.tid}','${x.t.estado}')">✓</div>
              <div class="task-info">
                <div class="task-title-text">${esc(x.t.titulo)}</div>
                <div class="task-chips">
                  <span style="font-size:10px;color:var(--muted2)">${esc(x.carpeta)} › ${esc(x.proyecto)}</span>
                </div>
              </div>
            </div>`).join('')}
        </div>` : ''}
    </div>`;
}

// ── CALENDARIO ───────────────────────────────────────────────
function renderCalendario() {
  const el = document.getElementById('view-calendario');
  const today = new Date();
  const base  = new Date(today);
  base.setDate(today.getDate() - today.getDay() + 1 + state.calWeekOffset * 7); // Monday

  const days = Array.from({length:7},(_,i) => { const d=new Date(base); d.setDate(base.getDate()+i); return d; });
  const DIAS = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

  // Collect events
  const events = {}; // dateStr → [{label, tipo, color}]
  Object.entries(state.carpetas).forEach(([,c]) => {
    Object.entries(c.proyectos||{}).forEach(([,p]) => {
      Object.entries(p.tareas||{}).forEach(([,t]) => {
        if (t.fechaLimite) {
          const d = t.fechaLimite;
          events[d] = events[d] || [];
          events[d].push({ label: t.titulo, tipo: 'tarea', estado: t.estado });
        }
      });
    });
  });

  const weekLabel = `${days[0].toLocaleDateString('es-AR',{day:'2-digit',month:'short'})} – ${days[6].toLocaleDateString('es-AR',{day:'2-digit',month:'short',year:'numeric'})}`;

  el.innerHTML = `
    <div class="page-header"><h2>Calendario</h2></div>
    <div class="cal-wrap">
      <div class="cal-nav-bar">
        <button class="btn" onclick="state.calWeekOffset--;renderCalendario()">← Anterior</button>
        <h3>${weekLabel}</h3>
        <button class="btn" onclick="state.calWeekOffset=0;renderCalendario()">Hoy</button>
        <button class="btn" onclick="state.calWeekOffset++;renderCalendario()">Siguiente →</button>
      </div>
      <div class="cal-grid">
        ${DIAS.map(d=>`<div class="cal-head">${d}</div>`).join('')}
        ${days.map(d => {
          const iso = d.toISOString().slice(0,10);
          const isToday = iso === today.toISOString().slice(0,10);
          const evs = events[iso] || [];
          return `
            <div class="cal-cell ${isToday?'today':''}">
              <div class="cal-date">${d.getDate()}</div>
              ${evs.map(e => `
                <button class="cal-chip ${e.estado==='listo'?'cal-chip-tarea':'cal-chip-vence'}" title="${esc(e.label)}">
                  ${esc(e.label.length>22?e.label.slice(0,22)+'…':e.label)}
                </button>`).join('')}
              ${!evs.length?'':''}
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

// ── ADMIN ────────────────────────────────────────────────────
function renderAdmin() {
  if (state.currentUser?.role !== 'admin') {
    document.getElementById('view-admin').innerHTML = '<div class="empty"><p>Acceso denegado</p></div>';
    return;
  }
  const el = document.getElementById('view-admin');
  const users = Object.entries(state.users);
  el.innerHTML = `
    <div class="page-header">
      <h2>Administrar usuarios</h2>
      <button class="btn btn-primary" onclick="modalNuevoUsuario()">+ Nuevo usuario</button>
    </div>
    <div class="content-pad">
      <div class="users-list">
        ${users.map(([uid,u]) => `
          <div class="user-row">
            <div class="user-avatar">${(u.nombre||u.email||'?')[0].toUpperCase()}</div>
            <div class="user-details">
              <div class="user-name">${esc(u.nombre||'—')}</div>
              <div class="user-email">${esc(u.email)}</div>
            </div>
            <span class="user-role ${u.role==='admin'?'role-admin':'role-user'}">${u.role==='admin'?'Admin':'Usuario'}</span>
            ${uid !== state.currentUser.uid ? `
              <button class="btn btn-sm" onclick="modalEditUsuario('${uid}')">Editar</button>
              <button class="btn btn-sm btn-danger" onclick="deleteUsuario('${uid}')">Eliminar</button>` : '<span style="font-size:11px;color:var(--muted2)">(vos)</span>'}
          </div>`).join('')}
      </div>
    </div>`;
}

window.modalNuevoUsuario = () => {
  openModal('Nuevo usuario', `
    <div class="modal-body">
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
      </div>
    </div>`);
};

window.saveUsuario = async () => {
  const nombre = document.getElementById('m-nombre').value.trim();
  const email  = document.getElementById('m-email').value.trim().toLowerCase();
  const pass   = document.getElementById('m-pass').value;
  const role   = document.getElementById('m-role').value;
  if (!nombre || !email || !pass) { toast('Completá todos los campos'); return; }
  if (pass.length < 6) { toast('La contraseña debe tener al menos 6 caracteres'); return; }
  // Check duplicate email
  const exists = Object.values(state.users).some(u => u.email === email);
  if (exists) { toast('Ya existe un usuario con ese email'); return; }
  await push(ref(db, 'users'), { nombre, email, role, passwordHash: hashPass(pass) });
  closeModal(); toast('Usuario creado ✓');
};

window.modalEditUsuario = (uid) => {
  const u = state.users[uid];
  if (!u) return;
  openModal('Editar usuario', `
    <div class="modal-body">
      <div class="form-group"><label>Nombre</label><input id="m-nombre" value="${esc(u.nombre||'')}"></div>
      <div class="form-group"><label>Email</label><input id="m-email" type="email" value="${esc(u.email)}"></div>
      <div class="form-group"><label>Nueva contraseña <span style="color:var(--muted2);font-weight:400">(dejá vacío para no cambiar)</span></label><input id="m-pass" type="password" placeholder="Nueva contraseña..."></div>
      <div class="form-group"><label>Rol</label>
        <select id="m-role">
          <option value="user" ${u.role==='user'?'selected':''}>Usuario</option>
          <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
        </select>
      </div>
      <div class="modal-actions">
        <button class="btn" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="updateUsuario('${uid}')">Guardar</button>
      </div>
    </div>`);
};

window.updateUsuario = async (uid) => {
  const nombre = document.getElementById('m-nombre').value.trim();
  const email  = document.getElementById('m-email').value.trim().toLowerCase();
  const pass   = document.getElementById('m-pass').value;
  const role   = document.getElementById('m-role').value;
  if (!nombre || !email) { toast('Nombre y email son obligatorios'); return; }
  const updates = { nombre, email, role };
  if (pass) {
    if (pass.length < 6) { toast('La contraseña debe tener al menos 6 caracteres'); return; }
    updates.passwordHash = hashPass(pass);
  }
  await update(ref(db, `users/${uid}`), updates);
  closeModal(); toast('Usuario actualizado ✓');
};

window.deleteUsuario = (uid) => {
  if (!confirm('¿Eliminar este usuario?')) return;
  remove(ref(db, `users/${uid}`));
  toast('Usuario eliminado');
};

// ── Gmail Report ─────────────────────────────────────────────
window.sendGmailReport = (folderId=null) => {
  const lines = [];
  const now = new Date().toLocaleDateString('es-AR', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  lines.push(`REPORTE DE AVANCE — WORKFLOW EQUIPO`);
  lines.push(now);
  lines.push('');

  const carpetasToReport = folderId
    ? (state.carpetas[folderId] ? [[folderId, state.carpetas[folderId]]] : [])
    : Object.entries(state.carpetas);

  let totalTareas = 0, totalDone = 0;

  carpetasToReport.forEach(([,c]) => {
    lines.push(`📁 ${c.nombre}`);
    Object.values(c.proyectos||{}).forEach(p => {
      const tareas = Object.values(p.tareas||{});
      const done = tareas.filter(t=>t.estado==='listo').length;
      totalTareas += tareas.length; totalDone += done;
      lines.push(`  📋 ${p.nombre} (${done}/${tareas.length} completadas)`);
      tareas.forEach(t => {
        const resp = t.responsableUid ? (state.users[t.responsableUid]?.nombre || '—') : 'Sin asignar';
        const est  = statusLabel(t.estado);
        const fecha = t.fechaLimite ? ` | Vence: ${fmtDate(t.fechaLimite)}` : '';
        lines.push(`    • ${t.titulo} [${est}] (${resp})${fecha}`);
      });
    });
    lines.push('');
  });

  lines.push(`RESUMEN: ${totalDone}/${totalTareas} tareas completadas`);
  const subject = `Avance del equipo — ${new Date().toLocaleDateString('es-AR')}`;
  window.open(`https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`, '_blank');
  toast('Abriendo Gmail ✓');
};

// ── Init ─────────────────────────────────────────────────────
async function init() {
  // Check session
  const saved = sessionStorage.getItem('wf_user');
  if (saved) {
    try { state.currentUser = JSON.parse(saved); startApp(); return; } catch(e) {}
  }

  // Check if first run — create admin if no users
  const snap = await get(ref(db, 'users'));
  if (!snap.val()) {
    // Create default admin
    await push(ref(db, 'users'), {
      nombre: 'Administrador',
      email: 'admin@workflow.com',
      role: 'admin',
      passwordHash: hashPass('admin123')
    });
    document.getElementById('l-err').innerHTML =
      '<span style="color:var(--green)">Primera vez: usá admin@workflow.com / admin123</span>';
  }
}

init();
