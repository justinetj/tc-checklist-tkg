import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "data.json");
const PORT = process.env.PORT || 3002;

// Load / save data
function loadData() {
  if (!fs.existsSync(DATA_FILE)) return { transactions: {} };
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return { transactions: {} }; }
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const BUYER_ITEMS = [
  // Contract & Opening
  { id: "b1",  section: "Contract & Opening",       label: "Fully executed purchase contract received" },
  { id: "b2",  section: "Contract & Opening",       label: "Earnest money deposited" },
  { id: "b3",  section: "Contract & Opening",       label: "Escrow opened & earnest money confirmed" },
  { id: "b4",  section: "Contract & Opening",       label: "Title ordered" },
  { id: "b5",  section: "Contract & Opening",       label: "Buyer pre-approval letter on file" },
  { id: "b6",  section: "Contract & Opening",       label: "Loan application submitted" },
  // Due Diligence
  { id: "b7",  section: "Due Diligence",            label: "Inspection period noted on calendar" },
  { id: "b8",  section: "Due Diligence",            label: "Home inspection scheduled" },
  { id: "b9",  section: "Due Diligence",            label: "Home inspection completed & report received" },
  { id: "b10", section: "Due Diligence",            label: "BINSR (inspection notice) sent to seller" },
  { id: "b11", section: "Due Diligence",            label: "BINSR response received from seller" },
  { id: "b12", section: "Due Diligence",            label: "Sewer / septic inspection (if applicable)" },
  { id: "b13", section: "Due Diligence",            label: "HOA documents ordered & delivered to buyer" },
  { id: "b14", section: "Due Diligence",            label: "HOA transfer fee confirmed" },
  { id: "b15", section: "Due Diligence",            label: "Seller's Property Disclosure Statement (SPDS) received" },
  { id: "b16", section: "Due Diligence",            label: "Lead-based paint disclosure (if pre-1978)" },
  // Financing
  { id: "b17", section: "Financing",                label: "Loan commitment / approval received" },
  { id: "b18", section: "Financing",                label: "Appraisal ordered" },
  { id: "b19", section: "Financing",                label: "Appraisal completed — value confirmed" },
  { id: "b20", section: "Financing",                label: "Appraisal gap addendum (if needed)" },
  { id: "b21", section: "Financing",                label: "Loan conditions cleared" },
  { id: "b22", section: "Financing",                label: "Clear to close received" },
  // Title & Insurance
  { id: "b23", section: "Title & Insurance",        label: "Preliminary title report reviewed" },
  { id: "b24", section: "Title & Insurance",        label: "Title exceptions reviewed with buyer" },
  { id: "b25", section: "Title & Insurance",        label: "Homeowner's insurance bound" },
  // Closing Prep
  { id: "b26", section: "Closing Prep",             label: "Final walkthrough scheduled" },
  { id: "b27", section: "Closing Prep",             label: "Final walkthrough completed" },
  { id: "b28", section: "Closing Prep",             label: "Closing disclosure reviewed" },
  { id: "b29", section: "Closing Prep",             label: "Closing date & time confirmed with all parties" },
  { id: "b30", section: "Closing Prep",             label: "Wire instructions sent to buyer" },
  { id: "b31", section: "Closing Prep",             label: "Funds wired / cashier's check confirmed" },
  { id: "b32", section: "Closing Prep",             label: "Utilities transfer scheduled" },
  // Closing
  { id: "b33", section: "Closing",                  label: "Buyer signed closing documents" },
  { id: "b34", section: "Closing",                  label: "Loan funded" },
  { id: "b35", section: "Closing",                  label: "Deed recorded" },
  { id: "b36", section: "Closing",                  label: "Keys delivered to buyer" },
  { id: "b37", section: "Closing",                  label: "Commission disbursed" },
  { id: "b38", section: "Closing",                  label: "File closed & archived" },
];

