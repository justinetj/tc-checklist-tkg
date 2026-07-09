import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import pg from "pg";

// Arizona is UTC-7 with no DST
function todayAZ() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' });
}

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const PORT = process.env.PORT || 3002;

async function initDB() {
  await pool.query(`CREATE TABLE IF NOT EXISTS store (key TEXT PRIMARY KEY, value JSONB NOT NULL)`);
  await pool.query(`INSERT INTO store (key, value) VALUES ('data', '{"transactions":{}}') ON CONFLICT (key) DO NOTHING`);
}

async function loadData() {
  const r = await pool.query(`SELECT value FROM store WHERE key = 'data'`);
  return r.rows[0]?.value || { transactions: {} };
}

async function saveData(data) {
  await pool.query(`UPDATE store SET value = $1 WHERE key = 'data'`, [JSON.stringify(data)]);
}

// ─── CHECKLIST ITEMS ────────────────────────────────────────────────────────
// day: "Day N" = N days after contract execution date
//      "COE N" = N days relative to close of escrow (negative = before COE)
//      "COE"   = day of close of escrow

const BUYER_ITEMS = [
  // Day 0
  { id: "b60",  day: "Day 0",   label: "Review Formstack" },
  { id: "b2",   day: "Day 0",   label: "Create Deal in FUB" },
  { id: "b2a",  day: "Day 0",   label: "Accurate stage?", indent: true },
  { id: "b2b",  day: "Day 0",   label: "Accurate source?", indent: true },
  { id: "b3",   day: "Day 0",   label: "Create Zillow Payment Form (if applicable)" },
  { id: "b4",   day: "Day 0",   label: "Update Kumler Group Workbook" },
  { id: "b5",   day: "Day 0",   label: "Send intro email to all parties" },
  { id: "b5a",  day: "Day 0",   label: "TC", indent: true },
  { id: "b5d",  day: "Day 0",   label: "Title", indent: true },
  { id: "b5b",  day: "Day 0",   label: "Lender", indent: true },
  { id: "b5c",  day: "Day 0",   label: "Agents", indent: true },
  { id: "b6",   day: "Day 0",   label: "Send buyer intro email (if applicable)" },
  { id: "b7",   day: "Day 0",   label: "Order home / termite inspection (if applicable)" },
  // Day 1
  { id: "b61",  day: "Day 1",   label: "Confirm inspection has been scheduled" },
  { id: "b13",  day: "Day 1",   label: "Earnest money received by title" },
  { id: "b14",  day: "Day 1",   label: "Create SkySlope transaction" },
  { id: "b15",  day: "Day 1",   label: "Notify agent of missing docs / send missing items checklist" },
  // Day 3
  { id: "b16",  day: "Day 3",   label: "SPDS received — send to buyer", hasDue: true },
  // Day 5
  { id: "b16b", day: "Day 5",   label: "CLUE received — send to buyer" },
  { id: "b18",  day: "Day 5",   label: "Update client" },
  { id: "b19",  day: "Day 5",   label: "Send seller ABD" },
  // Day 7
  { id: "b62",  day: "Day 7",   label: "Follow up with agent regarding BINSR" },
  // Day 9
  { id: "b63",  day: "Day 9",   label: "Second BINSR follow up if needed" },
  // Day 10
  { id: "b23",  day: "Day 10",  label: "Inspection period complete" },
  { id: "b24",  day: "Day 10",  label: "BINSR #1 due", hasDue: true },
  { id: "b25",  day: "Day 10",  label: "Request LSU #1", hasDue: true },
  { id: "b26",  day: "Day 10",  label: "Request title commitment", hasDue: true },
  // Day 7-12
  { id: "b30b", day: "Day 12",  label: "BINSR #2 due (5 days after #1)", hasDue: true },
  // Day 12
  { id: "b18b", day: "Day 12",  label: "Update client" },
  // Day 15
  { id: "b29",  day: "Day 15",  label: "Appraisal ordered", hasDue: true },
  { id: "b64",  day: "Day 15",  label: "Follow up with agent regarding BINSR #3" },
  // Day 17
  { id: "b25b", day: "Day 17",  label: "Request LSU #2", hasDue: true },
  { id: "b65",  day: "Day 17",  label: "BINSR #4 due (5 days after BINSR #2)", hasDue: true },
  // Day 19
  { id: "b18c", day: "Day 19",  label: "Update client" },
  // Day 22
  { id: "b34",  day: "Day 22",  label: "Appraisal received — confirm value" },
  // Day 24
  { id: "b35",  day: "Day 24",  label: "Request LSU #3", hasDue: true },
  // Day 26
  { id: "b18d", day: "Day 26",  label: "Update client" },
  // COE -10
  { id: "b37",  day: "COE -10", label: "Order home warranty", hasDue: true },
  { id: "b38",  day: "COE -10", label: "Send questionnaire to listing agent", hasDue: true },
  // COE -5
  { id: "b39",  day: "COE -5",  label: "CDA sent to title", hasDue: true },
  { id: "b40",  day: "COE -5",  label: "Loan approval received / confirmed" },
  // COE -4
  { id: "b41",  day: "COE -4",  label: "Final walkthrough reminder" },
  // COE -3
  { id: "b66",  day: "COE -3",  label: "Confirm all repairs are complete" },
  { id: "b67",  day: "COE -3",  label: "Docs to title" },
  { id: "b40b", day: "COE -3",  label: "Est. Settlement statement" },
  // COE
  { id: "b68",  day: "COE",     label: "Recording confirmed" },
  { id: "b44",  day: "COE",     label: "Final SS / copy of check" },
  { id: "b50",  day: "COE",     label: "Check SkySlope — final documents" },
  { id: "b45",  day: "COE",     label: "Update Workbook" },
  { id: "b45a", day: "COE",     label: "Reconfirm title company", indent: true },
  { id: "b45b", day: "COE",     label: "Reconfirm lender", indent: true },
  { id: "b45c", day: "COE",     label: "Reconfirm home warranty", indent: true },
  { id: "b45d", day: "COE",     label: "Reconfirm sales price", indent: true },
  { id: "b46",  day: "COE",     label: "Update FUB status" },
  { id: "b46b", day: "COE",     label: "Change status to closed", indent: true },
  { id: "b46c", day: "COE",     label: "Reconfirm sales price", indent: true },
  { id: "b46a", day: "COE",     label: "Reconfirm closing date", indent: true },
  { id: "b48",  day: "COE",     label: "Update Zillow status → Sold" },
  { id: "b49",  day: "COE",     label: "Move file to close" },
  { id: "b51",  day: "COE",     label: "Commission Settled" },
];

