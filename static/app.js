"use strict";
/* ====== État global ====== */
const ME = window.CURRENT_USER;
const IS_ADMIN = ME.is_admin;
const CAN_PROJECTS = ME.can_manage_projects || ME.is_admin;  // admin ou Team Leader
let state = {
  projects: [], tasks: [], users: [], absences: [], alerts: [], documents: [], notifications: [], notifUnread: 0,
  currentProject: localStorage.getItem('atelier_curproj') || null,
  filterStatus: 'all'
};
let pendingDocItems = [];
let listSort = 'due_date', listDir = 1;
let currentEditTaskId = null;
let activeFilters = {assignee: '', priority: '', status: 'all'};
let projectTags = [], projectMilestones = [], currentTaskTags = [];
let chartStatus = null, chartAssignee = null;
let allTasksCache = [];  // toutes les tâches tous projets (alimenté par Mon espace / KPI)

/* ====== Helpers ====== */
const $ = id => document.getElementById(id);
function esc(s){return (s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function today(){return new Date().toISOString().slice(0,10);}
function addDays(n){return new Date(Date.now()+n*864e5).toISOString().slice(0,10);}
function daysBetween(a,b){return Math.round((new Date(b)-new Date(a))/864e5);}
function fmtDate(d){if(!d)return '—';const p=d.split('-');return p[2]+'/'+p[1]+'/'+p[0];}
// Palette élargie de couleurs bien distinctes (24 teintes)
const AVA = ['#e8642f','#2f7fd6','#2e9e5b','#9b59b6','#f3a712','#e0729a','#1aa89a','#d6383f',
  '#5b6bd6','#3aa856','#c0529b','#e09020','#6a4fb3','#0e8e8e','#d65a5a','#4a90d9',
  '#7cb342','#ab47bc','#ff7043','#26a69a','#ec407a','#8d6e63','#5c6bc0','#9e9d24'];
// Couleur UNIQUE et stable par personne (basée sur sa position dans l'équipe triée par id)
function avaColor(id){
  const ordered=[...state.users].sort((a,b)=>a.id-b.id);
  const idx=ordered.findIndex(u=>u.id===id);
  if(idx>=0) return AVA[idx % AVA.length];
  // fallback (projets ou id inconnu) : hachage
  let h=0;const s=String(id);for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))%AVA.length;return AVA[h];
}
function initials(n){return n.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();}
function userById(id){return state.users.find(u=>u.id===id);}
function userName(id){const u=userById(id);return u?u.name:'Non assigné';}
function projById(id){return state.projects.find(p=>p.id==id);}
function projTasks(){return state.tasks.filter(t=>t.project_id==state.currentProject);}
const STATUS_LABEL={todo:'À faire',prog:'En cours',done:'Terminé'};
const STATUS_COLOR={todo:'#8a8478',prog:'#2f7fd6',done:'#2e9e5b'};
const PRIO_LABEL={h:'Haute',m:'Moyenne',l:'Basse'};
const PRIO_WEIGHT={h:3,m:2,l:1};
function isLate(t){return t.status!=='done' && t.due_date && t.due_date<today();}
function isAbsentNow(uid){return state.absences.some(a=>a.user_id===uid && a.from_date<=today() && a.to_date>=today());}
function canEditTask(t){return IS_ADMIN || t.assignee_id===ME.id;}

/* ====== API ====== */
async function api(path, opts={}){
  opts.headers = opts.headers || {};
  if(opts.body && typeof opts.body!=='string'){
    opts.headers['Content-Type']='application/json';
    opts.body=JSON.stringify(opts.body);
  }
  const r = await fetch(path, opts);
  if(!r.ok){
    let msg = `Erreur ${r.status}`;
    try{const j=await r.json(); msg = j.detail || msg;}catch{}
    throw new Error(msg);
  }
  return r.status===204 ? null : r.json();
}

async function loadAll(){
  try{
    const [projects, users, absences] = await Promise.all([
      api('/api/projects'), api('/api/users'), api('/api/absences')
    ]);
    state.projects = projects;
    state.users = users;
    state.absences = absences;
    if(!state.currentProject && projects.length) state.currentProject = projects[0].id;
    if(state.currentProject){
      state.tasks = await api('/api/tasks');
      state.alerts = await api('/api/alerts');
      await loadProjectTags();
    }
    await loadNotifications();
    renderFilterAssigneeOpts();
    renderAll();
  }catch(e){alert('Erreur de chargement : '+e.message);}
}
async function loadNotifications(){
  try{
    const r=await api('/api/notifications');
    state.notifications=r.items||[];
    state.notifUnread=r.unread||0;
  }catch{state.notifications=[];state.notifUnread=0;}
}

/* ====== Render ====== */
function renderAll(){
  renderProjBar();
  renderStats();
  renderDash();
  renderSynth();
  renderTasks();
  renderTeam();
  renderAbsences();
  renderAlerts();
  renderKanban();
  renderCalendar();
  renderList();
  renderCapacity();
  renderNotifBell();
  renderDashCharts();
  if(IS_ADMIN) renderAudit();
}

function renderProjBar(){
  const sel=$('projSelect');
  const meta=$('projMeta');
  if(!state.projects.length){sel.innerHTML='<option value="">Aucun projet</option>';if(meta)meta.innerHTML='';return;}
  sel.innerHTML = state.projects.map(p=>`<option value="${p.id}"${p.id==state.currentProject?' selected':''}>${esc(p.name)}</option>`).join('');
  // Info chef de projet du projet courant
  if(meta){
    const p=projById(state.currentProject);
    if(p&&p.lead_name){
      const mine=p.lead_id===ME.id;
      meta.innerHTML=`<span class="proj-lead-chip${mine?' mine':''}">👤 Chef de projet : <strong>${esc(p.lead_name)}</strong>${mine?' (toi)':''}</span>`;
    }else meta.innerHTML='';
  }
}

function projectProgress(){
  const ts=projTasks();
  if(!ts.length)return {pct:0,done:0,prog:0,todo:0,late:0,total:0};
  let wsum=0,wdone=0;
  ts.forEach(t=>{const w=PRIO_WEIGHT[t.priority]||2;wsum+=w;wdone+=w*((t.progress||0)/100);});
  return {
    pct:Math.round(wdone/wsum*100),
    done:ts.filter(t=>t.status==='done').length,
    prog:ts.filter(t=>t.status==='prog').length,
    todo:ts.filter(t=>t.status==='todo').length,
    late:ts.filter(isLate).length,
    total:ts.length
  };
}
function projectHealth(){
  const ts=projTasks(),late=ts.filter(isLate).length;
  const soon=ts.filter(t=>t.status!=='done'&&t.due_date&&daysBetween(today(),t.due_date)>=0&&daysBetween(today(),t.due_date)<=3).length;
  if(late>0)return {label:'En difficulté',color:'var(--bad)',ic:'🔴'};
  if(soon>0)return {label:'À surveiller',color:'var(--warn)',ic:'🟠'};
  return {label:'En bonne voie',color:'var(--ok)',ic:'🟢'};
}

function renderStats(){
  const p=projectProgress();
  $('statRow').innerHTML=
    `<div class="stat"><div class="n">${p.total}</div><div class="l">Tâches</div></div>`+
    `<div class="stat accent"><div class="n">${p.prog}</div><div class="l">En cours</div></div>`+
    `<div class="stat"><div class="n">${p.done}</div><div class="l">Terminées</div></div>`+
    `<div class="stat ${p.late?'bad':''}"><div class="n">${p.late}</div><div class="l">En retard</div></div>`+
    `<div class="stat"><div class="n">${p.pct}%</div><div class="l">Avancement</div></div>`;
}

function renderDash(){
  const ts=projTasks();
  // Ajoute les canvas Chart.js si absent
  if(!$('chartStatus')){
    const chartsDiv=document.createElement('div');
    chartsDiv.className='grid';chartsDiv.style='grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px';
    chartsDiv.innerHTML='<div class="panel"><div class="sec-h" style="margin-bottom:8px"><h2 style="font-size:15px">Répartition des statuts</h2></div><div class="chart-wrap"><canvas id="chartStatus"></canvas></div></div><div class="panel"><div class="sec-h" style="margin-bottom:8px"><h2 style="font-size:15px">Charge par membre</h2></div><div class="chart-wrap"><canvas id="chartAssignee"></canvas></div></div>';
    $('sec-dash').insertBefore(chartsDiv,$('statRow').nextSibling);
    renderDashCharts();
  } else { renderDashCharts(); }
  $('dashProgress').innerHTML = ts.length===0 ? '<div class="empty">Aucune tâche dans ce projet.</div>' :
    ts.map(t=>`<div style="margin-bottom:14px"><div class="row" style="justify-content:space-between"><strong>${esc(t.title)}</strong><span class="meta">${t.progress||0}%${isLate(t)?' · <span style="color:var(--bad)">retard</span>':''}</span></div><div class="progress"><i style="width:${t.progress||0}%"></i></div></div>`).join('');
  const al = state.alerts;
  $('dashAlerts').innerHTML = al.length ? al.slice(0,5).map(alertHTML).join('') : '<div class="empty">Aucune alerte active 🎉</div>';
}

function renderTasks(){
  const list=filteredTasks().filter(t=>state.filterStatus==='all'||t.status===state.filterStatus);
  const el=$('taskList');
  if(list.length===0){el.innerHTML='<div class="empty">Aucune tâche. Clique sur « Nouvelle tâche ».</div>';return;}
  el.innerHTML = list.map((t,i)=>{
    const late=isLate(t), st=late?'late':t.status, lbl=late?'En retard':STATUS_LABEL[t.status];
    const assignee=userById(t.assignee_id);
    const canRemind=late && assignee && assignee.email;
    const canEdit=canEditTask(t);
    return `<div class="card" style="animation-delay:${i*35}ms"><div class="bar" style="background:${late?'var(--bad)':STATUS_COLOR[t.status]}"></div>
      <div class="row" style="justify-content:space-between"><span class="tag ${st}">${lbl}</span><span class="prio ${t.priority}">● ${PRIO_LABEL[t.priority]}</span></div>
      <h3 style="margin-top:8px">${esc(t.title)}</h3>${t.description?`<div class="meta">${esc(t.description)}</div>`:''}
      <div class="meta">👤 ${esc(userName(t.assignee_id))}${isAbsentNow(t.assignee_id)?' <span class="pill absent">absent</span>':''}</div>
      <div class="meta">📅 ${fmtDate(t.due_date)}</div>
      <div class="progress"><i style="width:${t.progress||0}%"></i></div>
      <div class="row" style="justify-content:flex-end;margin-top:10px">
        ${canRemind?`<button class="btn sm danger" data-remind="${t.id}">✉ Relancer</button>`:''}
        ${canEdit?`<button class="btn sm ghost" data-edit-task="${t.id}">Modifier</button><button class="btn sm ghost" data-del-task="${t.id}">Supprimer</button>`:''}
      </div></div>`;
  }).join('');
}

