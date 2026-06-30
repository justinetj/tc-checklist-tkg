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
  // Day 0 — Contract Execution
  { id: "b1",  section: "Day 0 — Contract Execution",  day: "Day 0",  label: "Review Formstack — download & review all documents" },
  { id: "b2",  section: "Day 0 — Contract Execution",  day: "Day 0",  label: "Create Deal in FUB / update task due dates" },
  { id: "b3",  section: "Day 0 — Contract Execution",  day: "Day 0",  label: "Create Zillow Payment Form (if applicable)" },
  { id: "b4",  section: "Day 0 — Contract Execution",  day: "Day 0",  label: "Update Kumler Group Workbook" },
  { id: "b5",  section: "Day 0 — Contract Execution",  day: "Day 0",  label: "Send intro email to all parties (TC, title, lender, agents)" },
  { id: "b6",  section: "Day 0 — Contract Execution",  day: "Day 0",  label: "Send buyer intro email (if applicable)" },
  { id: "b7",  section: "Day 0 — Contract Execution",  day: "Day 0",  label: "Order home / termite inspection (if applicable)" },
  { id: "b8",  section: "Day 0 — Contract Execution",  day: "Day 0",  label: "Verify commission split (agent partner vs Kumler)" },
  { id: "b9",  section: "Day 0 — Contract Execution",  day: "Day 0",  label: "Verify lender (approved/preferred lender confirmed)" },
  { id: "b10", section: "Day 0 — Contract Execution",  day: "Day 0",  label: "Verify Zillow payment amount" },
  { id: "b11", section: "Day 0 — Contract Execution",  day: "Day 0",  label: "Confirm title company" },
  // Day 1
  { id: "b12", section: "Day 1",                       day: "Day 1",  label: "Confirm inspection has been scheduled" },
  { id: "b13", section: "Day 1",                       day: "Day 1",  label: "Earnest deposit received by title" },
  { id: "b14", section: "Day 1",                       day: "Day 1",  label: "Create SkySlope transaction" },
  { id: "b15", section: "Day 1",                       day: "Day 1",  label: "Notify agent of any missing docs / send missing docs checklist" },
  // Day 3
  { id: "b16", section: "Day 3",                       day: "Day 3",  label: "SPDS received from seller — send to buyer", hasDue: true },
  { id: "b16b", section: "Day 3",                      day: "Day 3",  label: "CLUE report received" },
  // Day 5
  { id: "b17", section: "Day 5",                       day: "Day 5",  label: "ICH (Insurance Claims History) received — send to buyer" },
  { id: "b18", section: "Day 5",                       day: "Day 5",  label: "Update client (buyer) if applicable" },
  { id: "b19", section: "Day 5",                       day: "Day 5",  label: "Send seller ABD (As-Built Drawing / applicable docs)" },
  // Day 7
  { id: "b20", section: "Day 7",                       day: "Day 7",  label: "Follow up with agent regarding BINSR status" },
  // Day 7–12
  { id: "b21", section: "Day 7–12 — BINSR",            day: "Day 7",  label: "BINSR #1 due (follow up if not received)" },
  // Day 9
  { id: "b22", section: "Day 9",                       day: "Day 9",  label: "Second BINSR follow-up if needed" },
  // Day 10
  { id: "b23", section: "Day 10",                      day: "Day 10", label: "Inspection period complete" },
  { id: "b24", section: "Day 10",                      day: "Day 10", label: "BINSR #1 deadline" },
  { id: "b25", section: "Day 10",                      day: "Day 10", label: "Request LSU (Loan Status Update) #1 from lender" },
  { id: "b26", section: "Day 10",                      day: "Day 10", label: "Request title commitment from title company" },
  // Day 12
  { id: "b27", section: "Day 12",                      day: "Day 12", label: "BINSR #2 due (5 days after BINSR #1)" },
  { id: "b28", section: "Day 12",                      day: "Day 12", label: "Update client if applicable" },
  // Day 15
  { id: "b29", section: "Day 15",                      day: "Day 15", label: "Appraisal ordered" },
  { id: "b30", section: "Day 15",                      day: "Day 15", label: "Follow up with agent regarding BINSR #3 status" },
  { id: "b30b", section: "Day 15",                     day: "Day 15", label: "Seller response to BINSR due (5 days after BINSR)", hasDue: true },
  // Day 17
  { id: "b31", section: "Day 17",                      day: "Day 17", label: "Request LSU #2 from lender" },
  { id: "b32", section: "Day 17",                      day: "Day 17", label: "BINSR #3 due (5 days after BINSR #2)" },
  // Day 19
  { id: "b33", section: "Day 19",                      day: "Day 19", label: "Update client if applicable" },
  // Day 22
  { id: "b34", section: "Day 22",                      day: "Day 22", label: "Appraisal received — confirm value" },
  // Day 24
  { id: "b35", section: "Day 24",                      day: "Day 24", label: "Request LSU #3 from lender" },
  // Day 26
  { id: "b36", section: "Day 26",                      day: "Day 26", label: "Update client if applicable" },
  // COE -10
  { id: "b37", section: "COE -10 Days",                day: "COE -10", label: "Order home warranty" },
  { id: "b38", section: "COE -10 Days",                day: "COE -10", label: "Send questionnaire to listing agent" },
  // COE -5
  { id: "b39", section: "COE -5 Days",                 day: "COE -5", label: "CDA (Commission Disbursement Authorization) sent to title" },
  { id: "b40", section: "COE -5 Days",                 day: "COE -5", label: "Loan approval received / confirmed" },
  // COE -4
  { id: "b41", section: "COE -4 Days",                 day: "COE -4", label: "Final walkthrough reminder sent to buyer & agent" },
  // COE -3
  { id: "b42", section: "COE -3 Days",                 day: "COE -3", label: "Confirm all repairs are complete" },
  { id: "b43", section: "COE -3 Days",                 day: "COE -3", label: "Docs to title (confirm all required docs submitted)" },
  // COE — Close of Escrow
  { id: "b44", section: "COE — Close of Escrow",       day: "COE",    label: "Recording confirmed" },
  { id: "b45", section: "COE — Close of Escrow",       day: "COE",    label: "Update THG Tracker (Workbook)" },
  { id: "b46", section: "COE — Close of Escrow",       day: "COE",    label: "Update FUB status → Closed" },
  { id: "b47", section: "COE — Close of Escrow",       day: "COE",    label: "Update MLS status → Sold" },
  { id: "b48", section: "COE — Close of Escrow",       day: "COE",    label: "Update Zillow status → Sold" },
  { id: "b49", section: "COE — Close of Escrow",       day: "COE",    label: "Commission disbursed — verify split matches workbook" },
  { id: "b50", section: "COE — Close of Escrow",       day: "COE",    label: "Keys delivered to buyer" },
  { id: "b51", section: "COE — Close of Escrow",       day: "COE",    label: "SkySlope file marked complete & archived" },
  // SkySlope Docs
  { id: "b52", section: "SkySlope Docs",               day: "",       label: "Buyer Representation Agreement" },
  { id: "b53", section: "SkySlope Docs",               day: "",       label: "Purchase Contract (fully executed)" },
  { id: "b54", section: "SkySlope Docs",               day: "",       label: "All addenda / amendments" },
  { id: "b55", section: "SkySlope Docs",               day: "",       label: "SPDS (Seller's Property Disclosure)" },
  { id: "b56", section: "SkySlope Docs",               day: "",       label: "Lead-based paint disclosure (if applicable)" },
  { id: "b57", section: "SkySlope Docs",               day: "",       label: "BINSR & seller response(s)" },
  { id: "b58", section: "SkySlope Docs",               day: "",       label: "Home inspection report" },
  { id: "b59", section: "SkySlope Docs",               day: "",       label: "HOA documents (if applicable)" },
  { id: "b60", section: "SkySlope Docs",               day: "",       label: "Appraisal report" },
  { id: "b61", section: "SkySlope Docs",               day: "",       label: "Loan approval / commitment letter" },
  { id: "b62", section: "SkySlope Docs",               day: "",       label: "Earnest money receipt" },
  { id: "b63", section: "SkySlope Docs",               day: "",       label: "Home warranty agreement" },
  { id: "b64", section: "SkySlope Docs",               day: "",       label: "CDA (Commission Disbursement Authorization)" },
  { id: "b65", section: "SkySlope Docs",               day: "",       label: "Settlement / closing disclosure" },
  { id: "b66", section: "SkySlope Docs",               day: "",       label: "Final walkthrough confirmation" },
  { id: "b67", section: "SkySlope Docs",               day: "",       label: "Title commitment" },
  { id: "b68", section: "SkySlope Docs",               day: "",       label: "LSU(s) from lender" },
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
  { id: "l54", section: "COE — Close of Escrow",       day: "COE",    label: "Update THG Tracker (Workbook)" },
  { id: "l55", section: "COE — Close of Escrow",       day: "COE",    label: "Update FUB status → Closed" },
  { id: "l56", section: "COE — Close of Escrow",       day: "COE",    label: "Update MLS status → Sold" },
  { id: "l57", section: "COE — Close of Escrow",       day: "COE",    label: "Update Zillow status → Sold" },
  { id: "l58", section: "COE — Close of Escrow",       day: "COE",    label: "Commission disbursed — verify split matches workbook" },
  { id: "l59", section: "COE — Close of Escrow",       day: "COE",    label: "Keys & lockbox retrieved" },
  { id: "l60", section: "COE — Close of Escrow",       day: "COE",    label: "Deed recorded & proceeds wired to seller" },
  { id: "l61", section: "COE — Close of Escrow",       day: "COE",    label: "SkySlope file marked complete & archived" },
  // SkySlope Docs
  { id: "l62", section: "SkySlope Docs",               day: "",       label: "Listing Agreement" },
  { id: "l63", section: "SkySlope Docs",               day: "",       label: "Purchase Contract (fully executed)" },
  { id: "l64", section: "SkySlope Docs",               day: "",       label: "All addenda / amendments" },
  { id: "l65", section: "SkySlope Docs",               day: "",       label: "SPDS (Seller's Property Disclosure)" },
  { id: "l66", section: "SkySlope Docs",               day: "",       label: "Lead-based paint disclosure (if applicable)" },
  { id: "l67", section: "SkySlope Docs",               day: "",       label: "BINSR & seller response(s)" },
  { id: "l68", section: "SkySlope Docs",               day: "",       label: "HOA documents (if applicable)" },
  { id: "l69", section: "SkySlope Docs",               day: "",       label: "Appraisal report" },
  { id: "l70", section: "SkySlope Docs",               day: "",       label: "Buyer pre-approval letter" },
  { id: "l71", section: "SkySlope Docs",               day: "",       label: "Earnest money receipt" },
  { id: "l72", section: "SkySlope Docs",               day: "",       label: "Home warranty agreement" },
  { id: "l73", section: "SkySlope Docs",               day: "",       label: "CDA (Commission Disbursement Authorization)" },
  { id: "l74", section: "SkySlope Docs",               day: "",       label: "Settlement / closing disclosure" },
  { id: "l75", section: "SkySlope Docs",               day: "",       label: "Final walkthrough confirmation" },
  { id: "l76", section: "SkySlope Docs",               day: "",       label: "Title commitment" },
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

  const sections = {};
  for (const item of items) {
    if (!sections[item.section]) sections[item.section] = [];
    sections[item.section].push(item);
  }

  const sectionHTML = Object.entries(sections).map(([section, sItems]) => {
    const secDone = sItems.filter(i => checked[i.id]).length;
    const secPct = Math.round((secDone / sItems.length) * 100);
    const rows = sItems.map(item => {
      const itemNotes = notes[item.id] || {};
      const autoISO = calcDueDateISO(item.day, contractDate, closeDate);
      const dueVal = itemNotes.due || autoISO;
      const today = new Date().toISOString().slice(0, 10);
      const isChecked = !!checked[item.id];
      const overdue = dueVal && !isChecked && dueVal < today;
      const dueCls = overdue ? " overdue" : (dueVal ? " on-time" : "");
      return `
      <tr class="${isChecked ? 'done' : ''}" data-day="${item.day || ''}">
        <td class="cb-cell">
          <input type="checkbox" id="${item.id}" ${isChecked ? 'checked' : ''}
            onchange="toggle('${item.id}', this.checked)">
        </td>
        <td class="label-cell"><label for="${item.id}">${item.label}</label></td>
        <td class="day-cell">${dayBadge(item.day, color)}</td>
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
    return `
      <div class="section">
        <div class="section-header">
          <span class="section-title">${section}</span>
          <span class="section-progress">
            <span class="sec-bar"><span class="sec-fill" style="width:${secPct}%;background:${color}"></span></span>
            ${secDone}/${sItems.length}
          </span>
        </div>
        <table>
          <thead><tr>
            <th style="width:40px"></th>
            <th style="text-align:left;padding:6px 8px;font-size:11px;color:#888;font-weight:600">Item</th>
            <th style="width:80px;padding:6px 8px;font-size:11px;color:#888;font-weight:600">Day</th>
            <th style="width:130px;padding:6px 8px;font-size:11px;color:#888;font-weight:600">Due Date ✏️</th>
            <th style="width:180px;padding:6px 8px;font-size:11px;color:#888;font-weight:600">Note</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join('');

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
  .date-cell { padding:6px 4px; width:130px; }
  .date-input { width:100%; border:1px solid #e0e4f0; border-radius:5px; padding:4px 6px;
                font-size:12px; color:#555; outline:none; background:#fafbff; font-family:inherit; }
  .date-input:focus { border-color:${color}; background:white; }
  .note-cell { padding:6px 16px 6px 0; width:180px; }
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
  <div style="padding:12px 0 8px;font-size:11px;font-weight:700;text-transform:uppercase;color:#888;letter-spacing:.5px">Transaction Details</div>
  <div class="info-grid">
    ${[
      ["Contract Execution Date (Day 0)", "contractDate", "date", true],
      ["Close of Escrow Date (COE)", "closeDate", "date", true],
      ["Client Name", "clientName", "text", false],
      ["Agent Partner 1", "agentPartner1", "text", false],
      ["Agent Partner 2", "agentPartner2", "text", false],
      ["TC Name", "tcName", "text", false],
      ["Title Company", "titleCompany", "text", false],
      ["Lender", "lender", "text", false],
      ["Agent Partner Commission", "agentCommission", "text", false],
      ["Kumler Commission", "kumlerCommission", "text", false],
      ["Zillow Payment", "zillowPayment", "text", false],
      ["Home Warranty", "homeWarranty", "text", false],
      ["Escrow Number", "escrowNumber", "text", false],
    ].map(([label, key, type, hi]) => `
      <div class="info-field${hi ? ' highlight' : ''}">
        <div class="info-label">${label}</div>
        <input class="info-input" type="${type}" placeholder="—"
          value="${(fields[key] || '').replace(/"/g, '&quot;')}"
          onchange="saveField('${key}', this.value)">
      </div>`).join('')}
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
  const keys = ['contractDate','closeDate','clientName','agentPartner1','agentPartner2','tcName','titleCompany','lender','agentCommission','kumlerCommission','zillowPayment','homeWarranty','escrowNumber'];
  inp.setAttribute('data-key', keys[i] || '');
  if (keys[i] === 'contractDate' || keys[i] === 'closeDate') {
    inp.addEventListener('change', refreshDueDates);
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
  const rows = sorted.map(([id, t]) => {
    const items = t.type === "buyer" ? BUYER_ITEMS : LISTING_ITEMS;
    const done = items.filter(i => (t.checked || {})[i.id]).length;
    const pct = Math.round((done / items.length) * 100);
    const color = t.type === "buyer" ? "#1565c0" : "#2e7d32";
    const fields = t.fields || {};
    return `<tr onclick="window.location='/t/${id}'" style="cursor:pointer">
      <td><strong>${t.address || '(no address)'}</strong></td>
      <td><span style="background:${color};color:white;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;text-transform:uppercase">${t.type}</span></td>
      <td>${t.clientName || fields.clientName || '—'}</td>
      <td>${fields.agentPartner1 || '—'}</td>
      <td>${fields.contractDate || '—'}</td>
      <td>${fields.closeDate || '—'}</td>
      <td>${fields.lender || '—'}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;height:7px;background:#e0e4f0;border-radius:4px;min-width:80px">
            <div style="width:${pct}%;height:7px;background:${pct===100?'#2e7d32':color};border-radius:4px"></div>
          </div>
          <span style="font-size:12px;font-weight:600;color:#555;white-space:nowrap">${pct}%</span>
        </div>
      </td>
    </tr>`;
  }).join('');

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
  <div class="card">
    ${sorted.length === 0
      ? '<div class="empty">No transactions yet. Click <strong>+ New Transaction</strong> to get started.</div>'
      : `<table><thead><tr>
          <th>Address</th><th>Type</th><th>Client</th><th>Agent Partner</th>
          <th>Contract Date</th><th>Close Date</th><th>Lender</th><th>Progress</th>
         </tr></thead><tbody>${rows}</tbody></table>`}
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
      <input id="f-agent" placeholder="Agent name">
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
async function create() {
  const body = {
    type: document.getElementById('f-type').value,
    address: document.getElementById('f-address').value,
    clientName: document.getElementById('f-client').value,
    agentName: document.getElementById('f-agent').value,
    fields: {
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
      data.transactions[id] = { id, ...parsed, checked: {}, notes: {}, fields: parsed.fields || {}, createdAt: Date.now() };
      saveData(data);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data.transactions[id]));
    });
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
