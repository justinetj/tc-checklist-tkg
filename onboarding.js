// Agent On-boarding & Off-boarding.
// Moved here from the standalone agent hub. Rows stay in onboard_store under
// the key 'data' — the same table and key the agent hub used — so every agent
// and every checkmark carries straight over.
import crypto from "crypto";

const ADMIN_USER = "DOO";
let pool;
export const setOnboardPool = p => { pool = p; };

const ONBOARD_PATHS = ["/onboarding", "/api/agents", "/api/recruits"];
export const isOnboardPath = p =>
  ONBOARD_PATHS.includes(p) ||
  /^\/a\/[a-f0-9]+$/.test(p) ||
  /^\/api\/(agents|recruits)\/[a-f0-9]+(\/[a-z/]+)?$/.test(p);

let onbInit;
async function initDb() {
  if (!onbInit) onbInit = pool.query(`CREATE TABLE IF NOT EXISTS onboard_store (key TEXT PRIMARY KEY, value JSONB NOT NULL)`);
  await onbInit;
}
async function loadData() {
  await initDb();
  const r = await pool.query(`SELECT value FROM onboard_store WHERE key = 'data'`);
  return r.rows[0]?.value || { agents: {} };
}
let writeQueue = Promise.resolve();
function withData(fn) {
  const job = writeQueue.then(async () => {
    const data = await loadData();
    const out = fn(data);
    await pool.query(
      `INSERT INTO onboard_store (key, value) VALUES ('data', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`, [JSON.stringify(data)]);
    return out;
  });
  writeQueue = job.catch(() => {});
  return job;
}

const ONBOARD_ITEMS = [
  { id: "on33", phase: "On-boarding", label: "DOO to send welcome text" },
  { id: "on20", phase: "On-boarding", label: "Scott to send eXp application" },
  { id: "on21", phase: "On-boarding", label: "DOO to send team agreement" },
  { id: "on22", phase: "On-boarding", label: "eXp application complete and approved" },
  { id: "on23", phase: "On-boarding", label: "eXp license transferred (if applicable)" },
  { id: "on24", phase: "On-boarding", label: "Scott to send welcome email (copy DOO)" },
  { id: "on2",  phase: "On-boarding", label: "Meet with Ashley" },
  { id: "on3",  phase: "On-boarding", label: "Meet with Scott" },
  { id: "on26", phase: "On-boarding", label: "Join Skool" },
  { id: "on26a", phase: "On-boarding", label: "The Kumler Group", indent: true },
  { id: "on26b", phase: "On-boarding", label: "GSD Mode",         indent: true },
  { id: "on26c", phase: "On-boarding", label: "Wolf Pack",        indent: true },
  { id: "on28", phase: "On-boarding", label: "Head shot & bio" },
  { id: "on28a", phase: "On-boarding", label: "Send to Kevin for welcome post", indent: true },
  { id: "on29", phase: "On-boarding", label: "Add to agent roster" },
  { id: "on31", phase: "On-boarding", label: "Add to workbook" },
  { id: "on10", phase: "On-boarding", label: "Schedule buyer consultation with DOO" },
  { id: "on11", phase: "On-boarding", label: "Schedule listing presentation with DOO" },
  { id: "on12", phase: "On-boarding", label: "Email DOO for technology setup" },
  { id: "on5",  phase: "On-boarding", label: "Get systems set up" },
  { id: "on5a", phase: "On-boarding", label: "Add to Email",     indent: true },
  { id: "on5a1", phase: "On-boarding", label: "Team",   indent2: true },
  { id: "on5a2", phase: "On-boarding", label: "Zillow", indent2: true },
  { id: "on5b", phase: "On-boarding", label: "Add to AgentFire", indent: true },
  { id: "on5c", phase: "On-boarding", label: "Add to Ruuster",   indent: true },
  { id: "on5d", phase: "On-boarding", label: "Add to FUB",       indent: true },
  { id: "on5e", phase: "On-boarding", label: "Add to Skool",     indent: true },
  { id: "on5f", phase: "On-boarding", label: "Add to Slack",     indent: true },
  { id: "on5g", phase: "On-boarding", label: "Add to Ponds",    indent: true },
  { id: "on5h", phase: "On-boarding", label: "Add to Fello",    indent: true },
  { id: "on5i", phase: "On-boarding", label: "Add to HouseWhisper", indent: true },
  { id: "on5i1", phase: "On-boarding", label: "Add assistant", indent2: true },
  { id: "on5i2", phase: "On-boarding", label: "Add Alex",      indent2: true },
  { id: "on7",  phase: "On-boarding", label: "Zillow training" },
  { id: "on8",  phase: "On-boarding", label: "Follow up after Zillow training" },
];
const OFFBOARD_ITEMS = [
  { id: "off1", phase: "Wind Down", label: "Transfer license out" },
  { id: "off2", phase: "Wind Down", label: "Collect open house signs" },
  { id: "off3", phase: "Wind Down", label: "Final commission reconciliation" },
  { id: "off7", phase: "Wind Down", label: "Check FUB past clients" },
  { id: "off4", phase: "Wind Down", label: "Remove from website" },
  { id: "off6", phase: "Wind Down", label: "Move from active to removed in workbook" },
  { id: "off5a", phase: "Systems Removal", label: "Remove from Email" },
  { id: "off5j", phase: "Systems Removal", label: "Remove from any calendar invites" },
  { id: "off5c", phase: "Systems Removal", label: "Remove from Ruuster" },
  { id: "off5d", phase: "Systems Removal", label: "Remove from FUB" },
  { id: "off5e", phase: "Systems Removal", label: "Remove from Skool — one week after departure" },
  { id: "off5f", phase: "Systems Removal", label: "Remove from Slack" },
  { id: "off5g", phase: "Systems Removal", label: "Remove from Fello" },
  { id: "off5h", phase: "Systems Removal", label: "Remove from HouseWhisper" },
];
const itemsFor = mode => (mode === "offboarding" ? OFFBOARD_ITEMS : ONBOARD_ITEMS);