function renderTeam(){
  const el=$('teamList');
  if(state.users.length===0){el.innerHTML='<div class="empty">Aucun membre.</div>';return;}
  el.innerHTML=state.users.map(u=>{
    const n=state.tasks.filter(t=>t.assignee_id===u.id && t.status!=='done').length;
    const absent=isAbsentNow(u.id);
    const onlineDot=u.online?'<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#2e9e5b;margin-right:5px;vertical-align:middle" title="En ligne"></span>':'';
    const lastLogin=u.last_login?'Dernière connexion : '+fmtDateTime(u.last_login):'Jamais connecté';
    return `<div class="card"><div class="person"><div class="ava" style="background:${avaColor(u.id)}">${initials(u.name)}</div>
      <div style="flex:1"><h3 style="font-size:16px">${onlineDot}${esc(u.name)}</h3><div class="meta">${u.role==='admin'?'Administrateur':u.role==='lead'?'Team Leader':'Utilisateur'}</div></div></div>
      <div class="meta" style="margin-top:10px">✉ ${esc(u.email)}</div>
      <div class="meta" style="margin-top:4px;font-size:12px">🕐 ${lastLogin}</div>
      <div class="row" style="margin-top:8px"><span class="pill">${n} tâche(s) active(s)</span>
        ${absent?`<span class="pill absent">Absent aujourd&#39;hui</span>`:`<span class="pill ok">Disponible</span>`}
        ${u.role==='admin'?'<span class="pill admin">Admin</span>':u.role==='lead'?'<span class="pill admin">Team Leader</span>':''}
      </div>
      ${IS_ADMIN?`<div class="row" style="justify-content:flex-end;margin-top:10px;flex-wrap:wrap;gap:5px">
        ${u.email?`<button class="btn sm ghost" data-remind-person="${u.id}">✉ Rappel tâches</button>`:''}
        ${u.email&&!u.last_login?`<button class="btn sm" style="background:var(--acc);color:#fff" data-remind-login="${u.id}">✉ Inviter à se connecter</button>`:u.email?`<button class="btn sm ghost" data-remind-login="${u.id}">🔗 Rappel connexion</button>`:''}
        <button class="btn sm ghost" data-edit-person="${u.id}">Modifier</button>
        ${u.id!==ME.id?`<button class="btn sm ghost" data-del-person="${u.id}">Supprimer</button>`:''}
      </div>`:''}
    </div>`;
  }).join('');
}

function renderAbsences(){
  const el=$('absList');
  if(state.absences.length===0){el.innerHTML='<tr><td colspan="6" class="empty">Aucune absence déclarée.</td></tr>';return;}
  el.innerHTML=state.absences.map(a=>{
    const now=a.from_date<=today() && a.to_date>=today(), future=a.from_date>today();
    const status=now?'<span class="pill absent">En cours</span>':future?'<span class="pill">À venir</span>':'<span class="pill">Passée</span>';
    const canDel=IS_ADMIN || a.user_id===ME.id;
    return `<tr><td>${esc(userName(a.user_id))}</td><td>${esc(a.kind)}</td><td>${fmtDate(a.from_date)}</td><td>${fmtDate(a.to_date)}</td><td>${status}</td><td>${canDel?`<button class="x" data-del-abs="${a.id}">✕</button>`:''}</td></tr>`;
  }).join('');
}

function renderAlerts(){
  const al = state.alerts;
  $('alertList').innerHTML = al.length ? al.map(alertHTML).join('') : '<div class="empty">Aucune alerte active. Tout est sous contrôle 🎉</div>';
  const b=$('alertBadge'); b.textContent=al.length; b.classList.toggle('hidden',al.length===0);
  $('btnAckAll').classList.toggle('hidden', al.length===0);
}
function alertHTML(a){
  const canRemind = a.kind==='late' && a.assignee_email;
  return `<div class="alert ${a.type}"><div class="ic">${a.ic||'⚠'}</div>
    <div class="ri-body"><strong>${esc(a.title)}</strong><div class="meta">${esc(a.msg)}</div></div>
    <div class="row" style="gap:6px">
      ${canRemind?`<button class="btn sm danger" data-remind="${a.task_id}">✉ Relancer</button>`:''}
      <button class="btn sm ghost" data-ack="${a.key}">✓ Acquitter</button>
    </div></div>`;
}

/* ====== Synthèse + Gantt ====== */
function renderSynth(){
  const proj=projById(state.currentProject);
  const c=$('synthContent');
  if(!proj){c.innerHTML='<div class="empty">Aucun projet sélectionné.</div>';return;}
  $('synthTitle').textContent='Synthèse — '+proj.name;
  const pp=projectProgress(), health=projectHealth(), ts=projTasks();
  let html='';
  html+='<div class="grid" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:18px">';
  html+=`<div class="panel"><div class="l" style="color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:1px">Santé du projet</div><div style="font-family:'Space Grotesk';font-size:24px;font-weight:700;margin-top:6px;color:${health.color}">${health.ic} ${health.label}</div></div>`;
  html+=`<div class="panel"><div class="l" style="color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:1px">Avancement pondéré</div><div style="font-family:'Space Grotesk';font-size:24px;font-weight:700;margin-top:6px">${pp.pct}%</div><div class="progress big"><i style="width:${pp.pct}%"></i></div></div>`;
  html+=`<div class="panel"><div class="l" style="color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:1px">État des tâches</div><div style="margin-top:8px;font-size:13px;line-height:1.7">✅ Terminées : <strong>${pp.done}</strong><br>🔵 En cours : <strong>${pp.prog}</strong><br>⚪ À faire : <strong>${pp.todo}</strong><br>🔴 En retard : <strong>${pp.late}</strong></div></div>`;
  html+='</div>';
  if(proj.description)html+=`<div class="panel" style="margin-bottom:18px"><strong>Description</strong><div class="meta" style="margin-top:6px">${esc(proj.description)}</div></div>`;
  html+=`<div class="panel" style="margin-bottom:18px"><div class="sec-h"><h2 style="font-size:18px">Diagramme de Gantt</h2></div>${buildGantt(ts)}</div>`;
  html+='<div class="panel"><div class="sec-h"><h2 style="font-size:18px">Détail des tâches</h2></div><div style="overflow:auto"><table><thead><tr><th>Tâche</th><th>Responsable</th><th>Priorité</th><th>Début</th><th>Échéance</th><th>Statut</th><th>%</th></tr></thead><tbody>';
  if(!ts.length)html+='<tr><td colspan="7" class="empty">Aucune tâche.</td></tr>';
  ts.forEach(t=>{const late=isLate(t);
    html+=`<tr><td>${esc(t.title)}</td><td>${esc(userName(t.assignee_id))}</td><td>${PRIO_LABEL[t.priority]}</td><td>${fmtDate(t.start_date)}</td><td${late?' style="color:var(--bad);font-weight:700"':''}>${fmtDate(t.due_date)}</td><td>${late?'En retard':STATUS_LABEL[t.status]}</td><td>${t.progress||0}%</td></tr>`;});
  html+='</tbody></table></div></div>';
  c.innerHTML=html;
}
function buildGantt(ts){
  const dated=ts.filter(t=>t.start_date && t.due_date);
  if(!dated.length)return '<div class="empty">Ajoute des dates de début et d\'échéance aux tâches pour afficher le Gantt.</div>';
  let min=dated[0].start_date,max=dated[0].due_date;
  dated.forEach(t=>{if(t.start_date<min)min=t.start_date;if(t.due_date>max)max=t.due_date;});
  const d0=new Date(min),d1=new Date(max);
  const span=Math.max(1,daysBetween(min,max));
  const months=[]; let cur=new Date(d0.getFullYear(),d0.getMonth(),1);
  while(cur<=d1){months.push(new Date(cur));cur.setMonth(cur.getMonth()+1);}
  const MN=['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Aoû','Sep','Oct','Nov','Déc'];
  let head='<div class="gantt-head"><div class="gantt-label">Tâche</div>';
  months.forEach(m=>{head+=`<div class="gantt-month">${MN[m.getMonth()]} ${String(m.getFullYear()).slice(2)}</div>`;});
  head+='</div>';
  let rows='';
  dated.forEach(t=>{
    const off=daysBetween(min,t.start_date)/span*100;
    const w=Math.max(2,daysBetween(t.start_date,t.due_date)/span*100);
    const cls=isLate(t)?'late':(t.status==='done'?'done':'');
    rows+=`<div class="gantt-row"><div class="gantt-label" title="${esc(t.title)}">${esc(t.title)}</div><div class="gantt-track"><div class="gantt-bar ${cls}" style="left:${off}%;width:${w}%" title="${fmtDate(t.start_date)} → ${fmtDate(t.due_date)}">${t.progress||0}%</div></div></div>`;
  });
  return `<div class="gantt">${head}${rows}</div>`;
}

/* ====== Calendrier ====== */
const MONTHS_FR=['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const DAYS_FR=['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
let calYear=new Date().getFullYear(), calMonth=new Date().getMonth();

function absenceIcon(kind){
  const k=(kind||'').toLowerCase();
  if(k.includes('congé')||k.includes('conge')||k.includes('vacance')) return '🌴';
  if(k.includes('malad')) return '🤒';
  if(k.includes('télé')||k.includes('tele')) return '🏠';
  if(k.includes('format')) return '🎓';
  return '📌';
}
function renderCalendar(){
  const c=$('calContent');if(!c)return;
  const ts=projTasks().filter(t=>t.due_date);
  const todayStr=today();
  const firstDay=new Date(calYear,calMonth,1);
  const lastDay=new Date(calYear,calMonth+1,0);
  let startDow=firstDay.getDay();startDow=startDow===0?6:startDow-1;
  const totalDays=lastDay.getDate();
  const headers=DAYS_FR.map(d=>`<div class="cal-day-name">${d}</div>`).join('');
  let cells='';
  for(let i=0;i<startDow;i++) cells+='<div class="cal-cell other-month"></div>';
  for(let d=1;d<=totalDays;d++){
    const dateStr=`${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday=dateStr===todayStr;
    // Tâches
    const dayTasks=ts.filter(t=>t.due_date===dateStr);
    // Absences de tous les collaborateurs
    const dayAbs=state.absences.filter(a=>a.from_date<=dateStr&&a.to_date>=dateStr);
    // Jalons du projet
    const dayMs=projectMilestones.filter(m=>m.due_date===dateStr);
    const MAX_T=2,MAX_A=2;
    const taskPills=dayTasks.slice(0,MAX_T).map(t=>{
      const late=isLate(t);
      const color=t.status==='done'?'var(--ok)':late?'var(--bad)':t.priority==='h'?'#d6383f':t.priority==='m'?'var(--warn)':'var(--info)';
      return `<div class="cal-task-pill" style="background:${color}" data-edit-task="${t.id}" title="${esc(t.title)}">${esc(t.title)}</div>`;
    }).join('');
    const absPills=dayAbs.slice(0,MAX_A).map(a=>{
      const u=userById(a.user_id);
      const nm=u?u.name:'?';
      const first=u?u.name.split(' ')[0]:'?';
      const col=u?avaColor(u.id):'#888';
      const ic=absenceIcon(a.kind);
      return `<div class="cal-abs-pill" style="background:${col}" title="🌴 ${esc(nm)} — ${esc(a.kind)} (du ${fmtDate(a.from_date)} au ${fmtDate(a.to_date)})">${ic} ${esc(first)}</div>`;
    }).join('');
    const msPills=dayMs.map(m=>`<div class="cal-ms-pill" title="Jalon : ${esc(m.name)}">🏁 ${esc(m.name)}</div>`).join('');
    const extra=(dayTasks.length>MAX_T?dayTasks.length-MAX_T:0)+(dayAbs.length>MAX_A?dayAbs.length-MAX_A:0);
    const more=extra>0?`<div class="cal-more">+${extra} autres</div>`:'';
    const hasAbs=dayAbs.length>0;
    cells+=`<div class="cal-cell${isToday?' today':''}${hasAbs?' has-abs':''}">
      <span class="cal-date-num">${d}</span>
      <div class="cal-tasks">${msPills}${taskPills}${absPills}${more}</div>
    </div>`;
  }
  const rem=(startDow+totalDays)%7;
  if(rem!==0) for(let i=0;i<7-rem;i++) cells+='<div class="cal-cell other-month"></div>';

  // Récap des absences du mois visible (qui est en congé, quand)
  const monthStart=`${calYear}-${String(calMonth+1).padStart(2,'0')}-01`;
  const monthEnd=`${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(totalDays).padStart(2,'0')}`;
  const monthAbs=state.absences.filter(a=>a.from_date<=monthEnd && a.to_date>=monthStart);
  let absRoster='';
  if(monthAbs.length){
    const rows=monthAbs.sort((a,b)=>a.from_date<b.from_date?-1:1).map(a=>{
      const u=userById(a.user_id);
      const nm=u?u.name:'?';
      const col=u?avaColor(u.id):'#888';
      return `<span class="cal-abs-roster-item" title="${esc(a.kind)}">
        <span class="cal-legend-dot" style="background:${col}"></span>
        <strong>${esc(nm)}</strong> · ${absenceIcon(a.kind)} ${esc(a.kind)} <span style="color:var(--mut)">(${fmtDate(a.from_date)} → ${fmtDate(a.to_date)})</span>
      </span>`;
    }).join('');
    absRoster=`<div class="cal-abs-roster"><strong style="font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.5px">🌴 Absences ce mois (${monthAbs.length})</strong><div class="cal-abs-roster-list">${rows}</div></div>`;
  }

  c.innerHTML=`<div class="cal-nav">
    <button class="btn sm ghost" id="calPrev">← Précédent</button>
    <h3 class="cal-title">${MONTHS_FR[calMonth]} ${calYear}</h3>
    <button class="btn sm ghost" id="calToday">Aujourd'hui</button>
    <button class="btn sm ghost" id="calNext">Suivant →</button>
  </div>
  <div class="cal-legend">
    <span class="cal-legend-item"><span class="cal-legend-dot" style="background:var(--info)"></span>Tâche</span>
    <span class="cal-legend-item"><span class="cal-legend-dot" style="background:#e8642f"></span>Absence (couleur = personne)</span>
    <span class="cal-legend-item"><span class="cal-legend-dot" style="background:#9b59b6"></span>Jalon</span>
  </div>
  ${absRoster}
  <div class="cal-grid">${headers}${cells}</div>`;
  $('calPrev').onclick=()=>{calMonth===0?(calMonth=11,calYear--):calMonth--;renderCalendar();};
  $('calNext').onclick=()=>{calMonth===11?(calMonth=0,calYear++):calMonth++;renderCalendar();};
  $('calToday').onclick=()=>{calYear=new Date().getFullYear();calMonth=new Date().getMonth();renderCalendar();};
}

/* ====== Kanban ====== */
const KANBAN_COLS=[
  {status:'todo',label:'À faire',cls:'todo'},
  {status:'prog',label:'En cours',cls:'prog'},
  {status:'done',label:'Terminé',cls:'done'}
];

function renderKanban(){
  const board=$('kanbanBoard');
  if(!board)return;
  const ts=filteredTasks();
  board.innerHTML='<div class="kanban-board">'+KANBAN_COLS.map(col=>{
    const tasks=ts.filter(t=>t.status===col.status);
    const cards=tasks.length?tasks.map(t=>{
      const u=userById(t.assignee_id);
      const late=isLate(t);
      const barColor=late?'var(--bad)':col.status==='done'?'var(--ok)':col.status==='prog'?'var(--info)':'var(--mut)';
      return `<div class="kanban-card${late?' late':''}" data-id="${t.id}">
        <div class="kanban-card-bar" style="background:${barColor}"></div>
        <div class="row" style="justify-content:space-between">
          <span class="prio ${t.priority}">● ${PRIO_LABEL[t.priority]}</span>
          ${late?'<span class="tag late" style="font-size:10px">Retard</span>':''}
        </div>
        <div class="kanban-card-title" data-edit-task="${t.id}">${esc(t.title)}</div>
        <div class="kanban-card-meta">
          <span>👤 ${esc(u?u.name:'Non assigné')}</span>
          ${t.due_date?`<span>📅 ${fmtDate(t.due_date)}</span>`:''}
        </div>
        ${t.progress>0?`<div class="progress" style="margin-top:8px"><i style="width:${t.progress}%"></i></div>`:''}
      </div>`;
    }).join(''):`<div class="kanban-empty">Aucune tâche</div>`;
    return `<div class="kanban-col">
      <div class="kanban-col-header ${col.cls}">
        <span class="kanban-col-title">${col.label}</span>
        <span class="kanban-count" id="kanban-count-${col.status}">${tasks.length}</span>
      </div>
      <div class="kanban-col-body" id="kanban-col-${col.status}" data-status="${col.status}">${cards}</div>
    </div>`;
  }).join('')+'</div>';
  if(typeof Sortable!=='undefined') initKanban();
}

function initKanban(){
  KANBAN_COLS.forEach(col=>{
    const el=$('kanban-col-'+col.status);
    if(!el)return;
    Sortable.create(el,{
      group:'kanban',animation:180,
      ghostClass:'kanban-ghost',chosenClass:'kanban-chosen',
      onEnd:async function(evt){
        const taskId=parseInt(evt.item.dataset.id,10);
        const newStatus=evt.to.dataset.status;
        const oldStatus=evt.from.dataset.status;
        if(newStatus===oldStatus)return;
        // Mise à jour optimiste des compteurs
        KANBAN_COLS.forEach(c=>{
          const body=$('kanban-col-'+c.status);
          const count=$('kanban-count-'+c.status);
          if(body&&count) count.textContent=body.querySelectorAll('.kanban-card').length;
        });
        // Update state local
        const task=state.tasks.find(t=>t.id===taskId);
        const prevStatus=oldStatus;
        if(task) task.status=newStatus;
        try{
          await api('/api/tasks/'+taskId,{method:'PUT',body:{status:newStatus}});
          if(task&&newStatus==='done') task.progress=100;
          renderStats();renderDash();
        }catch(e){
          // Rollback
          if(task) task.status=prevStatus;
          alert('Erreur lors du déplacement : '+e.message);
          renderKanban();
        }
      }
    });
  });
}

/* ====== Rappel par personne ====== */
async function remindPerson(userId){
  const u=userById(userId);
  if(!u||!u.email){alert("Cet utilisateur n'a pas d'adresse email.");return;}
  let allTasks;
  try{allTasks=await api('/api/tasks');}catch(e){alert(e.message);return;}
  const tasks=allTasks.filter(t=>t.assignee_id===userId&&t.status!=='done');
  if(!tasks.length){alert(`${u.name} n'a aucune tâche active.`);return;}
  const late=tasks.filter(isLate);
  const soon=tasks.filter(t=>!isLate(t)&&t.due_date&&daysBetween(today(),t.due_date)>=0&&daysBetween(today(),t.due_date)<=3);
  const other=tasks.filter(t=>!isLate(t)&&!(t.due_date&&daysBetween(today(),t.due_date)>=0&&daysBetween(today(),t.due_date)<=3));
  let body=`Bonjour ${u.name.split(' ')[0]},\n\nVoici un récapitulatif de tes tâches actives :\n\n`;
  if(late.length){
    body+=`⚠ EN RETARD (${late.length}) :\n`;
    late.forEach(t=>{const p=projById(t.project_id);body+=`• ${t.title}${p?' ['+p.name+']':''} — Échéance : ${fmtDate(t.due_date)} — Avancement : ${t.progress||0}%\n`;});
    body+='\n';
  }
  if(soon.length){
    body+=`⏰ ÉCHÉANCES DANS LES 3 JOURS :\n`;
    soon.forEach(t=>{const p=projById(t.project_id);body+=`• ${t.title}${p?' ['+p.name+']':''} — Échéance : ${fmtDate(t.due_date)}\n`;});
    body+='\n';
  }
  if(other.length){
    body+=`📋 EN COURS :\n`;
    other.forEach(t=>{const p=projById(t.project_id);body+=`• ${t.title}${p?' ['+p.name+']':''} — ${STATUS_LABEL[t.status]} — Avancement : ${t.progress||0}%\n`;});
    body+='\n';
  }
  body+=`Merci de tenir ton avancement à jour dans l'application.\n\nCordialement,\n${ME.name}`;
  const subject=`Récapitulatif de tes tâches — ${document.title}`;
  window.location.href='mailto:'+encodeURIComponent(u.email)+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
}

/* ====== Rappel connexion ====== */
async function remindLogin(userId){
  const u=userById(parseInt(userId,10));
  if(!u||!u.email){toast("Cet utilisateur n'a pas d'adresse email.",'err');return;}
  const appUrl=window.location.origin;
  const appName=document.title;
  const subject=`Invitation à se connecter — ${appName}`;
  const body=`Bonjour ${u.name.split(' ')[0]},\n\nCeci est un rappel pour vous connecter à l'application de gestion de projet "${appName}".\n\nAccédez à l'application ici :\n${appUrl}\n\nVos identifiants vous ont été communiqués lors de votre inscription. Si vous avez oublié votre mot de passe, contactez l'administrateur.\n\nÀ bientôt !`;
  window.location.href='mailto:'+encodeURIComponent(u.email)+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
}

/* ====== Relance mail ====== */
async function remindTask(taskId){
  const t=state.tasks.find(x=>x.id==taskId);
  if(!t)return;
  const u=userById(t.assignee_id);
  if(!u||!u.email){alert("Cette tâche n'a pas de personne avec une adresse email.");return;}
  const proj=projById(t.project_id);
  const d=Math.abs(daysBetween(t.due_date,today()));
  const subject='Relance — tâche en retard : '+t.title;
  const body=`Bonjour ${u.name.split(' ')[0]},\n\nPetit rappel concernant la tâche suivante, actuellement en retard de ${d} jour(s) :\n\n• Tâche : ${t.title}\n${proj?'• Projet : '+proj.name+'\n':''}• Échéance initiale : ${fmtDate(t.due_date)}\n• Priorité : ${PRIO_LABEL[t.priority]}\n• Avancement actuel : ${t.progress||0}%\n\nPeux-tu me faire un point sur l'avancement et une date de livraison réaliste ?\n\nMerci,\n${ME.name}`;
  window.location.href='mailto:'+encodeURIComponent(u.email)+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
}

/* ====== Navigation ====== */
function tab(name){
  document.querySelectorAll('nav .tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===name));
  ['me','dash','kpi','synth','tasks','team','absence','alerts','kanban','cal','list','docs','capacity','audit'].forEach(s=>{
    const el=$('sec-'+s);
    if(!el) return;
    if(s===name){
      el.classList.remove('hidden');
      el.style.animation='none';
      el.offsetHeight; // force reflow pour relancer l'animation
      el.style.animation='';
    }else{
      el.classList.add('hidden');
    }
  });
  if(name==='docs') renderDocs();
  if(name==='kpi') renderKPI();
  if(name==='me') renderMe();
}
function openModal(id){fillSelects();$(id).classList.add('show');}
function closeModal(id){$(id).classList.remove('show');}
function fillSelects(){
  // Projets pour la tâche
  $('f_taskProject').innerHTML=state.projects.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  // Pour la tâche : assignés = utilisateurs
  $('f_assignee').innerHTML='<option value="">— Non assigné —</option>'+state.users.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('');
  $('f_aPerson').innerHTML=state.users.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('');
  // L'assigné est verrouillé sur soi-même sauf pour admin / Team Leader
  if(!CAN_PROJECTS){
    $('f_assignee').value=ME.id;
    $('f_assignee').disabled=true;
  }else{
    $('f_assignee').disabled=false;
  }
  // Les absences restent gérées pour soi-même hors admin
  if(!IS_ADMIN && state.users.find(u=>u.id===ME.id)){
    $('f_aPerson').value=ME.id;
    $('f_aPerson').disabled=true;
  }
}

/* ====== Projets ====== */
async function addProject(){
  const n=prompt('Nom du nouveau projet :');if(!n||!n.trim())return;
  const d=prompt('Description (optionnelle) :')||'';
  try{const p=await api('/api/projects',{method:'POST',body:{name:n.trim(),description:d.trim()}});
    state.currentProject=p.id;localStorage.setItem('atelier_curproj',p.id);
    await loadAll();
    toast(`✅ Projet « ${n.trim()} » créé — tu en es le chef de projet`);
  }catch(e){toast(e.message,'err');}
}
async function editProject(){
  const p=projById(state.currentProject);if(!p)return;
  const n=prompt('Nom du projet :',p.name);if(n===null)return;
  const d=prompt('Description :',p.description||'');
  await api('/api/projects/'+p.id,{method:'PUT',body:{name:n.trim(),description:(d||'').trim()}});
  await loadAll();
}
async function delProject(){
  const p=projById(state.currentProject);if(!p)return;
  if(!confirm('Supprimer le projet « '+p.name+' » et toutes ses tâches ?'))return;
  try{
    await api('/api/projects/'+p.id,{method:'DELETE'});
    state.currentProject=null;state.tasks=[];
    localStorage.removeItem('atelier_curproj');
    await loadAll();toast('Projet supprimé','warn');
  }catch(e){toast(e.message,'err');}
}

/* ====== Tâches ====== */
function openTask(id){
  if(!state.projects.length){alert('Crée d\'abord un projet.');return;}
  openModal('taskModal');
  if(id){
    const t=state.tasks.find(x=>x.id==id)||allTasksCache.find(x=>x.id==id);
    if(!t){closeModal('taskModal');toast('Tâche introuvable, rechargez la page.','err');return;}
    currentEditTaskId=parseInt(id,10);
    $('taskModalTitle').textContent='Modifier la tâche';
    $('f_taskId').value=t.id;$('f_title').value=t.title;$('f_desc').value=t.description||'';
    $('f_assignee').value=t.assignee_id||'';$('f_prio').value=t.priority;
    $('f_start').value=t.start_date||'';$('f_due').value=t.due_date||'';
    $('f_status').value=t.status;$('f_prog').value=t.progress||0;$('f_progVal').textContent=t.progress||0;
    $('f_taskProjectWrap').classList.toggle('hidden',!CAN_PROJECTS);
    if(CAN_PROJECTS) $('f_taskProject').value=t.project_id;
    $('f_estHours').value=t.estimated_hours||'';
    $('f_actHours').value=t.actual_hours||'';
    fillMilestoneSelect();$('f_milestone').value=t.milestone_id||'';
    loadSubtasks(t.id);
    loadTaskTags(t.id);
  }else{
    currentEditTaskId=null;
    $('f_estHours').value='';$('f_actHours').value='';
    currentTaskTags=[];fillMilestoneSelect();fillMilestoneSelect();
    $('taskModalTitle').textContent='Nouvelle tâche';
    $('f_taskId').value='';$('f_title').value='';$('f_desc').value='';
    $('f_assignee').value=CAN_PROJECTS?'':ME.id;
    $('f_prio').value='m';$('f_start').value=today();$('f_due').value='';
    $('f_status').value='todo';$('f_prog').value=0;$('f_progVal').textContent='0';
    $('f_taskProjectWrap').classList.remove('hidden');
    $('f_taskProject').value=state.currentProject||state.projects[0]?.id;
    $('subtasksWrap').classList.add('hidden');
    $('commentsWrap').classList.add('hidden');
  }
}
async function saveTask(){
  const title=$('f_title').value.trim();
  if(!title){alert('Le titre est obligatoire.');return;}
  let prog=parseInt($('f_prog').value,10);if($('f_status').value==='done')prog=100;
  const data={
    title,description:$('f_desc').value.trim(),
    assignee_id: $('f_assignee').value ? parseInt($('f_assignee').value,10) : null,
    priority:$('f_prio').value,
    start_date:$('f_start').value||null,due_date:$('f_due').value||null,
    status:$('f_status').value,progress:prog,
    estimated_hours:$('f_estHours').value?parseFloat($('f_estHours').value):null,
    actual_hours:$('f_actHours').value?parseFloat($('f_actHours').value):null,
    milestone_id:$('f_milestone').value?parseInt($('f_milestone').value):null
  };
  const existId=$('f_taskId').value;
  try{
    let r;
    if(existId){
      if(CAN_PROJECTS) data.project_id=parseInt($('f_taskProject').value,10);
      r=await api('/api/tasks/'+existId,{method:'PUT',body:data});
      toast('Tâche mise à jour');
    }else{
      data.project_id=parseInt($('f_taskProject').value,10);
      r=await api('/api/tasks',{method:'POST',body:data});
      toast('Tâche créée');
    }
    closeModal('taskModal');
    // Si la tâche vient d'être assignée à quelqu'un d'autre → notif + email Outlook
    if(r&&r.assignee_email){
      await loadNotifications();renderNotifBell();
      notifyTaskAssignee(r,data);
    }
    await loadAll();
  }catch(e){toast(e.message,'err');}
}
function notifyTaskAssignee(r,data){
  const first=(r.assignee_name||'').split(' ')[0];
  const appUrl=window.location.origin;
  const due=data.due_date?`\nÉchéance : ${fmtDate(data.due_date)}`:'';
  const subject=`[${document.title}] Tâche assignée : ${data.title}`;
  const body=`Bonjour ${first},\n\n${ME.name} t'a assigné la tâche suivante${r.assigned_project?` sur le projet « ${r.assigned_project} »`:''} :\n\n• ${data.title}${data.description?'\n  '+data.description:''}${due}\n• Priorité : ${PRIO_LABEL[data.priority]||data.priority}\n\nAccède à l'application :\n${appUrl}\n\nMerci,\n${ME.name}`;
  window.location.href='mailto:'+encodeURIComponent(r.assignee_email)+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
}
async function delTask(id){
  if(!confirm('Supprimer cette tâche ?'))return;
  try{await api('/api/tasks/'+id,{method:'DELETE'});await loadAll();toast('Tâche supprimée','warn');}catch(e){toast(e.message,'err');}
}

/* ====== Personnes (utilisateurs) ====== */
function openPerson(id){
  openModal('personModal');
  if(id){
    const u=userById(parseInt(id,10));
    if(!u){closeModal('personModal');toast('Utilisateur introuvable, rechargez la page.','err');return;}
    $('personModalTitle').textContent='Modifier '+u.name;
    $('f_personId').value=u.id;$('f_name').value=u.name;$('f_email').value=u.email;
    $('f_role').value=u.role;$('f_password').value='';
    $('passwordField').querySelector('label').textContent='Nouveau mot de passe (laisser vide pour ne pas changer)';
  }else{
    $('personModalTitle').textContent='Ajouter une personne';
    $('f_personId').value='';$('f_name').value='';$('f_email').value='@alivedx.com';
    $('f_role').value='user';$('f_password').value='';
    $('passwordField').querySelector('label').textContent='Mot de passe (laisser vide pour utiliser 123456 par défaut)';
  }
}
async function savePerson(){
  const name=$('f_name').value.trim(), email=$('f_email').value.trim();
  if(!name||!email){alert('Nom et email obligatoires.');return;}
  const data={name,email,role:$('f_role').value};
  if($('f_password').value)data.password=$('f_password').value;
  try{
    const existId=$('f_personId').value;
    if(existId){await api('/api/users/'+existId,{method:'PUT',body:data});}
    else{
      const r=await api('/api/users',{method:'POST',body:data});
      if(r.initial_password){
        closeModal('personModal');
        $('inv_email').textContent=r.email;
        $('inv_pw').textContent=r.initial_password;
        window._inviteData={name:r.name,email:r.email,password:r.initial_password};
        openModal('inviteModal');
        await loadAll();return;
      }
    }
    closeModal('personModal');await loadAll();toast('Profil mis à jour');
  }catch(e){toast(e.message,'err');}
}
async function delPerson(id){
  if(!confirm('Supprimer cette personne ? Ses tâches seront dé-assignées.'))return;
  try{await api('/api/users/'+id,{method:'DELETE'});await loadAll();}catch(e){alert(e.message);}
}

/* ====== Absences ====== */
function openAbsence(){
  if(state.users.length===0){alert('Aucun utilisateur.');return;}
  openModal('absModal');$('f_aFrom').value=today();$('f_aTo').value=today();
}
async function saveAbsence(){
  const data={user_id:parseInt($('f_aPerson').value,10),kind:$('f_aType').value,
    from_date:$('f_aFrom').value,to_date:$('f_aTo').value};
  if(!data.from_date||!data.to_date){alert('Indique les dates.');return;}
  try{await api('/api/absences',{method:'POST',body:data});closeModal('absModal');await loadAll();}
  catch(e){alert(e.message);}
}
async function delAbsence(id){try{await api('/api/absences/'+id,{method:'DELETE'});await loadAll();}catch(e){alert(e.message);}}

/* ====== Alertes ====== */
async function ackAlert(key){try{await api('/api/alerts/ack',{method:'POST',body:{key}});state.alerts=await api('/api/alerts');renderAll();}catch(e){alert(e.message);}}
async function ackAll(){try{await api('/api/alerts/ack_all',{method:'POST',body:{}});state.alerts=await api('/api/alerts');renderAll();}catch(e){alert(e.message);}}

/* ====== Branding ====== */
async function renameApp(){
  if(!IS_ADMIN)return;
  const cur=$('appName').textContent;
  const n=prompt("Nom de l'application :",cur);
  if(n!==null && n.trim()){
    await api('/api/settings',{method:'PUT',body:{app_name:n.trim()}});
    $('appName').textContent=n.trim();document.title=n.trim();
  }
}
async function changeLogo(e){
  if(!IS_ADMIN)return;
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=async()=>{
    await api('/api/settings',{method:'PUT',body:{app_logo:r.result}});
    $('appLogo').innerHTML='<img src="'+r.result+'" alt="logo">';
  };
  r.readAsDataURL(f);e.target.value='';
}

/* ====== Analyse de document (côté serveur pour extraction, côté navigateur pour analyse) ====== */
async function startDocImport(file){
  if(!state.currentProject){alert('Sélectionne d\'abord un projet.');return;}
  openModal('docModal');
  $('docModalTitle').textContent='Analyse : '+file.name;
  $('docBody').innerHTML='<div class="spinner"></div><p style="text-align:center;color:var(--mut)">Lecture du document…</p>';
  $('docActions').innerHTML='';
  try{
    const fd=new FormData();fd.append('file',file);
    const r=await fetch('/api/parse-document',{method:'POST',body:fd});
    if(!r.ok){const j=await r.json();throw new Error(j.detail||'Erreur');}
    const j=await r.json();
    if(!j.text||!j.text.trim())throw new Error('Aucun texte exploitable trouvé.');
    pendingDocItems = analyzeText(j.text);
    renderDocReview();
  }catch(err){
    $('docBody').innerHTML=`<p style="color:var(--bad)"><strong>Impossible d'analyser ce fichier.</strong></p><p class="meta">${esc(err.message)}</p>`;
    $('docActions').innerHTML='<button class="btn ghost" data-close="docModal">Fermer</button>';
  }
}
function analyzeText(text){
  const items=[];const lines=text.split(/\r?\n/);
  const existing=state.users.map(u=>u.name.toLowerCase());
  const roleWords=/(chef|cheffe|d[ée]veloppeu|designer|manager|responsable|lead|architect|testeur|analyste|consultant|ing[ée]nieu|product owner|scrum|directeu|assistant|stagiaire|graphiste|r[ée]dacteu|commercial)/i;
  lines.forEach(ln=>{const l=ln.trim();if(!l||l.length>90)return;
    const em=l.match(/([a-z0-9._%+-]+)@([a-z0-9.-]+\.[a-z]{2,})/i);
    const m=l.match(/^[-•*\s]*([A-ZÀ-Ü][\wÀ-ÿ'’.-]+(?:\s+[A-ZÀ-Ü][\wÀ-ÿ'’.-]+){1,2})\s*[:\-–—]\s*(.+)$/);
    if(m && roleWords.test(m[2])){
      const nm=m[1].trim(),role=m[2].trim().replace(/\.$/,'');
      if(existing.indexOf(nm.toLowerCase())===-1)items.push({kind:'person',name:nm,role:role.slice(0,60),email:em?em[0]:''});
    }else if(em && roleWords.test(l)){
      const guess=em[1].replace(/[._]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
      if(existing.indexOf(guess.toLowerCase())===-1)items.push({kind:'person',name:guess,role:(l.match(roleWords)||[''])[0],email:em[0]});
    }
  });
  const actionWords=/(cr[ée]er|d[ée]velopper|r[ée]diger|concevoir|tester|corriger|d[ée]ployer|pr[ée]parer|organiser|planifier|valider|r[ée]viser|impl[ée]menter|mettre en place|finaliser|livrer|analyser|maquette|prototype|int[ée]grer|documenter|configurer|installer|optimiser|envoyer|contacter|relancer|suivre|v[ée]rifier)/i;
  const prioHigh=/(urgent|prioritaire|critique|asap|important|haute priorit[ée]|bloquant)/i;
  const prioLow=/(plus tard|optionnel|si possible|basse priorit[ée]|secondaire)/i;
  function findAssignee(l){
    const all=state.users.concat(items.filter(x=>x.kind==='person').map(x=>({id:'NEW:'+x.name,name:x.name})));
    for(const a of all){const first=a.name.split(' ')[0];if(new RegExp('\\b'+first.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','i').test(l))return a;}
    return null;
  }
  function findDue(l){let m=l.match(/(\d{4})-(\d{2})-(\d{2})/);if(m)return m[1]+'-'+m[2]+'-'+m[3];
    m=l.match(/(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?/);
    if(m){const d=('0'+m[1]).slice(-2),mo=('0'+m[2]).slice(-2);const y=m[3]?(m[3].length===2?'20'+m[3]:m[3]):String(new Date().getFullYear());return y+'-'+mo+'-'+d;}
    return '';
  }
  lines.forEach(ln=>{const l=ln.trim();if(l.length<6||l.length>160)return;
    const isBullet=/^[-•*▪◦·]|^\d+[.)]\s/.test(l);const hasAction=actionWords.test(l);const explicit=/^t[âa]che\s*[:\-]/i.test(l);
    if(!(isBullet&&hasAction)&&!explicit&&!(hasAction&&l.length<100))return;
    const title=l.replace(/^[-•*▪◦·\d.)\s]+/,'').replace(/^t[âa]che\s*[:\-–—]\s*/i,'').trim();if(title.length<4)return;
    const as=findAssignee(l);const prio=prioHigh.test(l)?'h':prioLow.test(l)?'l':'m';
    items.push({kind:'task',title:title.slice(0,120),assigneeRef:as?as.id:'',assigneeName:as?as.name:'',priority:prio,due_date:findDue(l)});
  });
  const seen={};return items.filter(it=>{if(it.kind!=='task')return true;const k=it.title.toLowerCase();if(seen[k])return false;seen[k]=1;return true;});
}
function renderDocReview(){
  const tasks=pendingDocItems.filter(i=>i.kind==='task');
  const people=pendingDocItems.filter(i=>i.kind==='person');
  const body=$('docBody');const proj=projById(state.currentProject);
  if(tasks.length===0&&people.length===0){
    body.innerHTML='<p class="meta">Aucune tâche ni personne détectée.</p>';
    $('docActions').innerHTML='<button class="btn ghost" data-close="docModal">Fermer</button>';return;
  }
  let html=`<p class="meta">Tâches ajoutées au projet <strong>${esc(proj.name)}</strong>.${IS_ADMIN?'':' Toutes les tâches importées te seront assignées.'}</p>`;
  if(people.length && IS_ADMIN){
    html+=`<h3 style="font-size:15px;margin:14px 0 8px">Personnes détectées (${people.length})</h3>`;
    people.forEach((p,i)=>{html+=`<label class="review-item"><input type="checkbox" data-pi="P${i}" checked><div class="ri-body"><span class="ri-tag person">Nouvelle personne</span> <strong>${esc(p.name)}</strong>${p.role?' · '+esc(p.role):''}${p.email?`<div class="meta">✉ ${esc(p.email)}</div>`:''}<div class="meta">Un mot de passe sera généré automatiquement.</div></div></label>`;});
  }
  if(tasks.length){
    html+=`<h3 style="font-size:15px;margin:14px 0 8px">Tâches détectées (${tasks.length})</h3>`;
    tasks.forEach((t,i)=>{const pl={h:'Haute',m:'Moyenne',l:'Basse'}[t.priority];
      html+=`<label class="review-item"><input type="checkbox" data-ti="T${i}" checked><div class="ri-body"><span class="ri-tag">Tâche</span> <strong>${esc(t.title)}</strong><div class="meta">Priorité ${pl}${t.assigneeName?' · 👤 '+esc(t.assigneeName):''}${t.due_date?' · 📅 '+fmtDate(t.due_date):''}</div></div></label>`;});
  }
  body.innerHTML=html;
  $('docActions').innerHTML='<button class="btn ghost" data-close="docModal">Annuler</button><button class="btn primary" id="btnApplyDoc">Ajouter la sélection</button>';
  $('btnApplyDoc').addEventListener('click',applyDocImport);
}
async function applyDocImport(){
  const tasks=pendingDocItems.filter(i=>i.kind==='task');
  const people=pendingDocItems.filter(i=>i.kind==='person');
  const nameToId={};
  if(IS_ADMIN){
    for(let i=0;i<people.length;i++){
      const p=people[i],cb=document.querySelector(`[data-pi="P${i}"]`);
      if(cb&&cb.checked){
        try{const r=await api('/api/users',{method:'POST',body:{name:p.name,email:p.email||p.name.toLowerCase().replace(/\s+/g,'.')+'@exemple.fr',role:'user'}});
          nameToId[p.name]=r.id;}catch(e){console.warn('user create skipped:',e.message);}
      }
    }
  }
  let added=0;
  for(let i=0;i<tasks.length;i++){
    const t=tasks[i],cb=document.querySelector(`[data-ti="T${i}"]`);if(!cb||!cb.checked)continue;
    let assignee=null;
    if(IS_ADMIN){
      if(t.assigneeRef && String(t.assigneeRef).startsWith('NEW:'))assignee=nameToId[t.assigneeName]||null;
      else if(t.assigneeRef)assignee=t.assigneeRef;
    }
    try{
      await api('/api/tasks',{method:'POST',body:{project_id:parseInt(state.currentProject,10),title:t.title,description:'(importé du document)',assignee_id:assignee,priority:t.priority,start_date:today(),due_date:t.due_date||null,status:'todo',progress:0}});
      added++;
    }catch(e){console.warn('task create skipped:',e.message);}
  }
  closeModal('docModal');await loadAll();
  alert(added+' tâche(s) ajoutée(s) ✓');
}

/* ====== Export PDF ====== */
function exportPDF(){
  const proj=projById(state.currentProject);if(!proj){alert('Aucun projet.');return;}
  const pp=projectProgress(),health=projectHealth(),ts=projTasks();
  const w=window.open('','_blank');
  const css='body{font-family:Arial,Helvetica,sans-serif;color:#2b2925;margin:34px;}h1{font-size:26px;margin:0 0 4px}h2{font-size:17px;border-bottom:2px solid #e8642f;padding-bottom:4px;margin-top:26px}.sub{color:#888;margin-bottom:18px}.badge{display:inline-block;padding:4px 12px;border-radius:20px;font-weight:bold;color:#fff;background:'+health.color.replace('var(--bad)','#d6383f').replace('var(--warn)','#d98300').replace('var(--ok)','#2e9e5b')+'}.kpis{display:flex;gap:16px;margin:16px 0}.kpi{flex:1;border:1px solid #e2ddd2;border-radius:10px;padding:14px}.kpi .n{font-size:26px;font-weight:bold}.kpi .l{color:#888;font-size:11px;text-transform:uppercase}table{width:100%;border-collapse:collapse;margin-top:10px;font-size:12px}th,td{border:1px solid #e2ddd2;padding:7px 9px;text-align:left}th{background:#f7f4ee}.bar{height:14px;background:#eceae3;border-radius:7px;overflow:hidden}.bar>i{display:block;height:100%;background:#e8642f}.g{border:1px solid #e2ddd2;border-radius:8px;overflow:hidden;margin-top:8px}.grow{display:flex;border-bottom:1px solid #eee;min-height:26px;align-items:center}.glab{flex:0 0 180px;padding:4px 8px;font-size:11px;border-right:1px solid #eee;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.gtrack{position:relative;flex:1;height:26px}.gbar{position:absolute;top:6px;height:14px;border-radius:4px;background:#e8642f}.gbar.done{background:#2e9e5b}.gbar.late{background:#d6383f}.late{color:#d6383f;font-weight:bold}@media print{button{display:none}}';
  const dated=ts.filter(t=>t.start_date&&t.due_date);
  let ganttHTML='<p style="color:#888">Aucune tâche datée.</p>';
  if(dated.length){
    let min=dated[0].start_date,max=dated[0].due_date;
    dated.forEach(t=>{if(t.start_date<min)min=t.start_date;if(t.due_date>max)max=t.due_date;});
    const span=Math.max(1,daysBetween(min,max));
    ganttHTML='<div class="g">'+dated.map(t=>{
      const off=daysBetween(min,t.start_date)/span*100,wd=Math.max(2,daysBetween(t.start_date,t.due_date)/span*100);
      const cls=isLate(t)?'late':(t.status==='done'?'done':'');
      return `<div class="grow"><div class="glab">${esc(t.title)}</div><div class="gtrack"><div class="gbar ${cls}" style="left:${off}%;width:${wd}%"></div></div></div>`;
    }).join('')+`</div><p style="font-size:11px;color:#888">Période : ${fmtDate(min)} → ${fmtDate(max)}</p>`;
  }
  const rows=ts.map(t=>{const late=isLate(t);
    return `<tr><td>${esc(t.title)}</td><td>${esc(userName(t.assignee_id))}</td><td>${PRIO_LABEL[t.priority]}</td><td>${fmtDate(t.start_date)}</td><td class="${late?'late':''}">${fmtDate(t.due_date)}</td><td>${late?'En retard':STATUS_LABEL[t.status]}</td><td>${t.progress||0}%</td></tr>`;
  }).join('');
  const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(proj.name)} — Synthèse</title><style>${css}</style></head><body><h1>${esc(proj.name)}</h1><div class="sub">Synthèse générée le ${fmtDate(today())}</div><p>Santé du projet : <span class="badge">${health.label}</span></p>${proj.description?`<p><strong>Description :</strong> ${esc(proj.description)}</p>`:''}<div class="kpis"><div class="kpi"><div class="n">${pp.pct}%</div><div class="l">Avancement pondéré</div><div class="bar"><i style="width:${pp.pct}%"></i></div></div><div class="kpi"><div class="n">${pp.done}/${pp.total}</div><div class="l">Tâches terminées</div></div><div class="kpi"><div class="n" style="color:${pp.late?'#d6383f':'#2e9e5b'}">${pp.late}</div><div class="l">En retard</div></div></div><h2>Diagramme de Gantt</h2>${ganttHTML}<h2>Détail des tâches</h2><table><thead><tr><th>Tâche</th><th>Responsable</th><th>Priorité</th><th>Début</th><th>Échéance</th><th>Statut</th><th>%</th></tr></thead><tbody>${rows}</tbody></table><p style="margin-top:30px"><button onclick="window.print()" style="padding:10px 18px;font-size:14px;background:#e8642f;color:#fff;border:none;border-radius:8px;cursor:pointer">🖨 Imprimer / Enregistrer en PDF</button></p><script>setTimeout(()=>window.print(),500);<\/script></body></html>`;
  w.document.write(html);w.document.close();
}

/* ====== Filtres avancés (B3) ====== */
function filteredTasks(){
  return projTasks().filter(t=>{
    if(activeFilters.assignee && t.assignee_id!=parseInt(activeFilters.assignee)) return false;
    if(activeFilters.priority && t.priority!==activeFilters.priority) return false;
    if(activeFilters.status && activeFilters.status!=='all' && t.status!==activeFilters.status) return false;
    return true;
  });
}
function renderFilterAssigneeOpts(){
  const sel=$('filterAssignee');if(!sel)return;
  const cur=sel.value;
  sel.innerHTML='<option value="">👤 Tous</option>'+state.users.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('');
  sel.value=cur;
}
function applyFilters(){
  const fa=$('filterAssignee'), fp=$('filterPriority'), fs=$('filterStatus');
  if(fa) activeFilters.assignee=fa.value;
  if(fp) activeFilters.priority=fp.value;
  if(fs) activeFilters.status=fs.value;
  renderTasks();renderKanban();renderList();
}

/* ====== Cloche notifications (A3) ====== */
const NOTIF_IC={doc_assigned:'📄',mention:'💬'};
function fmtAgo(iso){
  if(!iso)return '';
  const diff=(Date.now()-parseTs(iso).getTime())/1000;
  if(diff<60)return "à l'instant";
  if(diff<3600)return Math.floor(diff/60)+' min';
  if(diff<86400)return Math.floor(diff/3600)+' h';
  return Math.floor(diff/86400)+' j';
}
function renderNotifBell(){
  const count=(state.notifUnread||0)+state.alerts.length;
  const badge=$('notifCount');
  if(badge){badge.textContent=count;badge.classList.toggle('hidden',count===0);}
}
async function toggleNotifDropdown(){
  const dd=$('notifDropdown');
  const willOpen=dd.classList.contains('hidden');
  dd.classList.toggle('hidden');
  if(!willOpen)return;
  dd.innerHTML='<div class="notif-empty">Chargement…</div>';
  await loadNotifications();
  renderNotifBell();
  let html='';
  // Notifications personnelles
  if(state.notifications.length){
    html+='<div class="notif-sec">Pour toi</div>';
    html+=state.notifications.slice(0,12).map(n=>`
      <div class="notif-item ${n.read?'':'unread'}" data-notif="${n.id}" data-notif-doc="${n.doc_id||''}" data-notif-task="${n.task_id||''}">
        <div class="notif-title">${NOTIF_IC[n.kind]||'🔔'} ${esc(n.title)}</div>
        <div class="notif-msg">${esc((n.body||'').split('\n')[0])}</div>
        <div class="notif-time">${fmtAgo(n.created_at)}</div>
      </div>`).join('');
  }
  // Alertes projet
  if(state.alerts.length){
    html+='<div class="notif-sec">Alertes projet</div>';
    html+=state.alerts.slice(0,8).map(a=>`
      <div class="notif-item alert ${a.type}" data-ack="${a.key}">
        <div class="notif-title">${esc(a.title)}</div>
        <div class="notif-msg">${esc(a.msg)}</div>
      </div>`).join('');
  }
  if(!html) html='<div class="notif-empty">🎉 Rien à signaler</div>';
  else if(state.notifUnread>0) html='<div class="notif-head"><span>Notifications</span><button class="btn sm ghost" id="notifReadAll">Tout marquer lu</button></div>'+html;
  dd.innerHTML=html;
  // Wiring
  dd.querySelectorAll('[data-ack]').forEach(el=>el.addEventListener('click',()=>{ackAlert(el.dataset.ack);dd.classList.add('hidden');}));
  dd.querySelectorAll('[data-notif]').forEach(el=>el.addEventListener('click',async()=>{
    const id=el.dataset.notif, docId=el.dataset.notifDoc, taskId=el.dataset.notifTask;
    try{await api('/api/notifications/read',{method:'POST',body:{id:parseInt(id,10)}});}catch{}
    dd.classList.add('hidden');
    await loadNotifications();renderNotifBell();
    if(docId){tab('docs');openDocViewer(docId);}
    else if(taskId){openTask(taskId);}
  }));
  const ra=$('notifReadAll');
  if(ra) ra.addEventListener('click',async(e)=>{
    e.stopPropagation();
    try{await api('/api/notifications/read',{method:'POST',body:{}});}catch{}
    await loadNotifications();renderNotifBell();toggleNotifDropdown();toggleNotifDropdown();
  });
}
document.addEventListener('click',e=>{
  if(!e.target.closest('#btnNotif') && !e.target.closest('#notifDropdown'))
    $('notifDropdown')?.classList.add('hidden');
},{capture:true});

/* ====== Modèle de charge intelligent (D2) ======
   Au lieu de compter bêtement les tâches, on estime l'EFFORT RESTANT (heures),
   pondéré par l'urgence (échéance), comparé à la CAPACITÉ DISPONIBLE réelle
   (jours ouvrés à venir moins les absences). */
const CAP_CONFIG = {
  weeklyHours: 40,                 // capacité hebdomadaire par personne (contrat 40h)
  horizonDays: 14,                 // fenêtre "charge imminente" (2 semaines)
  prioHours: { h: 8, m: 4, l: 2 }, // effort par défaut (h) si pas d'estimation
  urgency: { overdue: 1.5, d3: 1.3, d7: 1.15, normal: 1.0 } // multiplicateur de pression
};
const HOURS_PER_DAY = CAP_CONFIG.weeklyHours / 5;

// Effort restant d'une tâche, en heures (utilise l'estimation si dispo, sinon défaut par priorité)
function taskRemainingHours(t){
  if(t.status==='done') return 0;
  let base = (t.estimated_hours && t.estimated_hours>0) ? t.estimated_hours : (CAP_CONFIG.prioHours[t.priority]||4);
  const prog = Math.min(100, Math.max(0, t.progress||0));
  return base * (1 - prog/100);
}
// Multiplicateur d'urgence selon l'échéance
function taskUrgencyWeight(t){
  if(!t.due_date) return CAP_CONFIG.urgency.normal;
  const d = daysBetween(today(), t.due_date);
  if(d<0)  return CAP_CONFIG.urgency.overdue;
  if(d<=3) return CAP_CONFIG.urgency.d3;
  if(d<=7) return CAP_CONFIG.urgency.d7;
  return CAP_CONFIG.urgency.normal;
}
// Heures disponibles d'une personne sur l'horizon (jours ouvrés - absences)
function availableHoursInHorizon(userId){
  let workdays=0;
  const start=new Date();
  for(let i=0;i<CAP_CONFIG.horizonDays;i++){
    const dt=new Date(start.getTime()+i*864e5);
    const dow=dt.getDay();
    if(dow===0||dow===6) continue; // week-end
    const ds=dt.toISOString().slice(0,10);
    const absent=state.absences.some(a=>a.user_id===userId && a.from_date<=ds && a.to_date>=ds);
    if(!absent) workdays++;
  }
  return workdays*HOURS_PER_DAY;
}
// Calcule la charge d'une personne (optionnellement filtrée sur un projet)
function computeUserLoad(userId, projectId){
  let tasks=state.tasks.filter(t=>t.assignee_id===userId && t.status!=='done');
  if(projectId) tasks=tasks.filter(t=>t.project_id==projectId);
  let imminentHours=0, backlogHours=0, lateCount=0;
  tasks.forEach(t=>{
    const rem=taskRemainingHours(t);
    backlogHours+=rem;
    if(isLate(t)) lateCount++;
    if(t.due_date){
      const d=daysBetween(today(), t.due_date);
      if(d<=CAP_CONFIG.horizonDays) imminentHours += rem*taskUrgencyWeight(t);
    }
  });
  const avail=availableHoursInHorizon(userId);
  const pct = avail>0 ? Math.round(imminentHours/avail*100) : (imminentHours>0?200:0);
  return {tasks, imminentHours, backlogHours, avail, pct, lateCount};
}
function loadClass(pct){ return pct>110?'over':pct>=85?'warn':'ok'; }
function loadLabel(pct){
  if(pct>110) return {txt:'Surchargé', col:'var(--bad)'};
  if(pct>=85) return {txt:'Chargé', col:'var(--warn)'};
  if(pct>=45) return {txt:'Optimal', col:'var(--ok)'};
  return {txt:'Disponible', col:'var(--ok)'};
}
function fmtH(h){ return (Math.round(h*10)/10).toString().replace('.0','')+' h'; }

/* ====== Vue Capacité (D2) ====== */
function renderCapacity(){
  const el=$('capacityBoard');if(!el)return;
  if(!state.users.length){el.innerHTML='<div class="empty">Aucun membre.</div>';return;}

  const legend=`<div class="panel" style="padding:12px 14px;margin-bottom:16px;font-size:12px;color:var(--mut)">
    <div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:260px">
        <strong style="color:var(--text)">📊 Charge intelligente</strong> — basée sur l'effort restant (estimation en heures, ou défaut selon priorité : haute 8h, moyenne 4h, basse 2h),
        pondéré par l'urgence des échéances, comparé à la capacité réelle disponible sur ${CAP_CONFIG.horizonDays} jours (jours ouvrés − absences, base ${CAP_CONFIG.weeklyHours}h/sem).
        <div style="margin-top:6px">
          <span style="margin-right:8px"><span class="cal-legend-dot" style="background:var(--ok)"></span> Disponible/Optimal</span>
          <span style="margin-right:8px"><span class="cal-legend-dot" style="background:var(--warn)"></span> Chargé (≥85%)</span>
          <span><span class="cal-legend-dot" style="background:var(--bad)"></span> Surchargé (>110%)</span>
        </div>
      </div>
      ${IS_ADMIN?`<button class="btn sm primary" id="btnAiEstimate" title="Estime automatiquement les tâches sans estimation grâce à l'IA">🤖 Estimer la charge avec l'IA</button>`:''}
    </div>
  </div>`;

  const cards=state.users.map(u=>{
    const L=computeUserLoad(u.id);
    const absent=isAbsentNow(u.id);
    const cls=loadClass(L.pct);
    const lbl=loadLabel(L.pct);
    const barW=Math.min(100, L.pct);

    // Répartition par projet
    const byProj={};
    L.tasks.forEach(t=>{ byProj[t.project_id]=(byProj[t.project_id]||0)+taskRemainingHours(t); });
    const projRows=Object.entries(byProj)
      .sort((a,b)=>b[1]-a[1])
      .map(([pid,hrs])=>{
        const p=projById(pid);
        const share=L.backlogHours>0?Math.round(hrs/L.backlogHours*100):0;
        return `<div style="margin-top:7px">
          <div class="row" style="justify-content:space-between;font-size:12px">
            <span>${esc(p?p.name:'Projet '+pid)}</span>
            <span style="color:var(--mut)">${fmtH(hrs)} · ${share}%</span>
          </div>
          <div class="capacity-bar-wrap" style="height:6px;margin-top:2px"><div class="capacity-bar-fill ok" style="width:${share}%;background:${avaColor(p?p.id:pid)}"></div></div>
        </div>`;
      }).join('');

    return `<div class="capacity-card">
      <div class="capacity-header">
        <div class="ava" style="background:${avaColor(u.id)}">${initials(u.name)}</div>
        <div style="flex:1">
          <div style="font-weight:700;font-size:15px">${esc(u.name)}${absent?'<span class="pill absent" style="margin-left:8px">Absent</span>':''}</div>
          <div style="font-size:12px;color:var(--mut)">${L.tasks.length} tâche(s) · ${L.lateCount?'<span style="color:var(--bad)">'+L.lateCount+' en retard</span>':'<span style="color:var(--ok)">À jour</span>'}</div>
        </div>
        <div style="text-align:right">
          <div style="font-family:'Space Grotesk',sans-serif;font-size:22px;font-weight:700;color:${lbl.col};line-height:1">${L.pct}%</div>
          <div style="font-size:11px;font-weight:700;color:${lbl.col}">${lbl.txt}</div>
        </div>
      </div>
      <div class="capacity-bar-wrap" style="margin-bottom:6px"><div class="capacity-bar-fill ${cls}" style="width:${barW}%"></div></div>
      <div class="row" style="justify-content:space-between;font-size:12px;color:var(--mut)">
        <span>Imminent : <strong style="color:var(--text)">${fmtH(L.imminentHours)}</strong> / ${fmtH(L.avail)} dispo</span>
        <span>Total restant : <strong style="color:var(--text)">${fmtH(L.backlogHours)}</strong></span>
      </div>
      ${projRows?`<div style="margin-top:10px;border-top:1px solid var(--line);padding-top:8px">
        <div style="font-size:11px;font-weight:700;color:var(--mut);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Par projet</div>
        ${projRows}
      </div>`:''}
    </div>`;
  }).join('');

  el.innerHTML=legend+'<div class="grid cards">'+cards+'</div>';
  const aiBtn=$('btnAiEstimate');
  if(aiBtn) aiBtn.addEventListener('click',aiEstimateLoad);
}

async function aiEstimateLoad(){
  const btn=$('btnAiEstimate');
  const nbSansEst=state.tasks.filter(t=>t.status!=='done' && (!t.estimated_hours||t.estimated_hours<=0)).length;
  if(nbSansEst===0){toast('Toutes les tâches actives ont déjà une estimation.','warn');return;}
  if(!confirm(`L'IA va estimer la charge de ${nbSansEst} tâche(s) sans estimation et appliquer le résultat automatiquement. Continuer ?`))return;
  if(btn){btn.disabled=true;btn.textContent='🤖 Analyse en cours…';}
  try{
    const r=await api('/api/ai/estimate-load',{method:'POST',body:{}});
    if(r.updated>0){
      toast(`IA : ${r.updated} tâche(s) estimée(s) — recalcul de la charge…`);
      await loadAll();
      tab('capacity');
    }else{
      toast(r.message||'Aucune tâche à estimer.','warn');
      renderCapacity();
    }
  }catch(e){
    toast(e.message,'err');
    renderCapacity();
  }
}

/* ====== Dashboard Charts (D1) ====== */
function renderDashCharts(){
  if(typeof Chart==='undefined') return;
  const ts=projTasks();
  // Graphique statuts
  const canvStatus=$('chartStatus');
  if(canvStatus){
    if(chartStatus){chartStatus.destroy();}
    const counts={todo:ts.filter(t=>t.status==='todo').length,prog:ts.filter(t=>t.status==='prog').length,done:ts.filter(t=>t.status==='done').length};
    chartStatus=new Chart(canvStatus,{type:'doughnut',data:{labels:['À faire','En cours','Terminé'],datasets:[{data:[counts.todo,counts.prog,counts.done],backgroundColor:['#8a8478','#2f7fd6','#2e9e5b'],borderWidth:0}]},options:{plugins:{legend:{position:'bottom',labels:{boxWidth:12,font:{size:11}}}},cutout:'70%',responsive:true,maintainAspectRatio:false}});
  }
  // Graphique charge par personne — modèle intelligent (heures imminentes vs capacité dispo)
  const canvAssign=$('chartAssignee');
  if(canvAssign && state.users.length){
    if(chartAssignee){chartAssignee.destroy();}
    const labels=state.users.map(u=>u.name.split(' ')[0]);
    const loads=state.users.map(u=>computeUserLoad(u.id));
    const dataImminent=loads.map(L=>Math.round(L.imminentHours*10)/10);
    const dataAvail=loads.map(L=>Math.round(L.avail*10)/10);
    // Couleur de la barre charge selon surcharge
    const colorsImminent=loads.map(L=>L.pct>110?'rgba(214,56,63,.8)':L.pct>=85?'rgba(243,167,18,.85)':'rgba(46,158,91,.8)');
    chartAssignee=new Chart(canvAssign,{type:'bar',data:{labels,datasets:[
      {label:'Charge imminente (h)',data:dataImminent,backgroundColor:colorsImminent,borderRadius:4},
      {label:'Capacité dispo (h)',data:dataAvail,backgroundColor:'rgba(138,132,120,.25)',borderRadius:4}
    ]},options:{plugins:{legend:{position:'bottom',labels:{boxWidth:12,font:{size:11}}},tooltip:{callbacks:{afterBody:(items)=>{const i=items[0].dataIndex;return 'Charge : '+loads[i].pct+'%';}}}},scales:{y:{beginAtZero:true,title:{display:true,text:'heures'}}},responsive:true,maintainAspectRatio:false}});
  }
}

/* ====== Tags (B1) ====== */
async function loadProjectTags(){
  if(!state.currentProject) return;
  try{projectTags=await api('/api/projects/'+state.currentProject+'/tags');}catch{projectTags=[];}
  try{projectMilestones=await api('/api/projects/'+state.currentProject+'/milestones');}catch{projectMilestones=[];}
}
async function loadTaskTags(taskId){
  try{currentTaskTags=await api('/api/tasks/'+taskId+'/tags');}catch{currentTaskTags=[];}
  renderTaskTagsUI();
}
function renderTaskTagsUI(){
  const el=$('taskTagsDisplay');if(!el)return;
  el.innerHTML=currentTaskTags.map(t=>`<span class="tag-pill" style="background:${t.color}" data-remove-tag="${t.id}">${esc(t.name)} <span class="tag-x">✕</span></span>`).join('');
  el.querySelectorAll('[data-remove-tag]').forEach(pill=>pill.addEventListener('click',async()=>{
    if(!currentEditTaskId)return;
    await api('/api/tasks/'+currentEditTaskId+'/tags/'+pill.dataset.removeTag,{method:'DELETE'});
    currentTaskTags=currentTaskTags.filter(t=>t.id!=pill.dataset.removeTag);
    renderTaskTagsUI();
  }));
  const sel=$('f_tagAdd');if(!sel)return;
  const usedIds=new Set(currentTaskTags.map(t=>t.id));
  sel.innerHTML='<option value="">+ Ajouter une étiquette</option>'+projectTags.filter(t=>!usedIds.has(t.id)).map(t=>`<option value="${t.id}" style="color:${t.color}">${t.name}</option>`).join('');
}
function fillMilestoneSelect(){
  const sel=$('f_milestone');if(!sel)return;
  sel.innerHTML='<option value="">— Aucun —</option>'+projectMilestones.map(m=>`<option value="${m.id}">${esc(m.name)}${m.due_date?' ('+fmtDate(m.due_date)+')':''}</option>`).join('');
}

/* ====== Audit ====== */
async function renderAudit(){
  const el=$('auditBody');if(!el)return;
  try{
    const logs=await api('/api/audit?limit=200');
    const cnt=$('auditCount');if(cnt)cnt.textContent=logs.length+' entrées';
    const ACTION_IC={'Connexion':'🔑','Création tâche':'➕','Modification tâche':'✏️','Suppression tâche':'🗑️',
      'Création utilisateur':'👤','Modification utilisateur':'✏️','Suppression utilisateur':'🗑️',
      'Création projet':'📁','Modification projet':'✏️','Suppression projet':'🗑️'};
    el.innerHTML=logs.map(l=>{
      const d=new Date(l.created_at);
      const dt=fmtDateTime(l.created_at);
      const ic=ACTION_IC[l.action]||'•';
      return `<tr style="border-bottom:1px solid var(--line)">
        <td style="padding:8px 14px;white-space:nowrap;color:var(--mut);font-size:12px">${dt}</td>
        <td style="padding:8px 14px;font-weight:600">${esc(l.user_name)}</td>
        <td style="padding:8px 14px">${ic} ${esc(l.action)}</td>
        <td style="padding:8px 14px;color:var(--mut);font-size:12px">${esc(l.details)}</td>
      </tr>`;
    }).join('');
  }catch(e){if($('auditBody'))$('auditBody').innerHTML='<tr><td colspan="4" class="empty">Erreur chargement</td></tr>';}
}

/* ====== Mon espace (tableau de bord personnel) ====== */
async function renderMe(){
  const el=$('meContent');if(!el)return;
  el.innerHTML='<div class="empty">Chargement…</div>';
  let allTasks=[],allDocs=[],prefs={};
  try{[allTasks,allDocs,prefs]=await Promise.all([api('/api/tasks'),api('/api/documents'),api('/api/me/prefs')]);}
  catch(e){el.innerHTML='<div class="empty">Erreur : '+esc(e.message)+'</div>';return;}
  allTasksCache=allTasks;
  mePrefs=prefs||{};

  const myTasks=allTasks.filter(t=>t.assignee_id===ME.id&&t.status!=='done');
  const myLate=myTasks.filter(isLate);
  const mySoon=myTasks.filter(t=>!isLate(t)&&t.due_date&&daysBetween(today(),t.due_date)>=0&&daysBetween(today(),t.due_date)<=7);
  const myDocs=allDocs.filter(d=>d.assigned_to===ME.id);

  // Tri par urgence : retard → échéance proche → reste
  const urgency=t=>{ if(isLate(t))return 0; if(t.due_date){const d=daysBetween(today(),t.due_date); if(d>=0&&d<=7)return 1+d/100;} return 5; };
  const sorted=myTasks.slice().sort((a,b)=>{const ua=urgency(a),ub=urgency(b);if(ua!==ub)return ua-ub;return (a.due_date||'9999')<(b.due_date||'9999')?-1:1;});

  const hour=new Date().getHours();
  const greet=hour<18?'Bonjour':'Bonsoir';
  const dateStr=new Date().toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'});
  let summary;
  if(myTasks.length===0&&myDocs.length===0) summary='Rien d\'assigné pour le moment. Profite ! 🎉';
  else summary=`Tu as <strong>${myTasks.length}</strong> tâche(s) active(s)${myLate.length?` dont <strong style="color:var(--bad)">${myLate.length} en retard</strong>`:''} · <strong>${myDocs.length}</strong> document(s) chez toi.`;

  const hero=`<div class="me-hero">
    <div class="me-hero-txt">
      <h2>${greet} ${esc(ME.name.split(' ')[0])} 👋</h2>
      <div class="me-date">${dateStr}</div>
      <div class="me-summary">${summary}</div>
    </div>
    <div class="me-ava" style="background:${avaColor(ME.id)}">${initials(ME.name)}</div>
  </div>`;

  const kpis=`<div class="kpi-hero">
    ${kpiCard('✓','Mes tâches actives',myTasks.length,'','info')}
    ${kpiCard('⏰','En retard',myLate.length,'',myLate.length>0?'bad':'ok')}
    ${kpiCard('📅','Échéances à 7 j',mySoon.length,'',mySoon.length>0?'warn':'ok')}
    ${kpiCard('📄','Documents chez moi',myDocs.length,'','teal')}
  </div>`;

  // Liste de mes tâches
  const taskRows=sorted.map(t=>{
    const p=projById(t.project_id);
    const late=isLate(t);
    const d=t.due_date?daysBetween(today(),t.due_date):null;
    const soon=!late&&d!==null&&d>=0&&d<=7;
    const dueCls=late?'late':soon?'soon':'';
    const dueTxt=t.due_date?(late?`En retard (${Math.abs(d)}j)`:fmtDate(t.due_date)):'—';
    const prioCol=t.priority==='h'?'var(--bad)':t.priority==='m'?'var(--warn)':'var(--info)';
    return `<div class="me-row" data-edit-task="${t.id}">
      <span class="me-prio" style="background:${prioCol}" title="${PRIO_LABEL[t.priority]}"></span>
      <div style="flex:1;min-width:0">
        <div class="me-row-title">${esc(t.title)}</div>
        <div class="meta" style="font-size:11.5px">${p?esc(p.name)+' · ':''}${STATUS_LABEL[t.status]}${t.progress?` · ${t.progress}%`:''}</div>
      </div>
      <span class="me-due ${dueCls}">📅 ${dueTxt}</span>
    </div>`;
  }).join('')||'<div class="empty">Aucune tâche assignée 🎉</div>';

  // Liste de mes documents
  const docRows=myDocs.map(d=>{
    const ph=DOC_PHASE_BY_KEY[d.phase||'redaction']||{ic:'•',label:d.phase,color:'var(--mut)'};
    const p=d.project_id?projById(d.project_id):null;
    return `<div class="me-row" data-open-doc="${d.id}">
      <span class="me-prio" style="background:${ph.color}"></span>
      <div style="flex:1;min-width:0">
        <div class="me-row-title">📄 ${esc(d.name)}</div>
        <div class="meta" style="font-size:11.5px">${p?esc(p.name)+' · ':'Service · '}v${d.last_version}</div>
      </div>
      <span class="pill" style="background:${ph.color};color:#fff;font-size:10px">${ph.ic} ${ph.label}</span>
    </div>`;
  }).join('')||'<div class="empty">Aucun document chez toi</div>';

  // Mes projets : ceux dont je suis chef de projet, créateur, ou où j'ai des tâches
  const projStats=state.projects.map(p=>{
    const pts=allTasks.filter(t=>t.project_id==p.id);
    const mine=pts.filter(t=>t.assignee_id===ME.id);
    const done=pts.filter(t=>t.status==='done').length;
    return {p, total:pts.length, mineActive:mine.filter(t=>t.status!=='done').length,
            pc:pts.length?Math.round(done/pts.length*100):0,
            isLead:p.lead_id===ME.id, isCreator:p.created_by===ME.id, mineCount:mine.length};
  }).filter(x=>x.isLead||x.isCreator||x.mineCount>0)
    .sort((a,b)=>(b.isLead?1:0)-(a.isLead?1:0));
  const projRows=projStats.map(x=>`<div class="me-row" data-open-project="${x.p.id}">
      <span class="me-prio" style="background:${x.isLead?'var(--acc)':'var(--info)'}"></span>
      <div style="flex:1;min-width:0">
        <div class="me-row-title">📁 ${esc(x.p.name)} ${x.isLead?'<span class="proj-lead-chip mine" style="margin-left:4px">Chef de projet</span>':''}</div>
        <div class="meta" style="font-size:11.5px">${x.pc}% · ${x.mineActive} tâche(s) active(s) pour toi · ${x.total} au total</div>
        <div class="progress" style="margin-top:4px"><i style="width:${x.pc}%"></i></div>
      </div>
    </div>`).join('')||'<div class="empty">Aucun projet pour toi.'+(CAN_PROJECTS?' Crée-en un via « + Nouveau ».':'')+'</div>';

  el.innerHTML=hero+kpis+meWidgetsHtml()+`<div class="kpi-grid2" style="margin-top:18px">
    <div class="panel"><div class="sec-h" style="margin-bottom:8px"><h2 style="font-size:15px">📁 Mes projets (${projStats.length})</h2></div>
      <div style="max-height:420px;overflow:auto">${projRows}</div></div>
    <div class="panel"><div class="sec-h" style="margin-bottom:8px"><h2 style="font-size:15px">✓ Mes tâches (${myTasks.length})</h2></div>
      <div style="max-height:420px;overflow:auto">${taskRows}</div></div>
    <div class="panel"><div class="sec-h" style="margin-bottom:8px"><h2 style="font-size:15px">📄 Mes documents (${myDocs.length})</h2></div>
      <div style="max-height:420px;overflow:auto">${docRows}</div></div>
  </div>`;

  el.querySelectorAll('[data-open-project]').forEach(row=>row.addEventListener('click',()=>{
    const pid=row.dataset.openProject;
    $('projSelect').value=pid;$('projSelect').dispatchEvent(new Event('change'));
    tab('dash');
  }));
  wireMeWidgets();
  el.querySelectorAll('[data-countup]').forEach(node=>{
    const target=parseFloat(node.dataset.countup)||0;const start=performance.now();const dur=750;
    function step(now){const pr=Math.min(1,(now-start)/dur);node.textContent=Math.round(target*(1-Math.pow(1-pr,3)));if(pr<1)requestAnimationFrame(step);}
    requestAnimationFrame(step);
  });
}

/* ====== Widgets personnalisables de Mon espace ====== */
const ME_WIDGET_DEFS={
  clock:{ic:'🕐',label:'Horloge'},
  note:{ic:'📝',label:'Note'},
  memo:{ic:'✅',label:'Mémo perso'},
  quickactions:{ic:'⚡',label:'Actions rapides'},
  absents:{ic:'🌴',label:'Absents aujourd’hui'},
  countdown:{ic:'⏳',label:'Compte à rebours'},
  quote:{ic:'💡',label:'Inspiration'},
};
const ME_QUOTES=['La qualité n’est jamais un accident ; c’est le résultat d’un effort intelligent.',
  'Ce qui se mesure s’améliore.','Un objectif sans plan n’est qu’un souhait.',
  'Le mieux est l’ami du bien — avance par petites étapes.','La discipline est le pont entre les objectifs et les réalisations.',
  'Fais-le bien du premier coup : c’est le moins cher.'];
let _meClock=null;
let mePrefs={};            // préférences perso synchronisées (widgets, note, mémo…)
let _mePrefsTimer=null;
function saveMePrefs(){
  clearTimeout(_mePrefsTimer);
  _mePrefsTimer=setTimeout(()=>{api('/api/me/prefs',{method:'PUT',body:mePrefs}).catch(()=>{});},600);
}
function getMeWidgets(){return Array.isArray(mePrefs.widgets)?mePrefs.widgets.filter(k=>ME_WIDGET_DEFS[k]):['clock','note','quickactions'];}
function setMeWidgets(arr){mePrefs.widgets=arr;saveMePrefs();}
function meWidgetsHtml(){
  const active=getMeWidgets();
  const cards=active.map(meWidgetCard).join('');
  const avail=Object.keys(ME_WIDGET_DEFS).filter(k=>!active.includes(k));
  const addBtn=avail.length?`<button class="btn sm" id="meAddWidget">+ Ajouter un widget</button>`:'';
  return `<div class="sec-h" style="margin:6px 0 10px;position:relative">
      <h2 style="font-size:16px">🧩 Mes widgets</h2>${addBtn}
      <div id="meWidgetMenu" class="me-widget-menu hidden"></div>
    </div>
    <div class="me-widgets">${cards||'<div class="empty">Aucun widget — clique « + Ajouter un widget ».</div>'}</div>`;
}
function meWidgetCard(k){
  const def=ME_WIDGET_DEFS[k];if(!def)return '';
  return `<div class="me-widget" data-widget="${k}">
    <div class="me-widget-head"><span>${def.ic} ${def.label}</span><button class="x" data-rm-widget="${k}" title="Retirer">✕</button></div>
    <div class="me-widget-body">${meWidgetBody(k)}</div>
  </div>`;
}
function meWidgetBody(k){
  if(k==='clock') return `<div class="mw-clock" id="mwClock">—</div>`;
  if(k==='note') return `<textarea class="mw-note" id="mwNote" placeholder="Tes notes perso…">${esc(mePrefs.note||'')}</textarea>`;
  if(k==='memo'){const items=meMemoGet();return `<div class="mw-memo-list" id="mwMemoList">${meMemoRows(items)}</div>
    <div class="row" style="gap:5px;margin-top:6px"><input id="mwMemoInput" class="mw-memo-input" placeholder="Ajouter…"><button class="btn sm" id="mwMemoAdd">+</button></div>`;}
  if(k==='quickactions') return `<div class="mw-actions">
    <button class="btn sm" id="mwActTask">➕ Nouvelle tâche</button>
    <button class="btn sm" id="mwActDoc">📄 Nouveau document</button>
    <button class="btn sm ghost" id="mwActSearch">🔍 Rechercher</button></div>`;
  if(k==='absents'){
    const list=state.users.filter(u=>isAbsentNow(u.id));
    return list.length?list.map(u=>{const a=state.absences.find(x=>x.user_id===u.id&&x.from_date<=today()&&x.to_date>=today());
      return `<div class="mw-abs-row"><span class="ava" style="width:22px;height:22px;font-size:9px;background:${avaColor(u.id)}">${initials(u.name)}</span><span>${esc(u.name)}</span><span class="meta" style="margin-left:auto;font-size:11px">${a?esc(a.kind):''}</span></div>`;}).join('')
      :'<div class="meta" style="font-size:13px">Personne absente aujourd’hui 🎉</div>';
  }
  if(k==='countdown'){const tgt=mePrefs.countdown||'';
    return `<input type="date" id="mwCdDate" value="${tgt}" class="mw-cd-date"><div class="mw-cd-out" id="mwCdOut"></div>`;}
  if(k==='quote'){const q=ME_QUOTES[Math.floor(Math.random()*ME_QUOTES.length)];return `<div class="mw-quote">« ${esc(q)} »</div>`;}
  return '';
}
function meMemoGet(){return Array.isArray(mePrefs.memo)?mePrefs.memo:[];}
function meMemoSet(v){mePrefs.memo=v;saveMePrefs();}
function meMemoRows(items){return items.length?items.map((it,i)=>`<label class="mw-memo-item${it.done?' done':''}"><input type="checkbox" data-memo-i="${i}" ${it.done?'checked':''}><span>${esc(it.t)}</span><button class="x" data-memo-del="${i}">✕</button></label>`).join(''):'<div class="meta" style="font-size:12px">Aucune tâche perso.</div>';}
function wireMeWidgets(){
  // Ajouter / retirer
  const addBtn=$('meAddWidget');
  if(addBtn) addBtn.addEventListener('click',e=>{
    e.stopPropagation();
    const menu=$('meWidgetMenu');
    const active=getMeWidgets();
    const avail=Object.keys(ME_WIDGET_DEFS).filter(k=>!active.includes(k));
    menu.innerHTML=avail.map(k=>`<div class="me-widget-opt" data-add-widget="${k}">${ME_WIDGET_DEFS[k].ic} ${ME_WIDGET_DEFS[k].label}</div>`).join('');
    menu.classList.toggle('hidden');
    menu.querySelectorAll('[data-add-widget]').forEach(o=>o.addEventListener('click',()=>{
      const arr=getMeWidgets();arr.push(o.dataset.addWidget);setMeWidgets(arr);renderMe();
    }));
  });
  document.querySelectorAll('[data-rm-widget]').forEach(b=>b.addEventListener('click',()=>{
    setMeWidgets(getMeWidgets().filter(k=>k!==b.dataset.rmWidget));renderMe();
  }));
  // Horloge
  if(_meClock){clearInterval(_meClock);_meClock=null;}
  if($('mwClock')){
    const upd=()=>{const el=$('mwClock');if(!el){clearInterval(_meClock);return;}const n=new Date();
      el.innerHTML=`<div class="mw-time">${n.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})}</div><div class="mw-date">${n.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'})}</div>`;};
    upd();_meClock=setInterval(upd,1000);
  }
  // Note
  const note=$('mwNote');
  if(note) note.addEventListener('input',()=>{mePrefs.note=note.value;saveMePrefs();});
  // Mémo
  const memoAdd=$('mwMemoAdd'), memoInp=$('mwMemoInput');
  function refreshMemo(){const l=$('mwMemoList');if(l)l.innerHTML=meMemoRows(meMemoGet());wireMemo();}
  function wireMemo(){
    document.querySelectorAll('[data-memo-i]').forEach(cb=>cb.addEventListener('change',function(){const v=meMemoGet();if(v[this.dataset.memoI]){v[this.dataset.memoI].done=this.checked;meMemoSet(v);refreshMemo();}}));
    document.querySelectorAll('[data-memo-del]').forEach(b=>b.addEventListener('click',function(){const v=meMemoGet();v.splice(this.dataset.memoDel,1);meMemoSet(v);refreshMemo();}));
  }
  if(memoAdd&&memoInp){
    const add=()=>{const t=memoInp.value.trim();if(!t)return;const v=meMemoGet();v.push({t,done:false});meMemoSet(v);memoInp.value='';refreshMemo();};
    memoAdd.addEventListener('click',add);
    memoInp.addEventListener('keydown',e=>{if(e.key==='Enter')add();});
    wireMemo();
  }
  // Actions rapides
  if($('mwActTask')) $('mwActTask').addEventListener('click',()=>openTask());
  if($('mwActDoc')) $('mwActDoc').addEventListener('click',()=>{tab('docs');openDocCreate();});
  if($('mwActSearch')) $('mwActSearch').addEventListener('click',openSearch);
  // Compte à rebours
  const cd=$('mwCdDate');
  if(cd){
    const out=$('mwCdOut');
    const upd=()=>{const v=cd.value;if(!v){out.innerHTML='<span class="meta" style="font-size:12px">Choisis une date cible</span>';return;}
      const dd=daysBetween(today(),v);
      out.innerHTML=dd>0?`<div class="mw-cd-num">${dd}</div><div class="meta">jour(s) restant(s)</div>`
        :dd===0?'<div class="mw-cd-num" style="color:var(--warn)">Aujourd’hui !</div>'
        :`<div class="mw-cd-num" style="color:var(--bad)">${Math.abs(dd)}</div><div class="meta">jour(s) de retard</div>`;};
    cd.addEventListener('change',()=>{mePrefs.countdown=cd.value;saveMePrefs();upd();});
    upd();
  }
}
// Ferme le menu d'ajout de widget au clic extérieur
document.addEventListener('click',e=>{const m=$('meWidgetMenu');if(m&&!m.classList.contains('hidden')&&!e.target.closest('#meWidgetMenu')&&e.target.id!=='meAddWidget')m.classList.add('hidden');});

/* ====== KPI de service (cockpit transverse) ====== */
function kpiCard(ic,label,value,suffix,variant,raw){
  const inner = raw!==undefined ? raw : `<span data-countup="${value}">0</span>${suffix||''}`;
  return `<div class="kpi-card ${variant||''}">
    <div class="kpi-ic">${ic}</div>
    <div class="kpi-val">${inner}</div>
    <div class="kpi-lbl">${label}</div>
  </div>`;
}
async function renderKPI(){
  const el=$('kpiContent');if(!el)return;
  el.innerHTML='<div class="empty">Chargement…</div>';
  let allTasks=[],allDocs=[];
  try{[allTasks,allDocs]=await Promise.all([api('/api/tasks'),api('/api/documents')]);}
  catch(e){el.innerHTML='<div class="empty">Erreur : '+esc(e.message)+'</div>';return;}
  allTasksCache=allTasks;

  // --- Calculs ---
  const total=allTasks.length;
  const done=allTasks.filter(t=>t.status==='done').length;
  const prog=allTasks.filter(t=>t.status==='prog').length;
  const completion=total?Math.round(done/total*100):0;
  const late=allTasks.filter(isLate).length;
  const dueWeek=allTasks.filter(t=>t.status!=='done'&&t.due_date&&daysBetween(today(),t.due_date)>=0&&daysBetween(today(),t.due_date)<=7).length;

  // Charge par membre (modèle intelligent, tous projets)
  const loads=state.users.map(u=>{
    const tks=allTasks.filter(t=>t.assignee_id===u.id&&t.status!=='done');
    let imminent=0,backlog=0;
    tks.forEach(t=>{const rem=taskRemainingHours(t);backlog+=rem;if(t.due_date){const dd=daysBetween(today(),t.due_date);if(dd<=CAP_CONFIG.horizonDays)imminent+=rem*taskUrgencyWeight(t);}});
    const avail=availableHoursInHorizon(u.id);
    const pct=avail>0?Math.round(imminent/avail*100):(imminent>0?200:0);
    return {u,pct,backlog};
  });
  const avgLoad=loads.length?Math.round(loads.reduce((s,l)=>s+l.pct,0)/loads.length):0;
  const overloaded=loads.filter(l=>l.pct>110).length;
  const availMembers=state.users.filter(u=>!isAbsentNow(u.id)).length;

  // Documents par phase
  const phaseCounts={};DOC_PHASES.forEach(p=>phaseCounts[p.key]=0);
  allDocs.forEach(d=>{const ph=d.phase||'redaction';phaseCounts[ph]=(phaseCounts[ph]||0)+1;});
  const readyQMS=phaseCounts['pret_qms']||0;
  const awaitingReview=(phaseCounts['revue_qa']||0)+(phaseCounts['approbation']||0);
  const slaBreaches=allDocs.filter(d=>d.sla_over).length;

  // Projets à risque (au moins une tâche en retard)
  const projRisk=state.projects.filter(p=>allTasks.some(t=>t.project_id==p.id&&isLate(t))).length;
  const alerts=(state.alerts||[]).length;

  // --- Cartes héro ---
  const loadVar=avgLoad>110?'bad':avgLoad>=85?'warn':'ok';
  const hero=`<div class="kpi-hero">
    ${kpiCard('📁','Projets actifs',state.projects.length,'','info')}
    ${kpiCard('✅','Complétion globale',completion,'%','ok')}
    ${kpiCard('⏰','Tâches en retard',late,'',late>0?'bad':'ok')}
    ${kpiCard('🔄','Tâches en cours',prog,'','info')}
    ${kpiCard('📅','Échéances à 7 jours',dueWeek,'',dueWeek>0?'warn':'ok')}
    ${kpiCard('💪','Charge équipe moy.',avgLoad,'%',loadVar)}
    ${kpiCard('🟢','Membres dispo. auj.','','','ok',`${availMembers}<span style="font-size:18px;color:var(--mut)">/${state.users.length}</span>`)}
    ${kpiCard('🚀','Docs prêts QMS',readyQMS,'','teal')}
    ${kpiCard('🔬','Docs en revue QA',awaitingReview,'',awaitingReview>0?'warn':'ok')}
    ${kpiCard('⏱','Docs hors délai SLA',slaBreaches,'',slaBreaches>0?'bad':'ok')}
    ${kpiCard('⚠️','Projets à risque',projRisk,'',projRisk>0?'bad':'ok')}
  </div>`;

  // --- Avancement par projet ---
  const projRows=state.projects.map(p=>{
    const pts=allTasks.filter(t=>t.project_id==p.id);
    const dn=pts.filter(t=>t.status==='done').length;
    const pc=pts.length?Math.round(dn/pts.length*100):0;
    const lt=pts.filter(isLate).length;
    return `<div style="margin-bottom:11px">
      <div class="row" style="justify-content:space-between;font-size:13px;margin-bottom:3px">
        <strong>${esc(p.name)}</strong>
        <span class="meta">${pc}% · ${dn}/${pts.length}${lt?` · <span style="color:var(--bad)">${lt} en retard</span>`:''}</span>
      </div>
      <div class="progress"><i style="width:${pc}%"></i></div>
    </div>`;
  }).join('')||'<div class="empty">Aucun projet</div>';

  // --- Workflow documentaire (barres par phase) ---
  const maxPhase=Math.max(1,...DOC_PHASES.map(p=>phaseCounts[p.key]||0));
  const wfRows=DOC_PHASES.map(p=>{
    const n=phaseCounts[p.key]||0;
    return `<div style="margin-bottom:9px">
      <div class="row" style="justify-content:space-between;font-size:12.5px;margin-bottom:3px">
        <span>${p.ic} ${p.label}</span><strong>${n}</strong>
      </div>
      <div class="capacity-bar-wrap" style="height:8px"><div class="capacity-bar-fill ok" style="width:${Math.round(n/maxPhase*100)}%;background:${p.color}"></div></div>
    </div>`;
  }).join('');

  // --- Charge par membre (top chargés) ---
  const loadRows=loads.slice().sort((a,b)=>b.pct-a.pct).slice(0,8).map(l=>{
    const cls=loadClass(l.pct);const col=l.pct>110?'var(--bad)':l.pct>=85?'var(--warn)':'var(--ok)';
    return `<div style="margin-bottom:9px">
      <div class="row" style="justify-content:space-between;font-size:12.5px;margin-bottom:3px">
        <span class="row" style="gap:6px"><span class="ava" style="width:20px;height:20px;font-size:9px;background:${avaColor(l.u.id)}">${initials(l.u.name)}</span>${esc(l.u.name)}</span>
        <strong style="color:${col}">${l.pct}%</strong>
      </div>
      <div class="capacity-bar-wrap" style="height:7px"><div class="capacity-bar-fill ${cls}" style="width:${Math.min(100,l.pct)}%"></div></div>
    </div>`;
  }).join('')||'<div class="empty">Aucun membre</div>';

  // --- Échéances à venir (7j, tous projets) ---
  const soon=allTasks.filter(t=>t.status!=='done'&&t.due_date&&daysBetween(today(),t.due_date)>=0&&daysBetween(today(),t.due_date)<=7)
    .sort((a,b)=>a.due_date<b.due_date?-1:1).slice(0,8);
  const soonRows=soon.map(t=>{
    const p=projById(t.project_id);
    return `<div class="row" style="justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--line);font-size:12.5px">
      <span data-edit-task="${t.id}" style="cursor:pointer;font-weight:600">${esc(t.title)}</span>
      <span class="meta" style="white-space:nowrap">${p?esc(p.name)+' · ':''}${fmtDate(t.due_date)}</span>
    </div>`;
  }).join('')||'<div class="empty">Aucune échéance dans les 7 jours 🎉</div>';

  el.innerHTML=hero+`<div class="kpi-grid2">
    <div class="panel"><div class="sec-h" style="margin-bottom:10px"><h2 style="font-size:15px">📊 Avancement par projet</h2></div>${projRows}</div>
    <div class="panel"><div class="sec-h" style="margin-bottom:10px"><h2 style="font-size:15px">🗂 Workflow documentaire</h2></div>${wfRows}</div>
    <div class="panel"><div class="sec-h" style="margin-bottom:10px"><h2 style="font-size:15px">💪 Charge par membre</h2></div>${loadRows}</div>
    <div class="panel"><div class="sec-h" style="margin-bottom:10px"><h2 style="font-size:15px">📅 Échéances à venir (7 j)</h2></div>${soonRows}</div>
  </div>`;

  // Animation count-up
  el.querySelectorAll('[data-countup]').forEach(node=>{
    const target=parseFloat(node.dataset.countup)||0;const start=performance.now();const dur=850;
    function step(now){const pr=Math.min(1,(now-start)/dur);node.textContent=Math.round(target*(1-Math.pow(1-pr,3)));if(pr<1)requestAnimationFrame(step);}
    requestAnimationFrame(step);
  });
}

/* ====== Documents qualité ====== */
const DOC_STATUS_LABEL={draft:'Brouillon',review:'En revue',approved:'Approuvé'};
const DOC_STATUS_COLOR={draft:'#8a8478',review:'var(--warn)',approved:'var(--ok)'};
// Workflow documentaire (style Veeva) — phases ordonnées
const DOC_PHASES=[
  {key:'redaction',    label:'Rédaction',     ic:'✍️', color:'#8a8478'},
  {key:'revue_equipe', label:'Revue équipe',  ic:'👥', color:'#2f7fd6'},
  {key:'revue_qa',     label:'Revue QA',      ic:'🔬', color:'#9b59b6'},
  {key:'approbation',  label:'Approbation',   ic:'✅', color:'#f3a712'},
  {key:'pret_qms',     label:'Prêt pour QMS', ic:'🚀', color:'#2e9e5b'},
];
const DOC_PHASE_BY_KEY=Object.fromEntries(DOC_PHASES.map(p=>[p.key,p]));
const DOC_TYPES={SOP:'SOP',PROTO:'Protocole',REPORT:'Rapport',FORM:'Formulaire',IT:'Instruction',DOC:'Document'};
const DOC_SIGN_PHASES=['approbation','pret_qms'];
function docPhaseIndex(k){return DOC_PHASES.findIndex(p=>p.key===k);}
let currentDocId=null, currentDocObj=null, docProjectFilter='', docViewMode='folders';
let _docComments=[], _placingComment=false;

function fmtBytes(n){
  if(!n) return '0 o';
  if(n<1024) return n+' o';
  if(n<1048576) return (n/1024).toFixed(0)+' Ko';
  return (n/1048576).toFixed(1)+' Mo';
}
// Interprète un horodatage serveur (UTC naïf) et le convertit dans le fuseau local du navigateur
function parseTs(iso){
  if(!iso) return null;
  const s=(iso.endsWith('Z')||/[+-]\d\d:?\d\d$/.test(iso))?iso:iso+'Z';
  return new Date(s);
}
function fmtDateTime(iso){
  if(!iso) return '—';
  return parseTs(iso).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
}

async function renderDocs(){
  const el=$('docsList');if(!el)return;
  el.className='';  // on n'utilise pas la grille ici, mais un pipeline horizontal
  el.innerHTML='<div class="empty">Chargement…</div>';
  let docs;
  try{docs=await api('/api/documents');}
  catch(e){el.innerHTML='<div class="empty">Erreur : '+esc(e.message)+'</div>';return;}
  state.documents=docs;

  // Barre d'outils : filtre projet + bascule de vue (Répertoires / Workflow)
  const projOpts=['<option value="">Tous les documents</option>',
    '<option value="service">📁 Documents de service</option>']
    .concat(state.projects.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`)).join('');
  const filterBar=`<div class="doc-toolbar">
    <label style="font-size:12px;font-weight:700;color:var(--mut)">PROJET :</label>
    <select id="docProjFilter" class="btn sm">${projOpts}</select>
    <div class="doc-viewtoggle">
      <button class="btn sm${docViewMode==='folders'?' primary':' ghost'}" id="docViewFolders">📁 Répertoires</button>
      <button class="btn sm${docViewMode==='workflow'?' primary':' ghost'}" id="docViewWorkflow">⠿ Workflow</button>
    </div>
  </div>`;

  let filtered=docs;
  if(docProjectFilter==='service') filtered=docs.filter(d=>!d.project_id);
  else if(docProjectFilter) filtered=docs.filter(d=>String(d.project_id)===String(docProjectFilter));

  const wireToolbar=()=>{
    const fs=$('docProjFilter');if(fs){fs.value=docProjectFilter;fs.addEventListener('change',function(){docProjectFilter=this.value;renderDocs();});}
    if($('docViewFolders')) $('docViewFolders').addEventListener('click',()=>{docViewMode='folders';renderDocs();});
    if($('docViewWorkflow')) $('docViewWorkflow').addEventListener('click',()=>{docViewMode='workflow';renderDocs();});
  };

  if(!filtered.length){
    el.innerHTML=filterBar+'<div class="empty">Aucun document. Clique sur « + Ajouter un document ».</div>';
    wireToolbar();return;
  }

  if(docViewMode==='folders'){
    // Regroupement par répertoire
    const groups={};
    filtered.forEach(d=>{const f=(d.folder||'').trim()||'__none__';(groups[f]=groups[f]||[]).push(d);});
    const keys=Object.keys(groups).sort((a,b)=>{if(a==='__none__')return 1;if(b==='__none__')return -1;return a.localeCompare(b);});
    const sections=keys.map(k=>{
      const list=groups[k].slice().sort((a,b)=>a.name.localeCompare(b.name));
      const label=k==='__none__'?'📂 Sans répertoire':'📁 '+esc(k);
      const rows=list.map(d=>{
        const ph=DOC_PHASE_BY_KEY[d.phase||'redaction']||{ic:'•',label:d.phase,color:'var(--mut)'};
        const proj=d.project_id?projById(d.project_id):null;
        return `<div class="doc-frow${d.obsolete?' obsolete':''}" data-open-doc="${d.id}">
          <span class="doc-frow-ic">📄</span>
          <div style="flex:1;min-width:0">
            <div class="doc-frow-name">${esc(d.name)} ${d.obsolete?'<span class="doc-obsolete-badge">⚠ OBSOLÈTE</span>':''}</div>
            <div class="meta" style="font-size:11px">${DOC_TYPES[d.doc_type]||d.doc_type} · v${d.last_version}${proj?' · '+esc(proj.name):' · Service'}${d.assigned_to_name?' · chez '+esc(d.assigned_to_name):''}</div>
          </div>
          <span class="pill" style="background:${ph.color};color:#fff;font-size:10px;white-space:nowrap">${ph.ic} ${ph.label}</span>
          ${d.sla_over?'<span class="doc-sla-badge">⏱</span>':''}
        </div>`;
      }).join('');
      return `<div class="doc-folder">
        <div class="doc-folder-head"><span>${label}</span><span class="doc-col-count">${list.length}</span></div>
        <div class="doc-folder-body">${rows}</div>
      </div>`;
    }).join('');
    el.innerHTML=filterBar+`<div class="doc-folders">${sections}</div>`;
    wireToolbar();return;
  }

  // Vue Workflow : une colonne par phase
  const docCard=(d)=>{
    const proj=d.project_id?projById(d.project_id):null;
    const lock=d.locked_by?`<span class="pill" style="background:rgba(214,56,63,.12);color:var(--bad);font-size:10px">🔒 ${esc(d.locked_by_name||'?')}</span>`:'';
    const assignee=d.assigned_to_name
      ? `<div class="doc-assignee"><span class="ava" style="width:22px;height:22px;font-size:10px;background:${avaColor(d.assigned_to)}">${initials(d.assigned_to_name)}</span><span>${esc(d.assigned_to_name)}</span></div>`
      : '<div class="meta" style="font-size:11px">Non assigné</div>';
    const sla=d.sla_over?`<span class="doc-sla-badge" title="Délai indicatif de ${d.sla_days} j dépassé">⏱ ${d.days_in_phase} j · SLA dépassé</span>`:'';
    const fold=d.folder?`<span class="doc-folder-tag">📁 ${esc(d.folder)}</span>`:'';
    return `<div class="doc-pcard${d.sla_over?' sla-over':''}${d.obsolete?' obsolete':''}" data-open-doc="${d.id}">
      <div class="row" style="justify-content:space-between;align-items:flex-start;gap:6px">
        ${fold||(d.obsolete?'<span class="doc-obsolete-badge">⚠ OBSOLÈTE</span>':'<span></span>')}
        <span class="pill" style="font-size:10px">v${d.last_version}</span>
      </div>
      <strong style="font-size:13px;line-height:1.3;display:block;margin-top:4px">📄 ${esc(d.name)}</strong>
      ${proj?`<div class="meta" style="font-size:11px">${esc(proj.name)}</div>`:'<div class="meta" style="font-size:11px">Service</div>'}
      <div style="margin-top:6px">${assignee}</div>
      ${sla?`<div style="margin-top:5px">${sla}</div>`:''}
      ${lock?`<div style="margin-top:5px">${lock}</div>`:''}
    </div>`;
  };
  const cols=DOC_PHASES.map(ph=>{
    const inPhase=filtered.filter(d=>(d.phase||'redaction')===ph.key);
    return `<div class="doc-col">
      <div class="doc-col-head" style="border-top:3px solid ${ph.color}">
        <span>${ph.ic} ${ph.label}</span><span class="doc-col-count">${inPhase.length}</span>
      </div>
      <div class="doc-col-body">${inPhase.map(docCard).join('')||'<div class="doc-col-empty">—</div>'}</div>
    </div>`;
  }).join('');
  el.innerHTML=filterBar+`<div class="doc-pipeline">${cols}</div>`;
  wireToolbar();
}

async function openDocDetail(docId){
  currentDocId=parseInt(docId,10);
  openModal('docDetailModal');
  const c=$('docDetailContent');
  c.innerHTML='<div class="empty">Chargement…</div>';
  let d;
  try{d=await api('/api/documents/'+currentDocId);}
  catch(e){c.innerHTML='<div class="empty">Erreur : '+esc(e.message)+'</div>';return;}
  currentDocObj=d;
  const isLockedByMe=d.locked_by===ME.id;
  const canDelete=IS_ADMIN || d.created_by===ME.id;
  const cur=d.versions[0];
  const phaseIdx=Math.max(0,docPhaseIndex(d.phase||'redaction'));
  const curPhase=DOC_PHASES[phaseIdx];

  // ----- Timeline animée -----
  const pct=DOC_PHASES.length>1 ? Math.round(phaseIdx/(DOC_PHASES.length-1)*100) : 0;
  const steps=DOC_PHASES.map((ph,i)=>{
    const cls=i<phaseIdx?'done':(i===phaseIdx?'current':'todo');
    return `<div class="doc-tl-step ${cls}">
      <div class="doc-tl-dot" style="${i<=phaseIdx?'background:'+ph.color+';border-color:'+ph.color:''}">${i<phaseIdx?'✓':ph.ic}</div>
      <div class="doc-tl-label">${ph.label}</div>
    </div>`;
  }).join('');
  const timeline=`<div class="doc-timeline">
    <div class="doc-tl-track"><div class="doc-tl-fill" style="width:0%" data-fill="${pct}"></div></div>
    <div class="doc-tl-steps">${steps}</div>
  </div>
  <div class="doc-holder">
    ${d.assigned_to_name
      ? `<span class="ava" style="width:26px;height:26px;font-size:11px;background:${avaColor(d.assigned_to)}">${initials(d.assigned_to_name)}</span>
         <span>Actuellement chez <strong>${esc(d.assigned_to_name)}</strong> — phase <strong style="color:${curPhase.color}">${curPhase.label}</strong></span>`
      : `<span>Phase <strong style="color:${curPhase.color}">${curPhase.label}</strong> — non assigné</span>`}
  </div>`;

  // ----- Verrou / édition -----
  const lockInfo=d.locked_by
    ? `<div class="meta" style="color:${isLockedByMe?'var(--ok)':'var(--bad)'};font-weight:600">🔒 Verrouillé par ${esc(d.locked_by_name)}${isLockedByMe?' (toi)':''} — ${fmtDateTime(d.locked_at)}</div>`
    : `<div class="meta" style="color:var(--ok)">🔓 Disponible pour édition</div>`;
  let actionBtns='';
  if(!d.locked_by){
    actionBtns=`<button class="btn primary sm" data-doc-lock="${d.id}">🔒 Verrouiller pour éditer</button>`;
  }else if(isLockedByMe){
    actionBtns=`<button class="btn primary sm" id="btnUploadNewVersion">⬆ Uploader nouvelle version</button>
                <button class="btn ghost sm" data-doc-unlock="${d.id}">Libérer le verrou</button>`;
  }else{
    actionBtns=`<span class="meta">Verrouillé par ${esc(d.locked_by_name)}.</span>
                ${IS_ADMIN?`<button class="btn ghost sm" data-doc-unlock="${d.id}">Forcer le déverrouillage (admin)</button>`:''}`;
  }

  // ----- Formulaire de transition (faire avancer) -----
  const nextIdx=Math.min(phaseIdx+1,DOC_PHASES.length-1);
  const phaseOpts=DOC_PHASES.map((ph,i)=>`<option value="${ph.key}"${i===nextIdx?' selected':''}>${ph.ic} ${ph.label}</option>`).join('');
  const assigneeOpts='<option value="">— Personne (optionnel) —</option>'+state.users.map(usr=>`<option value="${usr.id}">${esc(usr.name)}</option>`).join('');
  const transition=`<div class="panel" style="padding:13px;margin:14px 0;border-left:3px solid var(--acc)">
    <strong style="font-size:14px">➡️ Faire avancer / transférer le document</strong>
    <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:10px">
      <div class="field" style="flex:1;min-width:150px;margin:0"><label style="font-size:11px">Nouvelle phase</label>
        <select id="f_docPhase" class="btn sm" style="width:100%">${phaseOpts}</select></div>
      <div class="field" style="flex:1;min-width:150px;margin:0"><label style="font-size:11px">Assigner à</label>
        <select id="f_docAssignee" class="btn sm" style="width:100%">${assigneeOpts}</select></div>
    </div>
    <div class="field" style="margin:8px 0 0"><label style="font-size:11px">Note (optionnel)</label>
      <input id="f_docTransNote" placeholder="Ex : prêt pour relecture QA" style="width:100%;background:var(--panel2);border:1.5px solid var(--line);padding:7px 10px;border-radius:var(--r-sm);outline:none;font-size:13px"></div>
    <div id="docSignBlock" class="doc-sign-block hidden">
      <div class="doc-sign-head">🔏 Signature électronique requise — cette action engage ta responsabilité (21 CFR Part 11).</div>
      <div class="field" style="margin:0 0 8px"><label style="font-size:11px">Motif / signification</label>
        <input id="f_docSignReason" placeholder="Ex : Document approuvé, conforme aux exigences qualité" style="width:100%;background:#fff;border:1.5px solid var(--line);padding:7px 10px;border-radius:var(--r-sm);outline:none;font-size:13px"></div>
      <div class="field" style="margin:0"><label style="font-size:11px">Confirme ton mot de passe</label>
        <input type="password" id="f_docSignPwd" placeholder="••••••••" autocomplete="current-password" style="width:100%;background:#fff;border:1.5px solid var(--line);padding:7px 10px;border-radius:var(--r-sm);outline:none;font-size:13px"></div>
    </div>
    <label class="row" style="gap:6px;margin-top:8px;font-size:13px;cursor:pointer">
      <input type="checkbox" id="f_docNotify" checked> Prévenir la personne par email (ouvre Outlook)
    </label>
    <div class="row" style="justify-content:flex-end;margin-top:8px">
      <button class="btn primary sm" id="btnDocTransition">Valider la transition</button>
    </div>
  </div>`;

  // ----- Historique workflow -----
  const wfHtml=(d.workflow||[]).slice().reverse().map(w=>{
    const ph=DOC_PHASE_BY_KEY[w.phase]||{ic:'•',label:w.phase,color:'var(--mut)'};
    return `<div class="row" style="gap:8px;align-items:flex-start;padding:7px 0;border-bottom:1px solid var(--line)">
      <span style="font-size:15px">${ph.ic}</span>
      <div style="flex:1">
        <div style="font-size:13px"><strong style="color:${ph.color}">${ph.label}</strong>${w.assigned_to_name?` → chez ${esc(w.assigned_to_name)}`:''}</div>
        <div class="meta" style="font-size:11px">Par ${esc(w.moved_by_name||'?')} · ${fmtDateTime(w.created_at)}${w.note?' · '+esc(w.note):''}</div>
      </div>
    </div>`;
  }).join('');

  // ----- Versions -----
  const versionsHtml=d.versions.map(v=>`
    <div class="row" style="justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--line)">
      <div style="flex:1;min-width:0">
        <div class="row" style="gap:8px;align-items:center">
          <span class="pill" style="font-weight:700">v${v.version}</span>
          <strong style="font-size:13px">${esc(v.filename)}</strong>
          <span class="meta" style="font-size:11px">${fmtBytes(v.size)}</span>
        </div>
        <div class="meta" style="font-size:12px">Par ${esc(v.uploaded_by_name||'?')} · ${fmtDateTime(v.uploaded_at)}${v.note?' · '+esc(v.note):''}</div>
      </div>
      <a class="btn sm ghost" href="/api/documents/${d.id}/versions/${v.id}/download">⬇ Télécharger</a>
    </div>`).join('');

  // ----- Signatures électroniques -----
  const sigHtml=(d.signatures||[]).map(sg=>`
    <div class="doc-sign-item">
      <div style="font-size:13px"><strong>✒️ ${esc(sg.user_name)}</strong> — ${esc(sg.meaning)} <span class="meta">(v${sg.version})</span></div>
      <div class="meta" style="font-size:12px">« ${esc(sg.reason)} » · ${fmtDateTime(sg.signed_at)}</div>
    </div>`).join('')||'<div class="empty">Aucune signature pour le moment</div>';

  // ----- Lu & compris (accusés + liste de diffusion) -----
  const canManageDoc=IS_ADMIN || d.created_by===ME.id;
  let ackPanel='';
  if(d.needs_ack){
    const dist=(d.distribution||[]);
    const distProgress=dist.length?`<div class="meta" style="margin-top:6px;font-size:12.5px">Diffusion : <strong>${d.dist_acked}/${d.dist_count}</strong> lecteur(s) requis ont accusé réception</div>
      <div class="dist-list">${dist.map(x=>`<span class="dist-chip ${x.acked?'ok':''}">${x.acked?'✓':'⏳'} ${esc(x.user_name)}</span>`).join('')}</div>`
      :`<div class="meta" style="margin-top:6px;font-size:12px">${d.ack_count} accusé(s) de lecture libre sur v${d.last_version}</div>`;
    const showAck=!d.my_ack && (d.dist_count===0 || d.my_required || canManageDoc);
    ackPanel=`<div class="panel doc-ack-panel">
      <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <strong style="font-size:14px">📖 Lu &amp; compris</strong>
        <div class="row" style="gap:6px;flex-wrap:wrap">
          ${d.my_ack?`<span style="color:var(--ok);font-weight:600;font-size:13px">✓ Tu as accusé (v${d.last_version})</span>`:(showAck?`<button class="btn primary sm" id="btnDocAck">✓ J'ai lu et compris</button>`:'')}
          ${canManageDoc?`<button class="btn sm ghost" id="btnManageDist">👥 Liste de diffusion</button>`:''}
        </div>
      </div>
      ${distProgress}
      <div id="distEditor" class="hidden" style="margin-top:10px"></div>
    </div>`;
  }

  // ----- Liens documentaires (remplace / référence) -----
  const repl=(d.replaced_by||[]);
  const replWarn=repl.length?`<div class="doc-obsolete-warn">⚠ Ce document est <strong>remplacé par</strong> : ${repl.map(r=>`<a class="doc-link-a" data-open-doc="${r.doc_id}">${esc(r.doc_name)}</a>`).join(', ')}</div>`:'';
  const linkRows=(d.links||[]).map(l=>`<div class="row" style="justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--line)">
      <span style="font-size:13px">${l.kind==='replaces'?'↪ <strong>Remplace</strong>':'🔗 Référence'} : <a class="doc-link-a" data-open-doc="${l.target_id}">${esc(l.target_name)}</a></span>
      ${canManageDoc?`<button class="x" data-rmlink="${l.target_id}|${l.kind}">✕</button>`:''}
    </div>`).join('')||'<div class="meta" style="font-size:12px">Aucun lien.</div>';
  const otherDocs=(state.documents||[]).filter(x=>x.id!==d.id);
  const addLinkForm=canManageDoc&&otherDocs.length?`<div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">
      <select id="f_linkKind" class="btn sm"><option value="references">🔗 Référence</option><option value="replaces">↪ Remplace</option></select>
      <select id="f_linkTarget" class="btn sm" style="flex:1;min-width:150px"><option value="">— Document cible —</option>${otherDocs.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
      <button class="btn sm" id="btnAddLink">+ Lier</button>
    </div>`:(canManageDoc?'<div class="meta" style="font-size:12px;margin-top:6px">Ouvre l\'onglet Documents pour charger la liste des documents à lier.</div>':'');
  const linksSection=`<h3 style="font-size:15px;margin:16px 0 4px">🔗 Liens documentaires</h3>${linkRows}${addLinkForm}`;

  const proj=d.project_id?projById(d.project_id):null;
  const slaHtml=d.sla_over
    ? `<span class="doc-sla-badge big">⏱ ${d.days_in_phase} j en phase · SLA dépassé (max ${d.sla_days} j)</span>`
    : (d.sla_days?`<span class="meta" style="font-size:11px;white-space:nowrap">⏱ ${d.days_in_phase} j en phase / ${d.sla_days} j</span>`:'');
  c.innerHTML=`
    ${replWarn}
    <div class="row" style="justify-content:space-between;align-items:flex-start;gap:10px">
      <div style="min-width:0">
        <div class="row" style="gap:7px;align-items:center;flex-wrap:wrap">
          ${d.reference?`<span class="doc-ref lg">${esc(d.reference)}</span>`:''}
          <span class="pill">${DOC_TYPES[d.doc_type]||d.doc_type}</span>
          ${d.folder?`<span class="doc-folder-tag">📁 ${esc(d.folder)}</span>`:''}
          <button class="btn sm ghost" id="btnDocFolder" style="padding:2px 8px;font-size:11px">📁 ${d.folder?'Changer':'Ranger'}</button>
          ${d.obsolete?'<span class="doc-obsolete-badge">⚠ OBSOLÈTE</span>':''}
        </div>
        <h2 style="margin:7px 0 0">📄 ${esc(d.name)}</h2>
      </div>
      ${slaHtml}
    </div>
    ${d.description?`<div class="meta" style="margin-top:6px">${esc(d.description)}</div>`:''}
    <div class="meta" style="margin-top:4px">${proj?'📁 '+esc(proj.name):'📁 Document de service'} · Créé par ${esc(d.created_by_name||'?')} · ${fmtDateTime(d.created_at)}</div>

    ${timeline}
    ${ackPanel}
    ${linksSection}
    ${transition}

    <div class="panel" style="padding:12px;margin-bottom:14px">
      ${lockInfo}
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px">
        ${cur?`<a class="btn sm" href="/api/documents/${d.id}/versions/${cur.id}/download">⬇ Télécharger la dernière (v${cur.version})</a>`:''}
        ${actionBtns}
      </div>
      ${isLockedByMe?`<div class="meta" style="margin-top:8px;font-size:12px">💡 Édite le fichier téléchargé dans Word, puis clique « Uploader nouvelle version ».</div>`:''}
    </div>

    <h3 style="font-size:15px;margin:16px 0 4px">🔏 Signatures électroniques (${(d.signatures||[]).length})</h3>
    <div style="max-height:160px;overflow:auto">${sigHtml}</div>

    <h3 style="font-size:15px;margin:16px 0 4px">🗂 Historique du workflow</h3>
    <div style="max-height:180px;overflow:auto">${wfHtml||'<div class="empty">Aucune étape</div>'}</div>

    <h3 style="font-size:15px;margin:16px 0 4px">📑 Historique des versions (${d.versions.length})</h3>
    <div style="max-height:220px;overflow:auto">${versionsHtml||'<div class="empty">Aucune version</div>'}</div>

    ${canDelete?`<div class="row" style="justify-content:flex-start;margin-top:14px">
      <button class="btn sm ghost" style="color:var(--bad)" data-doc-delete="${d.id}">🗑 Supprimer ce document</button>
    </div>`:''}
  `;

  // Animation de la barre de progression (remplissage)
  requestAnimationFrame(()=>{const f=c.querySelector('.doc-tl-fill');if(f)requestAnimationFrame(()=>{f.style.width=f.dataset.fill+'%';});});
  const upBtn=$('btnUploadNewVersion');
  if(upBtn) upBtn.addEventListener('click',()=>$('docVersionFile').click());
  const trBtn=$('btnDocTransition');
  if(trBtn) trBtn.addEventListener('click',docTransition);
  const ackBtn=$('btnDocAck');
  if(ackBtn) ackBtn.addEventListener('click',ackDoc);
  // Répertoire / catégorie
  const folBtn=$('btnDocFolder');
  if(folBtn) folBtn.addEventListener('click',async()=>{
    const v=prompt('Répertoire / catégorie du document :',d.folder||'');
    if(v===null)return;
    try{await api('/api/documents/'+d.id,{method:'PUT',body:{folder:v.trim()}});toast('Répertoire mis à jour');openDocDetail(d.id);renderDocs();}
    catch(e){toast(e.message,'err');}
  });
  // Gestion de la liste de diffusion
  const mgBtn=$('btnManageDist');
  if(mgBtn) mgBtn.addEventListener('click',()=>{
    const ed=$('distEditor');
    const current=new Set((d.distribution||[]).map(x=>x.user_id));
    ed.innerHTML=`<div class="dist-editor">${state.users.map(usr=>`<label class="dist-opt"><input type="checkbox" value="${usr.id}" ${current.has(usr.id)?'checked':''}> ${esc(usr.name)}</label>`).join('')}</div>
      <button class="btn sm primary" id="btnSaveDist" style="margin-top:8px">Enregistrer la diffusion</button>`;
    ed.classList.remove('hidden');
    $('btnSaveDist').addEventListener('click',async()=>{
      const ids=[...ed.querySelectorAll('input:checked')].map(i=>parseInt(i.value,10));
      try{await api('/api/documents/'+d.id+'/distribution',{method:'POST',body:{user_ids:ids}});
        toast('Liste de diffusion mise à jour');await loadNotifications();renderNotifBell();openDocDetail(d.id);}
      catch(e){toast(e.message,'err');}
    });
  });
  // Liens documentaires
  const addLink=$('btnAddLink');
  if(addLink) addLink.addEventListener('click',async()=>{
    const target=$('f_linkTarget').value, kind=$('f_linkKind').value;
    if(!target){toast('Choisis un document cible.','err');return;}
    try{await api('/api/documents/'+d.id+'/links',{method:'POST',body:{target_id:parseInt(target,10),kind}});
      toast('Lien ajouté');openDocDetail(d.id);renderDocs();}
    catch(e){toast(e.message,'err');}
  });
  c.querySelectorAll('[data-rmlink]').forEach(b=>b.addEventListener('click',async function(){
    const [tid,kind]=this.dataset.rmlink.split('|');
    try{await api('/api/documents/'+d.id+'/links/remove',{method:'POST',body:{target_id:parseInt(tid,10),kind}});
      openDocDetail(d.id);renderDocs();}
    catch(e){toast(e.message,'err');}
  }));
  // Affiche le bloc signature si la phase choisie l'exige
  const phaseSel=$('f_docPhase');
  function toggleSign(){const need=DOC_SIGN_PHASES.includes(phaseSel.value);$('docSignBlock').classList.toggle('hidden',!need);}
  if(phaseSel){phaseSel.addEventListener('change',toggleSign);toggleSign();}
}

async function ackDoc(){
  if(!currentDocId)return;
  try{
    await api('/api/documents/'+currentDocId+'/ack',{method:'POST',body:{}});
    toast('Accusé de lecture enregistré ✓');
    openDocDetail(currentDocId);
  }catch(e){toast(e.message,'err');}
}

/* ====== Lecteur de document (aperçu + commentaires, façon Veeva) ====== */
function refreshDocViews(id){
  if($('docViewerModal').classList.contains('show')) openDocViewer(id);
  if($('docDetailModal').classList.contains('show')) openDocDetail(id);
  renderDocs();
}
async function openDocViewer(docId){
  currentDocId=parseInt(docId,10);
  $('docViewerModal').classList.add('show');
  $('dvTitle').innerHTML='<div class="meta">Chargement…</div>';
  $('dvPreview').innerHTML='';$('dvSide').innerHTML='';
  let d;
  try{d=await api('/api/documents/'+currentDocId);}
  catch(e){$('dvPreview').innerHTML='<div class="empty">Erreur : '+esc(e.message)+'</div>';return;}
  currentDocObj=d;
  const cur=d.versions[0];
  const ph=DOC_PHASE_BY_KEY[d.phase||'redaction']||{ic:'',label:d.phase,color:'var(--mut)'};
  $('dvTitle').innerHTML=`<div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
    ${d.reference?`<span class="doc-ref">${esc(d.reference)}</span>`:''}
    <strong style="font-size:15px">📄 ${esc(d.name)}</strong>
    <span class="pill" style="background:${ph.color};color:#fff;font-size:10px">${ph.ic} ${ph.label}</span>
    ${d.folder?`<span class="doc-folder-tag">📁 ${esc(d.folder)}</span>`:''}
    <span class="meta" style="font-size:11px">v${d.last_version}</span>
    ${d.obsolete?'<span class="doc-obsolete-badge">⚠ OBSOLÈTE</span>':''}
    ${d.sla_over?`<span class="doc-sla-badge">⏱ SLA dépassé</span>`:''}
  </div>`;
  renderDocPreview(d, cur);
  renderDocViewerSide(d, cur);
  loadDocComments();
}
async function renderDocPreview(d, cur){
  const pv=$('dvPreview');
  pv.innerHTML='<div class="dv-watermark"></div><div class="dv-content" id="dvContent"><div class="dv-doc" id="dvDoc"></div><div class="dv-anno" id="dvAnno"></div></div>';
  const c=$('dvDoc');
  if(!cur){c.innerHTML='<div class="empty">Aucun fichier</div>';return;}
  const name=(cur.filename||'').toLowerCase();
  const ext=name.split('.').pop();
  const viewUrl='/api/documents/'+d.id+'/versions/'+cur.id+'/view';
  const dlUrl='/api/documents/'+d.id+'/versions/'+cur.id+'/download';
  try{
    if(name.endsWith('.pdf')){
      if(window.pdfjsLib){ c.innerHTML='<div class="dv-loading">Rendu du PDF…</div>'; await renderPdfInto(c, viewUrl); }
      else c.innerHTML=`<iframe class="dv-frame" src="${viewUrl}#toolbar=1"></iframe>`;
    }else if(name.endsWith('.docx')){
      c.innerHTML='<div class="dv-loading">Rendu du document…</div>';
      const blob=await (await fetch(viewUrl)).blob();
      c.innerHTML=`<div class="dv-note">ℹ️ Aperçu web — la mise en forme exacte peut différer. <a href="${dlUrl}">Télécharger l'original</a> pour la version officielle.</div><div class="dv-docx" id="dvDocx"></div>`;
      if(window.docx&&docx.renderAsync) await docx.renderAsync(blob, $('dvDocx'), null, {inWrapper:true, className:'docx'});
      else $('dvDocx').innerHTML=`<div class="empty">Lecteur DOCX indisponible. <a href="${dlUrl}">Télécharger</a></div>`;
    }else if(/\.(txt|md|csv)$/.test(name)){
      const txt=await (await fetch(viewUrl)).text();const pre=document.createElement('pre');pre.className='dv-text';pre.textContent=txt;c.innerHTML='';c.appendChild(pre);
    }else{
      c.innerHTML=`<div class="dv-noprev"><div style="font-size:48px">📄</div><p>Aperçu non disponible pour ce format (.${esc(ext)}).<br>Word/Excel/PowerPoint s'ouvrent dans l'application bureautique.</p><a class="btn primary" href="${dlUrl}">⬇ Télécharger le document</a></div>`;
    }
  }catch(e){
    c.innerHTML=`<div class="dv-noprev"><div style="font-size:42px">📄</div><p>Aperçu impossible.</p><a class="btn primary" href="${dlUrl}">⬇ Télécharger le document</a></div>`;
  }
  setupAnnoLayer();
  renderDocAnno();
}
async function renderPdfInto(container, url){
  const data=await (await fetch(url)).arrayBuffer();
  const pdf=await pdfjsLib.getDocument({data}).promise;
  container.innerHTML='';
  const W=Math.max(320,(container.clientWidth||640)-4);
  for(let p=1;p<=pdf.numPages;p++){
    const page=await pdf.getPage(p);
    const base=page.getViewport({scale:1});
    const scale=Math.min(2,W/base.width);
    const vp=page.getViewport({scale});
    const canvas=document.createElement('canvas');
    canvas.className='dv-pdf-page';canvas.width=vp.width;canvas.height=vp.height;
    container.appendChild(canvas);
    await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
  }
}
// Couche d'annotation : clic pour placer, épingles pour commentaires ancrés
function setupAnnoLayer(){
  const anno=$('dvAnno');if(!anno)return;
  anno.onclick=(e)=>{
    if(!_placingComment||e.target!==anno)return;
    const c=$('dvContent');const rect=c.getBoundingClientRect();
    const x=Math.max(0,Math.min(100,(e.clientX-rect.left)/rect.width*100));
    const y=Math.max(0,Math.min(100,(e.clientY-rect.top)/rect.height*100));
    finishPlacement(x,y);
  };
}
function renderDocAnno(){
  const anno=$('dvAnno');if(!anno)return;
  anno.innerHTML='';let n=0;
  (_docComments||[]).forEach(c=>{
    if(c.anchor_x==null||c.anchor_y==null)return;
    n++;
    const pin=document.createElement('div');
    pin.className='dv-pin';pin.style.left=c.anchor_x+'%';pin.style.top=c.anchor_y+'%';
    pin.textContent=n;pin.title=c.author+' : '+c.text;pin.dataset.cid=c.id;
    anno.appendChild(pin);
    pin.addEventListener('click',ev=>{ev.stopPropagation();scrollListToComment(c.id);});
    makePinDraggable(pin,c);
  });
}
function makePinDraggable(pin,c){
  pin.addEventListener('mousedown',e=>{
    e.preventDefault();e.stopPropagation();
    const cont=$('dvContent');let moved=false;pin.classList.add('drag');
    function mv(ev){moved=true;const rect=cont.getBoundingClientRect();
      let x=Math.max(0,Math.min(100,(ev.clientX-rect.left)/rect.width*100));
      let y=Math.max(0,Math.min(100,(ev.clientY-rect.top)/rect.height*100));
      pin.style.left=x+'%';pin.style.top=y+'%';pin._x=x;pin._y=y;}
    function up(){document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);pin.classList.remove('drag');
      if(moved&&pin._x!=null){api('/api/doc-comments/'+c.id+'/anchor',{method:'PUT',body:{anchor_x:pin._x,anchor_y:pin._y}}).then(loadDocComments).catch(()=>{});}}
    document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);
  });
}
function startPlacement(){
  const inp=$('dvCommentInput');
  if(!inp||!inp.value.trim()){toast("Écris d'abord ton commentaire, puis place-le.",'warn');inp&&inp.focus();return;}
  _placingComment=true;
  const anno=$('dvAnno');if(anno)anno.classList.add('placing');
  $('dvPlaceBtn')&&$('dvPlaceBtn').classList.add('active');
  toast('📍 Clique dans le document pour placer ton commentaire');
}
function cancelPlacement(){_placingComment=false;const a=$('dvAnno');if(a)a.classList.remove('placing');$('dvPlaceBtn')&&$('dvPlaceBtn').classList.remove('active');}
async function finishPlacement(x,y){
  const inp=$('dvCommentInput');const text=inp.value.trim();
  cancelPlacement();
  if(!text)return;
  await addDocComment({x,y});
}
function scrollDocToPin(cid){
  const pin=document.querySelector('.dv-pin[data-cid="'+cid+'"]');if(!pin)return;
  const pv=$('dvPreview');
  pv.scrollTo({top:pin.offsetTop+ $('dvContent').offsetTop -100, behavior:'smooth'});
  pin.classList.add('flash');setTimeout(()=>pin.classList.remove('flash'),1400);
}
function scrollListToComment(cid){
  const row=document.querySelector('.dv-comment[data-cid="'+cid+'"]');if(!row)return;
  row.scrollIntoView({block:'nearest',behavior:'smooth'});
  row.classList.add('flash');setTimeout(()=>row.classList.remove('flash'),1400);
}
function renderDocViewerSide(d, cur){
  const isLockedByMe=d.locked_by===ME.id;
  const dlUrl=cur?'/api/documents/'+d.id+'/versions/'+cur.id+'/download':'';
  let actions='';
  if(cur) actions+=`<a class="btn sm" href="${dlUrl}">⬇ Télécharger</a>`;
  if(!d.locked_by) actions+=`<button class="btn sm primary" data-doc-lock="${d.id}">🔒 Verrouiller / éditer</button>`;
  else if(isLockedByMe) actions+=`<button class="btn sm primary" id="dvUpload">⬆ Nouvelle version</button><button class="btn sm ghost" data-doc-unlock="${d.id}">Libérer</button>`;
  else actions+=`<span class="pill" style="background:rgba(220,38,38,.12);color:var(--bad)">🔒 ${esc(d.locked_by_name||'?')}</span>${IS_ADMIN?`<button class="btn sm ghost" data-doc-unlock="${d.id}">Forcer (admin)</button>`:''}`;
  actions+=`<button class="btn sm ghost" id="dvWorkflow">⚙ Workflow & signatures</button>`;
  const lockMsg=isLockedByMe?'<div class="meta" style="font-size:12px;margin-top:6px">💡 Verrouillé par toi : télécharge, édite dans Word, puis « Nouvelle version ».</div>':'';
  // Historique du document : transitions de workflow + versions, fusionnés et triés
  const hist=[];
  (d.workflow||[]).forEach(w=>{const ph=DOC_PHASE_BY_KEY[w.phase]||{ic:'•',label:w.phase};
    hist.push({t:w.created_at, ic:ph.ic, txt:`<strong>${esc(ph.label)}</strong>${w.assigned_to_name?' → '+esc(w.assigned_to_name):''}`, by:w.moved_by_name, note:w.note});});
  (d.versions||[]).forEach(v=>hist.push({t:v.uploaded_at, ic:'📄', txt:`Version <strong>v${v.version}</strong> uploadée`, by:v.uploaded_by_name, note:v.note}));
  (d.signatures||[]).forEach(sg=>hist.push({t:sg.signed_at, ic:'✒️', txt:`Signé : <strong>${esc(sg.meaning)}</strong>`, by:sg.user_name, note:sg.reason}));
  hist.sort((a,b)=>(a.t||'')<(b.t||'')?1:-1);
  const histHtml=hist.slice(0,12).map(h=>`<div class="dv-hist-item">
    <span class="dv-hist-ic">${h.ic}</span>
    <div style="flex:1;min-width:0"><div style="font-size:12px">${h.txt}</div>
      <div class="meta" style="font-size:10.5px">${esc(h.by||'?')} · ${fmtAgo(h.t)}${h.note?' · '+esc(h.note):''}</div></div>
  </div>`).join('')||'<div class="empty" style="font-size:12px">Aucune activité</div>';

  $('dvSide').innerHTML=`
    <div class="dv-side-head">
      <div class="meta" style="font-size:12px">${d.assigned_to_name?'Chez <strong>'+esc(d.assigned_to_name)+'</strong>':'Non assigné'}</div>
    </div>
    <div class="dv-actions">${actions}</div>
    ${lockMsg}
    <h3 style="font-size:14px;margin:16px 0 6px">💬 Commentaires</h3>
    <div class="meta" style="font-size:11.5px;margin-bottom:6px">📍 = placé dans le document. Écris puis clique « Placer » et clique dans la page.</div>
    <div id="dvComments" class="dv-comments"><div class="empty" style="font-size:12px">Chargement…</div></div>
    <div class="dv-comment-input">
      <input id="dvCommentInput" placeholder="Commenter…  (@ pour mentionner)" autocomplete="off">
      <button class="btn sm ghost" id="dvPlaceBtn" title="Placer le commentaire dans le document">📍</button>
      <button class="btn sm primary" id="dvCommentSend">Envoyer</button>
    </div>
    <h3 style="font-size:14px;margin:18px 0 6px">🗂 Historique du document</h3>
    <div class="dv-history">${histHtml}</div>`;
  const up=$('dvUpload'); if(up) up.addEventListener('click',()=>$('docVersionFile').click());
  const wf=$('dvWorkflow'); if(wf) wf.addEventListener('click',()=>{closeModal('docViewerModal');openDocDetail(d.id);});
  const send=$('dvCommentSend'); if(send) send.addEventListener('click',()=>addDocComment());
  const placeBtn=$('dvPlaceBtn'); if(placeBtn) placeBtn.addEventListener('click',()=>{ _placingComment?cancelPlacement():startPlacement(); });
  const inp=$('dvCommentInput');
  if(inp){
    inp.addEventListener('keydown',e=>{
      if(e.key==='Enter'){ if(_mentionBox && !_mentionBox.classList.contains('hidden'))return; e.preventDefault(); addDocComment(); }
    });
    inp.addEventListener('input',function(){showMentionBox(this);});
    inp.addEventListener('blur',()=>setTimeout(hideMentionBox,150));
  }
}
async function loadDocComments(){
  if(!currentDocId)return;
  try{_docComments=await api('/api/documents/'+currentDocId+'/comments');renderDocCommentList();renderDocAnno();}
  catch{const el=$('dvComments');if(el)el.innerHTML='<div class="empty" style="font-size:12px">Erreur de chargement</div>';}
}
function renderDocCommentList(){
  const el=$('dvComments');if(!el)return;
  const cs=_docComments||[];let n=0;
  el.innerHTML=cs.length?cs.map(c=>{
    const anchored=c.anchor_x!=null&&c.anchor_y!=null; if(anchored)n++;
    return `<div class="dv-comment${anchored?' anchored':''}" data-cid="${c.id}"${anchored?` data-goto="${c.id}"`:''}>
      <div class="row" style="justify-content:space-between;align-items:center">
        <strong style="font-size:12.5px">${anchored?`<span class="dv-pin-num">📍${n}</span> `:''}${esc(c.author)}</strong>
        <div class="row" style="gap:6px"><span class="meta" style="font-size:11px">${fmtAgo(c.created_at)}</span>${(IS_ADMIN||c.user_id===ME.id)?`<button class="x" style="font-size:11px" data-del-doccomment="${c.id}">✕</button>`:''}</div>
      </div>
      <div style="font-size:13px;margin-top:2px">${highlightMentions(esc(c.text))}</div>
    </div>`;
  }).join(''):'<div class="empty" style="font-size:12px">Aucun commentaire. Lance la discussion 💬</div>';
  el.querySelectorAll('[data-del-doccomment]').forEach(b=>b.addEventListener('click',async function(e){
    e.stopPropagation();
    try{await api('/api/doc-comments/'+this.dataset.delDoccomment,{method:'DELETE'});loadDocComments();}catch(ex){toast(ex.message,'err');}
  }));
  el.querySelectorAll('[data-goto]').forEach(row=>row.addEventListener('click',()=>scrollDocToPin(row.dataset.goto)));
}
async function addDocComment(anchor){
  const inp=$('dvCommentInput');if(!inp)return;
  const text=inp.value.trim();if(!text||!currentDocId)return;
  try{
    const mentions=extractMentions(text);
    const body={text,mentions};
    if(anchor){body.anchor_x=anchor.x;body.anchor_y=anchor.y;}
    await api('/api/documents/'+currentDocId+'/comments',{method:'POST',body});
    inp.value='';hideMentionBox();
    loadDocComments();
    if(anchor) toast('Commentaire placé dans le document 📍');
    if(mentions.length){toast(`${mentions.length} personne(s) notifiée(s)`);await loadNotifications();renderNotifBell();}
  }catch(e){toast(e.message,'err');}
}

async function docTransition(){
  if(!currentDocId)return;
  const phase=$('f_docPhase').value;
  const assigneeVal=$('f_docAssignee').value;
  const note=$('f_docTransNote').value.trim();
  const notify=$('f_docNotify').checked;
  const ph=DOC_PHASE_BY_KEY[phase];
  const body={phase, assigned_to: assigneeVal?parseInt(assigneeVal,10):null, note, notify};
  // Signature électronique requise pour Approbation / Prêt QMS
  if(DOC_SIGN_PHASES.includes(phase)){
    const reason=$('f_docSignReason').value.trim();
    const pwd=$('f_docSignPwd').value;
    if(!reason){toast('Indique le motif de la signature.','err');$('f_docSignReason').focus();return;}
    if(!pwd){toast('Confirme ton mot de passe pour signer.','err');$('f_docSignPwd').focus();return;}
    body.reason=reason;body.password=pwd;
  }
  try{
    const r=await api('/api/documents/'+currentDocId+'/transition',{method:'POST',body});
    toast((DOC_SIGN_PHASES.includes(phase)?'✒️ Signé et déplacé en « ':'Document déplacé en « ')+(ph?ph.label:phase)+' »');
    // Notification email via Outlook (mailto) — ouvre depuis ton compte
    if(notify && assigneeVal && r.assignee_email){
      const docName=currentDocObj?currentDocObj.name:'document';
      const appUrl=window.location.origin;
      const subject=`[Document qualité] ${docName} — ${ph?ph.label:phase} : action requise`;
      const body=`Bonjour ${(r.assignee_name||'').split(' ')[0]},\n\nLe document « ${docName} » vient de passer en phase « ${ph?ph.label:phase} » et t'a été assigné pour action / revue.\n${note?'\nNote : '+note+'\n':''}\nAccède à l'application pour le consulter :\n${appUrl}\n\nMerci,\n${ME.name}`;
      window.location.href='mailto:'+encodeURIComponent(r.assignee_email)+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
    }else if(notify && assigneeVal && !r.assignee_email){
      toast("Pas d'email pour cette personne — notification in-app seulement.",'warn');
    }
    await loadNotifications();renderNotifBell();
    openDocDetail(currentDocId);
    renderDocs();
  }catch(e){toast(e.message,'err');}
}

async function uploadNewVersion(file){
  if(!file||!currentDocId)return;
  const note=prompt('Note de version (décris brièvement ce que tu as modifié) :','')||'';
  const fd=new FormData();
  fd.append('file',file);
  fd.append('note',note);
  try{
    const r=await fetch('/api/documents/'+currentDocId+'/versions',{method:'POST',body:fd});
    if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.detail||'Erreur '+r.status);}
    toast('Nouvelle version enregistrée');
    refreshDocViews(currentDocId);
  }catch(e){toast(e.message,'err');}
}

