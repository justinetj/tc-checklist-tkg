import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "data.json");
const PORT = process.env.PORT || 3002;

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return { transactions: {} };
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return { transactions: {} }; }
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ─── CHECKLIST ITEMS ────────────────────────────────────────────────────────
// day: "Day N" = N days after contract execution date
//      "COE N" = N days relative to close of escrow (negative = before COE)
//      "COE"   = day of close of escrow

const BUYER_ITEMS = [
  { id: "b5",   label: "Send intro email to all parties" },
  { id: "b5a",  label: "TC", indent: true },
  { id: "b5d",  label: "Title", indent: true },
  { id: "b5b",  label: "Lender", indent: true },
  { id: "b5c",  label: "Agents", indent: true },
  { id: "b6",   label: "Send buyer intro email (if applicable)" },
  { id: "b13",  label: "Earnest deposit received by title" },
  { id: "b7",   label: "Order home / termite inspection (if applicable)" },
  { id: "b14",  label: "Create SkySlope transaction" },
  { id: "b2",   label: "Create Deal in FUB" },
  { id: "b2a",  label: "Accurate stage?", indent: true },
  { id: "b2b",  label: "Accurate source?", indent: true },
  { id: "b3",   label: "Create Zillow Payment Form (if applicable)" },
  { id: "b4",   label: "Update Kumler Group Workbook" },
  { id: "b16",  label: "SPDS received", hasDue: true },
  { id: "b16b", label: "CLUE received" },
  { id: "b19",  label: "Send ABD (to other agent, if applicable)" },
  { id: "b15",  label: "Notify agent of any missing docs / send missing docs checklist" },
  { id: "b26",  label: "Request title commitment", hasDue: true },
  { id: "b25",  label: "LSU #1 (Loan Status Update) Request", hasDue: true },
  { id: "b18",  label: "Update client if applicable" },
  { id: "b20",  label: "BINSR (reminder / status)", hasDue: true },
  { id: "b24",  label: "BINSR #1 due (follow up if not received)", hasDue: true },
  { id: "b25b", label: "LSU #2 Request", hasDue: true },
  { id: "b18b", label: "Update client if applicable" },
  { id: "b30b", label: "BINSR #2 Response (5 days after)", hasDue: true },
  { id: "b35",  label: "LSU #3 Request", hasDue: true },
  { id: "b18c", label: "Update client if applicable" },
  { id: "b29",  label: "Appraisal ordered", hasDue: true },
  { id: "b30c", label: "BINSR #3 (5 days after response)", hasDue: true },
  { id: "b30d", label: "LSU #4 Request", hasDue: true },
  { id: "b34",  label: "Appraisal received — confirm value" },
  { id: "b18d", label: "Update client if applicable" },
  { id: "b37",  label: "Order home warranty", hasDue: true },
  { id: "b50",  label: "Check SkySlope for final documents", hasDue: true },
  { id: "b39",  label: "CDA (Commission Disbursement Authorization) sent to title", hasDue: true },
  { id: "b40",  label: "Loan approval received / confirmed" },
  { id: "b40b", label: "Est. Settlement statement" },
  { id: "b41",  label: "Final walkthrough" },
  { id: "b44",  label: "Final SS / copy of check" },
  { id: "b45",  label: "Update Workbook" },
  { id: "b45a", label: "Reconfirm title company", indent: true },
  { id: "b45b", label: "Reconfirm lender", indent: true },
  { id: "b45c", label: "Reconfirm home warranty", indent: true },
  { id: "b45d", label: "Reconfirm sales price", indent: true },
  { id: "b38",  label: "Send questionnaire", indent: true, hasDue: true },
  { id: "b46",  label: "Update FUB status → Closed" },
  { id: "b46b", label: "Closed", indent: true },
  { id: "b46c", label: "Sales price check", indent: true },
  { id: "b46a", label: "Closing date accurate", indent: true },
  { id: "b48",  label: "Update Zillow status → Sold" },
  { id: "b49",  label: "Move file to close" },
  { id: "b51",  label: "Commission Settled" },
];