// Indented rows belong to the last row above them at a shallower level, so a
// parent knows its children without the item list needing explicit nesting.
function childMap(items) {
  const kids = {}, lastAt = {};
  for (const it of items) {
    const level = it.indent2 ? 2 : it.indent ? 1 : 0;
    lastAt[level] = it.id;
    if (level > 0) {
      const parent = lastAt[level - 1];
      if (parent) (kids[parent] = kids[parent] || []).push(it.id);
    }
  }
  // A grandparent owns its grandchildren as well.
  for (const p of Object.keys(kids)) {
    const seen = new Set(kids[p]);
    for (const c of [...kids[p]]) for (const g of (kids[c] || [])) if (!seen.has(g)) { seen.add(g); kids[p].push(g); }
  }
  return kids;
}


// ── Storage (serialized writes, own table so it never touches the TC data) ──
let initDone;
// Arizona is UTC-7 with no DST.
const todayAZ = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Phoenix" });
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const fmtDate = iso => { if (!iso) return "\u2014"; const [y, m, d] = iso.split("-"); return `${+m}/${+d}/${y.slice(2)}`; };

function agentProgress(a) {
  const items = itemsFor(a.mode);
  const all = items.map(i => i.id).concat((a.customTasks || []).map(t => t.id));
  const done = all.filter(id => (a.checked || {})[id]).length;
  return { done, total: all.length, pct: all.length ? Math.round(done / all.length * 100) : 0 };
}
function overdueCount(a) {
  const t = todayAZ();
  let n = 0;
  for (const i of itemsFor(a.mode)) if (!(a.checked || {})[i.id] && (a.meta || {})[i.id]?.due && a.meta[i.id].due < t) n++;
  for (const c of (a.customTasks || [])) if (!(a.checked || {})[c.id] && c.due && c.due < t) n++;
  return n;
}

// ── Shared style ─────────────────────────────────────────────────────────────
const STYLE = `
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 100 100%27><circle cx=%2750%27 cy=%2750%27 r=%2748%27 fill=%27%23CB2CFB%27/><circle cx=%2744%27 cy=%2738%27 r=%2712%27 fill=%27none%27 stroke=%27white%27 stroke-width=%277%27/><path d=%27M22 78 a22 22 0 0 1 44 0%27 fill=%27none%27 stroke=%27white%27 stroke-width=%277%27 stroke-linecap=%27round%27/><path d=%27M70 30 v20 M60 40 h20%27 stroke=%27white%27 stroke-width=%277%27 stroke-linecap=%27round%27/></svg>">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Inter',-apple-system,sans-serif; background:#f2f5f9; color:#1c2733; }
  .header { background:#66187E; color:white; padding:10px 24px; display:flex; align-items:center; justify-content:space-between; }
  .header h1 { font-size:16px; font-weight:600; letter-spacing:-.01em; }
  .header .sub { font-size:11.5px; color:#cba8e0; margin-top:2px; font-weight:600; }
  .header a.back { color:rgba(255,255,255,.75); text-decoration:none; font-size:11px; font-weight:600; border:1px solid rgba(255,255,255,.3); border-radius:6px; padding:3px 9px; margin-right:12px; }
  .btn { background:#a21caf; color:white; border:none; padding:9px 16px; border-radius:8px; font-size:12.5px; font-weight:600; cursor:pointer; font-family:inherit; }
  .btn:hover { background:#86198f; transform:scale(1.04); }
  .btn { transition:transform .1s, background .12s; }
  .container { max-width:980px; margin:12px auto; padding:0 16px; }
  .tabs { display:flex; gap:5px; background:white; border:1px solid #e5eaf1; padding:4px; border-radius:11px; width:fit-content; margin-bottom:14px; box-shadow:0 1px 3px rgba(102,24,126,.06); }
  .tab { border:none; background:transparent; font-family:inherit; font-weight:600; font-size:12.5px; color:#5b6b7f; padding:7px 16px; border-radius:8px; cursor:pointer; }
  .tab.on { background:#66187E; color:white; }
  .tab .n { background:#eef2f8; color:#5b6b7f; border-radius:99px; font-size:10.5px; padding:1px 7px; margin-left:5px; }
  .tab.on .n { background:rgba(255,255,255,.18); color:white; }
  .card { background:white; border:1.5px solid #e5eaf1; border-radius:13px; box-shadow:0 1px 3px rgba(102,24,126,.05); overflow:hidden; margin-bottom:13px; transition:transform .12s, box-shadow .12s, border-color .12s; }

  table { width:100%; border-collapse:collapse; }
  th { text-align:left; padding:5px 12px; background:#fafbfd; font-size:9.5px; color:#5b6b7f; font-weight:600; text-transform:uppercase; letter-spacing:.05em; border-bottom:1px solid #e5eaf1; }
  td { padding:2px 11px; border-bottom:1px solid #f1f4f8; font-size:12px; }
  tr:last-child td { border-bottom:none; }
  tr.rowlink { cursor:pointer; } tr.rowlink td { transition:background .14s ease; }
  tr.rowlink:hover td { background:#faf0fe; }
  tr.rowlink:hover td:first-child { box-shadow:inset 3px 0 0 #CB2CFB; }
  .empty { padding:22px; text-align:center; color:#8896a5; font-size:12.5px; font-weight:600; }
  .bar { height:6px; border-radius:99px; background:#edf1f6; width:110px; display:inline-block; vertical-align:middle; }
  .bar i { display:block; height:6px; border-radius:99px; }
  .pct { font-size:11px; font-weight:600; margin-left:7px; }
  .pill { display:inline-block; font-size:10.5px; font-weight:600; border-radius:99px; padding:2px 9px; }
  .modal-bg { display:none; position:fixed; inset:0; background:rgba(12,26,41,.5); z-index:100; align-items:center; justify-content:center; }
  .modal-bg.open { display:flex; }
  .modal { background:white; border-radius:14px; padding:24px; width:420px; max-width:94vw; box-shadow:0 12px 40px rgba(12,26,41,.25); }
  .modal h2 { font-size:15px; margin-bottom:16px; color:#66187E; font-weight:600; }
  .field { margin-bottom:11px; }
  .field label { display:block; font-size:10px; font-weight:600; color:#5b6b7f; margin-bottom:4px; text-transform:uppercase; letter-spacing:.05em; }
  .field input, .field select { width:100%; border:1px solid #d5dde8; border-radius:7px; padding:8px 10px; font-size:13px; outline:none; font-family:inherit; }
  .field input:focus { border-color:#a21caf; }
  .modal-actions { display:flex; gap:8px; justify-content:flex-end; margin-top:16px; }
  .btn-ghost { background:#eef2f8; color:#66187E; border:none; padding:9px 16px; border-radius:8px; font-size:12.5px; font-weight:600; cursor:pointer; font-family:inherit; }
</style>`;