async function saveDoc(){
  const name=$('f_docName').value.trim();
  const file=$('f_docFile').files[0];
  if(!name){toast('Le nom est obligatoire.','err');return;}
  if(!file){toast('Sélectionne un fichier.','err');return;}
  const fd=new FormData();
  fd.append('name',name);
  fd.append('description',$('f_docDesc').value.trim());
  fd.append('note',$('f_docNote').value.trim());
  fd.append('doc_type',$('f_docType').value);
  fd.append('folder',$('f_docFolder')?$('f_docFolder').value.trim():'');
  const pid=$('f_docProject').value;
  if(pid) fd.append('project_id',pid);
  fd.append('file',file);
  try{
    const r=await fetch('/api/documents',{method:'POST',body:fd});
    if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.detail||'Erreur '+r.status);}
    closeModal('docCreateModal');
    $('f_docName').value='';$('f_docDesc').value='';$('f_docNote').value='';$('f_docFile').value='';
    toast('Document ajouté');
    renderDocs();
  }catch(e){toast(e.message,'err');}
}

async function lockDoc(id){
  try{await api('/api/documents/'+id+'/lock',{method:'POST',body:{}});refreshDocViews(id);}
  catch(e){toast(e.message,'err');}
}
async function unlockDoc(id){
  try{await api('/api/documents/'+id+'/unlock',{method:'POST',body:{}});refreshDocViews(id);}
  catch(e){toast(e.message,'err');}
}
async function deleteDoc(id){
  if(!confirm('Supprimer ce document et tout son historique de versions ? Action irréversible.'))return;
  try{await api('/api/documents/'+id,{method:'DELETE'});closeModal('docDetailModal');toast('Document supprimé','warn');renderDocs();}
  catch(e){toast(e.message,'err');}
}
function openDocCreate(){
  $('f_docProject').innerHTML='<option value="">— Document de service (général) —</option>'+state.projects.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  $('docCreateModal').classList.add('show');
  $('f_docFile').value='';$('f_docName').value='';if($('f_docFolder'))$('f_docFolder').value='';
}
// Auto-remplit le nom du document depuis le fichier choisi (modifiable ensuite)
if($('f_docFile')) $('f_docFile').addEventListener('change',function(){
  const f=this.files[0];if(!f)return;
  const base=f.name.replace(/\.[^.]+$/,'');  // sans extension
  if(!$('f_docName').value.trim()) $('f_docName').value=base;
});