const LISTING_ITEMS = [
  // Listing Setup
  { id: "l1",  section: "Listing Setup",            label: "Listing agreement fully executed" },
  { id: "l2",  section: "Listing Setup",            label: "Seller's Property Disclosure Statement (SPDS) completed" },
  { id: "l3",  section: "Listing Setup",            label: "Lead-based paint disclosure (if pre-1978)" },
  { id: "l4",  section: "Listing Setup",            label: "HOA documents/addendum completed" },
  { id: "l5",  section: "Listing Setup",            label: "Lockbox installed" },
  { id: "l6",  section: "Listing Setup",            label: "Yard sign installed" },
  { id: "l7",  section: "Listing Setup",            label: "Professional photos scheduled" },
  { id: "l8",  section: "Listing Setup",            label: "Professional photos received" },
  { id: "l9",  section: "Listing Setup",            label: "MLS listing entered & active" },
  { id: "l10", section: "Listing Setup",            label: "Listing syndicated (Zillow, Realtor.com, etc.)" },
  // Under Contract
  { id: "l11", section: "Under Contract",           label: "Offer received & presented to seller" },
  { id: "l12", section: "Under Contract",           label: "Purchase contract fully executed" },
  { id: "l13", section: "Under Contract",           label: "Earnest money received & deposited" },
  { id: "l14", section: "Under Contract",           label: "Escrow opened" },
  { id: "l15", section: "Under Contract",           label: "MLS status updated to Pending" },
  { id: "l16", section: "Under Contract",           label: "Contract copies sent to all parties" },
  // Due Diligence
  { id: "l17", section: "Due Diligence",            label: "Inspection period noted on calendar" },
  { id: "l18", section: "Due Diligence",            label: "Buyer inspection completed" },
  { id: "l19", section: "Due Diligence",            label: "BINSR received from buyer" },
  { id: "l20", section: "Due Diligence",            label: "BINSR response sent to buyer" },
  { id: "l21", section: "Due Diligence",            label: "Repair requests negotiated & agreed" },
  { id: "l22", section: "Due Diligence",            label: "Repairs completed (if applicable)" },
  { id: "l23", section: "Due Diligence",            label: "HOA transfer coordinated" },
  // Appraisal & Financing
  { id: "l24", section: "Appraisal & Financing",   label: "Appraisal appointment confirmed" },
  { id: "l25", section: "Appraisal & Financing",   label: "Appraisal completed — value confirmed" },
  { id: "l26", section: "Appraisal & Financing",   label: "Buyer loan approval confirmed" },
  { id: "l27", section: "Appraisal & Financing",   label: "Clear to close received" },
  // Closing Prep
  { id: "l28", section: "Closing Prep",             label: "Final walkthrough scheduled" },
  { id: "l29", section: "Closing Prep",             label: "Final walkthrough completed" },
  { id: "l30", section: "Closing Prep",             label: "Closing date & time confirmed" },
  { id: "l31", section: "Closing Prep",             label: "Seller net sheet reviewed" },
  { id: "l32", section: "Closing Prep",             label: "Mortgage payoff ordered" },
  { id: "l33", section: "Closing Prep",             label: "Utilities cancellation scheduled" },
  // Closing
  { id: "l34", section: "Closing",                  label: "Seller signed closing documents" },
  { id: "l35", section: "Closing",                  label: "Deed recorded" },
  { id: "l36", section: "Closing",                  label: "Proceeds wired to seller" },
  { id: "l37", section: "Closing",                  label: "Keys & lockbox retrieved" },
  { id: "l38", section: "Closing",                  label: "MLS status updated to Sold" },
  { id: "l39", section: "Closing",                  label: "Commission disbursed" },
  { id: "l40", section: "Closing",                  label: "File closed & archived" },
];