// ── Overview (dashboard) ─────────────────────────────────────────────────────
function overviewHTML(data, user) {
  const agents = Object.entries(data.agents || {});
  const isDone = a => a.status === "done" || (agentProgress(a).total > 0 && agentProgress(a).pct === 100);
  const byMode = mode => agents.filter(([, a]) => a.mode === mode && !isDone(a)).sort((x, y) => (x[1].name || "").localeCompare(y[1].name || ""));
  const finished = agents.filter(([, a]) => isDone(a)).sort((x, y) => (y[1].doneAt || 0) - (x[1].doneAt || 0));

  const row = ([id, a]) => {
    const p = agentProgress(a);
    const od = overdueCount(a);
    const barColor = "#66187E";
    const cellInp = (key, val, type, w) => `<td onclick="event.stopPropagation()" style="padding-top:2px;padding-bottom:2px"><input type="${type}" value="${esc(val || "")}" data-orig="${esc(val || "")}"
      onblur="if(this.value!==this.dataset.orig)ovField('${id}','${key}',this.value)" onkeydown="if(event.key==='Enter')this.blur()"
      style="width:${w};border:1px solid transparent;border-radius:6px;padding:3px 6px;font-size:12px;font-family:inherit;color:#5b6b7f;background:transparent;outline:none"
      onfocus="this.style.borderColor='#CB2CFB';this.style.background='white'"></td>`;
    return `<tr class="rowlink" onclick="location='/a/${id}?user=${encodeURIComponent(user)}'">
      <td style="font-weight:400;color:#66187E">${esc(a.name)}</td>
      ${cellInp('hireDate', a.hireDate, 'date', '128px')}
      ${cellInp('email', a.email, 'text', '235px')}
      ${cellInp('phone', a.phone, 'text', '118px')}
      ${cellInp('mlsId', a.mlsId, 'text', '86px')}
      <td style="white-space:nowrap"><span class="bar"><i style="width:${p.pct}%;background:linear-gradient(90deg,#66187E,#CB2CFB)"></i></span><span class="pct" style="color:${barColor}">${p.pct}%</span></td>
      <td>${od ? `<span class="pill" style="background:#fee2e2;color:#dc2626">${od} overdue</span>` : `<span class="pill" style="background:#e9f7ef;color:#15803d">on track</span>`}</td>
    </tr>`;
  };
  const tbl = (list, dateLabel) => list.length
    ? `<table><thead><tr><th>Agent</th><th>${dateLabel}</th><th>Email</th><th>Phone</th><th>MLS ID</th><th>Progress</th><th>Status</th></tr></thead><tbody>${list.map(row).join("")}</tbody></table>`
    : `<div class="empty">No agents here yet — add one above.</div>`;

  const onb = byMode("onboarding"), offb = byMode("offboarding");

  // Recruits: people the team agreement has gone out to, before they are
  // onboarding. "Start on-boarding" turns one into a full checklist.
  const RSTATUS = ["Agreement sent", "Signed", "Not joining"];
  const recruits = Object.entries(data.recruits || {})
    .sort((x, y) => String(y[1].sentDate || "").localeCompare(String(x[1].sentDate || "")));
  const recFld = (id, key, val, type, w, col) => `<input type="${type}" value="${esc(val || "")}" data-orig="${esc(val || "")}"
      onblur="if(this.value!==this.dataset.orig)recField('${id}','${key}',this.value)" onkeydown="if(event.key==='Enter')this.blur()"
      style="width:${w};border:1px solid transparent;border-radius:6px;padding:3px 6px;font-size:12px;font-family:inherit;color:${col || "#5b6b7f"};background:transparent;outline:none"
      onfocus="this.style.borderColor='#CB2CFB';this.style.background='white'">`;
  const recInp = (id, key, val, type, w, col) => `<td style="padding-top:2px;padding-bottom:2px">${recFld(id, key, val, type, w, col)}</td>`;
  const recRow = ([id, r]) => {
    const st = RSTATUS.includes(r.status) ? r.status : "Agreement sent";
    const pillCol = st === "Signed" ? "background:#e9f7ef;color:#15803d" : st === "Not joining" ? "background:#eef2f8;color:#5b6b7f" : "background:#f3e0fb;color:#66187E";
    return `<tr>
      <td style="padding-top:2px;padding-bottom:2px">${recFld(id, 'name', r.name, 'text', '170px', '#66187E')}</td>
      ${recInp(id, 'sentDate', r.sentDate, 'date', '128px')}
      ${recInp(id, 'email', r.email, 'text', '215px')}
      ${recInp(id, 'phone', r.phone, 'text', '118px')}
      <td><select onchange="recField('${id}','status',this.value)" style="border:1px solid #eadef0;border-radius:99px;padding:3px 9px;font-size:11.5px;font-weight:600;font-family:inherit;outline:none;${pillCol}">${
        RSTATUS.map(o => `<option${o === st ? " selected" : ""}>${o}</option>`).join("")}</select></td>
      ${recInp(id, 'note', r.note, 'text', '190px')}
      <td style="white-space:nowrap;text-align:right">
        <button onclick="recOnboard('${id}',this)" title="Create the on-boarding checklist for this recruit" style="background:#66187E;color:white;border:none;border-radius:99px;padding:4px 11px;font-size:11.5px;font-weight:600;font-family:inherit;cursor:pointer">Start on-boarding</button>
        <button onclick="recDel('${id}','${esc((r.name || "").replace(/'/g, ""))}')" title="Remove" style="background:none;border:none;color:#c3ccd6;cursor:pointer;font-size:13px;padding:0 4px">✕</button>
      </td></tr>`;
  };
  const recCard = `<div class="card">
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;padding:12px 14px;border-bottom:1px solid #f1f4f8">
      <div class="field" style="margin:0"><label>Name</label><input id="r-name" placeholder="Recruit name" style="width:180px"></div>
      <div class="field" style="margin:0"><label>Agreement Sent</label><input id="r-sent" type="date" style="width:150px"></div>
      <div class="field" style="margin:0"><label>Email</label><input id="r-email" placeholder="name@email.com" style="width:210px"></div>
      <div class="field" style="margin:0"><label>Phone</label><input id="r-phone" placeholder="480-555-0100" style="width:130px"></div>
      <button class="btn" style="padding:8px 16px;font-size:13px" onclick="recAdd(this)">+ Add Recruit</button>
    </div>
    ${recruits.length
      ? `<table><thead><tr><th>Recruit</th><th>Agreement Sent</th><th>Email</th><th>Phone</th><th>Status</th><th>Notes</th><th></th></tr></thead><tbody>${recruits.map(recRow).join("")}</tbody></table>`
      : `<div class="empty">No recruits yet — add one above once the team agreement goes out.</div>`}
  </div>`;
  const recWaiting = recruits.filter(([, r]) => (r.status || "Agreement sent") === "Agreement sent").length;
  const today = todayAZ();
  const allTasks = [];
  for (const [id, a] of agents) {
    for (const t of (a.customTasks || [])) {
      if (!(a.checked || {})[t.id]) allTasks.push({ aid: id, aname: a.name, t });
    }
  }
  allTasks.sort((x, y) => String(x.t.due || "9999").localeCompare(String(y.t.due || "9999")));
  const taskCard = allTasks.length ? `<div class="card">
    <div style="background:#4a1160;color:white;padding:8px 14px;font-size:11.5px;font-weight:500;text-transform:uppercase;letter-spacing:.5px">Tasks</div>
    ${allTasks.map(({ aid, aname, t }) => `<div style="display:flex;align-items:center;gap:10px;padding:8px 16px;border-bottom:1px solid #f1f4f8">
      <input type="checkbox" style="width:15px;height:15px" onchange="ovCheck('${aid}','${t.id}',this.checked)">
      <input value="${esc(t.label)}" onchange="ovTaskLabel('${aid}','${t.id}',this.value)" style="flex:1;min-width:0;border:none;background:transparent;font-family:inherit;font-size:13.5px;color:#1c1524;outline:none;text-overflow:ellipsis" title="Click to edit">
      <span style="font-size:12px;font-weight:600;color:#66187E;background:#f3e0fb;border-radius:99px;padding:3px 11px;white-space:nowrap">${esc(aname.split(" ")[0])}</span>
      <input type="date" value="${esc(t.due || "")}" onchange="ovTaskDue('${aid}','${t.id}',this.value)" style="border:none;background:transparent;font-family:inherit;font-size:12.5px;font-weight:${t.due && t.due < today ? '700' : '600'};color:${t.due ? (t.due < today ? '#dc2626' : '#4a4453') : '#c3b5cd'};outline:none;width:112px">
      <button onclick="ovTaskDel('${aid}','${t.id}',this)" title="Delete task" style="background:none;border:none;color:#c3ccd6;cursor:pointer;font-size:13px;padding:0">✕</button>
    </div>`).join("")}
  </div>` : "";
  const doneRows = finished.length ? `<div class="card"><table><thead><tr><th>Agent</th><th>Type</th><th>Completed</th></tr></thead><tbody>${
    finished.map(([id, a]) => `<tr class="rowlink" onclick="location='/a/${id}?user=${encodeURIComponent(user)}'">
      <td style="color:#5b6b7f;font-weight:600">${esc(a.name)}</td>
      <td><span class="pill" style="background:#eef2f8;color:#5b6b7f">${a.mode === "offboarding" ? "off-boarding" : "on-boarding"}</span></td>
      <td style="color:#8896a5">${a.doneAt ? fmtDate(new Date(a.doneAt).toLocaleDateString("en-CA", { timeZone: "America/Phoenix" })) : "—"}</td></tr>`).join("")
  }</tbody></table></div>` : "";

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kumler Agent Hub</title>${STYLE}</head><body>
<div class="header">
  <div>
    <h1>Agent Hub</h1>
    <div class="sub">On-boarding &amp; off-boarding · ${esc(user)}</div>
  </div>
  <button class="btn" onclick="document.getElementById('modal').classList.add('open')">+ Add Agent</button>
</div>
<div class="container" style="max-width:1240px">
  <div class="tabs">
    <button class="tab on" data-for="onb" onclick="showTab('onb')">On-boarding <span class="n">${onb.length}</span></button>
    <button class="tab" data-for="offb" onclick="showTab('offb')">Off-boarding <span class="n">${offb.length}</span></button>
    <button class="tab" data-for="rec" onclick="showTab('rec')">Recruits <span class="n">${recWaiting}</span></button>
    ${finished.length ? `<button class="tab" data-for="done" onclick="showTab('done')">Completed <span class="n">${finished.length}</span></button>` : ""}
  </div>
  ${taskCard}
  <div data-tab="onb"><div class="card">${tbl(onb, "Hire Date")}</div></div>
  <div data-tab="offb" style="display:none"><div class="card">${tbl(offb, "Departure Date")}</div></div>
  <div data-tab="rec" style="display:none">${recCard}</div>
  <div data-tab="done" style="display:none">${doneRows || '<div class="empty">Nothing completed yet.</div>'}</div>
</div>

<div style="text-align:center;padding:26px 0 34px">
  <a href="/" style="font-size:12px;font-weight:600;color:#66187E;text-decoration:none;border:1px solid #eadef0;border-radius:99px;padding:7px 18px">← Back</a>
</div>

<div class="modal-bg" id="modal">
  <div class="modal">
    <h2>Add Agent</h2>
    <div class="field"><label>Type</label><select id="f-mode" onchange="document.getElementById('l-hire').textContent = this.value === 'offboarding' ? 'Departure Date' : 'Hire Date'"><option value="onboarding">On-boarding</option><option value="offboarding">Off-boarding</option></select></div>
    <div class="field"><label>Name</label><input id="f-name" placeholder="Agent name"></div>
    <div class="field"><label id="l-hire">Hire Date</label><input id="f-hire" type="date"></div>
    <div class="field"><label>Email</label><input id="f-email" type="email" placeholder="agent@email.com"></div>
    <div class="field"><label>Phone</label><input id="f-phone" placeholder="(480) 555-0100"></div>
    <div class="field"><label>MLS ID</label><input id="f-mls" placeholder="MLS #"></div>
    <div class="field"><label>Valley</label><select id="f-valley"><option value="">—</option><option>East Valley</option><option>West Valley</option><option>Central</option></select></div>
    <div class="modal-actions">
      <button class="btn-ghost" onclick="document.getElementById('modal').classList.remove('open')">Cancel</button>
      <button class="btn" onclick="createAgent()">Create</button>
    </div>
  </div>
</div>
<script>
async function recAdd(btn) {
  const body = { name: document.getElementById('r-name').value.trim(), sentDate: document.getElementById('r-sent').value,
    email: document.getElementById('r-email').value.trim(), phone: document.getElementById('r-phone').value.trim() };
  if (!body.name) { alert('Name is required.'); return; }
  btn.disabled = true;
  await fetch('/api/recruits', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  location.reload();
}
async function recField(id, key, val) {
  await fetch('/api/recruits/' + id + '/field', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ key, val }) });
  location.reload();
}
async function recDel(id, name) {
  if (!confirm('Remove ' + name + ' from recruits?')) return;
  await fetch('/api/recruits/' + id, { method:'DELETE' });
  location.reload();
}
async function recOnboard(id, btn) {
  btn.disabled = true; btn.textContent = 'Creating…';
  const r = await fetch('/api/recruits/' + id + '/onboard', { method:'POST' });
  const a = await r.json();
  if (a.id) location = '/a/' + a.id + '?user=' + (new URLSearchParams(location.search).get('user') || '');
  else { alert('Could not start on-boarding.'); btn.disabled = false; btn.textContent = 'Start on-boarding'; }
}
async function ovField(aid, key, val) {
  await fetch('/api/agents/' + aid + '/field', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ key, val }) });
  location.reload();
}
async function ovTaskLabel(aid, taskId, label) {
  await fetch('/api/agents/' + aid + '/tasks/edit', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ taskId, label }) });
}
async function ovTaskDue(aid, taskId, due) {
  await fetch('/api/agents/' + aid + '/due', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ taskId, due, custom: true }) });
  location.reload();
}
async function ovTaskDel(aid, taskId, btn) {
  if (!confirm('Delete this task?')) return;
  await fetch('/api/agents/' + aid + '/tasks/delete', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ taskId }) });
  location.reload();
}
async function ovCheck(aid, itemId, checked) {
  await fetch('/api/agents/' + aid + '/check', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ itemId, checked }) });
  location.reload();
}
function showTab(name) {
  document.querySelectorAll('[data-tab]').forEach(el => el.style.display = el.dataset.tab === name ? '' : 'none');
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.for === name));
}
async function createAgent() {
  const btn = event.target; btn.disabled = true; btn.textContent = 'Creating…';
  const body = {
    mode: document.getElementById('f-mode').value,
    name: document.getElementById('f-name').value.trim(),
    hireDate: document.getElementById('f-hire').value,
    email: document.getElementById('f-email').value.trim(),
    phone: document.getElementById('f-phone').value.trim(),
    mlsId: document.getElementById('f-mls').value.trim(),
    valley: document.getElementById('f-valley').value,
  };
  if (!body.name) { alert('Name is required.'); btn.disabled = false; btn.textContent = 'Create'; return; }
  const r = await fetch('/api/agents', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const a = await r.json();
  location = '/a/' + a.id + '?user=' + encodeURIComponent(${JSON.stringify("")} || new URLSearchParams(location.search).get('user') || '');
}
document.getElementById('modal').addEventListener('click', function(e){ if (e.target === this) this.classList.remove('open'); });
</script>
</body></html>`;
}

// ── Agent page ───────────────────────────────────────────────────────────────
function agentHTML(id, a, user) {
  const items = itemsFor(a.mode);
  const meta = a.meta || {};
  const checked = a.checked || {};
  const today = todayAZ();
  const p = agentProgress(a);

  const itemRow = (it, custom, extra) => {
    const due = custom ? it.due || "" : meta[it.id]?.due || "";
    const isChecked = !!checked[it.id];
    const overdue = due && !isChecked && due < today;
    return `<tr ${extra || ""} style="${isChecked ? 'opacity:.55' : ''}">
      <td style="width:34px;${it.indent2 ? 'padding-left:56px' : it.indent ? 'padding-left:34px' : ''}"><input type="checkbox" ${isChecked ? "checked" : ""} onchange="check('${it.id}', this.checked)"></td>
      <td style="font-size:13.5px;padding-top:3px;padding-bottom:3px;${isChecked ? 'text-decoration:line-through;color:#8896a5' : ''}${it.indent ? ';color:#5b6b7f' : ''}">${(it.indent || it.indent2) ? "↳ " : ""}${esc(it.label)}${custom ? ' <span class="pill" style="background:#e8f0fe;color:#a21caf">added</span>' : ""}
        <span onclick="showNote(this)" style="cursor:pointer;font-size:${meta[it.id]?.note ? '12px' : '10.5px'};margin-left:8px;color:${meta[it.id]?.note ? '#66187E' : '#d5c8de'};font-style:${meta[it.id]?.note ? 'italic' : 'normal'};text-decoration:none">${meta[it.id]?.note ? esc(meta[it.id].note) : '+ note'}</span><input type="text" value="${esc(meta[it.id]?.note || "")}" placeholder="Add a note…" onchange="setNote('${it.id}', this.value)" onblur="this.style.display='none';this.previousElementSibling.style.display=''" onkeydown="if(event.key==='Enter')this.blur()" style="display:none;border:1px solid #e4d9ec;border-radius:5px;padding:2px 7px;font-size:12px;font-family:inherit;outline:none;margin-left:8px;width:min(300px,50%)"></td>
      <td style="width:88px;white-space:nowrap;text-align:right;padding-right:12px">
        <span onclick="showDue(this)" title="${due ? 'Change due date' : 'Add a due date'}" style="cursor:pointer;font-size:${due ? '12px' : '10.5px'};font-weight:${overdue ? '700' : '500'};color:${due ? (overdue ? '#dc2626' : '#8a7d95') : '#d5c8de'}">${due ? fmtDate(due) : '+ date'}</span>
        <input type="date" value="${due}" onchange="setDue('${it.id}', this.value, ${custom})" onblur="this.style.display='none';this.previousElementSibling.style.display=''"
        style="display:none;border:1px solid #e5eaf1;border-radius:5px;padding:1px 5px;font-size:12px;font-family:inherit"></td>
      <td style="width:34px">${custom ? `<button onclick="delTask('${it.id}')" style="background:none;border:none;color:#c3ccd6;cursor:pointer;font-size:13px">✕</button>` : ""}</td>
    </tr>`;
  };

  // One long list: no phase headings. Items keep their order, and sub-items
  // still collapse under their parent once the whole group is ticked.
  const sections = (() => {
    let rows = "";
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.indent && !it.indent2) {
        const subs = [];
        let j = i + 1;
        while (j < items.length && (items[j].indent || items[j].indent2)) { subs.push(items[j]); j++; }
        if (subs.length && checked[it.id] && subs.every(s => checked[s.id])) {
          rows += `<tr onclick="togGroup('${it.id}')" style="cursor:pointer;opacity:.55">
            <td style="width:34px"><input type="checkbox" checked onclick="event.stopPropagation()" onchange="check('${it.id}', this.checked)"></td>
            <td colspan="3" style="font-size:13.5px;padding-top:3px;padding-bottom:3px;text-decoration:line-through;color:#8896a5">${esc(it.label)} <span style="display:inline-block;font-size:11px;color:#a99bb5;text-decoration:none;margin-left:4px">▸ ${subs.length} done</span></td>
          </tr>`;
          rows += subs.map(s => itemRow(s, false, `class="grp-${it.id}" hidden`)).join("");
          i = j - 1;
          continue;
        }
      }
      rows += itemRow(it, false);
    }
    return `<div class="card"><table style="margin:6px 0 10px"><tbody>${rows}</tbody></table></div>`;
  })();

  const sideRow = (t, done) => `<div style="display:flex;align-items:center;gap:7px;padding:4px 12px;border-bottom:1px solid #f5f0f8;${done ? 'opacity:.6' : ''}">
    <input type="checkbox" ${done ? 'checked' : ''} onchange="check('${t.id}', this.checked)">
    <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;${done ? 'text-decoration:line-through;color:#8896a5' : ''}" title="${esc(t.label)}">${esc(t.label)}</span>
    ${t.due ? `<span style="font-size:11px;font-weight:600;color:${!done && t.due < today ? '#dc2626' : '#8a7d95'};white-space:nowrap">${fmtDate(t.due)}</span>` : ''}
    <button onclick="delTask('${t.id}')" title="Delete task" style="background:none;border:none;color:#c3ccd6;cursor:pointer;font-size:12px;padding:0">✕</button>
  </div>`;
  const openTasksRows = (a.customTasks || []).filter(t => !(a.checked || {})[t.id]).map(t => sideRow(t, false)).join("");
  const doneTasks = (a.customTasks || []).filter(t => (a.checked || {})[t.id]);
  const doneTasksRows = doneTasks.map(t => sideRow(t, true)).join("");
  const profileField = (label, key, type, val) => {
    const has = !!(val && String(val).trim());
    const shown = type === "date" ? fmtDate(val) : esc(val);
    return `
    <div class="field" style="margin-bottom:0">
      <label>${label}</label>
      <div onclick="pfEdit(this)" title="Click to edit" style="font-size:13.5px;font-weight:400;padding:4px 2px;cursor:pointer;min-height:27px;${has ? "color:#1c2733" : "color:#a5b1bf"}">${has ? shown : "Click to add"}</div>
      <input type="${type}" value="${esc(val || "")}" data-key="${key}" data-orig="${esc(val || "")}" style="display:none"
        onblur="pfSave(this)" onkeydown="if(event.key==='Enter')this.blur()">
    </div>`;
  };

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(a.name)} — Kumler Agent Hub</title>${STYLE}</head><body>
<div class="header">
  <div style="display:flex;align-items:center">
    <a class="back" href="/onboarding?user=${encodeURIComponent(user)}">← All Agents</a>
    <div>
      <h1>${esc(a.name)}</h1>
      <div class="sub">${a.mode === "offboarding" ? "Off-boarding" : "On-boarding"} · ${p.done} of ${p.total} done · ${p.pct}%</div>
    </div>
  </div>
  <div style="display:flex;gap:8px">
    ${a.status === "done"
      ? `<button class="btn-ghost" onclick="setStatus('active')">Reopen</button>`
      : `<button class="btn" style="background:#15803d" onclick="markDone()">Mark Complete</button>`}
    <button class="btn-ghost" style="background:#fee2e2;color:#dc2626" onclick="delAgent()">Delete</button>
  </div>
</div>
<div class="container" style="max-width:948px">
  <div class="card" style="padding:8px 14px">
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px 14px">
      ${profileField("Name", "name", "text", a.name)}
      ${profileField(a.mode === "offboarding" ? "Departure Date" : "Hire Date", "hireDate", "date", a.hireDate)}
      ${profileField("Email", "email", "email", a.email)}
      ${profileField("Phone", "phone", "text", a.phone)}
      ${profileField("MLS ID", "mlsId", "text", a.mlsId)}
      <div class="field" style="margin-bottom:0"><label>Valley</label>
        <select style="border:1px solid #e4d9ec;border-radius:7px;padding:5px 8px;font-size:13px;font-family:inherit;color:#1c1524;outline:none" onchange="post('/field',{key:'valley',val:this.value}).then(()=>location.reload())">
          <option value=""${!a.valley ? " selected" : ""}>—</option>
          ${["East Valley","West Valley","Central"].map(v => `<option${a.valley === v ? " selected" : ""}>${v}</option>`).join("")}
        </select>
      </div>
    </div>
  </div>
  <div style="display:flex;gap:16px;align-items:flex-start">
    <div style="flex:1;min-width:0;max-width:600px">
      ${sections}
    </div>
    <div style="width:300px;flex-shrink:0;position:sticky;top:12px">
      <div class="card">
        <div style="background:#4a1160;color:white;padding:9px 14px;font-size:11.5px;font-weight:500;text-transform:uppercase;letter-spacing:.5px">Tasks</div>
        ${openTasksRows || '<div style="padding:12px;text-align:center;color:#a99bb5;font-size:12px">No open tasks</div>'}
        ${doneTasks.length ? `<div onclick="toggleDoneTasks()" style="cursor:pointer;user-select:none;display:flex;justify-content:space-between;align-items:center;padding:6px 12px;background:#fbfafc;border-top:1px solid #f1f4f8;font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#8a7d95">Completed (${doneTasks.length}) <span id="dt-arrow" style="font-size:10px">▼</span></div>
        <div id="dt-body" style="display:none">${doneTasksRows}</div>` : ''}
        <div style="display:flex;flex-direction:column;gap:7px;padding:9px 12px;border-top:1px solid #f1f4f8">
          <input id="new-task" placeholder="Add a task for ${esc(a.name.split(" ")[0])}…" style="border:1px solid #e4d9ec;border-radius:7px;padding:7px 10px;font-size:12.5px;font-family:inherit;outline:none" onkeydown="if(event.key==='Enter')addTask()">
          <div style="display:flex;gap:7px">
            <input id="new-task-due" type="date" style="flex:1;border:1px solid #e4d9ec;border-radius:7px;padding:6px 8px;font-size:12px;font-family:inherit">
            <button class="btn" style="padding:7px 14px" onclick="addTask()">Add</button>
          </div>
        </div>
      </div>
      ${a.mode === "offboarding" ? "" : `<div class="card" style="margin-top:14px">
        <div style="background:#4a1160;color:white;padding:9px 14px;font-size:11.5px;font-weight:500;text-transform:uppercase;letter-spacing:.5px">Roleplay Notes</div>
        <div style="padding:10px 12px">
          <div style="font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#66187E;margin-bottom:4px">Buyer Roleplay</div>
          <textarea onchange="saveNote('buyerRp', this.value)" placeholder="Notes from the buyer consultation roleplay…" style="width:100%;min-height:76px;border:1px solid #e4d9ec;border-radius:8px;padding:8px 10px;font-family:inherit;font-size:12.5px;line-height:1.5;outline:none;resize:vertical">${esc((a.notes || {}).buyerRp || "")}</textarea>
          <div style="font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#66187E;margin:10px 0 4px">Listing Roleplay</div>
          <textarea onchange="saveNote('listingRp', this.value)" placeholder="Notes from the listing presentation roleplay…" style="width:100%;min-height:76px;border:1px solid #e4d9ec;border-radius:8px;padding:8px 10px;font-family:inherit;font-size:12.5px;line-height:1.5;outline:none;resize:vertical">${esc((a.notes || {}).listingRp || "")}</textarea>
          <div style="font-size:10px;color:#a99bb5;margin-top:6px">Saves automatically when you click away</div>
        </div>
      </div>`}
    </div>
  </div>
</div>
<script>
const ID = ${JSON.stringify(id)};
window.KIDS = ${JSON.stringify(childMap(items))};
const API = '/api/agents/' + ID;
async function post(path, body) {
  const r = await fetch(API + path, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  return r.json().catch(() => ({}));
}
async function check(itemId, checked) {
  const kids = (window.KIDS || {})[itemId] || [];
  await post('/check', { itemId, itemIds: [itemId].concat(kids), checked });
  location.reload();
}
function toggleDoneTasks() {
  const b = document.getElementById('dt-body');
  const open = b.style.display === 'none';
  b.style.display = open ? '' : 'none';
  document.getElementById('dt-arrow').textContent = open ? '▲' : '▼';
}
async function setDue(itemId, due, custom) { await post('/due', { itemId, due, custom }); location.reload(); }
function showDue(sp) { sp.style.display = 'none'; const inp = sp.nextElementSibling; inp.style.display = ''; inp.focus(); }
async function setNote(itemId, note) { await post('/inote', { itemId, note }); location.reload(); }
function showNote(sp) { sp.style.display = 'none'; const inp = sp.nextElementSibling; inp.style.display = ''; inp.focus(); }
function pfEdit(view) {
  const inp = view.nextElementSibling;
  view.style.display = 'none';
  inp.style.display = '';
  inp.focus();
}
async function pfSave(inp) {
  if (inp.value === inp.dataset.orig) {
    inp.style.display = 'none';
    inp.previousElementSibling.style.display = '';
    return;
  }
  await post('/field', { key: inp.dataset.key, val: inp.value });
  location.reload();
}
async function addTask() {
  const label = document.getElementById('new-task').value.trim();
  if (!label) return;
  await post('/tasks', { label, due: document.getElementById('new-task-due').value });
  location.reload();
}
async function delTask(taskId) { await post('/tasks/delete', { taskId }); location.reload(); }
async function saveNote(key, text) { await post('/notes', { key, text }); }
function togGroup(gid) { document.querySelectorAll('.grp-' + gid).forEach(r => r.hidden = !r.hidden); }
async function markDone() {
  const open = ${JSON.stringify(true)};
  await post('/status', { status: 'done' });
  location = '/onboarding?user=' + encodeURIComponent(${JSON.stringify(user)});
}
async function setStatus(status) { await post('/status', { status }); location.reload(); }
async function delAgent() {
  if (!confirm('Delete ${esc(a.name)} and this whole checklist? This cannot be undone.')) return;
  await fetch(API, { method: 'DELETE' });
  location = '/onboarding?user=' + encodeURIComponent(${JSON.stringify(user)});
}
</script>
</body></html>`;
}