/* ====== Import de planning / Gantt (IA) ====== */
let _ganttTasks=[];
function startGanttImport(file){
  if(!state.currentProject){toast('Sélectionne d\'abord un projet.','err');return;}
  toast('🤖 Analyse du planning par l\'IA…');
  const fd=new FormData();fd.append('file',file);
  fetch('/api/projects/'+state.currentProject+'/import-gantt',{method:'POST',body:fd})
    .then(async r=>{if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.detail||'Erreur '+r.status);}return r.json();})
    .then(d=>{_ganttTasks=d.tasks||[];if(!_ganttTasks.length){toast('Aucune tâche détectée dans ce fichier.','warn');return;}openGanttReview();})
    .catch(e=>toast(e.message,'err'));
}
function openGanttReview(){
  const proj=projById(state.currentProject);
  $('ganttSub').innerHTML=`<strong>${_ganttTasks.length}</strong> tâche(s) détectée(s) pour « ${esc(proj?proj.name:'')} ». Décoche celles à ignorer, ajuste, puis importe. Les tâches <strong>Fournisseur</strong> seront taguées automatiquement.`;
  renderGanttList();
  $('ganttModal').classList.add('show');
}
function renderGanttList(){
  $('ganttList').innerHTML=`<div class="gantt-row gantt-head"><span></span><span>Tâche</span><span>Début</span><span>Échéance</span><span>Fourn.</span></div>`+
    _ganttTasks.map((t,i)=>`<div class="gantt-row">
      <input type="checkbox" class="gantt-ck" data-i="${i}" checked>
      <input class="gantt-title" data-i="${i}" value="${esc(t.title||'')}">
      <input type="date" class="gantt-start" data-i="${i}" value="${esc((t.start_date||'').slice(0,10))}">
      <input type="date" class="gantt-due" data-i="${i}" value="${esc((t.due_date||'').slice(0,10))}">
      <input type="checkbox" class="gantt-extck" data-i="${i}" ${t.external?'checked':''}>
    </div>`).join('');
}
async function applyGanttImport(){
  const L=$('ganttList');
  L.querySelectorAll('.gantt-title').forEach(inp=>{_ganttTasks[inp.dataset.i].title=inp.value;});
  L.querySelectorAll('.gantt-start').forEach(inp=>{_ganttTasks[inp.dataset.i].start_date=inp.value;});
  L.querySelectorAll('.gantt-due').forEach(inp=>{_ganttTasks[inp.dataset.i].due_date=inp.value;});
  L.querySelectorAll('.gantt-extck').forEach(inp=>{_ganttTasks[inp.dataset.i].external=inp.checked;});
  const sel=[];
  L.querySelectorAll('.gantt-ck:checked').forEach(ck=>sel.push(_ganttTasks[ck.dataset.i]));
  if(!sel.length){toast('Aucune tâche cochée.','warn');return;}
  try{
    const r=await api('/api/projects/'+state.currentProject+'/gantt-apply',{method:'POST',body:{tasks:sel}});
    closeModal('ganttModal');
    toast(`✅ ${r.created} tâche(s) importée(s) dans le projet`);
    state.tasks=await api('/api/tasks?project_id='+state.currentProject);
    await loadProjectTags();
    renderAll();
  }catch(e){toast(e.message,'err');}
}