// Buyer - New Build checklist (BINSR, appraisal, LSU, repair items removed)
const BUYER_NEW_BUILD_ITEMS = [
  // Day 0
  { id: "b60",  day: "Day 0",   label: "Review Formstack" },
  { id: "b2",   day: "Day 0",   label: "Create Deal in FUB" },
  { id: "b2a",  day: "Day 0",   label: "Accurate stage?", indent: true },
  { id: "b2b",  day: "Day 0",   label: "Accurate source?", indent: true },
  { id: "b3",   day: "Day 0",   label: "Create Zillow Payment Form (if applicable)" },
  { id: "b4",   day: "Day 0",   label: "Update Kumler Group Workbook" },
  { id: "b5",   day: "Day 0",   label: "Send intro email to all parties" },
  { id: "b5a",  day: "Day 0",   label: "TC", indent: true },
  { id: "b5d",  day: "Day 0",   label: "Title", indent: true },
  { id: "b5b",  day: "Day 0",   label: "Lender", indent: true },
  { id: "b5c",  day: "Day 0",   label: "Agents", indent: true },
  { id: "b6",   day: "Day 0",   label: "Send buyer intro email (if applicable)" },
  // Day 1
  { id: "b61",  day: "Day 1",   label: "Confirm inspection has been scheduled" },
  { id: "b13",  day: "Day 1",   label: "Earnest money received by title" },
  { id: "b14",  day: "Day 1",   label: "Create SkySlope transaction" },
  { id: "b15",  day: "Day 1",   label: "Notify agent of missing docs / send missing items checklist" },
  // Day 5
  { id: "b19",  day: "Day 5",   label: "Send seller ABD" },
  // Day 10
  { id: "b26",  day: "Day 10",  label: "Request title commitment", hasDue: true },
  // COE -10
  { id: "b38",  day: "COE -10", label: "Send questionnaire to listing agent", hasDue: true },
  // COE -5
  { id: "b39",  day: "COE -5",  label: "CDA sent to title", hasDue: true },
  { id: "b40",  day: "COE -5",  label: "Loan approval received / confirmed" },
  // COE -3
  { id: "b67",  day: "COE -3",  label: "Docs to title" },
  { id: "b40b", day: "COE -3",  label: "Est. Settlement statement" },
  // COE
  { id: "b68",  day: "COE",     label: "Recording confirmed" },
  { id: "b44",  day: "COE",     label: "Final SS / copy of check" },
  { id: "b50",  day: "COE",     label: "Check SkySlope — final documents" },
  { id: "b45",  day: "COE",     label: "Update Workbook" },
  { id: "b45a", day: "COE",     label: "Reconfirm title company", indent: true },
  { id: "b45b", day: "COE",     label: "Reconfirm lender", indent: true },
  { id: "b45c", day: "COE",     label: "Reconfirm home warranty", indent: true },
  { id: "b45d", day: "COE",     label: "Reconfirm sales price", indent: true },
  { id: "b46",  day: "COE",     label: "Update FUB status" },
  { id: "b46b", day: "COE",     label: "Change status to closed", indent: true },
  { id: "b46c", day: "COE",     label: "Reconfirm sales price", indent: true },
  { id: "b46a", day: "COE",     label: "Reconfirm closing date", indent: true },
  { id: "b48",  day: "COE",     label: "Update Zillow status → Sold" },
  { id: "b49",  day: "COE",     label: "Move file to close" },
  { id: "b51",  day: "COE",     label: "Commission Settled" },
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

function getHTML(transaction, id, tc) {
  const items = transaction.type === "buyer" ? BUYER_ITEMS : transaction.type === "buyer-new-build" ? BUYER_NEW_BUILD_ITEMS : LISTING_ITEMS;
  const isListing = transaction.type === "listing" || transaction.type === "listing-uc";
  const checked = transaction.checked || {};
  const notes = transaction.notes || {};
  const fields = transaction.fields || {};
  const contractDate = fields.contractDate || "";
  const closeDate = fields.closeDate || "";
  const total = items.length;
  const done = items.filter(i => checked[i.id]).length;
  const pct = Math.round((done / total) * 100);
  const isBuyer = transaction.type === "buyer" || transaction.type === "buyer-new-build";
  const color = isBuyer ? "#1565c0" : transaction.type === "listing-uc" ? "#b45309" : "#2e7d32";

  // Group items by day label
  const today = todayAZ();
  const groups = [];
  let lastDay = null;
  for (const item of items) {
    const dayKey = item.day || item.section || '';
    if (dayKey !== lastDay) { groups.push({ day: dayKey, items: [] }); lastDay = dayKey; }
    groups[groups.length - 1].items.push(item);
  }

  const ucDate = fields.ucDate || "";
  const isUnderContract = !isListing || !!ucDate;

  const flatRows = groups.map(g => {
    const isUCSection = isListing && (g.items[0]?.section === "Under Contract" || g.items.some(i => i.section === "Under Contract" || i.section?.startsWith("COE")));
    const locked = isUCSection && !isUnderContract;
    const autoDateForGroup = calcDueDateISO(g.day, ucDate || contractDate, closeDate);
    let dateDisplay = '';
    if (autoDateForGroup) {
      const [y,m,d] = autoDateForGroup.split('-');
      dateDisplay = ` — <span style="font-size:12px;font-weight:700;color:#1e3a5f">${m}/${d}/${y}</span>`;
    }
    const isCOE = g.day && g.day.startsWith('COE');
    const headerBg = isCOE ? '#7e22ce' : '#0f4c9e';
    const rows = g.items.map(item => {
      const itemNotes = notes[item.id] || {};
      const autoISO = calcDueDateISO(item.day, contractDate, closeDate);
      const dueVal = itemNotes.due || autoISO;
      const isChecked = !!checked[item.id];
      const overdue = dueVal && !isChecked && dueVal < today;
      const dueCls = overdue ? " overdue" : (dueVal ? " on-time" : "");
      return `
      <tr class="${isChecked ? 'done' : ''}${item.indent ? ' sub-item' : ''}${overdue ? ' row-overdue' : ''}" data-day="${item.day || ''}">
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
    const lockedBanner = locked ? `<tr style="background:#fef9c3"><td colspan="4" style="padding:6px 12px;font-size:11px;color:#92400e;font-weight:600">🔒 Enter Under Contract Date above to unlock this section</td></tr>` : '';
    const tbodyId = 'day-' + g.day.replace(/[^a-z0-9]/gi, '-');
    const header = g.day ? `<tr class="day-header" id="hdr-${tbodyId}" style="background:#f8fafc;${locked?'opacity:0.4':''}cursor:pointer;" onclick="toggleDay('${tbodyId}',this)"><td colspan="4" style="padding:8px 12px;font-size:12px;font-weight:700;letter-spacing:.5px;border-bottom:1px solid #e2e8f0"><span class="day-badge" style="background:${headerBg};color:white;padding:2px 9px;border-radius:10px;font-size:11px">${g.day}</span>${dateDisplay} <span class="collapse-arrow" style="float:right;font-size:10px;color:#94a3b8">▲</span></td></tr>` : '';
    const rowsOut = locked ? rows.replace(/<input type="checkbox"/g, '<input type="checkbox" disabled').replace(/<input type="date"/g, '<input type="date" disabled').replace(/<input type="text"/g, '<input type="text" disabled') : rows;
    return lockedBanner + header + `<tbody id="${tbodyId}" style="${locked?'opacity:0.4;pointer-events:none':''}">${rowsOut}</tbody>`;
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
        ${flatRows}
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
  tr.row-overdue { background:#fff5f5; }
  tr.row-overdue .label-cell label { color:#dc2626; font-weight:600; }
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
  .detail-layout { display:flex; gap:20px; align-items:flex-start; padding:0 0 40px; }
  .detail-main { flex:1; min-width:0; }
  .detail-sidebar { width:280px; flex-shrink:0; position:sticky; top:16px; background:white; border-radius:10px; box-shadow:0 1px 4px rgba(0,0,0,.07); overflow:hidden; }
  .detail-sidebar-hdr { background:#1e3a5f; color:white; padding:11px 14px; font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.5px; }
  .task-due-group { border-bottom:1px solid #f0f2f8; padding:10px 14px; }
  .task-due-group:last-child { border-bottom:none; }
  .task-due-label { font-size:11px; font-weight:700; color:#1e3a5f; margin-bottom:6px; text-transform:uppercase; }
  .task-due-item { display:flex; align-items:flex-start; gap:7px; padding:3px 0; font-size:12px; color:#333; }
  .task-due-item input { margin-top:2px; flex-shrink:0; }
  .task-due-item label.overdue { color:#dc2626; font-weight:600; }
  .task-due-empty { padding:18px 14px; font-size:12px; color:#94a3b8; text-align:center; }
</style></head>
<body>
<div class="header">
  <div style="flex:1">
    <div><a href="/?tc=${tc}">← All Transactions</a></div>
    <h1>${transaction.address || 'No address'} <span class="badge">${transaction.type === 'buyer' ? 'Buyer - Resale' : transaction.type === 'buyer-new-build' ? 'Buyer - New Build' : transaction.type}</span></h1>
  </div>
  <div style="text-align:right;font-size:13px;color:#a8c4e0">${done}/${total} complete</div>
</div>
<div class="progress-bar"><div class="progress-fill" id="pbar"></div></div>
<div class="progress-label" id="plabel"><strong>${done} of ${total}</strong> items complete &nbsp;·&nbsp; <strong>${pct}%</strong></div>

<div class="info-card">
  <div style="padding:12px 0 8px;display:flex;align-items:center;justify-content:space-between">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#888;letter-spacing:.5px">Transaction Details</div>
    <div style="display:flex;gap:8px;align-items:center">
      ${transaction.status === 'pending' ? `<span style="background:#fef3c7;color:#b45309;padding:4px 12px;border-radius:6px;font-size:12px;font-weight:700">⚠️ Pending — Needs Setup</span>` : ''}
      ${transaction.status === 'closed' ? `<span style="background:#dcfce7;color:#15803d;padding:4px 12px;border-radius:6px;font-size:12px;font-weight:700">✓ Closed</span>` : ''}
      ${transaction.status === 'cancelled' ? `<span style="background:#fee2e2;color:#dc2626;padding:4px 12px;border-radius:6px;font-size:12px;font-weight:700">✕ Cancelled</span>` : ''}
      ${transaction.status === 'pending' ? `<button onclick="setTxnStatus('active')" style="background:#1565c0;color:white;border:none;padding:6px 14px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer">✓ Activate Transaction</button>` : ''}
      ${transaction.status !== 'closed' && transaction.status !== 'pending' ? `<button onclick="setTxnStatus('closed')" style="background:#dcfce7;color:#15803d;border:1px solid #bbf7d0;padding:6px 14px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer">Mark Closed</button>` : ''}
      ${transaction.status !== 'cancelled' && transaction.status !== 'pending' ? `<button onclick="setTxnStatus('cancelled')" style="background:#fee2e2;color:#dc2626;border:1px solid #fecaca;padding:6px 14px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer">Mark Cancelled</button>` : ''}
      ${transaction.status && transaction.status !== 'active' && transaction.status !== 'pending' ? `<button onclick="setTxnStatus('active')" style="background:#f0f4ff;color:#1e3a5f;border:1px solid #c7d2fe;padding:6px 14px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer">Reopen</button>` : ''}
    </div>
  </div>
  <div class="info-grid">
    ${(isListing ? [
      ["Property Address", "address", "text", false],
      ["Employment Agreement Date", "contractDate", "date", true],
      ["Listing Start Date", "listingStartDate", "date", true],
      ["Listing Expiration Date", "listingExpDate", "date", true],
      ["Client Name", "clientName", "text", false],
      ["Under Contract Date", "ucDate", "date", true],
      ["Close of Escrow (COE)", "closeDate", "date", true],
      ["BINSR Due (Day 10)", "binsrDue", "date", true],
    ] : transaction.type === "buyer-new-build" ? [
      ["Property Address", "address", "text", false],
      ["Contract Date — Day 0", "contractDate", "date", true],
      ["Close of Escrow Date (COE)", "closeDate", "date", true],
      ["Client Name", "clientName", "text", false],
    ] : [
      ["Property Address", "address", "text", false],
      ["Contract Date — Day 0", "contractDate", "date", true],
      ["Close of Escrow Date (COE)", "closeDate", "date", true],
      ["Client Name", "clientName", "text", false],
      ["BINSR Due (Day 10)", "binsrDue", "date", true],
    ]).map(([label, key, type, hi]) => `
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
    ${transaction.type === 'listing-uc' && transaction.linkedListingId ? `<div class="info-field" style="background:#fef3c7">
      <div class="info-label">Linked Listing</div>
      <a href="/t/${transaction.linkedListingId}" style="font-size:14px;color:#1e3a5f;font-weight:600;text-decoration:none">→ View Original Listing</a>
    </div>` : ''}
    ${!isListing && transaction.type !== 'buyer-new-build' ? `<div class="info-field" style="background:#fff7ed">
      <div class="info-label">BINSR Due (Day 10)</div>
      <input id="binsrDue" class="info-input" type="date" placeholder="—"
        style="color:#b45309;font-weight:600"
        value="${fields.binsrDue || (fields.contractDate ? (() => { const d = new Date(fields.contractDate + "T12:00:00"); d.setDate(d.getDate() + 10); return d.toISOString().slice(0,10); })() : '')}"
        onchange="saveField('binsrDue', this.value)">
    </div>` : ''}
  </div>
</div>

<div class="container" style="padding-top:0;padding-bottom:0">
<div class="detail-layout">
  <div class="detail-main">${sectionHTML}</div>
  <div class="detail-sidebar">
    ${(() => {
      const today = todayAZ();
      const pastDue = [], dueToday = [];
      for (const item of items) {
        if (checked[item.id]) continue;
        const autoISO = calcDueDateISO(item.day, contractDate, closeDate);
        const dueISO = (notes[item.id]?.due) || autoISO;
        if (!dueISO) continue;
        if (dueISO < today) pastDue.push(item);
        else if (dueISO === today) dueToday.push(item);
      }
      const hdrBadges = [
        pastDue.length ? `<span style="background:#dc2626;color:white;border-radius:10px;padding:2px 8px;font-size:11px;font-weight:700">⚠ ${pastDue.length} past due</span>` : '',
        dueToday.length ? `<span style="background:#15803d;color:white;border-radius:10px;padding:2px 8px;font-size:11px;font-weight:700">✓ ${dueToday.length} today</span>` : ''
      ].filter(Boolean).join(' ');
      const hdr = `<div class="detail-sidebar-hdr" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px">📋 Tasks ${hdrBadges}</div>`;
      if (!pastDue.length && !dueToday.length) return hdr + '<div class="task-due-empty">No tasks due today</div>';
      let html = hdr;
      if (pastDue.length) {
        html += '<div class="task-due-group" style="background:#fff5f5">';
        html += `<div class="task-due-label" style="color:#dc2626">⚠ Past Due <span style="font-size:11px;background:#dc2626;color:white;border-radius:10px;padding:1px 7px">${pastDue.length}</span></div>`;
        html += pastDue.map(item => `<div class="task-due-item"><input type="checkbox" onchange="toggle('${item.id}', this.checked)" id="s-${item.id}"><label for="s-${item.id}" class="overdue">${item.label}</label></div>`).join('');
        html += '</div>';
      }
      if (dueToday.length) {
        html += '<div class="task-due-group" style="background:#f0fdf4">';
        html += `<div class="task-due-label" style="color:#15803d">✓ Due Today <span style="font-size:11px;background:#15803d;color:white;border-radius:10px;padding:1px 7px">${dueToday.length}</span></div>`;
        html += dueToday.map(item => `<div class="task-due-item"><input type="checkbox" onchange="toggle('${item.id}', this.checked)" id="s-${item.id}"><label for="s-${item.id}" style="color:#15803d;font-weight:600">${item.label}</label></div>`).join('');
        html += '</div>';
      }
      return html;
    })()}
  </div>
</div>
</div>
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
function calcDueISO(dayLabel, contractDate, closeDate) {
  if (!dayLabel) return '';
  let base = '', offset = 0;
  if (dayLabel.startsWith('Day')) {
    if (!contractDate) return '';
    base = contractDate; offset = parseInt(dayLabel.split(' ')[1]) || 0;
  } else if (dayLabel.startsWith('COE')) {
    if (!closeDate) return '';
    base = closeDate; offset = dayLabel === 'COE' ? 0 : parseInt(dayLabel.split(' ')[1]) || 0;
  } else return '';
  const d = new Date(base + 'T12:00:00');
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function colorDue(inp) {
  const today = new Date().toISOString().slice(0, 10);
  const isChecked = inp.closest('tr')?.querySelector('input[type=checkbox]')?.checked;
  const overdue = inp.value && !isChecked && inp.value < today;
  inp.classList.toggle('overdue', !!overdue);
  // go gray when done, green when active with date
  inp.classList.toggle('due', !isChecked);
}

function updateDayHeaders() {
  document.querySelectorAll('tbody[id^="day-"]').forEach(tbody => {
    const boxes = tbody.querySelectorAll('input[type=checkbox]');
    if (!boxes.length) return;
    const allDone = [...boxes].every(b => b.checked);
    const hdr = document.getElementById('hdr-' + tbody.id);
    if (!hdr) return;
    const td = hdr.querySelector('td');
    if (td) {
      td.style.textDecoration = allDone ? 'line-through' : '';
      td.style.opacity = allDone ? '0.5' : '';
    }
  });
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
updateDayHeaders();

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

function toggleDay(tbodyId, headerRow) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  const collapsed = tbody.style.display === 'none';
  tbody.style.display = collapsed ? '' : 'none';
  const arrow = headerRow.querySelector('.collapse-arrow');
  if (arrow) arrow.textContent = collapsed ? '▲' : '▼';
}

async function toggle(itemId, val) {
  await fetch('/api/transactions/' + TXN_ID + '/check', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({itemId, checked: val})
  });
  const row = document.getElementById(itemId).closest('tr');
  row.classList.toggle('done', val);
  const inp = row.querySelector('.date-input');
  if (inp) colorDue(inp);
  updateDayHeaders();
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

function getDashboardHTML(transactions, tc) {
  const isAdmin = !tc || tc === 'admin';
  const allEntries = Object.entries(transactions).sort((a,b) => b[1].createdAt - a[1].createdAt);
  const sorted = isAdmin ? allEntries : allEntries.filter(([,t]) => (t.fields?.tcName || '') === tc);

  function fmt(dateStr) { if (!dateStr) return '—'; const [y,m,d] = dateStr.split('-'); return `${m}/${d}/${y}`; }
  function makeRow(id, t, isArchived, mode) {
    const items = t.type === "buyer" ? BUYER_ITEMS : t.type === "buyer-new-build" ? BUYER_NEW_BUILD_ITEMS : LISTING_ITEMS;
    const isBuyerT = t.type === "buyer" || t.type === "buyer-new-build";
    const done = items.filter(i => (t.checked || {})[i.id]).length;
    const pct = Math.round((done / items.length) * 100);
    const color = isBuyerT ? "#1565c0" : t.type === "listing-uc" ? "#b45309" : "#2e7d32";
    const fields = t.fields || {};
    const actionBtns = isArchived
      ? `<button onclick="event.stopPropagation();setStatus('${id}','active')" style="background:#f0f4ff;color:#1e3a5f;border:none;padding:4px 10px;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer">Reopen</button>`
      : `<button onclick="event.stopPropagation();setStatus('${id}','closed')" style="background:#dcfce7;color:#15803d;border:none;padding:4px 10px;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;margin-right:4px">Close</button>
         <button onclick="event.stopPropagation();setStatus('${id}','cancelled')" style="background:#fee2e2;color:#dc2626;border:none;padding:4px 10px;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer">Cancel</button>`;
    const progress = `<td><div style="display:flex;align-items:center;gap:8px"><div style="flex:1;height:7px;background:#e0e4f0;border-radius:4px;min-width:80px"><div style="width:${pct}%;height:7px;background:${pct===100?'#2e7d32':color};border-radius:4px"></div></div><span style="font-size:12px;font-weight:600;color:#555;white-space:nowrap">${pct}%</span></div></td>`;
    const actions = `<td onclick="event.stopPropagation()" style="white-space:nowrap">${actionBtns}<button onclick="event.stopPropagation();deleteTxn('${id}','${(t.address||'this transaction').replace(/'/g,"\\'")}',this)" style="background:#f5f5f5;color:#888;border:none;padding:4px 8px;border-radius:5px;font-size:11px;cursor:pointer;margin-left:4px">✕</button></td>`;
    const base = `<td><strong>${t.address || '(no address)'}</strong></td><td>${fields.clientName || t.clientName || '—'}</td><td>${fields.agentPartner1 || '—'}</td>`;
    let dateCols = '';
    if (mode === 'buyer') {
      dateCols = `<td>${fmt(fields.contractDate)}</td><td>${fmt(fields.closeDate)}</td>`;
    } else if (mode === 'listing') {
      dateCols = `<td>${fmt(fields.contractDate)}</td><td>${fmt(fields.listingStartDate)}</td><td>${fmt(fields.listingExpDate)}</td>`;
    } else {
      dateCols = `<td>${fmt(fields.contractDate)}</td><td>${fmt(fields.closeDate)}</td>`;
    }
    // Compute past-due and due-today counts
    const todayStr = todayAZ();
    const contractDate = fields.contractDate || '';
    const closeDate = fields.closeDate || '';
    const notes = t.notes || {};
    const checked = t.checked || {};
    let pastDue = [], dueToday = [];
    for (const item of items) {
      if (checked[item.id]) continue;
      const autoISO = calcDueDateISO(item.day, contractDate, closeDate);
      const dueISO = (notes[item.id]?.due) || autoISO;
      if (!dueISO) continue;
      if (dueISO < todayStr) pastDue.push(item.label);
      else if (dueISO === todayStr) dueToday.push(item.label);
    }
    const pillsCell = `<td style="white-space:nowrap;font-size:10px">` +
      (pastDue.length ? `<span style="background:#fee2e2;color:#dc2626;border-radius:8px;padding:1px 6px;font-weight:700;margin-right:3px">⚠${pastDue.length}</span>` : '') +
      (dueToday.length ? `<span style="background:#dcfce7;color:#15803d;border-radius:8px;padding:1px 6px;font-weight:700">✓${dueToday.length}</span>` : '') +
      `</td>`;
    const baseCompact = `<td style="white-space:nowrap;font-size:13px"><strong>${t.address || '(no address)'}</strong></td><td style="white-space:nowrap;font-size:12px">${fields.clientName || t.clientName || '—'}</td><td style="white-space:nowrap;font-size:12px">${fields.agentPartner1 || '—'}</td>${pillsCell}`;
    const rowStyle = dueToday.length && !pastDue.length
      ? 'border-left:4px solid #16a34a;background:#f0fdf4;'
      : pastDue.length ? 'border-left:4px solid #dc2626;' : '';
    return `<tr onclick="window.location='/t/${id}?tc=${tc}'" style="cursor:pointer;${rowStyle}${isArchived?'opacity:0.7':''}">${baseCompact}${dateCols}${progress}${actions}</tr>`;
  }

  const todayISO   = todayAZ();
  const pending     = sorted.filter(([,t]) => t.status === "pending");
  const active      = sorted.filter(([,t]) => (!t.status || t.status === "active") && (t.type === "buyer" || t.type === "buyer-new-build"));
  const listings    = sorted.filter(([,t]) => (!t.status || t.status === "active") && t.type === "listing" && !t.fields?.ucDate);
  const listingUC   = sorted.filter(([,t]) => (!t.status || t.status === "active") && (t.type === "listing-uc" || (t.type === "listing" && t.fields?.ucDate)));
  const closingToday = sorted.filter(([,t]) => (!t.status || t.status === "active") && t.type !== "listing" && (t.fields?.closeDate === todayISO));
  const closed     = sorted.filter(([,t]) => t.status === "closed");
  const cancelled  = sorted.filter(([,t]) => t.status === "cancelled");

  function makeTable(list, archived, mode) {
    if (list.length === 0) return '<div class="empty">None</div>';
    const headers = mode === 'buyer'
      ? `<th>Address</th><th>Client</th><th>Agent</th><th>Under Contract</th><th>Closing Date</th><th>Progress</th><th>Actions</th>`
      : mode === 'listing'
      ? `<th>Address</th><th>Client</th><th>Agent</th><th>Agreement Date</th><th>Start Date</th><th>Expiration</th><th>Progress</th><th>Actions</th>`
      : `<th>Address</th><th>Client</th><th>Agent</th><th>Contract Date</th><th>Close Date</th><th>Progress</th><th>Actions</th>`;
    return `<table><thead><tr>${headers}</tr></thead><tbody>${list.map(([id,t]) => makeRow(id,t,archived,mode)).join('')}</tbody></table>`;
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
  .container { max-width:1400px; margin:28px auto; padding:0 16px; }
  .dashboard-layout { display:flex; gap:20px; align-items:flex-start; }
  .dashboard-main { flex:1; min-width:0; }
  .task-panel { width:300px; flex-shrink:0; position:sticky; top:16px; }
  .task-panel .card { padding:0; }
  .task-group { border-bottom:1px solid #f0f2f8; padding:10px 14px; }
  .task-group:last-child { border-bottom:none; }
  .task-group-name { font-size:11px; font-weight:700; color:#1e3a5f; margin-bottom:6px; text-transform:uppercase; letter-spacing:.3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .task-item { display:flex; align-items:flex-start; gap:7px; padding:3px 0; }
  .task-item input[type=checkbox] { margin-top:2px; flex-shrink:0; cursor:pointer; }
  .task-item label { font-size:12px; color:#333; line-height:1.4; cursor:pointer; }
  .task-item label.overdue { color:#dc2626; font-weight:600; }
  .task-panel-empty { padding:24px 14px; text-align:center; color:#888; font-size:12px; }
  @media(max-width:900px) { .dashboard-layout { flex-direction:column; } .task-panel { width:100%; position:static; } }
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
    <div style="display:flex;align-items:center;gap:10px">
      <a href="/" style="color:rgba(255,255,255,.7);text-decoration:none;font-size:12px;font-weight:600;border:1px solid rgba(255,255,255,.3);border-radius:5px;padding:3px 8px">← Back</a>
      <h1>TC Checklist — Kumler Group</h1>
    </div>
    <p>${isAdmin ? 'Viewing all transactions (Admin)' : `Viewing transactions for <strong>${tc}</strong>`}</p>
  </div>
  <button class="btn" onclick="document.getElementById('modal').classList.add('open')">+ New Transaction</button>
</div>
<div class="container">
<div class="dashboard-layout">
  <div class="dashboard-main">
    ${pending.length > 0 ? `
    <div style="background:#b45309;color:white;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;padding:9px 16px;border-radius:8px;margin-bottom:8px;display:flex;align-items:center;gap:8px">⚠️ Needs Attention — New Submissions (${pending.length})</div>
    <div class="card" style="margin-bottom:28px;border:2px solid #b45309">${makeTable(pending, false, 'buyer')}</div>` : ''}
    ${closingToday.length > 0 ? `
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:white;letter-spacing:.5px;margin-bottom:8px;background:#dc2626;padding:8px 14px;border-radius:8px;display:flex;align-items:center;gap:8px">🔴 CLOSINGS TODAY — ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</div>
    <div class="card" style="margin-bottom:28px;border:2px solid #dc2626">${makeTable(closingToday, false, 'buyer')}</div>` : ''}
    <div style="background:#1565c0;color:white;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;padding:9px 16px;border-radius:8px;margin-bottom:8px">🏠 Buyers</div>
    <div class="card" style="margin-bottom:24px;border-top:3px solid #1565c0">
      ${active.length === 0 ? '<div class="empty">No active transactions.</div>' : makeTable(active, false, 'buyer')}
    </div>
    <div style="background:#1565c0;color:white;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;padding:9px 16px;border-radius:8px;margin-bottom:8px">📋 Active Listings</div>
    <div class="card" style="margin-bottom:24px;border-top:3px solid #1565c0">
      ${listings.length === 0 ? '<div class="empty">No active listings.</div>' : makeTable(listings, false, 'listing')}
    </div>
    <div style="background:#1565c0;color:white;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;padding:9px 16px;border-radius:8px;margin-bottom:8px">📝 Sellers</div>
    <div class="card" style="margin-bottom:24px;border-top:3px solid #1565c0">
      ${listingUC.length === 0 ? '<div class="empty">No listings under contract.</div>' : makeTable(listingUC, false, 'buyer')}
    </div>
    <div style="background:#6b7280;color:white;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;padding:9px 16px;border-radius:8px;margin-bottom:8px">✓ Closed Transactions</div>
    <div class="card" style="margin-bottom:24px;border-top:3px solid #6b7280">${makeTable(closed, true, 'buyer')}</div>
    <div style="background:#6b7280;color:white;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;padding:9px 16px;border-radius:8px;margin-bottom:8px">✕ Cancelled Transactions</div>
    <div class="card" style="margin-bottom:24px;border-top:3px solid #6b7280">${makeTable(cancelled, true, 'buyer')}</div>
  </div>

  <div class="task-panel">
    ${(() => {
      const today = todayAZ();
      const allTxns = [...active, ...listings, ...listingUC];
      let totalPast = 0, totalToday = 0;
      const txnGroups = [];
      for (const [id, t] of allTxns) {
        const items = t.type === 'buyer' ? BUYER_ITEMS : t.type === 'buyer-new-build' ? BUYER_NEW_BUILD_ITEMS : LISTING_ITEMS;
        const fields = t.fields || {};
        const contractDate = fields.contractDate || '';
        const closeDate = fields.closeDate || '';
        const checked = t.checked || {};
        const notes = t.notes || {};
        const pastDue = [], dueToday = [];
        for (const item of items) {
          if (item.indent || checked[item.id]) continue;
          const auto = calcDueDateISO(item.day, contractDate, closeDate);
          const due = notes[item.id]?.due || auto;
          if (!due) continue;
          if (due < today) pastDue.push(item);
          else if (due === today) dueToday.push(item);
        }
        if (!pastDue.length && !dueToday.length) continue;
        totalPast += pastDue.length;
        totalToday += dueToday.length;
        const shortAddr = (t.address || '(no address)').replace(/,.*$/, '');
        let inner = `<div class="task-group-name" style="font-size:11px;font-weight:700;color:#1e3a5f;padding:5px 0 3px;border-bottom:1px solid #e0e4f0;margin-bottom:4px">${shortAddr}</div>`;
        if (pastDue.length) inner += pastDue.map(item => `<div class="task-item"><input type="checkbox" id="dt-${id}-${item.id}" onchange="dashCheck('${id}','${item.id}',this.checked)"><label for="dt-${id}-${item.id}" style="color:#dc2626;font-weight:600">${item.label}</label></div>`).join('');
        if (dueToday.length) inner += dueToday.map(item => `<div class="task-item"><input type="checkbox" id="dt-${id}-${item.id}" onchange="dashCheck('${id}','${item.id}',this.checked)"><label for="dt-${id}-${item.id}" style="color:#15803d;font-weight:600">${item.label}</label></div>`).join('');
        txnGroups.push(`<div style="padding:8px 12px;border-bottom:1px solid #f0f2f8">${inner}</div>`);
      }
      const hdrBadges = [
        totalPast ? `<span style="background:#dc2626;color:white;border-radius:10px;padding:2px 8px;font-size:11px;font-weight:700">⚠ ${totalPast} past due</span>` : '',
        totalToday ? `<span style="background:#15803d;color:white;border-radius:10px;padding:2px 8px;font-size:11px;font-weight:700">✓ ${totalToday} today</span>` : ''
      ].filter(Boolean).join(' ');
      const body = txnGroups.length ? txnGroups.join('') : '<div class="task-panel-empty">No tasks due today</div>';
      return `<div class="detail-sidebar-hdr" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px">📋 Tasks ${hdrBadges}</div><div class="card" style="padding:0;overflow:hidden">${body}</div>`;
    })()}
  </div>
</div>
</div>

<div class="modal-bg" id="modal">
  <div class="modal">
    <h2>New Transaction</h2>
    <div class="field"><label>Type</label>
      <select id="f-type" onchange="onTypeChange(this.value)">
        <option value="buyer">Buyer - Resale</option>
        <option value="buyer-new-build">Buyer - New Build</option>
        <option value="listing">Listing</option>
        <option value="listing-uc">Listing Under Contract</option>
      </select>
    </div>
    <div class="field" id="f-linked-wrap" style="display:none"><label>Link to Listing</label>
      <select id="f-linked">
        <option value="">— Select listing —</option>
        ${listings.map(([id,t]) => `<option value="${id}" data-address="${(t.address||'').replace(/"/g,'&quot;')}">${t.address || '(no address)'}</option>`).join('')}
      </select>
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
    <div class="field" id="f-contract-wrap"><label id="f-contract-label">Contract Execution Date (Day 0)</label>
      <input id="f-contract" type="date">
    </div>
    <div class="field" id="f-close-wrap"><label>Close of Escrow Date (COE)</label>
      <input id="f-close" type="date">
    </div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="document.getElementById('modal').classList.remove('open')">Cancel</button>
      <button class="btn" onclick="create()">Create Checklist</button>
    </div>
  </div>
</div>
<script>
function onTypeChange(val) {
  const isListing = val === 'listing';
  const isUC = val === 'listing-uc';
  document.getElementById('f-linked-wrap').style.display = isUC ? '' : 'none';
  document.getElementById('f-close-wrap').style.display = isListing ? 'none' : '';
  document.getElementById('f-contract-label').textContent = isListing ? 'Employment Agreement Date' : 'Contract Execution Date (Day 0)';
}
document.getElementById('f-linked').addEventListener('change', function() {
  const opt = this.options[this.selectedIndex];
  if (opt.value) document.getElementById('f-address').value = opt.dataset.address;
});
async function dashCheck(txnId, itemId, checked) {
  await fetch('/api/transactions/' + txnId + '/check', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ itemId, checked })
  });
  if (checked) {
    const row = document.getElementById('dt-' + txnId + '-' + itemId);
    if (row) row.closest('.task-item').style.opacity = '0.4';
  }
}
async function setStatus(id, status) {
  await fetch('/api/transactions/' + id + '/status', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({status})
  });
  location.reload();
}
async function deleteTxn(id, label, btn) {
  const code = prompt('Enter passcode to delete "' + label + '":');
  if (code === null) return;
  if (code !== '3315') { alert('Incorrect passcode.'); return; }
  if (!confirm('Delete "' + label + '"? This cannot be undone.')) return;
  const r = await fetch('/api/transactions/' + id, { method:'DELETE' });
  if (!r.ok) { const j = await r.json(); alert(j.error || 'Could not delete.'); return; }
  location.reload();
}
async function create() {
  const addr = document.getElementById('f-address').value;
  const type = document.getElementById('f-type').value;
  const body = {
    type,
    address: addr,
    linkedListingId: type === 'listing-uc' ? document.getElementById('f-linked').value : null,
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
  window.location.href = '/t/' + t.id + '?tc=${tc}';
}
document.getElementById('modal').addEventListener('click', function(e) {
  if (e.target === this) this.classList.remove('open');
});
</script>
</body></html>`;
}

const TC_NAMES = ["Joana Guzman", "Ashley Belliveau"];
const TC_COLORS = ["#1565c0", "#0d5c2e"];

function getTCSelectHTML() {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TC Checklist — Kumler Group</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:-apple-system,Helvetica,sans-serif; background:#f5f6fa; color:#1a1a2e; min-height:100vh; display:flex; flex-direction:column; }
  .header { background:#1e3a5f; color:white; padding:24px 32px; text-align:center; }
  .header h1 { font-size:24px; font-weight:800; }
  .header p { font-size:14px; color:#a8c4e0; margin-top:4px; }
  .select-wrap { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:40px 20px; }
  .select-label { font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; color:#64748b; margin-bottom:24px; }
  .tc-grid { display:flex; flex-wrap:wrap; gap:16px; justify-content:center; max-width:700px; }
  .tc-card { background:white; border-radius:12px; box-shadow:0 2px 8px rgba(0,0,0,.08); padding:28px 36px; cursor:pointer; text-align:center; min-width:180px; border:2px solid transparent; transition:all .15s; text-decoration:none; color:inherit; }
  .tc-card:hover { transform:translateY(-2px); box-shadow:0 6px 20px rgba(0,0,0,.12); }
  .tc-avatar { width:56px; height:56px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:22px; font-weight:800; color:white; margin:0 auto 12px; }
  .tc-name { font-size:15px; font-weight:700; color:#1e3a5f; }
  .tc-role { font-size:12px; color:#94a3b8; margin-top:3px; }
  .admin-card { background:#1e3a5f; color:white; }
  .admin-card .tc-name { color:white; }
  .admin-card .tc-role { color:#a8c4e0; }
</style>
<script>
const TC_PASSCODES = { 'Joana Guzman': '5211' };
function tcLogin(name) {
  const required = TC_PASSCODES[name];
  if (!required) { window.location.href = '/?tc=' + encodeURIComponent(name); return; }
  const code = prompt('Enter passcode:');
  if (code === required) { window.location.href = '/?tc=' + encodeURIComponent(name); }
  else if (code !== null) { alert('Incorrect passcode.'); }
}
function adminLogin() {
  const code = prompt('Enter passcode:');
  if (code === '3315') { window.location.href = '/?tc=admin'; }
  else if (code !== null) { alert('Incorrect passcode.'); }
}
</script>
</head>
<body>
<div class="header">
  <h1>TC Checklist — Kumler Group</h1>
  <p>Select your name to view your transactions</p>
</div>
<div class="select-wrap">
  <div class="select-label">Who are you?</div>
  <div class="tc-grid">
    ${TC_NAMES.map((name, i) => {
      const initials = name.split(' ').map(w=>w[0]).join('');
      return `<a class="tc-card" href="javascript:void(0)" onclick="tcLogin('${name.replace(/'/g,"\\'")}')">
        <div class="tc-avatar" style="background:${TC_COLORS[i]}">${initials}</div>
        <div class="tc-name">${name}</div>
        <div class="tc-role">Transaction Coordinator</div>
      </a>`;
    }).join('')}
    <a class="tc-card admin-card" href="javascript:void(0)" onclick="adminLogin()">
      <div class="tc-avatar" style="background:#7e22ce">JJ</div>
      <div class="tc-name">Justine Johnston</div>
      <div class="tc-role">Director of Operations</div>
    </a>
  </div>
</div>
</body></html>`;
}

// ─── SERVER ──────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);
  const pathname = url.pathname;

  if (req.method === "POST" && pathname === "/api/transactions") {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", async () => {
      const data = await loadData();
      const parsed = JSON.parse(body);
      const id = crypto.randomBytes(6).toString("hex");
      const fields = parsed.fields || {};
      if (parsed.address) fields.address = parsed.address;
      data.transactions[id] = { id, ...parsed, checked: {}, notes: {}, fields, createdAt: Date.now() };
      await saveData(data);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data.transactions[id]));
    });
    return;
  }

  const statusMatch = pathname.match(/^\/api\/transactions\/([^/]+)\/status$/);
  if (req.method === "POST" && statusMatch) {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", async () => {
      const data = await loadData();
      const txId = statusMatch[1];
      const { status } = JSON.parse(body);
      if (data.transactions[txId]) { data.transactions[txId].status = status; await saveData(data); }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  const deleteMatch = pathname.match(/^\/api\/transactions\/([^/]+)$/);
  if (req.method === "DELETE" && deleteMatch) {
    const data = await loadData();
    const delId = deleteMatch[1];
    const linked = Object.values(data.transactions).find(t => t.linkedListingId === delId);
    if (linked) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: 'This transaction has a linked Listing UC and cannot be deleted.' }));
      return;
    }
    delete data.transactions[delId];
    await saveData(data);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  const checkMatch = pathname.match(/^\/api\/transactions\/([^/]+)\/check$/);
  if (req.method === "POST" && checkMatch) {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", async () => {
      const data = await loadData();
      const txId = checkMatch[1];
      const { itemId, checked } = JSON.parse(body);
      if (data.transactions[txId]) { data.transactions[txId].checked[itemId] = checked; await saveData(data); }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  const noteMatch = pathname.match(/^\/api\/transactions\/([^/]+)\/note$/);
  if (req.method === "POST" && noteMatch) {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", async () => {
      const data = await loadData();
      const txId = noteMatch[1];
      const { itemId, field, val } = JSON.parse(body);
      if (data.transactions[txId]) {
        if (!data.transactions[txId].notes[itemId]) data.transactions[txId].notes[itemId] = {};
        data.transactions[txId].notes[itemId][field] = val;
        await saveData(data);
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
    req.on("end", async () => {
      const data = await loadData();
      const txId = fieldMatch[1];
      const { key, val } = JSON.parse(body);
      if (data.transactions[txId]) {
        if (!data.transactions[txId].fields) data.transactions[txId].fields = {};
        data.transactions[txId].fields[key] = val;
        if (key === 'address') data.transactions[txId].address = val;
        await saveData(data);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/webhook/formstack") {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", async () => {
      try {
        // Parse URL-encoded or JSON
        let p = {};
        try { p = JSON.parse(body); } catch(_) {
          const params = new URLSearchParams(body);
          for (const [k,v] of params.entries()) p[k] = v;
        }
        const get = (...keys) => { for (const k of keys) { const v = p[k]; if (v && String(v).trim()) return String(v).trim(); } return ''; };
        const join = (...keys) => keys.map(k => get(k)).filter(Boolean).join(' ').trim();

        // Agent
        const agentFirst = get('Agent Partner Name First', 'agent_partner_name_first');
        const agentLast  = get('Agent Partner Name Last',  'agent_partner_name_last');
        const agentName  = join('Agent Partner Name') || [agentFirst, agentLast].filter(Boolean).join(' ');
        const agentEmail = get('Agent Partner Email');
        const agentPhone = get('Agent Partner Cell Number');

        // Address (assembled from parts)
        const addr1  = get('Subject Property Address Address Line 1', 'Subject Property Address_1');
        const city   = get('Subject Property Address City', 'Subject Property Address_3');
        const state  = get('Subject Property Address State', 'Subject Property Address_4');
        const zip    = get('Subject Property Address ZIP Code', 'Subject Property Address_5');
        const address = addr1 ? [addr1, city, state, zip].filter(Boolean).join(', ') : get('Subject Property Address');

        // Detect form type: listing form has "Seller 1 Name", escrow has "Client 1 Name"
        const hasSeller = !!(p['Seller 1 Name First'] || p['Seller 1 Name Last'] || p['Seller/Client Email']);
        const type = hasSeller ? 'listing' : 'buyer';

        // Client/Seller names
        let clientName = '';
        if (hasSeller) {
          const s1 = [get('Seller 1 Name First'), get('Seller 1 Name Last')].filter(Boolean).join(' ');
          const s2 = [get('Seller 2 Name First'), get('Seller 2 Name Last')].filter(Boolean).join(' ');
          const s3 = [get('Seller 3 Name First'), get('Seller 3 Name Last')].filter(Boolean).join(' ');
          clientName = [s1, s2, s3].filter(Boolean).join(' & ');
        } else {
          const c1 = [get('Client 1 Name First'), get('Client 1 Name Last')].filter(Boolean).join(' ');
          const c2 = [get('Client 2 Name First'), get('Client 2 Name Last')].filter(Boolean).join(' ');
          const c3 = [get('Client 3 Name First'), get('Client 3 Name Last')].filter(Boolean).join(' ');
          clientName = [c1, c2, c3].filter(Boolean).join(' & ');
        }

        // Dates
        const closeDate = get('Estimated closing date (Month and Year OK)?', 'Estimated closing date');
        const listingStartDate = get('What Date Do You and Your Client Want The Listing Active on the MLS?');
        const notes = get('Any other important information or notes you want/need your transaction coordinator to know?', 'Additional info (optional)', 'Long Answer');

        const data = await loadData();
        const id = 'txn_' + Date.now();
        data.transactions[id] = {
          type,
          address: address || '(Address pending)',
          status: 'pending',
          createdAt: Date.now(),
          fields: {
            clientName,
            agentPartner1: agentName,
            agentPartner1Email: agentEmail,
            agentPartner1Phone: agentPhone,
            closeDate,
            listingStartDate,
            notes,
          },
          checked: {},
          itemNotes: {},
        };
        await saveData(data);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, id, type, address, clientName }));
      } catch(e) {
        res.writeHead(500); res.end(e.message);
      }
    });
    return;
  }

  const txMatch = pathname.match(/^\/t\/([^/]+)$/);
  if (txMatch) {
    const data = await loadData();
    const tx = data.transactions[txMatch[1]];
    if (!tx) { res.writeHead(404); res.end("Not found"); return; }
    const tc = url.searchParams.get('tc') || '';
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(getHTML(tx, txMatch[1], tc));
    return;
  }

  if (pathname === "/" || pathname === "") {
    const tc = url.searchParams.get('tc');
    if (!tc) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(getTCSelectHTML());
      return;
    }
    const data = await loadData();
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(getDashboardHTML(data.transactions, tc));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

initDB().then(() => {
  server.listen(PORT, () => console.log(`TC Checklist running on port ${PORT}`));
}).catch(err => { console.error("DB init failed:", err); process.exit(1); });