const LISTING_ITEMS = [
  // Day 0 — Listing Setup
  { id: "l1",  section: "Day 0 — Listing Setup",       day: "Day 0",  label: "Listing agreement fully executed" },
  { id: "l2",  section: "Day 0 — Listing Setup",       day: "Day 0",  label: "Review Formstack — download & review all documents" },
  { id: "l3",  section: "Day 0 — Listing Setup",       day: "Day 0",  label: "Create Deal in FUB / update task due dates" },
  { id: "l4",  section: "Day 0 — Listing Setup",       day: "Day 0",  label: "Update Kumler Group Workbook" },
  { id: "l5",  section: "Day 0 — Listing Setup",       day: "Day 0",  label: "Verify commission split (agent partner vs Kumler)" },
  { id: "l6",  section: "Day 0 — Listing Setup",       day: "Day 0",  label: "Create Zillow Payment Form (if applicable)" },
  { id: "l7",  section: "Day 0 — Listing Setup",       day: "Day 0",  label: "SPDS completed by seller — on file", hasDue: true },
  { id: "l7b", section: "Day 0 — Listing Setup",       day: "Day 0",  label: "CLUE report received" },
  { id: "l8",  section: "Day 0 — Listing Setup",       day: "Day 0",  label: "Lead-based paint disclosure (pre-1978 homes)" },
  { id: "l9",  section: "Day 0 — Listing Setup",       day: "Day 0",  label: "HOA addendum completed (if applicable)" },
  { id: "l10", section: "Day 0 — Listing Setup",       day: "Day 0",  label: "Professional photos scheduled" },
  { id: "l11", section: "Day 0 — Listing Setup",       day: "Day 0",  label: "Create SkySlope transaction" },
  { id: "l12", section: "Day 0 — Listing Setup",       day: "Day 0",  label: "Send intro email to all parties" },
  // Day 1
  { id: "l13", section: "Day 1",                       day: "Day 1",  label: "Photos received & approved" },
  { id: "l14", section: "Day 1",                       day: "Day 1",  label: "MLS listing entered & active" },
  { id: "l15", section: "Day 1",                       day: "Day 1",  label: "Update Zillow status → Active" },
  { id: "l16", section: "Day 1",                       day: "Day 1",  label: "Update FUB status → Active Listing" },
  { id: "l17", section: "Day 1",                       day: "Day 1",  label: "Lockbox installed" },
  { id: "l18", section: "Day 1",                       day: "Day 1",  label: "Yard sign installed" },
  { id: "l19", section: "Day 1",                       day: "Day 1",  label: "Notify agent of any missing docs" },
  // Under Contract
  { id: "l20", section: "Under Contract",              day: "",       label: "Offer received & presented to seller" },
  { id: "l21", section: "Under Contract",              day: "Day 0",  label: "Purchase contract fully executed" },
  { id: "l22", section: "Under Contract",              day: "Day 0",  label: "Update FUB status → Under Contract" },
  { id: "l23", section: "Under Contract",              day: "Day 0",  label: "Update MLS status → Pending" },
  { id: "l24", section: "Under Contract",              day: "Day 0",  label: "Update Zillow status → Pending" },
  { id: "l25", section: "Under Contract",              day: "Day 0",  label: "Update Workbook — add contract price & buyer lender" },
  { id: "l26", section: "Under Contract",              day: "Day 0",  label: "Verify buyer lender — confirm pre-approval on file" },
  { id: "l27", section: "Under Contract",              day: "Day 0",  label: "Escrow opened — escrow number on file" },
  { id: "l28", section: "Under Contract",              day: "Day 0",  label: "Earnest money confirmed received by title" },
  { id: "l29", section: "Under Contract",              day: "Day 0",  label: "Send intro email to all parties" },
  { id: "l30", section: "Under Contract",              day: "Day 0",  label: "Create Zillow Payment Form (if applicable)" },
  // Day 1 (after contract)
  { id: "l31", section: "Day 1 (After Contract)",      day: "Day 1",  label: "Create SkySlope transaction (under contract file)" },
  { id: "l32", section: "Day 1 (After Contract)",      day: "Day 1",  label: "Notify agent of any missing docs" },
  // Day 5
  { id: "l33", section: "Day 5",                       day: "Day 5",  label: "Buyer inspection scheduled — confirm with agent" },
  // Day 7
  { id: "l34", section: "Day 7",                       day: "Day 7",  label: "BINSR received from buyer — send to seller" },
  { id: "l35", section: "Day 7",                       day: "Day 7",  label: "Follow up with agent regarding BINSR response" },
  // Day 10
  { id: "l36", section: "Day 10",                      day: "Day 10", label: "BINSR due (10 days from contract acceptance)" },
  { id: "l37", section: "Day 10",                      day: "Day 10", label: "Inspection period complete" },
  { id: "l38", section: "Day 10",                      day: "Day 10", label: "Request title commitment from title company" },
  // Day 15
  { id: "l39", section: "Day 15",                      day: "Day 15", label: "Appraisal appointment confirmed" },
  { id: "l40", section: "Day 15",                      day: "Day 15", label: "Confirm any agreed repairs are scheduled" },
  { id: "l40b", section: "Day 15",                     day: "Day 15", label: "Seller response to BINSR due (5 days after BINSR)", hasDue: true },
  // Day 22
  { id: "l41", section: "Day 22",                      day: "Day 22", label: "Appraisal received — confirm value" },
  { id: "l42", section: "Day 22",                      day: "Day 22", label: "Buyer loan approval confirmed" },
  { id: "l43", section: "Day 22",                      day: "Day 22", label: "Confirm all repairs are complete" },
  // COE -10
  { id: "l44", section: "COE -10 Days",                day: "COE -10", label: "Confirm home warranty — ordered & who pays" },
  { id: "l45", section: "COE -10 Days",                day: "COE -10", label: "Mortgage payoff ordered by title" },
  // COE -5
  { id: "l46", section: "COE -5 Days",                 day: "COE -5", label: "CDA (Commission Disbursement Authorization) sent to title" },
  { id: "l47", section: "COE -5 Days",                 day: "COE -5", label: "Buyer clear to close received from lender" },
  { id: "l48", section: "COE -5 Days",                 day: "COE -5", label: "Seller net sheet reviewed" },
  // COE -4
  { id: "l49", section: "COE -4 Days",                 day: "COE -4", label: "Final walkthrough reminder sent to buyer & agent" },
  // COE -3
  { id: "l50", section: "COE -3 Days",                 day: "COE -3", label: "Confirm all repairs are complete" },
  { id: "l51", section: "COE -3 Days",                 day: "COE -3", label: "Docs to title (all required docs submitted)" },
  { id: "l52", section: "COE -3 Days",                 day: "COE -3", label: "Utilities cancellation scheduled by seller" },
  // COE — Close of Escrow
  { id: "l53", section: "COE — Close of Escrow",       day: "COE",    label: "Recording confirmed" },
  { id: "l54", section: "COE — Close of Escrow",       day: "COE",    label: "Update Workbook" },
  { id: "l55", section: "COE — Close of Escrow",       day: "COE",    label: "Update FUB status → Closed" },
  { id: "l56", section: "COE — Close of Escrow",       day: "COE",    label: "Update MLS status → Sold" },
  { id: "l57", section: "COE — Close of Escrow",       day: "COE",    label: "Update Zillow status → Sold" },
  { id: "l58", section: "COE — Close of Escrow",       day: "COE",    label: "Move file to close" },
];