/* ====== Toasts ====== */
function toast(msg, type='ok'){
  let container=$('toastContainer');
  if(!container){container=document.createElement('div');container.id='toastContainer';container.className='toast-container';document.body.appendChild(container);}
  const t=document.createElement('div');t.className=`toast toast-${type}`;t.textContent=msg;
  container.appendChild(t);
  requestAnimationFrame(()=>requestAnimationFrame(()=>t.classList.add('show')));
  setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),300);},3500);
}

/* ====== Vue Liste ====== */
function renderList(){
  const head=$('listHead'), body=$('listBody');
  if(!head||!body)return;
  const ts=projTasks().slice().sort((a,b)=>{
    let va=a[listSort]||'', vb=b[listSort]||'';
    if(listSort==='priority'){const w={h:3,m:2,l:1};va=w[va]||0;vb=w[vb]||0;}
    return (va>vb?1:va<vb?-1:0)*listDir;
  });
  const cols=['title','assignee','priority','status','start_date','due_date','progress'];
  const labels={title:'Titre',assignee:'Assigné',priority:'Priorité',status:'Statut',start_date:'Début',due_date:'Échéance',progress:'%'};
  head.innerHTML='<tr>'+cols.map(c=>{
    const ic=listSort===c?(listDir===1?'↑':'↓'):'';
    return `<th data-sort="${c}">${labels[c]} <span class="sort-ic">${ic}</span></th>`;
  }).join('')+'<th></th></tr>';
  if(!ts.length){body.innerHTML='<tr><td colspan="8" class="empty">Aucune tâche dans ce projet.</td></tr>';return;}
  body.innerHTML=ts.map(t=>{
    const late=isLate(t);
    const u=userById(t.assignee_id);
    const prioOpts=['h','m','l'].map(v=>`<option value="${v}"${t.priority===v?' selected':''}>${PRIO_LABEL[v]}</option>`).join('');
    const statOpts=['todo','prog','done'].map(v=>`<option value="${v}"${t.status===v?' selected':''}>${STATUS_LABEL[v]}</option>`).join('');
    return `<tr class="${late?'late-row':''}">
      <td><span data-edit-task="${t.id}" style="cursor:pointer;font-weight:600">${esc(t.title)}</span></td>
      <td>${esc(u?u.name:'—')}</td>
      <td><select class="list-inline-sel" data-list-prio="${t.id}">${prioOpts}</select></td>
      <td><select class="list-inline-sel" data-list-status="${t.id}">${statOpts}</select></td>
      <td>${fmtDate(t.start_date)}</td>
      <td>${fmtDate(t.due_date)}</td>
      <td>${t.progress||0}%</td>
      <td><button class="x" data-del-task="${t.id}">✕</button></td>
    </tr>`;
  }).join('');
  head.querySelectorAll('th[data-sort]').forEach(th=>th.addEventListener('click',()=>sortList(th.dataset.sort)));
  body.querySelectorAll('[data-list-status]').forEach(sel=>sel.addEventListener('change',async function(){
    try{await api('/api/tasks/'+this.dataset.listStatus,{method:'PUT',body:{status:this.value}});
    const t=state.tasks.find(x=>x.id==this.dataset.listStatus);if(t)t.status=this.value;
    renderList();renderStats();renderDash();renderKanban();toast('Statut mis à jour');}catch(e){toast(e.message,'err');}
  }));
  body.querySelectorAll('[data-list-prio]').forEach(sel=>sel.addEventListener('change',async function(){
    try{await api('/api/tasks/'+this.dataset.listPrio,{method:'PUT',body:{priority:this.value}});
    const t=state.tasks.find(x=>x.id==this.dataset.listPrio);if(t)t.priority=this.value;
    renderList();toast('Priorité mise à jour');}catch(e){toast(e.message,'err');}
  }));
}
function sortList(field){
  if(listSort===field)listDir*=-1; else{listSort=field;listDir=1;}
  renderList();
}
function exportCSV(){
  const ts=projTasks();if(!ts.length){toast('Aucune tâche à exporter','warn');return;}
  const proj=projById(state.currentProject);
  const header='Titre,Responsable,Priorité,Statut,Début,Échéance,Avancement';
  const rows=ts.map(t=>[
    `"${(t.title||'').replace(/"/g,'""')}"`,
    `"${userName(t.assignee_id)}"`,
    PRIO_LABEL[t.priority],
    STATUS_LABEL[t.status],
    t.start_date||'',
    t.due_date||'',
    (t.progress||0)+'%'
  ].join(','));
  const csv='﻿'+header+'\n'+rows.join('\n');
  const a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download=`taches-${(proj?.name||'projet').replace(/\s+/g,'-')}.csv`;
  a.click();
  toast('Export CSV téléchargé');
}