function getHTML(transaction, id) {
  const items = transaction.type === "buyer" ? BUYER_ITEMS : LISTING_ITEMS;
  const checked = transaction.checked || {};
  const notes = transaction.notes || {};
  const total = items.length;
  const done = items.filter(i => checked[i.id]).length;
  const pct = Math.round((done / total) * 100);

  // Group by section
  const sections = {};
  for (const item of items) {
    if (!sections[item.section]) sections[item.section] = [];
    sections[item.section].push(item);
  }

  const sectionHTML = Object.entries(sections).map(([section, sItems]) => {
    const secDone = sItems.filter(i => checked[i.id]).length;
    const rows = sItems.map(item => `
      <tr class="${checked[item.id] ? 'done' : ''}">
        <td class="cb-cell">
          <input type="checkbox" id="${item.id}" ${checked[item.id] ? 'checked' : ''}
            onchange="toggle('${item.id}', this.checked)">
        </td>
        <td class="label-cell"><label for="${item.id}">${item.label}</label></td>
        <td class="note-cell">
          <input type="text" class="note-input" placeholder="note…"
            value="${(notes[item.id] || '').replace(/"/g, '&quot;')}"
            onblur="saveNote('${item.id}', this.value)">
        </td>
      </tr>`).join('');
    return `
      <div class="section">
        <div class="section-header">
          <span class="section-title">${section}</span>
          <span class="section-count">${secDone}/${sItems.length}</span>
        </div>
        <table><tbody>${rows}</tbody></table>
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${transaction.address || 'Transaction'} — TC Checklist</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, Helvetica, sans-serif; background: #f5f6fa; color: #1a1a2e; }
  .header { background: #1e3a5f; color: white; padding: 20px 32px; }
  .header h1 { font-size: 20px; font-weight: 700; }
  .header .meta { font-size: 13px; color: #a8c4e0; margin-top: 4px; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 700;
           margin-left: 10px; vertical-align: middle;
           background: ${transaction.type === 'buyer' ? '#1565c0' : '#2e7d32'};
           color: white; text-transform: uppercase; }
  .progress-bar { height: 6px; background: #d0d7e8; margin: 0; }
  .progress-fill { height: 6px; background: #2e7d32; transition: width .3s;
                   width: ${pct}%; }
  .progress-label { background: white; padding: 10px 32px; font-size: 13px; color: #555;
                    border-bottom: 1px solid #e0e4f0; }
  .progress-label strong { color: #1e3a5f; }
  .container { max-width: 900px; margin: 24px auto; padding: 0 16px; }
  .section { background: white; border-radius: 10px; margin-bottom: 18px;
             box-shadow: 0 1px 4px rgba(0,0,0,.07); overflow: hidden; }
  .section-header { display: flex; justify-content: space-between; align-items: center;
                    padding: 12px 18px; background: #f0f4ff; border-bottom: 1px solid #e0e4f0; }
  .section-title { font-weight: 700; font-size: 14px; color: #1e3a5f; }
  .section-count { font-size: 12px; color: #666; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  tr { border-bottom: 1px solid #f0f2f8; transition: background .15s; }
  tr:last-child { border-bottom: none; }
  tr.done .label-cell label { color: #aaa; text-decoration: line-through; }
  tr:hover { background: #fafbff; }
  .cb-cell { width: 40px; padding: 10px 8px 10px 18px; }
  .cb-cell input[type=checkbox] { width: 16px; height: 16px; cursor: pointer; accent-color: #1e3a5f; }
  .label-cell { padding: 10px 8px; font-size: 14px; }
  .label-cell label { cursor: pointer; }
  .note-cell { padding: 6px 18px 6px 0; width: 220px; }
  .note-input { width: 100%; border: 1px solid #e0e4f0; border-radius: 5px; padding: 4px 8px;
                font-size: 12px; color: #555; outline: none; background: #fafbff; }
  .note-input:focus { border-color: #1e3a5f; background: white; }
  .toast { position: fixed; bottom: 20px; right: 20px; background: #2e7d32; color: white;
           padding: 10px 20px; border-radius: 8px; font-size: 13px; opacity: 0;
           transition: opacity .3s; pointer-events: none; }
  .toast.show { opacity: 1; }
  @media(max-width:600px) { .note-cell { display: none; } .header { padding: 16px; } }
</style></head>
<body>
<div class="header">
  <h1>${transaction.address || 'No address set'}<span class="badge">${transaction.type}</span></h1>
  <div class="meta">
    ${transaction.clientName ? `Client: ${transaction.clientName} &nbsp;·&nbsp; ` : ''}
    ${transaction.agentName ? `Agent: ${transaction.agentName} &nbsp;·&nbsp; ` : ''}
    ${transaction.closeDate ? `Close: ${transaction.closeDate} &nbsp;·&nbsp; ` : ''}
    TC Checklist · ${done}/${total} complete
  </div>
</div>
<div class="progress-bar"><div class="progress-fill" id="pbar"></div></div>
<div class="progress-label"><strong>${done} of ${total}</strong> items complete &nbsp;·&nbsp; <strong>${pct}%</strong></div>
<div class="container">${sectionHTML}</div>
<div class="toast" id="toast">Saved</div>
<script>
async function toggle(id, val) {
  await fetch('/api/transactions/${id}/check', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({itemId: id, checked: val})
  });
  const row = document.getElementById(id).closest('tr');
  row.classList.toggle('done', val);
  updateProgress();
  showToast();
}
async function saveNote(id, val) {
  await fetch('/api/transactions/${id}/note', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({itemId: id, note: val})
  });
  showToast();
}
function updateProgress() {
  const boxes = document.querySelectorAll('input[type=checkbox]');
  const total = boxes.length;
  const done = [...boxes].filter(b => b.checked).length;
  const pct = Math.round(done/total*100);
  document.getElementById('pbar').style.width = pct + '%';
  document.querySelector('.progress-label').innerHTML =
    '<strong>' + done + ' of ' + total + '</strong> items complete &nbsp;·&nbsp; <strong>' + pct + '%</strong>';
}
let toastTimer;
function showToast() {
  const t = document.getElementById('toast');
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1500);
}
</script>
</body></html>`;
}

function getDashboardHTML(transactions) {
  const rows = Object.entries(transactions).map(([id, t]) => {
    const items = t.type === "buyer" ? BUYER_ITEMS : LISTING_ITEMS;
    const done = items.filter(i => (t.checked || {})[i.id]).length;
    const pct = Math.round((done / items.length) * 100);
    const badgeColor = t.type === "buyer" ? "#1565c0" : "#2e7d32";
    return `<tr>
      <td><a href="/t/${id}">${t.address || '(no address)'}</a></td>
      <td><span style="background:${badgeColor};color:white;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;text-transform:uppercase">${t.type}</span></td>
      <td>${t.clientName || '—'}</td>
      <td>${t.agentName || '—'}</td>
      <td>${t.closeDate || '—'}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;height:8px;background:#e0e4f0;border-radius:4px">
            <div style="width:${pct}%;height:8px;background:${pct===100?'#2e7d32':'#1565c0'};border-radius:4px"></div>
          </div>
          <span style="font-size:12px;font-weight:600;color:#555;white-space:nowrap">${pct}%</span>
        </div>
      </td>
      <td><a href="/t/${id}" style="font-size:12px">Open →</a></td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TC Checklist Dashboard</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:-apple-system,Helvetica,sans-serif; background:#f5f6fa; color:#1a1a2e; }
  .header { background:#1e3a5f; color:white; padding:20px 32px; display:flex; align-items:center; justify-content:space-between; }
  .header h1 { font-size:20px; font-weight:700; }
  .btn { background:#2563eb; color:white; border:none; padding:9px 18px; border-radius:7px;
         font-size:13px; font-weight:600; cursor:pointer; text-decoration:none; }
  .btn:hover { background:#1d4ed8; }
  .container { max-width:1000px; margin:28px auto; padding:0 16px; }
  .card { background:white; border-radius:10px; box-shadow:0 1px 4px rgba(0,0,0,.07); overflow:hidden; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; padding:12px 16px; background:#f0f4ff; font-size:12px; color:#555;
       font-weight:700; text-transform:uppercase; border-bottom:2px solid #e0e4f0; }
  td { padding:12px 16px; border-bottom:1px solid #f0f2f8; font-size:14px; }
  tr:last-child td { border-bottom:none; }
  tr:hover td { background:#fafbff; }
  a { color:#1565c0; text-decoration:none; font-weight:500; }
  a:hover { text-decoration:underline; }
  .empty { padding:40px; text-align:center; color:#888; font-size:14px; }
  .modal-bg { display:none; position:fixed; inset:0; background:rgba(0,0,0,.4); z-index:100; align-items:center; justify-content:center; }
  .modal-bg.open { display:flex; }
  .modal { background:white; border-radius:12px; padding:28px; width:420px; max-width:95vw; }
  .modal h2 { font-size:17px; margin-bottom:18px; color:#1e3a5f; }
  .field { margin-bottom:14px; }
  .field label { display:block; font-size:12px; font-weight:600; color:#555; margin-bottom:5px; }
  .field input, .field select { width:100%; border:1px solid #d0d7e8; border-radius:6px;
    padding:8px 10px; font-size:14px; outline:none; }
  .field input:focus, .field select:focus { border-color:#1e3a5f; }
  .modal-actions { display:flex; gap:10px; justify-content:flex-end; margin-top:20px; }
  .btn-cancel { background:#f0f4ff; color:#1e3a5f; border:none; padding:9px 18px;
                border-radius:7px; font-size:13px; font-weight:600; cursor:pointer; }
</style></head>
<body>
<div class="header">
  <h1>TC Checklist Dashboard</h1>
  <button class="btn" onclick="document.getElementById('modal').classList.add('open')">+ New Transaction</button>
</div>
<div class="container">
  <div class="card">
    ${Object.keys(transactions).length === 0
      ? '<div class="empty">No transactions yet. Click <strong>+ New Transaction</strong> to get started.</div>'
      : `<table><thead><tr>
          <th>Address</th><th>Type</th><th>Client</th><th>Agent</th><th>Close Date</th><th>Progress</th><th></th>
         </tr></thead><tbody>${rows}</tbody></table>`}
  </div>
</div>

<div class="modal-bg" id="modal">
  <div class="modal">
    <h2>New Transaction</h2>
    <div class="field"><label>Type</label>
      <select id="f-type"><option value="buyer">Buyer</option><option value="listing">Listing</option></select>
    </div>
    <div class="field"><label>Property Address</label><input id="f-address" placeholder="123 Main St, Phoenix AZ"></div>
    <div class="field"><label>Client Name</label><input id="f-client" placeholder="John & Jane Smith"></div>
    <div class="field"><label>Agent Name</label><input id="f-agent" placeholder="Agent name"></div>
    <div class="field"><label>Estimated Close Date</label><input id="f-close" type="date"></div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="document.getElementById('modal').classList.remove('open')">Cancel</button>
      <button class="btn" onclick="create()">Create Checklist</button>
    </div>
  </div>
</div>
<script>
async function create() {
  const body = {
    type: document.getElementById('f-type').value,
    address: document.getElementById('f-address').value,
    clientName: document.getElementById('f-client').value,
    agentName: document.getElementById('f-agent').value,
    closeDate: document.getElementById('f-close').value,
  };
  const res = await fetch('/api/transactions', { method:'POST',
    headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const t = await res.json();
  window.location.href = '/t/' + t.id;
}
</script>
</body></html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost`);
  const pathname = url.pathname;

  // API routes
  if (req.method === "POST" && pathname === "/api/transactions") {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", () => {
      const data = loadData();
      const parsed = JSON.parse(body);
      const id = crypto.randomBytes(6).toString("hex");
      data.transactions[id] = { id, ...parsed, checked: {}, notes: {}, createdAt: Date.now() };
      saveData(data);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data.transactions[id]));
    });
    return;
  }

  const checkMatch = pathname.match(/^\/api\/transactions\/([^/]+)\/check$/);
  if (req.method === "POST" && checkMatch) {
    const txId = checkMatch[1];
    let body = "";
    req.on("data", d => body += d);
    req.on("end", () => {
      const data = loadData();
      const { itemId, checked } = JSON.parse(body);
      if (data.transactions[txId]) {
        data.transactions[txId].checked[itemId] = checked;
        saveData(data);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  const noteMatch = pathname.match(/^\/api\/transactions\/([^/]+)\/note$/);
  if (req.method === "POST" && noteMatch) {
    const txId = noteMatch[1];
    let body = "";
    req.on("data", d => body += d);
    req.on("end", () => {
      const data = loadData();
      const { itemId, note } = JSON.parse(body);
      if (data.transactions[txId]) {
        data.transactions[txId].notes[itemId] = note;
        saveData(data);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // Transaction page
  const txMatch = pathname.match(/^\/t\/([^/]+)$/);
  if (txMatch) {
    const data = loadData();
    const tx = data.transactions[txMatch[1]];
    if (!tx) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(getHTML(tx, txMatch[1]));
    return;
  }

  // Dashboard
  if (pathname === "/" || pathname === "") {
    const data = loadData();
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(getDashboardHTML(data.transactions));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => console.log(`TC Checklist running on port ${PORT}`));