// ── routes ───────────────────────────────────────────────────────────────────
export async function handleOnboarding(req, res, url, body) {
  const pathname = url.pathname;
    // Recruits: the team agreement has been sent, on-boarding hasn't started.
    if (pathname === "/api/recruits" && req.method === "POST") {
      const b = await body();
      const name = String(b.name || "").trim();
      if (!name) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end('{"error":"name required"}'); }
      const id = crypto.randomBytes(5).toString("hex");
      await withData(data => {
        data.recruits = data.recruits || {};
        data.recruits[id] = { name, sentDate: b.sentDate || "", email: b.email || "", phone: b.phone || "",
          status: "Agreement sent", note: "", createdAt: Date.now() };
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ id }));
    }
    const rm = pathname.match(/^\/api\/recruits\/([a-f0-9]+)(\/[a-z]+)?$/);
    if (rm) {
      const [, rid, rsub] = rm;
      if (req.method === "DELETE" && !rsub) {
        await withData(data => { if (data.recruits) delete data.recruits[rid]; });
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end('{"ok":true}');
      }
      if (req.method === "POST" && rsub === "/field") {
        const b = await body();
        const ok = ["name", "sentDate", "email", "phone", "status", "note"];
        await withData(data => {
          const r = (data.recruits || {})[rid];
          if (r && ok.includes(b.key)) r[b.key] = String(b.val || "").trim();
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end('{"ok":true}');
      }
      if (req.method === "POST" && rsub === "/onboard") {
        const id = crypto.randomBytes(5).toString("hex");
        const out = await withData(data => {
          const r = (data.recruits || {})[rid];
          if (!r) return { missing: true };
          data.agents[id] = { name: r.name, mode: "onboarding", hireDate: "", email: r.email || "", phone: r.phone || "",
            mlsId: "", valley: "", status: "active", createdAt: Date.now(), checked: {}, meta: {}, customTasks: [] };
          delete data.recruits[rid];
          return { ok: true };
        });
        res.writeHead(out.missing ? 404 : 200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(out.missing ? { error: "not found" } : { id }));
      }
    }

    if (req.method === "POST" && pathname === "/api/agents") {
      const { name, mode, hireDate, email, phone, mlsId, valley } = await body();
      const id = crypto.randomBytes(5).toString("hex");
      await withData(data => {
        data.agents[id] = { name: String(name || "").trim(), mode: mode === "offboarding" ? "offboarding" : "onboarding",
          hireDate: hireDate || "", email: email || "", phone: phone || "", mlsId: mlsId || "", valley: valley || "",
          status: "active", createdAt: Date.now(), checked: {}, meta: {}, customTasks: [] };
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ id }));
    }

    const m = pathname.match(/^\/api\/agents\/([a-f0-9]+)(\/.*)?$/);
    if (m) {
      const [, id, sub] = m;
      if (req.method === "DELETE" && !sub) {
        await withData(data => { delete data.agents[id]; });
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: true }));
      }
      if (req.method === "POST") {
        const b = await body();
        await withData(data => {
          const a = data.agents[id];
          if (!a) return;
          if (sub === "/check") {
            a.checked = a.checked || {};
            // A parent row sends its indented children too, so ticking
            // "Schedule buyer consultation" fills in everything under it.
            const ids = Array.isArray(b.itemIds) && b.itemIds.length ? b.itemIds : [b.itemId];
            for (const id of ids) { if (b.checked) { a.checked[id] = true; } else { delete a.checked[id]; } }
          }
          else if (sub === "/due") {
            if (b.custom) { const t = (a.customTasks || []).find(x => x.id === b.taskId || x.id === b.itemId); if (t) t.due = b.due || ""; }
            else { a.meta = a.meta || {}; a.meta[b.itemId] = a.meta[b.itemId] || {}; a.meta[b.itemId].due = b.due || ""; }
          }
          else if (sub === "/field") { const ok = ["name", "hireDate", "email", "phone", "mlsId", "valley"]; if (ok.includes(b.key)) a[b.key] = String(b.val || "").trim(); }
          else if (sub === "/tasks") { a.customTasks = a.customTasks || []; a.customTasks.push({ id: "c" + crypto.randomBytes(4).toString("hex"), label: String(b.label || "").trim(), due: b.due || "" }); }
          else if (sub === "/tasks/delete") { a.customTasks = (a.customTasks || []).filter(t => t.id !== b.taskId); if (a.checked) delete a.checked[b.taskId]; }
          else if (sub === "/tasks/edit") { const tk = (a.customTasks || []).find(x => x.id === b.taskId); if (tk && String(b.label || "").trim()) tk.label = String(b.label).trim(); }
          else if (sub === "/notes") { const ok = ["buyerRp", "listingRp"]; if (ok.includes(b.key)) { a.notes = a.notes || {}; a.notes[b.key] = String(b.text || ""); } }
          else if (sub === "/inote") { a.meta = a.meta || {}; a.meta[b.itemId] = a.meta[b.itemId] || {}; a.meta[b.itemId].note = String(b.note || ""); }
          else if (sub === "/status") { a.status = b.status === "done" ? "done" : "active"; if (b.status === "done") a.doneAt = Date.now(); else delete a.doneAt; }
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: true }));
      }
    }

    const pm = pathname.match(/^\/a\/([a-f0-9]+)$/);
    const user = url.searchParams.get("user") || "";
    if (pm) {
      const data = await loadData();
      const a = data.agents[pm[1]];
      if (!a) { res.writeHead(404); return res.end("Not found"); }
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(agentHTML(pm[1], a, user));
    }


  if (pathname === "/onboarding") {
    const data = await loadData();
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(overviewHTML(data, user || ADMIN_USER));
  }
  res.writeHead(404); return res.end("Not found");
}