/* ====== Recherche (Ctrl+K) ====== */
function openSearch(){
  $('searchModal').classList.add('show');
  $('searchInput').value='';
  $('searchResults').innerHTML='<div class="search-empty">Commence à taper…</div>';
  setTimeout(()=>$('searchInput').focus(),50);
}
async function doSearch(q){
  if(!q||q.length<2){$('searchResults').innerHTML='<div class="search-empty">Commence à taper…</div>';return;}
  try{
    const r=await api('/api/search?q='+encodeURIComponent(q));
    let html='';
    if(r.projects.length){
      html+=`<div class="search-group"><div class="search-group-label">Projets</div>`;
      html+=r.projects.map(p=>`<div class="search-item" data-search-proj="${p.id}"><span class="search-item-icon">📁</span>${esc(p.name)}</div>`).join('');
      html+='</div>';
    }
    if(r.tasks.length){
      html+=`<div class="search-group"><div class="search-group-label">Tâches</div>`;
      html+=r.tasks.map(t=>`<div class="search-item" data-edit-task="${t.id}"><span class="search-item-icon">${t.status==='done'?'✅':'📌'}</span><div><div>${esc(t.title)}</div><div style="font-size:11px;color:var(--mut)">${esc(projById(t.project_id)?.name||'')}</div></div></div>`).join('');
      html+='</div>';
    }
    if(!html)html='<div class="search-empty">Aucun résultat</div>';
    $('searchResults').innerHTML=html;
    $('searchResults').querySelectorAll('[data-search-proj]').forEach(el=>el.addEventListener('click',()=>{
      const pid=parseInt(el.dataset.searchProj,10);
      $('projSelect').value=pid;$('projSelect').dispatchEvent(new Event('change'));
      closeModal('searchModal');
    }));
    $('searchResults').querySelectorAll('[data-edit-task]').forEach(el=>el.addEventListener('click',()=>{
      closeModal('searchModal');openTask(el.dataset.editTask);
    }));
  }catch(e){$('searchResults').innerHTML=`<div class="search-empty">Erreur : ${esc(e.message)}</div>`;}
}