// ─── HTML ────────────────────────────────────────────────────────────────────

function calcDueDateISO(dayLabel, contractDate, closeDate) {
  if (!dayLabel) return "";
  if (dayLabel.startsWith("Day")) {
    const n = parseInt(dayLabel.split(" ")[1]);
    if (!contractDate) return "";
    const d = new Date(contractDate + "T12:00:00");
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }
  if (dayLabel.startsWith("COE")) {
    if (!closeDate) return "";
    const offset = dayLabel === "COE" ? 0 : parseInt(dayLabel.split(" ")[1]);
    const d = new Date(closeDate + "T12:00:00");
    d.setDate(d.getDate() + (offset || 0));
    return d.toISOString().slice(0, 10);
  }
  return "";
}

function dayBadge(dayLabel, color) {
  if (!dayLabel) return "";
  const bg = dayLabel.startsWith("COE") ? "#7e22ce" : "#0f4c9e";
  return `<span class="day-badge" style="background:${bg}">${dayLabel}</span>`;
}

function getHTML(transaction, id) {
  const items = transaction.type === "buyer" ? BUYER_ITEMS : LISTING_ITEMS;
  const checked = transaction.checked || {};
  const notes = transaction.notes || {};
  const fields = transaction.fields || {};
  const contractDate = fields.contractDate || "";
  const closeDate = fields.closeDate || "";
  const total = items.length;
  const done = items.filter(i => checked[i.id]).length;
  const pct = Math.round((done / total) * 100);
  const color = transaction.type === "buyer" ? "#1565c0" : "#2e7d32";

  const flatRows = items.map(item => {
    const itemNotes = notes[item.id] || {};
    const autoISO = calcDueDateISO(item.day, contractDate, closeDate);
    const dueVal = itemNotes.due || autoISO;
    const today = new Date().toISOString().slice(0, 10);
    const isChecked = !!checked[item.id];
    const overdue = dueVal && !isChecked && dueVal < today;
    const dueCls = overdue ? " overdue" : (dueVal ? " on-time" : "");
    return `
    <tr class="${isChecked ? 'done' : ''}${item.indent ? ' sub-item' : ''}" data-day="${item.day || ''}">
      <td class="cb-cell" style="${item.indent ? 'padding-left:32px' : ''}">
        <input type="checkbox" id="${item.id}" ${isChecked ? 'checked' : ''}
          onchange="toggle('${item.id}', this.checked)">
      </td>
      <td class="label-cell" style="${item.indent ? 'color:#64748b;font-size:13px' : ''}"><label for="${item.id}">${item.indent ? '↳ ' : ''}${item.label}</label></td>
      <td class="date-cell">${item.hasDue ? `
        <input type="date" class="date-input due${dueCls}" data-item="${item.id}" data-auto="${autoISO}"
          value="${dueVal.replace(/"/g, '&quot;')}"
          onchange="saveDue('${item.id}', this.value)">` : `<span style="color:#ccc">—</span>`}
      </td>
      <td class="note-cell">
        <input type="text" class="note-input" placeholder="note…"
          value="${(itemNotes.note || '').replace(/"/g, '&quot;')}"
          onblur="saveItemField('${item.id}', 'note', this.value)">
      </td>
    </tr>`;
  }).join('');

  const sectionHTML = `
    <div class="section">
      <table>
        <thead><tr>
          <th style="width:40px"></th>
          <th style="text-align:left;padding:6px 8px;font-size:11px;color:#888;font-weight:600">Item</th>
          <th style="width:150px;padding:6px 8px;font-size:11px;color:#888;font-weight:600">Due Date ✏️</th>
          <th style="width:300px;padding:6px 8px;font-size:11px;color:#888;font-weight:600">Note</th>
        </tr></thead>
        <tbody>${flatRows}</tbody>
      </table>
    </div>`;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${transaction.address || 'Transaction'} — TC Checklist</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:-apple-system,Helvetica,sans-serif; background:#f5f6fa; color:#1a1a2e; }
  .header { background:#1e3a5f; color:white; padding:18px 32px; display:flex; align-items:center; gap:16px; }
  .header a { color:#a8c4e0; font-size:13px; text-decoration:none; margin-right:8px; }
  .header a:hover { color:white; }
  .header h1 { font-size:18px; font-weight:700; flex:1; }
  .badge { display:inline-block; padding:3px 10px; border-radius:12px; font-size:11px;
           font-weight:700; background:${color}; color:white; text-transform:uppercase; }
  .progress-bar { height:5px; background:#d0d7e8; }
  .progress-fill { height:5px; background:${color}; transition:width .3s; width:${pct}%; }
  .progress-label { background:white; padding:8px 32px; font-size:13px; color:#555;
                    border-bottom:1px solid #e0e4f0; }

  .info-card { background:white; margin:20px auto; max-width:1100px; padding:0 16px; }
  .info-grid { background:white; border-radius:10px; box-shadow:0 1px 4px rgba(0,0,0,.07);
               display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:0;
               overflow:hidden; border:1px solid #e0e4f0; }
  .info-field { padding:12px 16px; border-right:1px solid #e0e4f0; border-bottom:1px solid #e0e4f0; }
  .info-field.highlight { background:#f0f4ff; }
  .info-label { font-size:10px; font-weight:700; text-transform:uppercase; color:#888; margin-bottom:4px; }
  .info-input { width:100%; border:none; font-size:13px; color:#1a1a2e; background:transparent;
                outline:none; font-family:inherit; }
  .info-input:focus { color:#1565c0; }

  .container { max-width:1100px; margin:16px auto; padding:0 16px; }
  .section { background:white; border-radius:10px; margin-bottom:14px;
             box-shadow:0 1px 4px rgba(0,0,0,.07); overflow:hidden; }
  .section-header { display:flex; justify-content:space-between; align-items:center;
                    padding:10px 16px; background:#f0f4ff; border-bottom:1px solid #e0e4f0; }
  .section-title { font-weight:700; font-size:13px; color:#1e3a5f; text-transform:uppercase; letter-spacing:.5px; }
  .section-progress { display:flex; align-items:center; gap:8px; font-size:12px; color:#666; font-weight:600; }
  .sec-bar { width:80px; height:6px; background:#e0e4f0; border-radius:3px; display:inline-block; }
  .sec-fill { height:6px; border-radius:3px; display:block; transition:width .3s; }
  table { width:100%; border-collapse:collapse; }
  tr { border-bottom:1px solid #f0f2f8; transition:background .1s; }
  tr:last-child { border-bottom:none; }
  tr.done .label-cell label { color:#bbb; text-decoration:line-through; }
  tr:hover { background:#fafbff; }
  .cb-cell { width:40px; padding:10px 6px 10px 16px; }
  .cb-cell input[type=checkbox] { width:16px; height:16px; cursor:pointer; accent-color:${color}; }
  .label-cell { padding:10px 8px; font-size:14px; }
  .label-cell label { cursor:pointer; }
  .day-cell { padding:6px 4px; width:80px; }
  .day-badge { display:inline-block; padding:2px 7px; border-radius:10px; font-size:10px;
               font-weight:700; color:white; white-space:nowrap; }
  .date-input.due { border-color:#d1fae5; color:#15803d; font-weight:600; background:#f0fdf4; }
  .date-input.due.overdue { border-color:#fecaca; color:#dc2626; background:#fff5f5; }
  .date-input.due:focus { border-color:#16a34a; }
  .date-input.due.overdue:focus { border-color:#dc2626; }
  .date-cell { padding:6px 4px; width:150px; }
  .date-input { width:100%; border:1px solid #e0e4f0; border-radius:5px; padding:4px 6px;
                font-size:12px; color:#555; outline:none; background:#fafbff; font-family:inherit; }
  .date-input:focus { border-color:${color}; background:white; }
  .note-cell { padding:6px 16px 6px 0; width:300px; }
  .note-input { width:100%; border:1px solid #e0e4f0; border-radius:5px; padding:4px 8px;
                font-size:12px; color:#555; outline:none; background:#fafbff; }
  .note-input:focus { border-color:${color}; background:white; }
  .toast { position:fixed; bottom:20px; right:20px; background:#2e7d32; color:white;
           padding:10px 20px; border-radius:8px; font-size:13px; opacity:0;
           transition:opacity .3s; pointer-events:none; z-index:99; }
  .toast.show { opacity:1; }
  @media(max-width:600px) { .note-cell,.day-cell { display:none; } .header { padding:14px 16px; } }
</style></head>
<body>
<div class="header">
  <div style="flex:1">
    <div><a href="/">← All Transactions</a></div>
    <h1>${transaction.address || 'No address'} <span class="badge">${transaction.type}</span></h1>
  </div>
  <div style="text-align:right;font-size:13px;color:#a8c4e0">${done}/${total} complete</div>
</div>
<div class="progress-bar"><div class="progress-fill" id="pbar"></div></div>
<div class="progress-label" id="plabel"><strong>${done} of ${total}</strong> items complete &nbsp;·&nbsp; <strong>${pct}%</strong></div>

<div class="info-card">
  <div style="padding:12px 0 8px;display:flex;align-items:center;justify-content:space-between">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#888;letter-spacing:.5px">Transaction Details</div>
    <div style="display:flex;gap:8px;align-items:center">
      ${transaction.status === 'closed' ? `<span style="background:#dcfce7;color:#15803d;padding:4px 12px;border-radius:6px;font-size:12px;font-weight:700">✓ Closed</span>` : ''}
      ${transaction.status === 'cancelled' ? `<span style="background:#fee2e2;color:#dc2626;padding:4px 12px;border-radius:6px;font-size:12px;font-weight:700">✕ Cancelled</span>` : ''}
      ${transaction.status !== 'closed' ? `<button onclick="setTxnStatus('closed')" style="background:#dcfce7;color:#15803d;border:1px solid #bbf7d0;padding:6px 14px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer">Mark Closed</button>` : ''}
      ${transaction.status !== 'cancelled' ? `<button onclick="setTxnStatus('cancelled')" style="background:#fee2e2;color:#dc2626;border:1px solid #fecaca;padding:6px 14px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer">Mark Cancelled</button>` : ''}
      ${transaction.status && transaction.status !== 'active' ? `<button onclick="setTxnStatus('active')" style="background:#f0f4ff;color:#1e3a5f;border:1px solid #c7d2fe;padding:6px 14px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer">Reopen</button>` : ''}
    </div>
  </div>
  <div class="info-grid">
    ${[
      ["Property Address", "address", "text", false],
      ["Contract Date — Day 0", "contractDate", "date", true],
      ["Close of Escrow Date (COE)", "closeDate", "date", true],
      ["Client Name", "clientName", "text", false],
    ].map(([label, key, type, hi]) => `
      <div class="info-field${hi ? ' highlight' : ''}">
        <div class="info-label">${label}</div>
        <input class="info-input" type="${type}" placeholder="—"
          value="${(key === 'address' ? (fields.address || transaction.address || '') : (fields[key] || '')).replace(/"/g, '&quot;')}"
          onchange="saveField('${key}', this.value)">
      </div>`).join('')}
    ${['agentPartner1','agentPartner2'].map((key, i) => {
      const agentNames = ['Akanksha Tomar','Alexandra Allen','Alexis Wilson','Angela Massey','Angie Rodriguez','Annie Clark','Arielle Jaime','Ashleigh DiFilippantonio','Ashton Kaufman','Benjamin Veader','Brandi Romero','Carla Balk','Chelsea Higgs','Cierra Farrow-Boyle','Darlena Barley','Dennis Sadberry','Donica Sadberry','Gabriela Crosser','Hector Torres','India Blackshear','Jenny Cohen','Jessenia Zinner','Joyce Mireault','Justine Johnston','Kahila White','Keith Glass','Kira Warrens','Kye Mingus','Kyle Olson','Lake Porter','Michael Tarver','Prakash Agrawal','Ravi Sharma','Richie Corrie','Roberta Harris','Thomas Doheny','Time Isufi','Youseff Daboul','Yuxuan Xia'];
      const val = fields[key] || '';
      const opts = agentNames.map(n => `<option value="${n}"${n===val?' selected':''}>${n}</option>`).join('');
      return `<div class="info-field">
        <div class="info-label">Agent Partner ${i+1}</div>
        <select class="info-input" onchange="saveField('${key}', this.value)">
          <option value="">—</option>${opts}
        </select>
      </div>`;
    }).join('')}
    <div class="info-field">
      <div class="info-label">TC Name</div>
      <select class="info-input" onchange="saveField('tcName', this.value)">
        <option value="">—</option>
        <option value="Joana Guzman"${(fields.tcName||'')==='Joana Guzman'?' selected':''}>Joana Guzman</option>
        <option value="Ashley Belliveau"${(fields.tcName||'')==='Ashley Belliveau'?' selected':''}>Ashley Belliveau</option>
      </select>
    </div>
    <div class="info-field" style="background:#fff7ed">
      <div class="info-label">BINSR Due (Day 10)</div>
      <input id="binsrDue" class="info-input" type="date" placeholder="—"
        style="color:#b45309;font-weight:600"
        value="${fields.binsrDue || (fields.contractDate ? (() => { const d = new Date(fields.contractDate + "T12:00:00"); d.setDate(d.getDate() + 10); return d.toISOString().slice(0,10); })() : '')}"
        onchange="saveField('binsrDue', this.value)">
    </div>
  </div>
</div>

<div class="container">${sectionHTML}</div>
<div class="toast" id="toast">Saved</div>

<script>
const TXN_ID = '${id}';
const ITEMS = ${JSON.stringify(items.map(i => ({ id: i.id, day: i.day })))};

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function calcDue(dayLabel, contractDate, closeDate) {
  if (!dayLabel) return '';
  if (dayLabel.startsWith('Day')) {
    const n = parseInt(dayLabel.split(' ')[1]);
    if (!contractDate) return '';
    return addDays(contractDate, n);
  }
  if (dayLabel.startsWith('COE')) {
    if (!closeDate) return '';
    const offset = dayLabel === 'COE' ? 0 : parseInt(dayLabel.split(' ')[1]);
    return addDays(closeDate, offset || 0);
  }
  return '';
}

function refreshDueDates() {
  const contractDate = document.querySelector('input[data-key="contractDate"]')?.value || '';
  const closeDate = document.querySelector('input[data-key="closeDate"]')?.value || '';
  const today = new Date().toISOString().slice(0, 10);
  ITEMS.forEach(item => {
    const inp = document.querySelector('.date-input.due[data-item="' + item.id + '"]');
    if (!inp) return;
    const autoISO = calcDue(item.day, contractDate, closeDate);
    inp.setAttribute('data-auto', autoISO);
    // only auto-fill if user hasn't manually saved a due date
    if (!inp.dataset.manual) inp.value = autoISO;
    colorDue(inp);
  });
}
function colorDue(inp) {
  const today = new Date().toISOString().slice(0, 10);
  const isChecked = inp.closest('tr')?.querySelector('input[type=checkbox]')?.checked;
  const overdue = inp.value && !isChecked && inp.value < today;
  inp.classList.toggle('overdue', !!overdue);
}
async function saveDue(itemId, val) {
  const inp = document.querySelector('.date-input.due[data-item="' + itemId + '"]');
  if (inp) { inp.dataset.manual = val ? '1' : ''; colorDue(inp); }
  await fetch('/api/transactions/' + TXN_ID + '/note', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({itemId, field: 'due', val})
  });
  showToast();
}

// mark manually saved due dates so auto-refresh doesn't overwrite them
document.querySelectorAll('.date-input.due').forEach(inp => {
  const auto = inp.dataset.auto;
  if (inp.value && inp.value !== auto) inp.dataset.manual = '1';
  colorDue(inp);
});

// tag info-inputs with data-key for easy lookup
document.querySelectorAll('.info-input').forEach((inp, i) => {
  const keys = ['address','contractDate','closeDate','clientName','binsrDue'];
  inp.setAttribute('data-key', keys[i] || '');
  if (keys[i] === 'contractDate' || keys[i] === 'closeDate') {
    inp.addEventListener('change', refreshDueDates);
  }
  if (keys[i] === 'binsrDue') {
    inp.addEventListener('change', function() { this.dataset.manual = this.value ? '1' : ''; });
  }
  if (keys[i] === 'contractDate') {
    inp.addEventListener('change', function() {
      const binsr = document.getElementById('binsrDue');
      if (binsr && !binsr.dataset.manual) {
        if (!this.value) { binsr.value = ''; return; }
        const d = new Date(this.value + 'T12:00:00');
        d.setDate(d.getDate() + 10);
        binsr.value = d.toISOString().slice(0, 10);
      }
    });
  }
});

async function toggle(itemId, val) {
  await fetch('/api/transactions/' + TXN_ID + '/check', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({itemId, checked: val})
  });
  document.getElementById(itemId).closest('tr').classList.toggle('done', val);
  updateProgress();
  refreshDueDates();
  showToast();
}
async function saveItemField(itemId, field, val) {
  await fetch('/api/transactions/' + TXN_ID + '/note', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({itemId, field, val})
  });
  showToast();
}
async function setTxnStatus(status) {
  await fetch('/api/transactions/' + TXN_ID + '/status', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({status})
  });
  location.reload();
}
async function saveField(key, val) {
  await fetch('/api/transactions/' + TXN_ID + '/field', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({key, val})
  });
  showToast();
  refreshDueDates();
}
function updateProgress() {
  const boxes = document.querySelectorAll('input[type=checkbox]');
  const total = boxes.length, done = [...boxes].filter(b=>b.checked).length;
  const pct = Math.round(done/total*100);
  document.getElementById('pbar').style.width = pct + '%';
  document.getElementById('plabel').innerHTML =
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
  const sorted = Object.entries(transactions).sort((a,b) => b[1].createdAt - a[1].createdAt);

  function makeRow(id, t, isArchived) {
    const items = t.type === "buyer" ? BUYER_ITEMS : LISTING_ITEMS;
    const done = items.filter(i => (t.checked || {})[i.id]).length;
    const pct = Math.round((done / items.length) * 100);
    const color = t.type === "buyer" ? "#1565c0" : "#2e7d32";
    const fields = t.fields || {};
    const status = t.status || "active";
    const actionBtns = isArchived
      ? `<button onclick="event.stopPropagation();setStatus('${id}','active')" style="background:#f0f4ff;color:#1e3a5f;border:none;padding:4px 10px;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer">Reopen</button>`
      : `<button onclick="event.stopPropagation();setStatus('${id}','closed')" style="background:#dcfce7;color:#15803d;border:none;padding:4px 10px;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;margin-right:4px">Close</button>
         <button onclick="event.stopPropagation();setStatus('${id}','cancelled')" style="background:#fee2e2;color:#dc2626;border:none;padding:4px 10px;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer">Cancel</button>`;
    return `<tr onclick="window.location='/t/${id}'" style="cursor:pointer;${isArchived?'opacity:0.7':''}">
      <td><strong>${t.address || '(no address)'}</strong></td>
      <td><span style="background:${color};color:white;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;text-transform:uppercase">${t.type}</span></td>
      <td>${fields.clientName || t.clientName || '—'}</td>
      <td>${fields.agentPartner1 || '—'}</td>
      <td>${fields.contractDate || '—'}</td>
      <td>${fields.closeDate || '—'}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;height:7px;background:#e0e4f0;border-radius:4px;min-width:80px">
            <div style="width:${pct}%;height:7px;background:${pct===100?'#2e7d32':color};border-radius:4px"></div>
          </div>
          <span style="font-size:12px;font-weight:600;color:#555;white-space:nowrap">${pct}%</span>
        </div>
      </td>
      <td onclick="event.stopPropagation()" style="white-space:nowrap">
        ${actionBtns}
        <button onclick="event.stopPropagation();deleteTxn('${id}','${(t.address||'this transaction').replace(/'/g,"\\'")}',this)" style="background:#f5f5f5;color:#888;border:none;padding:4px 8px;border-radius:5px;font-size:11px;cursor:pointer;margin-left:4px">✕</button>
      </td>
    </tr>`;
  }

  const active     = sorted.filter(([,t]) => !t.status || t.status === "active");
  const closed     = sorted.filter(([,t]) => t.status === "closed");
  const cancelled  = sorted.filter(([,t]) => t.status === "cancelled");

  function makeTable(list, archived) {
    if (list.length === 0) return '<div class="empty">None</div>';
    return `<table><thead><tr>
      <th>Address</th><th>Type</th><th>Client</th><th>Agent Partner</th>
      <th>Contract Date</th><th>Close Date</th><th>Progress</th><th>Actions</th>
    </tr></thead><tbody>${list.map(([id,t]) => makeRow(id,t,archived)).join('')}</tbody></table>`;
  }

  const rows = ''; // unused placeholder

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TC Checklist — Kumler Group</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:-apple-system,Helvetica,sans-serif; background:#f5f6fa; color:#1a1a2e; }
  .header { background:#1e3a5f; color:white; padding:18px 32px; display:flex; align-items:center; justify-content:space-between; }
  .header h1 { font-size:20px; font-weight:700; }
  .header p { font-size:13px; color:#a8c4e0; margin-top:2px; }
  .btn { background:#2563eb; color:white; border:none; padding:10px 20px; border-radius:7px;
         font-size:13px; font-weight:600; cursor:pointer; }
  .btn:hover { background:#1d4ed8; }
  .container { max-width:1200px; margin:28px auto; padding:0 16px; }
  .card { background:white; border-radius:10px; box-shadow:0 1px 4px rgba(0,0,0,.07); overflow:hidden; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; padding:11px 16px; background:#f0f4ff; font-size:11px; color:#555;
       font-weight:700; text-transform:uppercase; letter-spacing:.4px; border-bottom:2px solid #e0e4f0; }
  td { padding:12px 16px; border-bottom:1px solid #f0f2f8; font-size:14px; }
  tr:last-child td { border-bottom:none; }
  tr:hover td { background:#f7f9ff; }
  .empty { padding:48px; text-align:center; color:#888; font-size:14px; }
  .modal-bg { display:none; position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:100; align-items:center; justify-content:center; }
  .modal-bg.open { display:flex; }
  .modal { background:white; border-radius:12px; padding:28px; width:440px; max-width:95vw; box-shadow:0 8px 32px rgba(0,0,0,.18); }
  .modal h2 { font-size:17px; margin-bottom:20px; color:#1e3a5f; font-weight:700; }
  .field { margin-bottom:14px; }
  .field label { display:block; font-size:12px; font-weight:700; color:#555; margin-bottom:5px; text-transform:uppercase; }
  .field input, .field select { width:100%; border:1px solid #d0d7e8; border-radius:6px;
    padding:9px 12px; font-size:14px; outline:none; font-family:inherit; }
  .field input:focus, .field select:focus { border-color:#1e3a5f; }
  .modal-actions { display:flex; gap:10px; justify-content:flex-end; margin-top:22px; }
  .btn-cancel { background:#f0f4ff; color:#1e3a5f; border:none; padding:10px 20px;
                border-radius:7px; font-size:13px; font-weight:600; cursor:pointer; }
</style></head>
<body>
<div class="header">
  <div>
    <h1>TC Checklist — Kumler Group</h1>
    <p>Transaction coordinator checklists for buyers &amp; listings</p>
  </div>
  <button class="btn" onclick="document.getElementById('modal').classList.add('open')">+ New Transaction</button>
</div>
<div class="container">
  <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:#1e3a5f;letter-spacing:.5px;margin-bottom:8px">Active Transactions</div>
  <div class="card" style="margin-bottom:28px">
    ${active.length === 0
      ? '<div class="empty">No active transactions. Click <strong>+ New Transaction</strong> to get started.</div>'
      : makeTable(active, false)}
  </div>

  <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:#15803d;letter-spacing:.5px;margin-bottom:8px">Closed Transactions</div>
  <div class="card" style="margin-bottom:28px">
    ${makeTable(closed, true)}
  </div>

  <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:#dc2626;letter-spacing:.5px;margin-bottom:8px">Cancelled Transactions</div>
  <div class="card" style="margin-bottom:28px">
    ${makeTable(cancelled, true)}
  </div>
</div>

<div class="modal-bg" id="modal">
  <div class="modal">
    <h2>New Transaction</h2>
    <div class="field"><label>Type</label>
      <select id="f-type"><option value="buyer">Buyer</option><option value="listing">Listing</option></select>
    </div>
    <div class="field"><label>Property Address</label>
      <input id="f-address" placeholder="123 Main St, Phoenix AZ 85001">
    </div>
    <div class="field"><label>Client Name</label>
      <input id="f-client" placeholder="John & Jane Smith">
    </div>
    <div class="field"><label>Agent Partner</label>
      <select id="f-agent">
        <option value="">—</option>
        ${['Akanksha Tomar','Alexandra Allen','Alexis Wilson','Angela Massey','Angie Rodriguez','Annie Clark','Arielle Jaime','Ashleigh DiFilippantonio','Ashton Kaufman','Benjamin Veader','Brandi Romero','Carla Balk','Chelsea Higgs','Cierra Farrow-Boyle','Darlena Barley','Dennis Sadberry','Donica Sadberry','Gabriela Crosser','Hector Torres','India Blackshear','Jenny Cohen','Jessenia Zinner','Joyce Mireault','Justine Johnston','Kahila White','Keith Glass','Kira Warrens','Kye Mingus','Kyle Olson','Lake Porter','Michael Tarver','Prakash Agrawal','Ravi Sharma','Richie Corrie','Roberta Harris','Thomas Doheny','Time Isufi','Youseff Daboul','Yuxuan Xia'].map(n => `<option value="${n}">${n}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>Contract Execution Date (Day 0)</label>
      <input id="f-contract" type="date">
    </div>
    <div class="field"><label>Close of Escrow Date (COE)</label>
      <input id="f-close" type="date">
    </div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="document.getElementById('modal').classList.remove('open')">Cancel</button>
      <button class="btn" onclick="create()">Create Checklist</button>
    </div>
  </div>
</div>
<script>
async function setStatus(id, status) {
  await fetch('/api/transactions/' + id + '/status', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({status})
  });
  location.reload();
}
async function deleteTxn(id, label, btn) {
  if (!confirm('Delete "' + label + '"? This cannot be undone.')) return;
  await fetch('/api/transactions/' + id, { method:'DELETE' });
  location.reload();
}
async function create() {
  const addr = document.getElementById('f-address').value;
  const body = {
    type: document.getElementById('f-type').value,
    address: addr,
    fields: {
      address: addr,
      clientName: document.getElementById('f-client').value,
      agentPartner1: document.getElementById('f-agent').value,
      contractDate: document.getElementById('f-contract').value,
      closeDate: document.getElementById('f-close').value,
    }
  };
  const res = await fetch('/api/transactions', {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
  });
  const t = await res.json();
  window.location.href = '/t/' + t.id;
}
document.getElementById('modal').addEventListener('click', function(e) {
  if (e.target === this) this.classList.remove('open');
});
</script>
</body></html>`;
}

// ─── SERVER ──────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost`);
  const pathname = url.pathname;

  if (req.method === "POST" && pathname === "/api/transactions") {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", () => {
      const data = loadData();
      const parsed = JSON.parse(body);
      const id = crypto.randomBytes(6).toString("hex");
      const fields = parsed.fields || {};
      if (parsed.address) fields.address = parsed.address;
      data.transactions[id] = { id, ...parsed, checked: {}, notes: {}, fields, createdAt: Date.now() };
      saveData(data);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data.transactions[id]));
    });
    return;
  }

  const statusMatch = pathname.match(/^\/api\/transactions\/([^/]+)\/status$/);
  if (req.method === "POST" && statusMatch) {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", () => {
      const data = loadData();
      const txId = statusMatch[1];
      const { status } = JSON.parse(body);
      if (data.transactions[txId]) { data.transactions[txId].status = status; saveData(data); }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  const deleteMatch = pathname.match(/^\/api\/transactions\/([^/]+)$/);
  if (req.method === "DELETE" && deleteMatch) {
    const data = loadData();
    delete data.transactions[deleteMatch[1]];
    saveData(data);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  const checkMatch = pathname.match(/^\/api\/transactions\/([^/]+)\/check$/);
  if (req.method === "POST" && checkMatch) {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", () => {
      const data = loadData();
      const txId = checkMatch[1];
      const { itemId, checked } = JSON.parse(body);
      if (data.transactions[txId]) { data.transactions[txId].checked[itemId] = checked; saveData(data); }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  const noteMatch = pathname.match(/^\/api\/transactions\/([^/]+)\/note$/);
  if (req.method === "POST" && noteMatch) {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", () => {
      const data = loadData();
      const txId = noteMatch[1];
      const { itemId, field, val } = JSON.parse(body);
      if (data.transactions[txId]) {
        if (!data.transactions[txId].notes[itemId]) data.transactions[txId].notes[itemId] = {};
        data.transactions[txId].notes[itemId][field] = val;
        saveData(data);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  const fieldMatch = pathname.match(/^\/api\/transactions\/([^/]+)\/field$/);
  if (req.method === "POST" && fieldMatch) {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", () => {
      const data = loadData();
      const txId = fieldMatch[1];
      const { key, val } = JSON.parse(body);
      if (data.transactions[txId]) {
        if (!data.transactions[txId].fields) data.transactions[txId].fields = {};
        data.transactions[txId].fields[key] = val;
        if (key === 'address') data.transactions[txId].address = val;
        saveData(data);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  const txMatch = pathname.match(/^\/t\/([^/]+)$/);
  if (txMatch) {
    const data = loadData();
    const tx = data.transactions[txMatch[1]];
    if (!tx) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(getHTML(tx, txMatch[1]));
    return;
  }

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