/* ====== Sous-tâches ====== */
async function loadSubtasks(taskId){
  if(!taskId){$('subtasksWrap').classList.add('hidden');return;}
  $('subtasksWrap').classList.remove('hidden');
  $('commentsWrap').classList.remove('hidden');
  const [subtasks,comments]=await Promise.all([
    api('/api/tasks/'+taskId+'/subtasks'),
    api('/api/tasks/'+taskId+'/comments')
  ]);
  renderSubtaskList(subtasks, taskId);
  renderCommentList(comments);
}
function renderSubtaskList(subtasks, taskId){
  const done=subtasks.filter(s=>s.done).length, total=subtasks.length;
  $('subtaskList').innerHTML=(total?`<div class="subtask-progress">${done}/${total} complétées</div>`:'')
    +subtasks.map(st=>`<div class="subtask-item" data-stid="${st.id}">
      <input type="checkbox" ${st.done?'checked':''} data-st-toggle="${st.id}">
      <span class="st-title${st.done?' done':''}">${esc(st.title)}</span>
      <button class="x" data-st-del="${st.id}">✕</button>
    </div>`).join('');
  $('subtaskList').querySelectorAll('[data-st-toggle]').forEach(cb=>cb.addEventListener('change',async function(){
    try{await api('/api/subtasks/'+this.dataset.stToggle,{method:'PUT',body:{done:this.checked}});
    const sts=await api('/api/tasks/'+taskId+'/subtasks');renderSubtaskList(sts,taskId);}
    catch(e){toast(e.message,'err');}
  }));
  $('subtaskList').querySelectorAll('[data-st-del]').forEach(btn=>btn.addEventListener('click',async function(){
    try{await api('/api/subtasks/'+this.dataset.stDel,{method:'DELETE'});
    const sts=await api('/api/tasks/'+taskId+'/subtasks');renderSubtaskList(sts,taskId);}
    catch(e){toast(e.message,'err');}
  }));
}
function highlightMentions(escaped){
  state.users.forEach(u=>{const tag='@'+esc(u.name);if(escaped.includes(tag))escaped=escaped.split(tag).join('<span class="mention-tag">'+tag+'</span>');});
  return escaped;
}
function extractMentions(text){
  const ids=[];state.users.forEach(u=>{if(text.includes('@'+u.name))ids.push(u.id);});return ids;
}
function renderCommentList(comments){
  $('commentList').innerHTML=comments.length?comments.map(c=>`<div class="comment-item">
    <div class="comment-header"><span class="comment-author">${esc(c.author)}</span><div class="row" style="gap:8px"><span class="comment-date">${fmtDate(c.created_at.slice(0,10))}</span>${(ME.role==='admin'||c.user_id===ME.id)?`<button class="x" style="font-size:12px" data-del-comment="${c.id}">✕</button>`:''}</div></div>
    <div class="comment-text">${highlightMentions(esc(c.text))}</div>
  </div>`).join(''):'<div style="color:var(--mut);font-size:13px;font-style:italic">Aucun commentaire.</div>';
  if(currentEditTaskId) $('commentList').querySelectorAll('[data-del-comment]').forEach(btn=>btn.addEventListener('click',async function(){
    try{await api('/api/comments/'+this.dataset.delComment,{method:'DELETE'});
    const cs=await api('/api/tasks/'+currentEditTaskId+'/comments');renderCommentList(cs);}
    catch(e){toast(e.message,'err');}
  }));
}

/* ====== Événements ====== */
document.addEventListener('click',function(e){
  const t=e.target.closest('[data-tab],[data-close],[data-edit-task],[data-del-task],[data-edit-person],[data-del-person],[data-del-abs],[data-remind],[data-ack],[data-remind-person],[data-remind-login],[data-open-doc],[data-doc-lock],[data-doc-unlock],[data-doc-delete]');
  if(!t)return;
  if(t.hasAttribute('data-tab'))tab(t.dataset.tab);
  else if(t.hasAttribute('data-close'))closeModal(t.dataset.close);
  else if(t.hasAttribute('data-edit-task'))openTask(t.dataset.editTask);
  else if(t.hasAttribute('data-del-task'))delTask(t.dataset.delTask);
  else if(t.hasAttribute('data-edit-person'))openPerson(t.dataset.editPerson);
  else if(t.hasAttribute('data-del-person'))delPerson(t.dataset.delPerson);
  else if(t.hasAttribute('data-del-abs'))delAbsence(t.dataset.delAbs);
  else if(t.hasAttribute('data-remind'))remindTask(t.dataset.remind);
  else if(t.hasAttribute('data-ack'))ackAlert(t.dataset.ack);
  else if(t.hasAttribute('data-remind-person'))remindPerson(parseInt(t.dataset.remindPerson,10));
  else if(t.hasAttribute('data-remind-login'))remindLogin(t.dataset.remindLogin);
  else if(t.hasAttribute('data-open-doc'))openDocViewer(t.dataset.openDoc);
  else if(t.hasAttribute('data-doc-lock'))lockDoc(t.dataset.docLock);
  else if(t.hasAttribute('data-doc-unlock'))unlockDoc(t.dataset.docUnlock);
  else if(t.hasAttribute('data-doc-delete'))deleteDoc(t.dataset.docDelete);
});
document.querySelectorAll('.modal-bg').forEach(m=>m.addEventListener('click',e=>{if(e.target===m && m.id!=='changePwModal')m.classList.remove('show');}));

$('projSelect').addEventListener('change',async function(){
  state.currentProject=parseInt(this.value,10);
  localStorage.setItem('atelier_curproj',state.currentProject);
  state.tasks=await api('/api/tasks?project_id='+state.currentProject);
  state.alerts=await api('/api/alerts?project_id='+state.currentProject);
  renderAll();
});
$('filterStatus').addEventListener('change',function(){state.filterStatus=this.value;renderTasks();});
$('f_prog').addEventListener('input',function(){$('f_progVal').textContent=this.value;});
$('f_status').addEventListener('change',function(){if(this.value==='done'){$('f_prog').value=100;$('f_progVal').textContent='100';}});

// Boutons projet : admin OU Team Leader
if(CAN_PROJECTS){
  if($('btnAddProj')) $('btnAddProj').addEventListener('click',addProject);
  if($('btnEditProj')) $('btnEditProj').addEventListener('click',editProject);
  if($('btnDelProj')) $('btnDelProj').addEventListener('click',delProject);
}
if(IS_ADMIN){
  $('btnAddPerson').addEventListener('click',()=>openPerson());
  $('appName').addEventListener('click',renameApp);
  $('appLogo').addEventListener('click',()=>$('logoInput').click());
  $('logoInput').addEventListener('change',changeLogo);
}
$('btnAddTask').addEventListener('click',()=>openTask());
$('btnAddAbs').addEventListener('click',openAbsence);
$('btnSaveTask').addEventListener('click',saveTask);
$('btnSavePerson').addEventListener('click',savePerson);
$('btnSaveAbs').addEventListener('click',saveAbsence);
$('btnAckAll').addEventListener('click',ackAll);
// Documents qualité
if($('btnAddDoc')) $('btnAddDoc').addEventListener('click',openDocCreate);
if($('btnSaveDoc')) $('btnSaveDoc').addEventListener('click',saveDoc);
if($('docVersionFile')) $('docVersionFile').addEventListener('change',function(e){const f=e.target.files[0];if(f)uploadNewVersion(f);e.target.value='';});
$('btnExportPDF').addEventListener('click',exportPDF);
$('btnImportDoc').addEventListener('click',()=>$('docInput').click());
$('docInput').addEventListener('change',function(e){const f=e.target.files[0];if(f)startDocImport(f);e.target.value='';});
// Import de planning / Gantt
if($('btnImportGantt')) $('btnImportGantt').addEventListener('click',()=>$('ganttInput').click());
if($('ganttInput')) $('ganttInput').addEventListener('change',function(e){const f=e.target.files[0];if(f)startGanttImport(f);e.target.value='';});
if($('ganttApply')) $('ganttApply').addEventListener('click',applyGanttImport);
if($('ganttAll')) $('ganttAll').addEventListener('click',()=>$('ganttList').querySelectorAll('.gantt-ck').forEach(c=>c.checked=true));
if($('ganttNone')) $('ganttNone').addEventListener('click',()=>$('ganttList').querySelectorAll('.gantt-ck').forEach(c=>c.checked=false));

// Boutons liste
if($('btnExportCSV')) $('btnExportCSV').addEventListener('click',exportCSV);
if($('btnAddTaskList')) $('btnAddTaskList').addEventListener('click',()=>openTask());

// Cloche notifications
if($('btnNotif')) $('btnNotif').addEventListener('click',toggleNotifDropdown);

// Recherche globale (topbar) + raccourci sidebar mobile
if($('btnGlobalSearch')) $('btnGlobalSearch').addEventListener('click',openSearch);
function toggleSidebar(force){
  const sb=$('sidebar'); if(!sb) return;
  const open = force!==undefined ? force : !sb.classList.contains('open');
  sb.classList.toggle('open',open);
  const sc=$('sidebarScrim'); if(sc) sc.classList.toggle('show',open);
}
if($('sidebarToggle')) $('sidebarToggle').addEventListener('click',()=>toggleSidebar());
if($('sidebarScrim')) $('sidebarScrim').addEventListener('click',()=>toggleSidebar(false));
// Sur mobile, refermer la sidebar après navigation
document.querySelectorAll('.side-nav .tab').forEach(t=>t.addEventListener('click',()=>{if(window.innerWidth<=900)toggleSidebar(false);}));

// ====== Effet "dock" macOS : magnification des icônes au survol ======
(function(){
  const nav=document.querySelector('.side-nav');
  if(!nav)return;
  const RADIUS=96, MAXSCALE=0.55, MAXSHIFT=10;
  let raf=null;
  function magnify(my){
    nav.querySelectorAll('.tab').forEach(it=>{
      const ic=it.querySelector('.ic');if(!ic)return;
      const r=it.getBoundingClientRect();
      const center=r.top+r.height/2;
      const t=Math.max(0,1-Math.abs(my-center)/RADIUS);
      const e=t*t;  // falloff doux
      ic.style.transform=`scale(${1+MAXSCALE*e}) translateX(${MAXSHIFT*e}px)`;
    });
  }
  nav.addEventListener('mousemove',e=>{
    const y=e.clientY;
    if(raf)cancelAnimationFrame(raf);
    raf=requestAnimationFrame(()=>magnify(y));
  });
  nav.addEventListener('mouseleave',()=>{
    nav.querySelectorAll('.ic').forEach(ic=>ic.style.transform='');
  });
})();

// Filtres
if($('filterAssignee')) $('filterAssignee').addEventListener('change',applyFilters);
if($('filterPriority')) $('filterPriority').addEventListener('change',applyFilters);
if($('filterStatus')) $('filterStatus').addEventListener('change',applyFilters);

// Tags — ajout via le select
if($('f_tagAdd')) $('f_tagAdd').addEventListener('change',async function(){
  if(!this.value||!currentEditTaskId)return;
  try{
    await api('/api/tasks/'+currentEditTaskId+'/tags/'+this.value,{method:'POST',body:{}});
    const added=projectTags.find(t=>t.id==this.value);
    if(added) currentTaskTags.push(added);
    renderTaskTagsUI();toast('Étiquette ajoutée');
  }catch(e){toast(e.message,'err');}
  this.value='';
});

// Boutons liste

// Recherche Ctrl+K
document.addEventListener('keydown',function(e){
  if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();openSearch();}
  if(e.key==='Escape' && $('searchModal').classList.contains('show'))closeModal('searchModal');
});
if($('searchInput')) $('searchInput').addEventListener('input',function(){doSearch(this.value.trim());});
$('searchModal').addEventListener('click',e=>{if(e.target===$('searchModal'))closeModal('searchModal');});

// Sous-tâches
if($('btnAddSubtask')) $('btnAddSubtask').addEventListener('click',async function(){
  const title=$('f_subtaskTitle').value.trim();
  if(!title||!currentEditTaskId)return;
  try{
    await api('/api/tasks/'+currentEditTaskId+'/subtasks',{method:'POST',body:{title}});
    $('f_subtaskTitle').value='';
    const sts=await api('/api/tasks/'+currentEditTaskId+'/subtasks');
    renderSubtaskList(sts,currentEditTaskId);
    toast('Sous-tâche ajoutée');
  }catch(e){toast(e.message,'err');}
});
if($('f_subtaskTitle')) $('f_subtaskTitle').addEventListener('keydown',e=>{if(e.key==='Enter' && $('btnAddSubtask')) $('btnAddSubtask').click();});

// Commentaires + @mentions
if($('btnAddComment')) $('btnAddComment').addEventListener('click',async function(){
  const text=$('f_commentText').value.trim();
  if(!text||!currentEditTaskId)return;
  try{
    const mentions=extractMentions(text);
    await api('/api/tasks/'+currentEditTaskId+'/comments',{method:'POST',body:{text,mentions}});
    $('f_commentText').value='';
    const cs=await api('/api/tasks/'+currentEditTaskId+'/comments');
    renderCommentList(cs);
    toast(mentions.length?`Commentaire ajouté · ${mentions.length} personne(s) notifiée(s)`:'Commentaire ajouté');
  }catch(e){toast(e.message,'err');}
});
// Autocomplétion @ dans le champ commentaire
let _mentionBox=null;
function hideMentionBox(){if(_mentionBox)_mentionBox.classList.add('hidden');}
function showMentionBox(input){
  const val=input.value, caret=input.selectionStart;
  const m=val.slice(0,caret).match(/@([\wÀ-ÿ'-]*)$/);
  if(!m){hideMentionBox();return;}
  const q=m[1].toLowerCase();
  let users=state.users.filter(u=>u.id!==ME.id);
  if(q) users=users.filter(u=>u.name.toLowerCase().includes(q));
  users=users.slice(0,6);
  if(!users.length){hideMentionBox();return;}
  if(!_mentionBox){_mentionBox=document.createElement('div');_mentionBox.className='mention-box';document.body.appendChild(_mentionBox);}
  _mentionBox.innerHTML=users.map(u=>`<div class="mention-opt" data-uid="${u.id}"><span class="ava" style="width:22px;height:22px;font-size:10px;background:${avaColor(u.id)}">${initials(u.name)}</span>${esc(u.name)}</div>`).join('');
  const r=input.getBoundingClientRect();
  _mentionBox.style.left=r.left+'px';_mentionBox.style.top=(r.bottom+4)+'px';_mentionBox.style.width=Math.max(210,r.width)+'px';
  _mentionBox.classList.remove('hidden');
  _mentionBox.querySelectorAll('.mention-opt').forEach(opt=>opt.addEventListener('mousedown',ev=>{
    ev.preventDefault();
    const u=userById(parseInt(opt.dataset.uid,10));if(!u)return;
    const start=caret-m[0].length;
    input.value=val.slice(0,start)+'@'+u.name+' '+val.slice(caret);
    hideMentionBox();input.focus();
    const np=start+u.name.length+2;input.setSelectionRange(np,np);
  }));
}
if($('f_commentText')){
  $('f_commentText').addEventListener('input',function(){showMentionBox(this);});
  $('f_commentText').addEventListener('blur',()=>setTimeout(hideMentionBox,150));
  $('f_commentText').addEventListener('keydown',e=>{if(e.key==='Escape')hideMentionBox();});
}

// avatar utilisateur dans la barre du haut
$('meAva').style.background=avaColor(ME.id);
$('meAva').textContent=initials(ME.name);

/* ====== Changement de mot de passe forcé ====== */
async function changeMyPassword(){
  const pw=$('f_newPw').value, pw2=$('f_newPw2').value, err=$('changePwErr');
  err.style.display='none';
  if(pw.length<6){err.textContent='Au moins 6 caractères requis.';err.style.display='';return;}
  if(pw!==pw2){err.textContent='Les mots de passe ne correspondent pas.';err.style.display='';return;}
  try{
    await api('/api/me/password',{method:'PUT',body:{password:pw}});
    $('changePwModal').classList.remove('show');
    ME.must_change_password=false;
  }catch(e){err.textContent=e.message;err.style.display='';}
}
$('btnSendInvite').addEventListener('click',function(){
  const d=window._inviteData;if(!d)return;
  const appUrl=window.location.origin;
  const appName=document.title;
  const subject=`Invitation à ${appName}`;
  const body=`Bonjour ${d.name.split(' ')[0]},\n\nTu as été ajouté(e) à l'application de gestion de projet "${appName}".\n\nPour te connecter :\n${appUrl}\n\nEmail : ${d.email}\nMot de passe temporaire : ${d.password}\n\nLors de ta première connexion, tu devras choisir un nouveau mot de passe personnel.\n\nÀ bientôt !`;
  window.location.href='mailto:'+encodeURIComponent(d.email)+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
});
$('btnChangePw').addEventListener('click',changeMyPassword);
[$('f_newPw'),$('f_newPw2')].forEach(inp=>inp.addEventListener('keydown',e=>{if(e.key==='Enter')changeMyPassword();}));
if(ME.must_change_password) $('changePwModal').classList.add('show');

loadAll().then(()=>{ if($('sec-me') && !$('sec-me').classList.contains('hidden')) renderMe(); });
