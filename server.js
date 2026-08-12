import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

// All writes go through one queue: each mutation re-reads the latest blob,
// applies its change, and saves before the next write starts. Without this,
// two people clicking at the same moment each load the blob and whoever saves
// last silently erases the other's change (lost notes/checkmarks).
let writeChain = Promise.resolve();
function withData(mutate) {
  const run = writeChain.then(async () => {
    const data = await loadData();
    const result = await mutate(data);
    await saveData(data);
    return result;
  });
  writeChain = run.catch(() => {});
  return run;
}

// ─── CHECKLIST ITEMS ────────────────────────────────────────────────────────
// day: "Day N" = N days after contract execution date
//      "COE N" = N days relative to close of escrow (negative = before COE)
//      "COE"   = day of close of escrow

const fmtMoneySrv = v => { const n = parseFloat(String(v || "").replace(/[^0-9.]/g, "")); return isNaN(n) ? "" : "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 }); };

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
  { id: "b70",  day: "Day 1",   label: "Change FUB status to Inspection Contingency", indent: true },
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
  { id: "b64",  day: "Day 15",  label: "Follow up with agent regarding BINSR #3", hasDue: true },
  { id: "b71",  day: "Day 15",  label: "Change FUB status to Appraisal Contingency", indent: true },
  // Day 17
  { id: "b25b", day: "Day 17",  label: "Request LSU #2", hasDue: true },
  { id: "b65",  day: "Day 17",  label: "BINSR #3 due (5 days after BINSR #2)", hasDue: true },
  // Day 19
  { id: "b18c", day: "Day 19",  label: "Update client" },
  // Day 22
  { id: "b34",  day: "Day 22",  label: "Appraisal received — confirm value", hasDue: true },
  { id: "b72",  day: "Day 22",  label: "Change FUB status to Loan Contingency", indent: true },
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
  { id: "b70",  day: "Day 1",   label: "Change FUB status to Inspection Contingency", indent: true },
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
  { id: "l2",  section: "Day 0 — Listing Setup",       day: "Day 0",  label: "Review Formstack" },
  { id: "l3",  section: "Day 0 — Listing Setup",       day: "Day 0",  label: "Create Deal in FUB" },
  { id: "l3a", section: "Day 0 — Listing Setup",       day: "Day 0",  label: "Accurate stage", indent: true },
  { id: "l3b", section: "Day 0 — Listing Setup",       day: "Day 0",  label: "Accurate source", indent: true },
  { id: "l4",  section: "Day 0 — Listing Setup",       day: "Day 0",  label: "Update Kumler Group Workbook" },
  { id: "l7",  section: "Day 0 — Listing Setup",       day: "Day 0",  label: "SPDS completed by seller — on file" },
  { id: "l7b", section: "Day 0 — Listing Setup",       day: "Day 0",  label: "CLUE report received" },
  { id: "l8",  section: "Day 0 — Listing Setup",       day: "Day 0",  label: "Lead-based paint disclosure (pre-1978 homes)" },
  { id: "l9",  section: "Day 0 — Listing Setup",       day: "Day 0",  label: "HOA addendum completed (if applicable)" },
  { id: "l10", section: "Day 0 — Listing Setup",       day: "Day 0",  label: "Professional photos scheduled" },
  { id: "l60", section: "Day 0 — Listing Setup",       day: "Day 0",  label: "Input MLS listing" },
  { id: "l60a", section: "Day 0 — Listing Setup",      day: "Day 0",  label: "All information correct", indent: true },
  { id: "l60b", section: "Day 0 — Listing Setup",      day: "Day 0",  label: "Photos uploaded", indent: true },
  { id: "l61",  section: "Day 0 — Listing Setup",      day: "Day 0",  label: "Create SkySlope file with all required documents" },
  { id: "l61a", section: "Day 0 — Listing Setup",      day: "Day 0",  label: "MLS listing", indent: true },
  { id: "l61b", section: "Day 0 — Listing Setup",      day: "Day 0",  label: "Tax record printout", indent: true },
  { id: "l12", section: "Day 0 — Listing Setup",       day: "Day 0",  label: "Send intro email to all parties" },
  // Day 1
  { id: "l13", section: "Day 1",                       day: "Day 1",  label: "Photos received & approved" },
  { id: "l14", section: "Day 1",                       day: "Day 1",  label: "MLS listing entered & active" },
  { id: "l15", section: "Day 1",                       day: "Day 1",  label: "Update Zillow status → Active" },
  { id: "l16", section: "Day 1",                       day: "Day 1",  label: "Update FUB status → Listed" },
  { id: "l17", section: "Day 1",                       day: "Day 1",  label: "Lockbox installed" },
  { id: "l18", section: "Day 1",                       day: "Day 1",  label: "Yard sign installed" },
  { id: "l19", section: "Day 1",                       day: "Day 1",  label: "Notify agent of any missing docs" },
  // Under Contract
  { id: "l20",  section: "Under Contract",             day: "",       label: "Offer received & presented to seller" },
  { id: "l20b", section: "Under Contract",             day: "Day 0",  label: "Review Formstack" },
  { id: "l21",  section: "Under Contract",             day: "Day 0",  label: "Purchase contract fully executed" },
  { id: "l22",  section: "Under Contract",             day: "Day 0",  label: "Update FUB status → Under Contract" },
  { id: "l23",  section: "Under Contract",             day: "Day 0",  label: "Update MLS status → Pending" },
  { id: "l24",  section: "Under Contract",             day: "Day 0",  label: "Update Zillow status → Pending" },
  { id: "l25",  section: "Under Contract",             day: "Day 0",  label: "Update Workbook" },
  { id: "l25a", section: "Under Contract",             day: "Day 0",  label: "Add title", indent: true },
  { id: "l25b", section: "Under Contract",             day: "Day 0",  label: "Add lender", indent: true },
  { id: "l25c", section: "Under Contract",             day: "Day 0",  label: "Add price", indent: true },
  { id: "l26",  section: "Under Contract",             day: "Day 0",  label: "Pre-approval on file" },
  { id: "l27",  section: "Under Contract",             day: "Day 0",  label: "Escrow opened" },
  { id: "l29",  section: "Under Contract",             day: "Day 0",  label: "Send intro email to all parties" },
  { id: "lu1",  section: "Under Contract",             day: "Day 0",  label: "TC", indent: true },
  { id: "lu2",  section: "Under Contract",             day: "Day 0",  label: "Title", indent: true },
  { id: "lu3",  section: "Under Contract",             day: "Day 0",  label: "Lender", indent: true },
  { id: "lu4",  section: "Under Contract",             day: "Day 0",  label: "Agents", indent: true },
  { id: "l30",  section: "Under Contract",             day: "Day 0",  label: "Create Zillow Payment Form (if applicable)" },
  // Day 1 (after contract)
  { id: "l33", section: "Day 1 (After Contract)",      day: "Day 1",  label: "Buyer inspection scheduled — confirm with agent" },
  { id: "lu5", section: "Day 1 (After Contract)",      day: "Day 1",  label: "Change FUB status to Inspection Contingency", indent: true },
  { id: "l28", section: "Day 1 (After Contract)",      day: "Day 1",  label: "Earnest money confirmed received by title" },
  { id: "l31", section: "Day 1 (After Contract)",      day: "Day 1",  label: "Create SkySlope transaction" },
  { id: "l32", section: "Day 1 (After Contract)",      day: "Day 1",  label: "Notify agent of any missing docs" },
  // Day 3
  { id: "lu6", section: "Day 3",                       day: "Day 3",  label: "SPDS sent to buyer's agent" },
  // Day 5
  { id: "lu7", section: "Day 5",                       day: "Day 5",  label: "CLUE sent to buyer's agent" },
  { id: "lu8", section: "Day 5",                       day: "Day 5",  label: "Update seller" },
  { id: "lu9", section: "Day 5",                       day: "Day 5",  label: "Send seller ABD" },
  // Day 10
  { id: "l37", section: "Day 10",                      day: "Day 10", label: "Inspection period complete" },
  { id: "l36", section: "Day 10",                      day: "Day 10", label: "BINSR #1 Due", hasDue: true },
  { id: "lu11", section: "Day 10",                     day: "Day 10", label: "Request LSU #1" },
  { id: "l38", section: "Day 10",                      day: "Day 10", label: "Request title commitment from title company" },
  // Day 12
  { id: "l35", section: "Day 12",                      day: "Day 12", label: "Follow up with agent regarding BINSR response" },
  { id: "lu13", section: "Day 12",                     day: "Day 12", label: "Update seller" },
  // Day 13
  { id: "lu10", section: "Day 13",                     day: "Day 13", label: "Second BINSR follow up if needed" },
  // Day 15
  { id: "l39", section: "Day 15",                      day: "Day 15", label: "Appraisal appointment confirmed" },
  { id: "l40b", section: "Day 15",                     day: "Day 15", label: "Seller response to BINSR due", hasDue: true },
  // Day 17
  { id: "lu16", section: "Day 17",                     day: "Day 17", label: "Request LSU #2" },
  { id: "lu17", section: "Day 17",                     day: "Day 17", label: "BINSR #3 due (5 days after BINSR #2)", hasDue: true },
  { id: "lu15", section: "Day 17",                     day: "Day 17", label: "Change FUB status to Appraisal Contingency", indent: true },
  // Day 19
  { id: "lu18", section: "Day 19",                     day: "Day 19", label: "Update seller" },
  // Day 22
  { id: "l41", section: "Day 22",                      day: "Day 22", label: "Appraisal received — confirm value", hasDue: true },
  { id: "lu19", section: "Day 22",                     day: "Day 22", label: "Change FUB status to Loan Contingency", indent: true },
  // Day 24
  { id: "lu20", section: "Day 24",                     day: "Day 24", label: "Request LSU #3" },
  // Day 26
  { id: "lu21", section: "Day 26",                     day: "Day 26", label: "Update seller" },
  // COE -7
  { id: "lu23", section: "COE -7 Days",                day: "COE -7", label: "Seller scheduled to sign" },
  // COE -6
  { id: "lu24", section: "COE -6 Days",                day: "COE -6", label: "Make sure SkySlope is complete" },
  // COE -3
  { id: "l50", section: "COE -3 Days",                 day: "COE -3", label: "Confirm all repairs are complete" },
  { id: "l46", section: "COE -3 Days",                 day: "COE -3", label: "CDA sent to title" },
  { id: "l51", section: "COE -3 Days",                 day: "COE -3", label: "Docs to title / Clear to close" },
  { id: "lu22", section: "COE -3 Days",                day: "COE -3", label: "Est. Settlement statement" },
  // COE -1
  { id: "l49", section: "COE -1 Day",                  day: "COE -1", label: "Ask for walk through" },
  // COE — Close of Escrow
  { id: "l53",  section: "COE — Close of Escrow",      day: "COE",    label: "Recording confirmed" },
  { id: "l53a", section: "COE — Close of Escrow",      day: "COE",    label: "Final SS / copy of check" },
  { id: "l53b", section: "COE — Close of Escrow",      day: "COE",    label: "Check SkySlope — final docs" },
  { id: "l54",  section: "COE — Close of Escrow",      day: "COE",    label: "Update Workbook" },
  { id: "l54a", section: "COE — Close of Escrow",      day: "COE",    label: "Reconfirm title company", indent: true },
  { id: "l54b", section: "COE — Close of Escrow",      day: "COE",    label: "Reconfirm lender", indent: true },
  { id: "l54c", section: "COE — Close of Escrow",      day: "COE",    label: "Reconfirm home warranty", indent: true },
  { id: "l54d", section: "COE — Close of Escrow",      day: "COE",    label: "Reconfirm sales price", indent: true },
  { id: "l55",  section: "COE — Close of Escrow",      day: "COE",    label: "Update FUB status" },
  { id: "l55a", section: "COE — Close of Escrow",      day: "COE",    label: "Change status to closed", indent: true },
  { id: "l55b", section: "COE — Close of Escrow",      day: "COE",    label: "Reconfirm sales price", indent: true },
  { id: "l55c", section: "COE — Close of Escrow",      day: "COE",    label: "Reconfirm closing date", indent: true },
  { id: "l56",  section: "COE — Close of Escrow",      day: "COE",    label: "Update MLS status → Sold" },
  { id: "l57",  section: "COE — Close of Escrow",      day: "COE",    label: "Update Zillow status → Sold" },
  { id: "lu25", section: "COE — Close of Escrow",      day: "COE",    label: "Schedule sign/lockbox pick up" },
  { id: "l58",  section: "COE — Close of Escrow",      day: "COE",    label: "Move file to close" },
  { id: "l59",  section: "COE — Close of Escrow",      day: "COE",    label: "Commission settled" },
];

// ─── HTML ────────────────────────────────────────────────────────────────────

// Listing Escrow (listing-uc) files are escrow intakes: they carry only the
// Under Contract phases, never the pre-UC listing-input tasks.
const UC_START = LISTING_ITEMS.findIndex(i => i.section === "Under Contract");
const LISTING_UC_ITEMS = LISTING_ITEMS.slice(UC_START);
const txnItems = t => t.type === "buyer" ? BUYER_ITEMS
  : t.type === "buyer-new-build" ? BUYER_NEW_BUILD_ITEMS
  : t.type === "listing-uc" ? LISTING_UC_ITEMS
  // A listing that has gone Under Contract carries just the escrow phases,
  // exactly like a Listing Escrow intake (pre-UC checkmarks stay in the data)
  : (t.type === "listing" && t.fields?.ucDate) ? LISTING_UC_ITEMS : LISTING_ITEMS;

// Contract acceptance and COE can never fall on a weekend — returns the
// offending day name, or null if the date is fine/absent.
function weekendDayNameSrv(iso) {
  if (!iso) return null;
  const d = new Date(iso + "T12:00:00").getDay();
  return d === 0 ? "Sunday" : d === 6 ? "Saturday" : null;
}

function calcDueDateISO(dayLabel, contractDate, closeDate) {
  if (!dayLabel) return "";
  if (dayLabel.startsWith("Day")) {
    const n = parseInt(dayLabel.split(" ")[1]);
    if (!contractDate) return "";
    const d = new Date(contractDate + "T12:00:00");
    if (isNaN(d.getTime())) return "";   // malformed stored date must never crash a render
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }
  if (dayLabel.startsWith("COE")) {
    if (!closeDate) return "";
    const offset = dayLabel === "COE" ? 0 : parseInt(dayLabel.split(" ")[1]);
    const d = new Date(closeDate + "T12:00:00");
    if (isNaN(d.getTime())) return "";
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

function getHTML(transaction, id, tc, related = []) {
  const items = txnItems(transaction);
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
  const color = isBuyer ? "#9333ea" : transaction.type === "listing-uc" ? "#b45309" : "#2e7d32";
  // Task ownership: Listing Coordinators own the pre–Under Contract listing checklist;
  // TCs own buyers + listings once Under Contract; admin sees everything.
  const assignedTC = fields.tcName || '';
  const isPreUCListing = isListing && !fields.ucDate;
  let tasksHidden;
  if (!tc || tc === 'admin' || ADMIN_TCS.includes(tc)) {
    tasksHidden = false;
  } else if (LISTING_COORDS.includes(tc)) {
    tasksHidden = !isPreUCListing;                                    // listing coordinator: only pre-UC listings
  } else {
    tasksHidden = isPreUCListing || (assignedTC && assignedTC !== tc); // TC: everything except the listing-input phase
  }

  // Group items by day label
  const today = todayAZ();
  const groups = [];
  let lastDay = null;
  let ucPhaseFlag = false;
  for (const item of items) {
    if (item.section === "Under Contract") ucPhaseFlag = true;
    const dayKey = item.day || item.section || '';
    if (dayKey !== lastDay) { groups.push({ day: dayKey, items: [], ucPhase: ucPhaseFlag }); lastDay = dayKey; }
    groups[groups.length - 1].items.push(item);
  }

  const ucDate = fields.ucDate || "";
  const isUnderContract = !isListing || !!ucDate;

  let lockBannerShown = false;
  const renderGroup = (g, extraRows) => {
    const locked = isListing && g.ucPhase && !isUnderContract;
    // Listing due dates: pre-UC sections key off the agreement date, UC sections off the Under Contract date
    const groupBase = isListing ? (g.ucPhase ? ucDate : contractDate) : contractDate;
    const autoDateForGroup = calcDueDateISO(g.day, groupBase, closeDate);
    let dateDisplay = '';
    if (autoDateForGroup) {
      const [y,m,d] = autoDateForGroup.split('-');
      dateDisplay = ` — <span style="font-size:12px;font-weight:600;color:#4a1160">${m}/${d}/${y}</span>`;
    }
    const isCOE = g.day && g.day.startsWith('COE');
    const headerBg = isCOE ? '#7e22ce' : '#0f4c9e';
    const rows = g.items.map(item => {
      const itemNotes = notes[item.id] || {};
      const autoISO = calcDueDateISO(item.day, groupBase, closeDate);
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
        <td class="label-cell" style="${item.indent ? 'color:#64748b;font-size:11.5px' : ''}"><label for="${item.id}"${(() => {
          // oversight logins can hover a checked item to see when it was ticked
          const canSeeDates = !tc || tc === 'admin' || ADMIN_TCS.includes(tc);
          const ts = isChecked && canSeeDates && (transaction.checkedAt || {})[item.id];
          return ts ? ` title="Checked off ${new Date(ts).toLocaleString('en-US', { timeZone: 'America/Phoenix', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}"` : '';
        })()}>${item.indent ? '↳ ' : ''}${item.label}</label></td>
        <td class="date-cell">${item.hasDue ? `
          <input type="date" class="date-input due${dueCls}" data-item="${item.id}" data-auto="${autoISO}"
            value="${dueVal.replace(/"/g, '&quot;')}"
            onchange="saveDue('${item.id}', this.value)">` : `<span style="color:#ccc">—</span>`}
        </td>
        <td class="note-cell">
          <input type="text" class="note-input" placeholder="note…"
            value="${(itemNotes.note || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"
            oninput="debounceNote('${item.id}', this)"
            onblur="saveItemField('${item.id}', 'note', this.value)">
        </td>
      </tr>`;
    }).join('');
    const lockedBanner = locked && !lockBannerShown ? (lockBannerShown = true, `<tr style="background:#fef9c3"><td colspan="4" style="padding:6px 12px;font-size:11px;color:#92400e;font-weight:600">🔒 Enter Under Contract Date above to unlock the sections below</td></tr>`) : '';
    const tbodyId = 'day-' + g.day.replace(/[^a-z0-9]/gi, '-');
    const header = g.day ? `<tr class="day-header" id="hdr-${tbodyId}" style="background:#f8fafc;${locked?'opacity:0.4':''}cursor:pointer;" onclick="toggleDay('${tbodyId}',this)"><td colspan="4" style="padding:5px 10px;font-size:11px;font-weight:600;letter-spacing:.5px;border-bottom:1px solid #e2e8f0"><span class="day-badge" style="background:${headerBg};color:white;padding:2px 9px;border-radius:10px;font-size:11px">${g.day}</span>${dateDisplay} <span class="collapse-arrow" style="float:right;font-size:10px;color:#94a3b8">▲</span></td></tr>` : '';
    const rowsOut = locked ? rows.replace(/<input type="checkbox"/g, '<input type="checkbox" disabled').replace(/<input type="date"/g, '<input type="date" disabled').replace(/<input type="text"/g, '<input type="text" disabled') : rows;
    return lockedBanner + header + `<tbody id="${tbodyId}" style="${locked?'opacity:0.4;pointer-events:none':''}">${rowsOut}${extraRows || ''}</tbody>`;
  };

  // Dated contingencies become normal checklist rows placed on their due date.
  const contsSorted = (transaction.contingencies || []).filter(c => c && c.due).slice()
    .sort((a, b) => a.due < b.due ? -1 : a.due > b.due ? 1 : 0);
  const contRow = (c) => {
    const overdue = c.due && !c.done && c.due < today;
    return `<tr class="${c.done ? 'done' : ''}${overdue ? ' row-overdue' : ''}">
      <td class="cb-cell"><input type="checkbox" ${c.done ? 'checked' : ''} onchange="toggleContingencyDone('${c.id}')"></td>
      <td class="label-cell"><label>${String(c.name || 'Contingency').replace(/</g, '&lt;')} <span style="font-size:10px;color:#ea580c;font-weight:600;background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:0 5px">contingency</span></label></td>
      <td class="date-cell"><input type="date" class="date-input due${overdue ? ' overdue' : ''}" value="${(c.due || '').replace(/"/g, '&quot;')}" onchange="setContingencyDueById('${c.id}', this.value)"></td>
      <td class="note-cell"><button onclick="deleteContingencyById('${c.id}')" style="background:none;border:none;color:#cbd5e1;font-size:12px;cursor:pointer" title="Remove contingency">✕ remove</button></td>
    </tr>`;
  };
  const groupInfos = groups.map(g => {
    const gBase = isListing ? (g.ucPhase ? ucDate : contractDate) : contractDate;
    return { g, gDate: calcDueDateISO(g.day, gBase, closeDate) };
  });
  const groupDates = new Set(groupInfos.map(gi => gi.gDate).filter(Boolean));
  const placed = new Set();
  const standaloneCont = (c) => {
    const p = (c.due || '').split('-'); const dd = c.due ? (p[1] + '/' + p[2] + '/' + p[0]) : '';
    return `<tr class="day-header" style="background:#fff7ed;cursor:default"><td colspan="4" style="padding:8px 12px;font-size:12px;font-weight:600;border-bottom:1px solid #fed7aa"><span class="day-badge" style="background:#ea580c;color:white;padding:2px 9px;border-radius:10px;font-size:11px">🔶 CONTINGENCY</span> — <span style="font-size:12px;font-weight:600;color:#9a3412">${dd}</span></td></tr><tbody>${contRow(c)}</tbody>`;
  };
  let ci = 0;
  const partsArr = [];
  for (const info of groupInfos) {
    const gDate = info.gDate;
    if (gDate) {
      while (ci < contsSorted.length && contsSorted[ci].due < gDate) {
        const c = contsSorted[ci];
        if (!groupDates.has(c.due) && !placed.has(c.id)) { partsArr.push(standaloneCont(c)); placed.add(c.id); }
        ci++;
      }
    }
    // Attach contingencies whose due date matches this group's date as normal rows in the group.
    const matched = gDate ? contsSorted.filter(c => c.due === gDate && !placed.has(c.id)) : [];
    matched.forEach(c => placed.add(c.id));
    partsArr.push(renderGroup(info.g, matched.map(contRow).join('')));
  }
  contsSorted.forEach(c => { if (!placed.has(c.id)) { partsArr.push(standaloneCont(c)); placed.add(c.id); } });
  const flatRows = partsArr.join('');

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
<title>${transaction.address || 'Transaction'} — Transaction Hub</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 100 100%27>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet"><circle cx=%2750%27 cy=%2750%27 r=%2748%27 fill=%27%23CB2CFB%27/><path d=%27M28 52 50 34 72 52%27 stroke=%27white%27 stroke-width=%278%27 fill=%27none%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/><path d=%27M34 50 V74 H66 V50%27 stroke=%27white%27 stroke-width=%278%27 fill=%27none%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/></svg>">
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Inter',-apple-system,Helvetica,sans-serif; background:#f5f6fa; color:#1a1a2e; }
  .header { background:linear-gradient(120deg,#3d0d52,#66187E 55%,#a21caf 135%); color:white; padding:16px 32px; display:flex; align-items:center; gap:16px; }
  .header a { color:#cba8e0; font-size:13px; text-decoration:none; margin-right:8px; }
  .header a:hover { color:white; }
  .header h1 { font-size:18px; font-weight:600; flex:1; }
  .badge { display:inline-block; padding:3px 10px; border-radius:12px; font-size:11px;
           font-weight:600; background:${color}; color:white; text-transform:uppercase; }
  .progress-bar { height:5px; background:#d0d7e8; }
  .progress-fill { height:5px; background:${color}; transition:width .3s; width:${pct}%; }
  .progress-label { background:white; padding:8px 32px; font-size:13px; color:#555;
                    border-bottom:1px solid #e0e4f0; }

  .info-card { background:white; margin:20px auto; max-width:1100px; padding:0 16px; }
  .info-grid { background:white; border-radius:10px; box-shadow:0 1px 4px rgba(0,0,0,.07);
               display:grid; grid-template-columns:repeat(auto-fill,minmax(205px,1fr)); gap:0;
               overflow:hidden; border:1px solid #e0e4f0; }
  .info-field { padding:4px 10px; border-right:1px solid #e0e4f0; border-bottom:1px solid #e0e4f0; }
  .info-field.highlight { background:#faf0ff; }
  .info-label { font-size:9.5px; font-weight:600; text-transform:uppercase; color:#8a7d95; letter-spacing:.06em; margin-bottom:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .info-input { width:100%; border:none; font-size:13px; font-weight:500; color:#1c1524; background:transparent;
                outline:none; font-family:inherit; }
  .info-input:focus { color:#9333ea; border-color:#CB2CFB; box-shadow:0 0 0 3px rgba(203,44,251,.14); border-radius:6px; }
  .stx { background:white; color:#4a4453; border:1.5px solid #e4dcea; padding:6px 15px; border-radius:99px; font-size:12px; font-weight:500; cursor:pointer; font-family:inherit; transition:all .12s; }
  .stx:hover { border-color:#66187E; color:#66187E; transform:translateY(-1px); box-shadow:0 4px 12px rgba(102,24,126,.12); }
  .stx-green:hover { border-color:#15803d; color:#15803d; box-shadow:0 4px 12px rgba(21,128,61,.14); }
  .stx-red:hover { border-color:#dc2626; color:#dc2626; box-shadow:0 4px 12px rgba(220,38,38,.13); }

  .container { max-width:1100px; margin:16px auto; padding:0 16px; }
  .section { background:white; border-radius:10px; margin-bottom:14px;
             box-shadow:0 1px 4px rgba(0,0,0,.07); overflow:hidden; }
  .section-header { display:flex; justify-content:space-between; align-items:center;
                    padding:10px 16px; background:#faf0ff; border-bottom:1px solid #e0e4f0; }
  .section-title { font-weight:600; font-size:13px; color:#4a1160; text-transform:uppercase; letter-spacing:.5px; }
  .section-progress { display:flex; align-items:center; gap:8px; font-size:12px; color:#666; font-weight:600; }
  .sec-bar { width:80px; height:6px; background:#e0e4f0; border-radius:3px; display:inline-block; }
  .sec-fill { height:6px; border-radius:3px; display:block; transition:width .3s; }
  table { width:100%; border-collapse:collapse; }
  tr { border-bottom:1px solid #f0f2f8; transition:background .1s; }
  tr:last-child { border-bottom:none; }
  tr.done .label-cell label { color:#bbb; text-decoration:line-through; }
  tr:hover { background:#fdf6ff; }
  .cb-cell { width:34px; padding:4px 4px 4px 14px; }
  .cb-cell input[type=checkbox] { width:14px; height:14px; cursor:pointer; accent-color:${color}; }
  .label-cell { padding:2px 8px; font-size:11.5px; }
  .label-cell label { cursor:pointer; }
  .day-cell { padding:6px 4px; width:80px; }
  .day-badge { display:inline-block; padding:2px 7px; border-radius:10px; font-size:10px;
               font-weight:600; color:white; white-space:nowrap; }
  .date-input.due { border-color:#d1fae5; color:#15803d; font-weight:600; background:#f0fdf4; }
  .date-input.due.overdue { border-color:#fecaca; color:#dc2626; background:#fff5f5; }
  tr.row-overdue { background:#fff5f5; }
  tr.row-overdue .label-cell label { color:#dc2626; }
  .date-input.due:focus { border-color:#16a34a; }
  .date-input.due.overdue:focus { border-color:#dc2626; }
  .date-cell { padding:6px 4px; width:150px; }
  .date-input { width:100%; border:1px solid #e0e4f0; border-radius:5px; padding:2px 5px;
                font-size:12px; color:#555; outline:none; background:#fafbff; font-family:inherit; }
  .date-input:focus { border-color:${color}; background:white; }
  .note-cell { padding:6px 16px 6px 0; width:300px; }
  .note-input { width:100%; border:1px solid #e0e4f0; border-radius:5px; padding:2px 7px;
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
  .detail-sidebar-hdr { background:#4a1160; color:white; padding:11px 14px; font-size:12px; font-weight:500; text-transform:uppercase; letter-spacing:.5px; }
  .task-due-group { border-bottom:1px solid #f0f2f8; padding:10px 14px; }
  .task-due-group:last-child { border-bottom:none; }
  .task-due-label { font-size:11px; font-weight:600; color:#4a1160; margin-bottom:6px; text-transform:uppercase; }
  .task-due-item { display:flex; align-items:flex-start; gap:6px; padding:2px 0; font-size:11.5px; color:#333; }
  .task-due-item input { margin-top:2px; flex-shrink:0; }
  .task-due-item label.overdue { color:#dc2626; }
  .task-due-empty { padding:18px 14px; font-size:12px; color:#94a3b8; text-align:center; }
</style></head>
<body>
<div class="header">
  <div style="flex:1">
    <div><a href="/?tc=${tc}">← All Transactions</a></div>
    <h1>${transaction.address || 'No address'} <span class="badge">${transaction.type === 'buyer' ? 'Buyer - Resale' : transaction.type === 'buyer-new-build' ? 'Buyer - New Build' : transaction.type}</span></h1>
  </div>
  <div style="text-align:right;font-size:13px;color:#cba8e0">${done}/${total} complete</div>
</div>
<div class="progress-bar"><div class="progress-fill" id="pbar"></div></div>
<div class="progress-label" id="plabel"><strong>${done} of ${total}</strong> items complete &nbsp;·&nbsp; <strong>${pct}%</strong></div>
${(!isListing && !contractDate) ? `<div style="margin:12px 32px 0;background:#fff7ed;border:1px solid #fed7aa;border-left:4px solid #f97316;border-radius:8px;padding:10px 14px;font-size:13px;color:#9a3412;font-weight:600">⚠️ Please update this — the Under Contract date is missing. Add it in Transaction Details below.</div>` : ''}

<div class="info-card">
  <div style="padding:12px 0 8px;display:flex;align-items:center;justify-content:space-between">
    <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:#66187E;letter-spacing:.12em">Transaction Details</div>
    <div style="display:flex;gap:8px;align-items:center">
      ${transaction.status === 'pending' ? `<span style="background:#fef3c7;color:#b45309;padding:4px 12px;border-radius:6px;font-size:12px;font-weight:600">⚠️ Pending — Needs Setup</span>` : ''}
      ${transaction.status === 'closed' ? `<span style="display:inline-flex;align-items:center;gap:6px;color:#15803d;font-size:12px;font-weight:600;padding:6px 12px;background:#f2faf4;border-radius:99px"><span style="width:7px;height:7px;border-radius:50%;background:#15803d"></span>Closed</span>` : ''}
      ${transaction.status === 'cancelled' ? `<span style="display:inline-flex;align-items:center;gap:6px;color:#dc2626;font-size:12px;font-weight:600;padding:6px 12px;background:#fdf4f4;border-radius:99px"><span style="width:7px;height:7px;border-radius:50%;background:#dc2626"></span>Cancelled</span>` : ''}
      ${transaction.status === 'pending' ? `<button class="stx" onclick="setTxnStatus('active')" style="background:#66187E;color:white;border:1.5px solid #66187E">Activate Transaction</button>` : ''}
      ${transaction.status !== 'closed' && transaction.status !== 'pending' ? `<button class="stx stx-green" onclick="setTxnStatus('closed')">Mark Closed</button>` : ''}
      ${transaction.status !== 'cancelled' && transaction.status !== 'pending' ? `<button class="stx stx-red" onclick="setTxnStatus('cancelled')">Mark Cancelled</button>` : ''}
      ${transaction.status && transaction.status !== 'active' && transaction.status !== 'pending' ? `<button class="stx" onclick="setTxnStatus('active')">Reopen</button>` : ''}
      <button class="stx stx-red" onclick="adminDeleteTxn()" title="Delete this entire file">Delete</button>
    </div>
  </div>
  <div class="info-grid">
    ${(() => { const preUC = isListing && !fields.ucDate; return (isListing ? [
      ["Property Address", "address", "text", false],
      ["Client Name", "clientName", "text", false],
      ["Under Contract Date", "ucDate", "date", !preUC],
      ["Close of Escrow (COE)", "closeDate", "date", !preUC],
      ["BINSR Due (Day 10)", "__binsr", "date", false],
    ] : transaction.type === "buyer-new-build" ? [
      ["Property Address", "address", "text", false],
      ["Client Name", "clientName", "text", false],
      ["Contract Date — Day 0", "contractDate", "date", true],
      ["Close of Escrow Date (COE)", "closeDate", "date", true],
    ] : [
      ["Property Address", "address", "text", false],
      ["Client Name", "clientName", "text", false],
      ["Contract Date — Day 0", "contractDate", "date", true],
      ["Close of Escrow Date (COE)", "closeDate", "date", true],
      ["BINSR Due (Day 10)", "__binsr", "date", false],
    ]); })().map(([label, key, type, hi]) => key === '__binsr' ? `
      <div class="info-field">
        <div class="info-label">${label}</div>
        <input id="binsrDue" class="info-input" type="date" placeholder="—"
        value="${(() => { if (isListing && !fields.ucDate) return ''; if (fields.binsrDue) return fields.binsrDue; const base = isListing ? fields.ucDate : fields.contractDate; if (!base) return ''; const d = new Date(base + 'T12:00:00'); if (isNaN(d.getTime())) return ''; d.setDate(d.getDate() + 10); return d.toISOString().slice(0,10); })()}"
        onchange="saveField('binsrDue', this.value)">
      </div>` : `
      <div class="info-field${hi ? ' highlight' : ''}"${key === 'address' ? ' style="grid-column:span 2"' : ''}>
        <div class="info-label">${label}</div>
        ${key === 'address'
          ? `<textarea class="info-input" rows="1" placeholder="—" data-key="address"
              style="resize:none;overflow:hidden;line-height:1.35"
              oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'"
              onchange="saveField('address', this.value, this)">${(fields.address || transaction.address || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</textarea>`
          : `<input class="info-input" type="${type}" placeholder="—" data-key="${key}"
              value="${(key === 'salesPrice' ? fmtMoneySrv(fields[key]) : (fields[key] || '')).replace(/"/g, '&quot;')}"
              onchange="saveField('${key}', ${key === 'salesPrice' ? 'fmtMoney(this)' : 'this.value'}, this)">`}
      </div>`).join('')}
    <div class="info-field">
      <div class="info-label">Transaction Type</div>
      <select class="info-input" data-orig="${transaction.type || 'buyer'}" onchange="changeTxnType(this)">
        ${[['buyer','Buyer — Resale'],['buyer-new-build','Buyer — New Build'],['listing','Listing'],['listing-uc','Listing Escrow']].map(([v,l]) => `<option value="${v}"${(transaction.type||'buyer')===v?' selected':''}>${l}</option>`).join('')}
      </select>
    </div>
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
    ${isListing ? `<div class="info-field">
      <div class="info-label">LC Name</div>
      <select class="info-input" onchange="saveField('lcName', this.value)">
        <option value="">—</option>
        <option value="Cinnamon Kumler"${(fields.lcName||'')==='Cinnamon Kumler'?' selected':''}>Cinnamon Kumler</option>
      </select>
    </div>` : ''}
    <div class="info-field">
      <div class="info-label">TC Name${isListing && !fields.ucDate ? ' <span style="font-weight:400;text-transform:none;color:#b45309">(assigned when it goes under contract)</span>' : ''}</div>
      <select class="info-input" onchange="saveField('tcName', this.value)">
        <option value="">—</option>
        <option value="Joana Guzman"${(fields.tcName||'')==='Joana Guzman'?' selected':''}>Joana Guzman</option>
        <option value="Ashley Belliveau"${(fields.tcName||'')==='Ashley Belliveau'?' selected':''}>Ashley Belliveau</option>
        <option value="Cinnamon Kumler"${(fields.tcName||'')==='Cinnamon Kumler'?' selected':''}>Cinnamon Kumler</option>
      </select>
    </div>
    ${isListing ? (() => { const preUC = !fields.ucDate; return [
      ["Employment Agreement Date", "contractDate", "date", preUC],
      ["Listing Start Date", "listingStartDate", "date", preUC],
      ["Listing Expiration Date", "listingExpDate", "date", preUC],
      ["Sales Price", "salesPrice", "text", false],
      ["Commission Amount", "commissionAmount", "text", false],
    ].map(([label, key, type, hi]) => `
      <div class="info-field${hi ? ' highlight' : ''}">
        <div class="info-label">${label}</div>
        <input class="info-input" type="${type}" placeholder="—" data-key="${key}"
              value="${(key === 'salesPrice' ? fmtMoneySrv(fields[key]) : (fields[key] || '')).replace(/"/g, '&quot;')}"
              onchange="saveField('${key}', ${key === 'salesPrice' ? 'fmtMoney(this)' : 'this.value'}, this)">
      </div>`).join(''); })() : ''}
    ${(related || []).map(r => `<div class="info-field" style="background:#fef3c7">
      <div class="info-label">${r.label}</div>
      <a href="/t/${r.id}?tc=${encodeURIComponent(tc)}" style="font-size:14px;color:#4a1160;font-weight:600;text-decoration:none">→ ${r.text}</a>
    </div>`).join('')}
  </div>
  ${isListing ? `
  <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:#2e7d32;letter-spacing:.5px;margin:10px 0 4px"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.59 3.24H4a1 1 0 0 0-1 1v5.59a2 2 0 0 0 .59 1.41l9.58 9.59a2 2 0 0 0 2.83 0l4.59-4.59a2 2 0 0 0 0-2.83z"/><circle cx="7.5" cy="7.5" r=".5"/></svg> Listing Info</div>
  <div class="info-grid">
    ${[["MLS#", "mlsNum"], ["Lockbox#", "lockboxNum"], ["Shackle Code", "shackleCode"], ["CBS Code", "cbsCode"]].map(([label, key]) => `
    <div class="info-field">
      <div class="info-label">${label}</div>
      <input class="info-input" type="text" placeholder="—" data-key="${key}"
        value="${(fields[key] || '').replace(/"/g, '&quot;')}"
        onchange="saveField('${key}', this.value, this)">
    </div>`).join('')}
    <div class="info-field">
      <div class="info-label">Land or Resale</div>
      <select class="info-input" onchange="saveField('propertyType', this.value)">
        ${['', 'Resale', 'Land'].map(o => `<option value="${o}"${(fields.propertyType||'')===o?' selected':''}>${o || '—'}</option>`).join('')}
      </select>
    </div>
    <div class="info-field">
      <div class="info-label">Sign</div>
      <select class="info-input" onchange="saveField('signStatus', this.value)">
        ${['', 'Yes', 'No', 'Agents', 'Removed'].map(o => `<option value="${o}"${(fields.signStatus||'')===o?' selected':''}>${o || '—'}</option>`).join('')}
      </select>
    </div>
    <div class="info-field">
      <div class="info-label">Status</div>
      <select class="info-input" onchange="saveField('listingStatus', this.value)">
        ${['', 'Coming Soon', 'Active', 'Pending', 'Expired', 'Cancelled', 'Temp Off Mkt', 'Closed'].map(o => `<option value="${o}"${(fields.listingStatus||'')===o?' selected':''}>${o || '—'}</option>`).join('')}
      </select>
    </div>
  </div>` : ''}
  <div style="border-top:1px solid #f1f1f4;margin-top:8px;padding-top:10px;padding-bottom:6px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:#66187E;letter-spacing:.12em"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/></svg> Contingencies</div>
      <button class="stx" onclick="addContingency()">+ Add Contingency</button>
    </div>
    <div id="contingency-list"></div>
  </div>
</div>

<div class="container" style="padding-top:0;padding-bottom:0">
<div class="detail-layout">
  <div class="detail-main">${tasksHidden
    ? `<div style="background:white;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.07);padding:36px 24px;text-align:center;color:#64748b;font-size:14px">🔒 This transaction's checklist is managed by <strong style="color:#4a1160">${assignedTC}</strong></div>`
    : sectionHTML}</div>
  <div class="detail-sidebar">
    ${tasksHidden ? `<div class="detail-sidebar-hdr"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg> Tasks</div><div class="task-due-empty">Managed by ${assignedTC}</div>` : (() => {
      const today = todayAZ();
      const pastDue = [], dueToday = [];
      let ucp = false;
      // Listings: no due tasks in the sidebar until under contract
      for (const item of items) {
        if (item.section === "Under Contract") ucp = true;
        if (checked[item.id]) continue;
        const autoISO = calcDueDateISO(item.day, isListing ? (ucp ? ucDate : contractDate) : contractDate, closeDate);
        const dueISO = (notes[item.id]?.due) || autoISO;
        if (!dueISO) continue;
        if (dueISO < today) pastDue.push(item);
        else if (dueISO === today) dueToday.push(item);
      }
      // Contingencies with a due date show as tasks on that day.
      const contPast = [], contDueToday = [];
      for (const c of (transaction.contingencies || [])) {
        if (!c.due || c.done) continue;
        if (c.due < today) contPast.push(c);
        else if (c.due === today) contDueToday.push(c);
      }
      // Manual tasks live in this bar (never in the checklist), pinned to their day
      const escM = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const mts = (transaction.manualTasks || []).filter(m => !m.done);
      const mtPast = mts.filter(m => m.due && m.due < today);
      const mtToday = mts.filter(m => m.due === today);
      const mtUpcoming = mts.filter(m => !m.due || m.due > today)
        .sort((a, b) => ((a.due || '9999') < (b.due || '9999') ? -1 : 1));
      const mtRow = (m, style) => `<div class="task-due-item" style="justify-content:space-between"><div style="display:flex;align-items:flex-start;gap:7px;min-width:0"><input type="checkbox" onchange="doneManualTask('${m.id}', this)"><label style="${style}">${escM(m.text)} <span style="font-size:10px;color:#a21caf;font-weight:600">· task</span>${m.due && m.due > today ? ` <span style="font-size:10px;color:#94a3b8;font-weight:400">${m.due.slice(5,7)}/${m.due.slice(8,10)}</span>` : ''}</label></div><button onclick="deleteManualTask('${m.id}')" title="Delete task" style="background:none;border:none;color:#cbd5e1;cursor:pointer;font-size:11px;flex-shrink:0">✕</button></div>`;
      const totalPast = pastDue.length + contPast.length + mtPast.length;
      const totalToday = dueToday.length + contDueToday.length + mtToday.length;
      const contLabel = (c) => (c.name && c.name.trim() ? c.name : 'Contingency') + ' <span style="font-size:10px;color:#9a3412;font-weight:600">· contingency</span>';
      const hdrBadges = [
        totalPast ? `<span style="background:#dc2626;color:white;border-radius:10px;padding:2px 8px;font-size:11px;font-weight:600">⚠ ${totalPast} past due</span>` : '',
        totalToday ? `<span style="background:#15803d;color:white;border-radius:10px;padding:2px 8px;font-size:11px;font-weight:600">✓ ${totalToday} today</span>` : ''
      ].filter(Boolean).join(' ');
      const hdr = `<div class="detail-sidebar-hdr" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg> Tasks ${hdrBadges}</div>`;
      const upcoming = mtUpcoming.length
        ? `<div class="task-due-group"><div class="task-due-label" style="color:#64748b"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> Scheduled</div>${mtUpcoming.map(m => mtRow(m, 'color:#64748b;font-weight:600')).join('')}</div>`
        : '';
      const addRow = `<div style="padding:10px 12px;border-top:1px solid #f0f2f8">
        <input id="mt-text" placeholder="Add a task…" onkeydown="if(event.key==='Enter')addManualTask()"
          style="width:100%;box-sizing:border-box;border:1px solid #e0e4f0;border-radius:6px;padding:8px 10px;font-size:13px;margin-bottom:7px">
        <div style="display:flex;gap:7px;align-items:center">
          <input id="mt-due" type="date" value="${today}" style="flex:1;box-sizing:border-box;border:1px solid #e0e4f0;border-radius:6px;padding:6px 8px;font-size:12px">
          <button onclick="addManualTask()" style="background:#a21caf;color:white;border:none;border-radius:6px;padding:7px 18px;font-size:12px;font-weight:600;cursor:pointer">Add</button>
        </div>
      </div>`;
      if (!totalPast && !totalToday) return hdr + '<div class="task-due-empty">No tasks due today</div>' + upcoming + addRow;
      let html = hdr;
      if (totalPast) {
        html += '<div class="task-due-group" style="background:#fff5f5">';
        html += `<div class="task-due-label" style="color:#dc2626">⚠ Past Due <span style="font-size:11px;background:#dc2626;color:white;border-radius:10px;padding:1px 7px">${totalPast}</span></div>`;
        html += pastDue.map(item => `<div class="task-due-item"><input type="checkbox" onchange="toggle('${item.id}', this.checked)" id="s-${item.id}"><label for="s-${item.id}" class="overdue">${item.label}</label></div>`).join('');
        html += contPast.map(c => `<div class="task-due-item"><span style="color:#ea580c">🔶</span><label class="overdue">${contLabel(c)}</label></div>`).join('');
        html += mtPast.map(m => mtRow(m, 'color:#dc2626;font-weight:600')).join('');
        html += '</div>';
      }
      if (totalToday) {
        html += '<div class="task-due-group" style="background:#f0fdf4">';
        html += `<div class="task-due-label" style="color:#15803d">✓ Due Today <span style="font-size:11px;background:#15803d;color:white;border-radius:10px;padding:1px 7px">${totalToday}</span></div>`;
        html += dueToday.map(item => `<div class="task-due-item"><input type="checkbox" onchange="toggle('${item.id}', this.checked)" id="s-${item.id}"><label for="s-${item.id}" style="color:#15803d;font-weight:600">${item.label}</label></div>`).join('');
        html += contDueToday.map(c => `<div class="task-due-item"><span style="color:#ea580c">🔶</span><label style="color:#15803d;font-weight:600">${contLabel(c)}</label></div>`).join('');
        html += mtToday.map(m => mtRow(m, 'color:#15803d;font-weight:600')).join('');
        html += '</div>';
      }
      return html + upcoming + addRow;
    })()}
  </div>
</div>
</div>
<div class="toast" id="toast">Saved</div>

<script>
const TXN_ID = '${id}';
const IS_LISTING = ${JSON.stringify(isListing)};
const IS_ADMIN = ${JSON.stringify(!tc || tc === 'admin' || ADMIN_TCS.includes(tc))};
const ITEMS = ${JSON.stringify((() => { let u = false; return items.map(i => { if (i.section === "Under Contract") u = true; return { id: i.id, day: i.day, uc: u }; }); })())};

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
  const ucDate = document.querySelector('input[data-key="ucDate"]')?.value || '';
  const closeDate = document.querySelector('input[data-key="closeDate"]')?.value || '';
  ITEMS.forEach(item => {
    const inp = document.querySelector('.date-input.due[data-item="' + item.id + '"]');
    if (!inp) return;
    // listings: UC-phase items key off the Under Contract date only (blank until it's set)
    const baseDate = IS_LISTING ? (item.uc ? ucDate : contractDate) : (ucDate || contractDate);
    const autoISO = calcDue(item.day, baseDate, closeDate);
    inp.setAttribute('data-auto', autoISO);
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
    // auto-collapse when all done, auto-expand when not
    const arrow = hdr.querySelector('.collapse-arrow');
    if (allDone) {
      tbody.style.display = 'none';
      if (arrow) arrow.textContent = '▼';
    } else {
      tbody.style.display = '';
      if (arrow) arrow.textContent = '▲';
    }
  });
}
async function saveDue(itemId, val) {
  const inp = document.querySelector('.date-input.due[data-item="' + itemId + '"]');
  if (inp) { inp.dataset.manual = val ? '1' : ''; colorDue(inp); }
  await fetch('/api/transactions/' + TXN_ID + '/note', {
    method:'POST', headers:{'Content-Type':'application/json'}, keepalive:true,
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

// wire up info-inputs using data-key attributes set server-side
document.querySelectorAll('.info-input[data-key]').forEach(inp => {
  const key = inp.dataset.key;
  if (key === 'contractDate' || key === 'closeDate' || key === 'ucDate') {
    inp.addEventListener('change', refreshDueDates);
  }
  if (key === 'binsrDue') {
    inp.addEventListener('change', function() { this.dataset.manual = this.value ? '1' : ''; });
  }
  if (key === 'contractDate' || key === 'ucDate') {
    inp.addEventListener('change', function() {
      if (IS_LISTING && key === 'contractDate') return; // listings: BINSR keys off the UC date only
      const binsr = document.getElementById('binsrDue');
      if (binsr && !binsr.dataset.manual) {
        if (!this.value) { binsr.value = ''; return; }
        const d = new Date(this.value + 'T12:00:00');
        d.setDate(d.getDate() + 10);
        binsr.value = d.toISOString().slice(0, 10);
        saveField('binsrDue', binsr.value);
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
  // keepalive: the save still completes even if the page reloads right after
  await fetch('/api/transactions/' + TXN_ID + '/note', {
    method:'POST', headers:{'Content-Type':'application/json'}, keepalive:true,
    body: JSON.stringify({itemId, field, val})
  });
  showToast();
}
// Save while typing (debounced) so a note can't be lost to a reload before blur
const noteTimers = {};
function debounceNote(itemId, inp) {
  clearTimeout(noteTimers[itemId]);
  noteTimers[itemId] = setTimeout(() => saveItemField(itemId, 'note', inp.value), 600);
}
async function addManualTask() {
  const textEl = document.getElementById('mt-text');
  const text = textEl.value.trim();
  if (!text) { textEl.focus(); return; }
  const due = document.getElementById('mt-due').value;
  await fetch('/api/transactions/' + TXN_ID + '/manual-tasks', {
    method:'POST', headers:{'Content-Type':'application/json'}, keepalive:true,
    body: JSON.stringify({ text, due })
  });
  location.reload();
}
async function doneManualTask(id, cb) {
  await fetch('/api/transactions/' + TXN_ID + '/manual-tasks/' + id, {
    method:'POST', headers:{'Content-Type':'application/json'}, keepalive:true,
    body: JSON.stringify({ done: cb.checked })
  });
  const row = cb.closest('.task-due-item');
  if (row) row.style.opacity = cb.checked ? '0.4' : '';
  const lbl = cb.parentElement.querySelector('label');
  if (lbl) lbl.style.textDecoration = cb.checked ? 'line-through' : '';
  showToast();
}
async function deleteManualTask(id) {
  if (!confirm('Delete this task?')) return;
  await fetch('/api/transactions/' + TXN_ID + '/manual-tasks/' + id, { method:'DELETE' });
  location.reload();
}
async function adminDeleteTxn() {
function delGate(label) {
  return confirm('Do you want to delete ' + label + '? This cannot be undone.');
}
  if (!delGate('this file')) return;
  const r = await fetch('/api/transactions/' + TXN_ID, { method:'DELETE' });
  if (!r.ok) { const j = await r.json().catch(function(){ return {}; }); alert(j.error || 'Could not delete.'); return; }
  window.location = '/?tc=' + encodeURIComponent(${JSON.stringify(tc)});
}
async function setTxnStatus(status, force) {
  const res = await fetch('/api/transactions/' + TXN_ID + '/status', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({status, force: !!force})
  });
  const out = await res.json().catch(function(){ return {}; });
  if (out.error) {
    if (IS_ADMIN && confirm('⚠ ' + out.error + '\\n\\nClose it anyway (admin override)?')) return setTxnStatus(status, true);
    if (!IS_ADMIN) alert('⚠ ' + out.error);
    return;
  }
  location.reload();
}
// Contract acceptance and COE can never fall on a weekend (title/recording
// offices are closed). Employment agreement dates on listings are exempt.
function weekendDayName(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T12:00:00').getDay();
  return d === 0 ? 'Sunday' : d === 6 ? 'Saturday' : null;
}
function weekendBlockLabel(key) {
  if (key === 'closeDate') return 'Close of Escrow (COE)';
  return null;
}
async function changeTxnType(sel) {
  if (!confirm('Change this file to "' + sel.options[sel.selectedIndex].text + '"? The checklist will switch to the new type.')) { sel.value = sel.dataset.orig; return; }
  await fetch('/api/transactions/' + TXN_ID + '/type', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ type: sel.value }) });
  location.reload();
}
function fmtMoney(inp) {
  const n = parseFloat(String(inp.value).replace(/[^0-9.]/g, ''));
  inp.value = isNaN(n) ? '' : '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return inp.value;
}
async function saveField(key, val, el) {
  const label = weekendBlockLabel(key);
  const wknd = label && weekendDayName(val);
  if (wknd) {
    alert('⚠ ' + label + ' cannot be a weekend!\\n\\n' + val + ' is a ' + wknd + ' — please pick a weekday.');
    if (el) el.value = el.getAttribute('value') || '';
    return;
  }
  const res = await fetch('/api/transactions/' + TXN_ID + '/field', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({key, val})
  });
  const out = await res.json().catch(() => ({}));
  if (out.error) {
    alert('⚠ ' + out.error);
    if (el) el.value = el.getAttribute('value') || '';
    return;
  }
  showToast();
  refreshDueDates();
  if (out.activated) window.location.reload();
}

// ── Contingencies (add as many as needed; each with a name + due date) ──
let CONTINGENCIES = ${JSON.stringify(transaction.contingencies || [])};
function contToday(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function renderContingencies(){
  const el=document.getElementById('contingency-list'); if(!el) return;
  // Only contingencies without a due date show here — once a date is set they move into the checklist.
  const pending=CONTINGENCIES.filter(function(c){ return !c.due; });
  if(!pending.length){ el.innerHTML=''; return; }
  el.innerHTML=pending.map(function(c){
    const i=CONTINGENCIES.indexOf(c);
    return '<div style="display:flex;align-items:center;gap:8px;padding:5px 2px;border-bottom:1px solid #f5f5f7">'+
      '<input type="text" data-cid="'+c.id+'" value="'+String(c.name||'').replace(/"/g,'&quot;')+'" placeholder="Which contingency? (e.g. Inspection, Appraisal, Loan)" onblur="setContingency('+i+',\\'name\\',this.value)" style="flex:1;min-width:100px;border:1px solid #e2e8f0;border-radius:5px;padding:4px 8px;font-size:13px">'+
      '<input type="date" value="" onchange="setContingency('+i+',\\'due\\',this.value)" title="Set a due date to move it into the checklist on that day" style="border:1px solid #e2e8f0;border-radius:5px;padding:3px 6px;font-size:12px;flex-shrink:0">'+
      '<button onclick="deleteContingency('+i+')" title="Remove" style="background:none;border:none;color:#cbd5e1;font-size:14px;cursor:pointer;flex-shrink:0">&#10005;</button>'+
      '</div>';
  }).join('');
}
function deleteContingencyById(id){ const idx=CONTINGENCIES.findIndex(function(x){ return x.id===id; }); if(idx<0) return; CONTINGENCIES.splice(idx,1); saveContingencies().then(function(){ location.reload(); }); }
function setContingencyDueById(id,val){ const c=CONTINGENCIES.find(function(x){ return x.id===id; }); if(!c) return; c.due=val; saveContingencies().then(function(){ location.reload(); }); }
function addContingency(){
  const id=Date.now().toString();
  CONTINGENCIES.push({id:id,name:'',due:'',done:false});
  renderContingencies();
  saveContingencies();
  const inp=document.querySelector('#contingency-list input[data-cid="'+id+'"]');
  if(inp) inp.focus();
}
function setContingency(i,key,val){ if(!CONTINGENCIES[i])return; CONTINGENCIES[i][key]=val; if(key!=='name') renderContingencies(); saveContingencies().then(function(){ if(key==='due'||key==='done') location.reload(); }); }
function deleteContingency(i){ CONTINGENCIES.splice(i,1); renderContingencies(); saveContingencies().then(function(){ location.reload(); }); }

// size the wrapping address box to its content on load
(function(){
  const a = document.querySelector('textarea[data-key="address"]');
  if (a) { a.style.height = 'auto'; a.style.height = a.scrollHeight + 'px'; }
})();
function toggleContingencyDone(id){ const c=CONTINGENCIES.find(function(x){ return x.id===id; }); if(!c) return; c.done=!c.done; saveContingencies().then(function(){ location.reload(); }); }
async function saveContingencies(){ await fetch('/api/transactions/'+TXN_ID+'/contingencies',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contingencies:CONTINGENCIES})}); if(typeof showToast==='function') showToast(); }
renderContingencies();
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
  const isAdmin = !tc || tc === 'admin' || ADMIN_TCS.includes(tc);
  // Admin + coordinators (Joana/Ashley/Cinnamon) get the right-side task panel.
  // Leadership (Scott/Doug) don't — they get the full-width table.
  const showDashTasks = tc === 'admin' || TC_NAMES.includes(tc);
  function earliestDue(t) {
    const items = txnItems(t);
    const fields = t.fields || {};
    const contractDate = fields.contractDate || '';
    const closeDate = fields.closeDate || '';
    const checked = t.checked || {};
    const notes = t.notes || {};
    let earliest = '';
    for (const item of items) {
      if (checked[item.id]) continue;
      const due = (notes[item.id]?.due) || calcDueDateISO(item.day, contractDate, closeDate);
      if (due && (!earliest || due < earliest)) earliest = due;
    }
    return earliest || '9999-99-99';
  }
  const allEntries = Object.entries(transactions).sort((a,b) => {
    const da = earliestDue(a[1]), db = earliestDue(b[1]);
    if (da !== db) return da < db ? -1 : 1;
    return b[1].createdAt - a[1].createdAt;
  });
  // Everyone sees every transaction; only the Tasks panel is per-TC
  const sorted = allEntries;
  const isMine = ([,t]) => {
    if (isAdmin) return true;
    const isPreUCListingT = t.type === 'listing' && !(t.fields?.ucDate);
    if (LISTING_COORDS.includes(tc)) return isPreUCListingT;   // listing coordinator: pre-UC listings only
    if (isPreUCListingT) return false;                          // pre-UC listings belong to the listing coordinator
    const assigned = t.fields?.tcName || '';
    return assigned === tc || assigned === '';
  };

  function fmt(dateStr) { if (!dateStr) return '—'; const [y,m,d] = dateStr.split('-'); return `${+m}/${+d}/${y.slice(2)}`; }
  function streetOnly(a) {
    if (!a) return a;
    const parts = String(a).split(',').map(v => v.trim());
    let x = parts[0];
    if (parts[1] && /^(?:Unit|Apt|Apartment|Suite|Ste|Lot|#)\.?\s*[A-Za-z0-9-]+$/i.test(parts[1])) x += ' ' + parts[1];
    const m = x.match(/^(.*?\b(?:St|Street|Ave|Avenue|Dr|Drive|Rd|Road|Ln|Lane|Ct|Court|Pl|Place|Way|Blvd|Boulevard|Cir|Circle|Trl|Trail|Pkwy|Parkway|Ter|Terrace|Loop|Hwy)\b\.?(?:\s+(?:Unit|Apt|Apartment|Suite|Ste|Lot)\.?\s*[A-Za-z0-9-]+|\s*#\s*[A-Za-z0-9-]+)?)(?=\s|$)/i);
    if (m) return m[1];
    const u = x.match(/^(.*?(?:#\s*[A-Za-z0-9-]+|\b(?:Unit|Apt|Apartment|Suite|Ste|Lot)\.?\s*[A-Za-z0-9-]+))(?=\s|$)/i);
    return u ? u[1] : x;
  }
  function makeRow(id, t, isArchived, mode) {
    const items = txnItems(t);
    const isBuyerT = t.type === "buyer" || t.type === "buyer-new-build";
    const done = items.filter(i => (t.checked || {})[i.id]).length;
    const pct = Math.round((done / items.length) * 100);
    const color = isBuyerT ? "#9333ea" : t.type === "listing-uc" ? "#b45309" : "#2e7d32";
    const fields = t.fields || {};
    const actionBtns = isArchived
      ? `<button title="Reopen" onclick="event.stopPropagation();setStatus('${id}','active')" style="background:#faf0ff;color:#4a1160;border:none;padding:4px 9px;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer">Reopen</button>`
      : `<button title="Mark Closed" onclick="event.stopPropagation();setStatus('${id}','closed')" style="background:#dcfce7;color:#15803d;border:none;padding:2px 6px;border-radius:5px;font-size:12px;font-weight:600;cursor:pointer;margin-right:2px">✓</button><button title="Mark Cancelled" onclick="event.stopPropagation();setStatus('${id}','cancelled')" style="background:#fee2e2;color:#dc2626;border:none;padding:2px 6px;border-radius:5px;font-size:12px;font-weight:600;cursor:pointer">⊘</button>`;
    const progColor = pct === 100 ? '#9333ea' : pct >= 66 ? '#15803d' : pct >= 34 ? '#eab308' : '#dc2626';
    const progress = `<td><div style="display:flex;align-items:center;gap:6px"><div style="flex:1;height:6px;background:#e0e4f0;border-radius:4px;min-width:28px"><div style="width:${pct}%;height:7px;background:${progColor};border-radius:4px"></div></div><span style="font-size:11px;font-weight:600;color:${progColor};white-space:nowrap">${pct}%</span></div></td>`;
    const actions = `<td onclick="event.stopPropagation()" style="white-space:nowrap;text-align:right">${actionBtns}<button title="Delete" onclick="event.stopPropagation();deleteTxn('${id}','${(t.address||'this transaction').replace(/'/g,"\\'")}',this)" style="background:#f5f5f5;color:#888;border:none;padding:2px 6px;border-radius:5px;font-size:12px;font-weight:600;cursor:pointer;margin-left:2px">✕</button></td>`;
    const base = `<td><strong>${t.address || '(no address)'}</strong></td><td>${fields.clientName || t.clientName || '—'}</td><td>${fields.agentPartner1 || '—'}</td>`;
    const ucFlag = `<span style="background:#fee2e2;color:#dc2626;border-radius:6px;padding:1px 7px;font-size:10px;font-weight:600;white-space:nowrap">⚠ Please update</span>`;
    const ucCell = (isBuyerT && !fields.contractDate) ? ucFlag : fmt(fields.contractDate);
    let dateCols = '';
    if (mode === 'uc') {
      const ucd = fields.ucDate ? fmt(fields.ucDate) : ucFlag;
      dateCols = `<td>${ucd}</td><td>${fmt(fields.closeDate)}</td>`;
    } else if (mode === 'buyer') {
      dateCols = `<td>${ucCell}</td><td>${fmt(fields.closeDate)}</td>`;
    } else if (mode === 'listing') {
      dateCols = `<td style="font-size:11px;white-space:nowrap">${fmt(fields.contractDate)}</td><td style="font-size:11px;white-space:nowrap">${fmt(fields.listingStartDate)}</td><td style="font-size:11px;white-space:nowrap">${fmt(fields.listingExpDate)}</td>`;
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
    const baseCompact = `<td style="font-size:12.5px;white-space:nowrap;font-weight:600;color:#1c1524">${(streetOnly(t.address) || '(no address)').toUpperCase()}</td><td style="font-size:11.5px;white-space:nowrap">${fields.clientName || t.clientName || '—'}</td><td style="font-size:11.5px;white-space:nowrap">${fields.agentPartner1 || '—'}</td><td style="font-size:11.5px;white-space:nowrap">${(fields.tcName || fields.lcName || '—').split(' ')[0]}</td>`;
    const rowStyle = dueToday.length && !pastDue.length
      ? 'border-left:4px solid #16a34a;background:#f0fdf4;'
      : pastDue.length ? 'border-left:4px solid #dc2626;' : '';
    return `<tr onclick="window.location='/t/${id}?tc=${tc}'" style="cursor:pointer;${rowStyle}${isArchived?'opacity:0.7':''}">${baseCompact}${dateCols}${progress}</tr>`;
  }

  const todayISO   = todayAZ();
  // Manual reminder tasks due today or overdue for THIS TC — greets them in a
  // popup when they open the dashboard (admins skip it; they see everything).
  const popupTasks = [];
  if (!isAdmin) {
    for (const [pid, t] of allEntries) {
      if ((t.fields?.tcName) !== tc || t.status === 'closed' || t.status === 'cancelled') continue;
      for (const mtk of (t.manualTasks || [])) {
        if (!mtk.done && mtk.due && mtk.due <= todayAZ()) {
          popupTasks.push({ id: pid, address: t.address || '(no address)', text: mtk.text, due: mtk.due });
        }
      }
    }
    popupTasks.sort((x, y) => x.due < y.due ? -1 : 1);
  }
  const pending     = sorted.filter(([,t]) => t.status === "pending");
  const active      = sorted.filter(([,t]) => (!t.status || t.status === "active") && (t.type === "buyer" || t.type === "buyer-new-build"));
  const listings    = sorted.filter(([,t]) => (!t.status || t.status === "active") && t.type === "listing" && !t.fields?.ucDate);
  const listingUC   = sorted.filter(([,t]) => (!t.status || t.status === "active") && (t.type === "listing-uc" || (t.type === "listing" && t.fields?.ucDate)));
  const closingToday = sorted.filter(([,t]) => (!t.status || t.status === "active") && (t.fields?.closeDate === todayISO));
  const closed     = sorted.filter(([,t]) => t.status === "closed");
  const cancelled  = sorted.filter(([,t]) => t.status === "cancelled");
  // Active transactions whose close date has already passed but aren't marked closed.
  const needsAttention = sorted.filter(([,t]) => (!t.status || t.status === "active") && t.fields?.closeDate && t.fields.closeDate < todayISO);

  function makeTable(list, archived, mode) {
    if (list.length === 0) return '<div class="empty">None</div>';
    const headers = mode === 'uc'
      ? `<th>Address</th><th>Client</th><th>Agent</th><th>TC</th><th>Under Contract</th><th>Closing Date</th><th>Progress</th>`
      : mode === 'buyer'
      ? `<th>Address</th><th>Client</th><th>Agent</th><th>TC</th><th>Under Contract</th><th>Closing Date</th><th>Progress</th>`
      : mode === 'listing'
      ? `<th>Address</th><th>Client</th><th>Agent</th><th>TC</th><th>Agreement</th><th>Start</th><th>Exp</th><th>Progress</th>`
      : `<th>Address</th><th>Client</th><th>Agent</th><th>TC</th><th>Contract Date</th><th>Close Date</th><th>Progress</th>`;
    return `<div style="overflow-x:auto"><table><thead><tr>${headers}</tr></thead><tbody>${list.map(([id,t]) => makeRow(id,t,archived,mode)).join('')}</tbody></table></div>`;
  }

  const pendingCard = ([id, t]) => {
        const agent = t.fields?.agentPartner1 || t.fields?.agentName || '—';
        const client = t.fields?.clientName || '—';
        const addr = t.address || '—';
        const receivedAt = t.createdAt ? new Date(t.createdAt).toLocaleString('en-US', { timeZone: 'America/Phoenix', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : '—';
        const curType = (t.type && t.type !== '') ? t.type : 'buyer';
        const typeOpts = [['buyer','Buyer — Resale'],['buyer-new-build','Buyer — New Build'],['listing','Listing'],['listing-uc','Listing Escrow']];
        return `<div class="pcard" style="background:white;border:1px solid #e5eaf1;border-left:4px solid #CB2CFB;border-radius:10px;padding:10px 14px;box-shadow:0 1px 3px rgba(22,50,79,.05)">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <div style="flex:1;min-width:180px">
              <div style="font-weight:600;font-size:14px;color:#1e293b">${addr}</div>
              <div style="font-size:12px;color:#64748b;margin-top:2px">${client && client !== '—' ? `Client: <b style="color:#1e293b">${client}</b> &nbsp;·&nbsp; ` : ''}Agent: <b style="color:#1e293b">${agent}</b></div>
              <div style="font-size:11px;color:#94a3b8;margin-top:3px">Received: ${receivedAt}</div>
            </div>
            <a href="/t/${id}?tc=${tc}" class="open-btn" style="background:#66187E;color:white;text-decoration:none;font-size:12px;font-weight:600;padding:7px 14px;border-radius:8px;white-space:nowrap">Open →</a><button onclick="adminDelete('${id}')" title="Delete this file" style="background:white;color:#8a7d95;border:1.5px solid #eadef0;font-size:12px;font-weight:600;width:32px;height:32px;border-radius:8px;cursor:pointer;line-height:1" onmouseover="this.style.borderColor='#CB2CFB';this.style.color='#CB2CFB'" onmouseout="this.style.borderColor='#eadef0';this.style.color='#8a7d95'">✕</button>
          </div>
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            <span style="font-size:11px;color:#94a3b8;font-weight:600;margin-right:2px">TYPE:</span>
            ${typeOpts.map(([val, label]) => `<button onclick="setFsType('${id}','${val}',this)" style="font-size:11px;font-weight:600;padding:4px 10px;border-radius:5px;cursor:pointer;border:2px solid ${curType===val?'#CB2CFB':'#e2e8f0'};background:${curType===val?'#CB2CFB':'white'};color:${curType===val?'white':'#64748b'}">${label}</button>`).join('')}
          </div>
        </div>`;
      };

  const closingsTodaySection = closingToday.length > 0 ? `
    <div class="shd shd-green"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="m9 16 2 2 4-4"/></svg> Closings Today — ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})} (${closingToday.length})</div>
    <div class="card" style="margin-bottom:14px;border-left:4px solid #15803d">
      <table><tbody>${closingToday.map(([id,t]) => {
        const fields = t.fields || {};
        const label = t.type === 'listing' || t.type === 'listing-uc' ? '🏡 Seller' : '🔑 Buyer';
        return `<tr onclick="window.location='/t/${id}?tc=${tc}'" style="cursor:pointer">
          <td style="padding:3px 13px;font-size:12.5px;font-weight:600;color:#14532d">${(t.address || '(no address)').toUpperCase()}</td>
          <td style="padding:3px 8px;font-size:11.5px;color:#166534">${fields.clientName || t.clientName || '—'}</td>
          <td style="padding:3px 8px;font-size:10.5px"><span style="background:#dcfce7;color:#15803d;border-radius:8px;padding:1px 7px;font-weight:600">${label}</span></td>
          <td style="padding:3px 8px;font-size:11.5px;color:#166534">${fields.agentPartner1 || '—'}</td>
        </tr>`;
      }).join('')}</tbody></table>
    </div>` : '';

  const rows = ''; // unused placeholder

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>The Kumler Group — Transaction Hub</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 100 100%27><circle cx=%2750%27 cy=%2750%27 r=%2748%27 fill=%27%23CB2CFB%27/><path d=%27M28 52 50 34 72 52%27 stroke=%27white%27 stroke-width=%278%27 fill=%27none%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/><path d=%27M34 50 V74 H66 V50%27 stroke=%27white%27 stroke-width=%278%27 fill=%27none%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/></svg>">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Inter',-apple-system,Helvetica,sans-serif; background:#f2f5f9; color:#1c2733; }
  .header { background:linear-gradient(120deg,#3d0d52,#66187E 55%,#a21caf 135%); color:white; padding:15px 32px; display:flex; align-items:center; justify-content:space-between; }
  .header h1 { font-size:20px; font-weight:600; }
  .header p { font-size:13px; color:#cba8e0; margin-top:2px; }
  .btn { background:#a21caf; color:white; border:none; padding:10px 20px; border-radius:7px;
         font-size:13px; font-weight:600; cursor:pointer; }
  .btn:hover { background:#CB2CFB; transform:scale(1.04); }
  .container { max-width:1400px; margin:14px auto; padding:0 16px; }
  .tab-bar { display:flex; gap:6px; background:white; border:1px solid #e5eaf1; padding:5px; border-radius:12px; width:fit-content; margin-bottom:16px; box-shadow:0 1px 3px rgba(22,50,79,.06); flex-wrap:wrap; }
  .tab-btn { background:transparent; border:1.5px solid transparent; color:#5b6b7f; font-weight:600; font-family:inherit; font-size:13px; padding:8px 18px; border-radius:8px; cursor:pointer; transition:transform .1s, border-color .1s, color .1s, box-shadow .1s; }
  .tab-btn:hover { color:#66187E; transform:translateY(-1px); border-color:#CB2CFB; box-shadow:0 4px 12px rgba(203,44,251,.18); }
  .tab-btn.on { background:#66187E; color:white; }
  .tab-badge { background:linear-gradient(135deg,#a21caf,#CB2CFB); color:white; border-radius:999px; padding:1px 9px; font-size:11px; font-weight:600; margin-left:5px; box-shadow:0 2px 8px rgba(203,44,251,.35); }
  .pcard { transition:transform .12s, box-shadow .12s; }
  .pcard:hover { transform:translateY(-2px); box-shadow:0 8px 22px rgba(102,24,126,.15) !important; }
  .open-btn { transition:transform .1s, background .12s; display:inline-block; }
  .open-btn:hover { transform:scale(1.06); background:#CB2CFB !important; }
  .shd { display:flex; align-items:center; gap:9px; border-radius:10px; margin-bottom:6px; padding:7px 14px; font-size:12.5px; font-weight:600; text-transform:uppercase; letter-spacing:.06em; color:white; }
  .shd:has(+ .card) { border-radius:14px 14px 0 0; margin-bottom:0; }
  .shd-purple { background:linear-gradient(120deg,#8b21a8,#CB2CFB 70%,#e05df7 140%); } .shd-red { background:#dc2626; } .shd-green { background:#15803d; }
  .shd-blue { background:linear-gradient(120deg,#3d0d52,#66187E 55%,#a21caf 135%); } .shd-gray { background:#eceaf0 !important; color:#6b6477 !important; }
  .shd-green { background:linear-gradient(120deg,#0c4a26,#15803d 60%,#1fa04e 135%) !important; }
  .dashboard-layout { display:flex; gap:20px; align-items:flex-start; }
  .dashboard-main { flex:1; min-width:0; }
  .task-panel { width:260px; flex-shrink:0; position:sticky; top:16px; }
  .detail-sidebar-hdr { background:#4a1160; color:white; padding:9px 14px; font-size:11.5px; font-weight:500; text-transform:uppercase; letter-spacing:.5px; }
  .task-panel .card { padding:0; }
  .task-group { border-bottom:1px solid #f0f2f8; padding:10px 14px; }
  .task-group:last-child { border-bottom:none; }
  .task-group-name { font-size:11px; font-weight:600; color:#4a1160; margin-bottom:6px; text-transform:uppercase; letter-spacing:.3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .task-item { display:flex; align-items:flex-start; gap:6px; padding:2px 0; }
  .task-item input[type=checkbox] { margin-top:2px; flex-shrink:0; cursor:pointer; }
  .task-item label { font-size:11.5px; color:#333; line-height:1.3; cursor:pointer; }
  .task-item label.overdue { color:#dc2626; }
  .task-panel-empty { padding:24px 14px; text-align:center; color:#888; font-size:12px; }
  @media(max-width:900px) { .dashboard-layout { flex-direction:column; } .task-panel { width:100%; position:static; } }
  .card { background:white; border:1.5px solid #e5eaf1; border-radius:14px; box-shadow:0 1px 3px rgba(102,24,126,.05); overflow:hidden; transition:transform .12s, box-shadow .12s, border-color .12s; }
  .card:hover { transform:translateY(-2px); border-color:#CB2CFB; box-shadow:0 8px 24px rgba(102,24,126,.12); }
  .shd + .card { border-top-left-radius:0; border-top-right-radius:0; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; padding:5px 14px; background:#fafbfd; font-size:10px; color:#5b6b7f;
       font-weight:600; text-transform:uppercase; letter-spacing:.05em; border-bottom:1px solid #e5eaf1; }
  td { padding:3px 10px; border-bottom:1px solid #f0f2f8; font-size:12px; }
  tr:last-child td { border-bottom:none; }
  tr:hover td { background:#faf0fe; }
  .empty { padding:14px; text-align:center; color:#888; font-size:13px; }
  .modal-bg { display:none; position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:100; align-items:center; justify-content:center; }
  .modal-bg.open { display:flex; }
  .modal { background:white; border-radius:12px; padding:28px; width:440px; max-width:95vw; box-shadow:0 8px 32px rgba(0,0,0,.18); }
  .modal h2 { font-size:17px; margin-bottom:20px; color:#4a1160; font-weight:600; }
  .field { margin-bottom:14px; }
  .field label { display:block; font-size:12px; font-weight:600; color:#555; margin-bottom:5px; text-transform:uppercase; }
  .field input, .field select { width:100%; border:1px solid #d0d7e8; border-radius:6px;
    padding:9px 12px; font-size:14px; outline:none; font-family:inherit; }
  .field input:focus, .field select:focus { border-color:#4a1160; }
  .modal-actions { display:flex; gap:10px; justify-content:flex-end; margin-top:22px; }
  .btn-cancel { background:#faf0ff; color:#4a1160; border:none; padding:10px 20px;
                border-radius:7px; font-size:13px; font-weight:600; cursor:pointer; }
</style></head>
<body>
<div class="header">
  <div>
    <div style="display:flex;align-items:center;gap:10px">
      <a href="/" style="color:rgba(255,255,255,.7);text-decoration:none;font-size:12px;font-weight:600;border:1px solid rgba(255,255,255,.3);border-radius:99px;padding:3px 11px">← Back</a>
      <h1 style="font-weight:600">The Kumler Group — Transaction Hub</h1>
    </div>
    <p>${isAdmin ? 'Viewing all transactions (Admin)' : `All transactions — tasks for <strong>${tc}</strong>`}</p>
  </div>
  <button class="btn" onclick="document.getElementById('modal').classList.add('open')">+ New Transaction</button>
</div>
<div class="container">
<div class="dashboard-layout">
  <div class="dashboard-main">
    <div class="tab-bar">
      <button class="tab-btn" data-for="dash" onclick="showTab('dash')"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Dashboard${needsAttention.length + pending.length ? ` <span class="tab-badge">${needsAttention.length + pending.length}</span>` : ''}</button>
      <button class="tab-btn" data-for="buyers" onclick="showTab('buyers')"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> Buyers (${active.length + listingUC.length})</button>
      <button class="tab-btn" data-for="listings" onclick="showTab('listings')"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.59 3.24H4a1 1 0 0 0-1 1v5.59a2 2 0 0 0 .59 1.41l9.58 9.59a2 2 0 0 0 2.83 0l4.59-4.59a2 2 0 0 0 0-2.83z"/><circle cx="7.5" cy="7.5" r=".5"/></svg> Listings (${listings.length})</button>
    </div>
    <div data-tab="dash">
    ${needsAttention.length + pending.length + closingToday.length === 0 ? `<div style="display:flex;align-items:center;gap:10px;padding:11px 18px;background:linear-gradient(120deg,#3d0d52,#66187E 55%,#a21caf 135%);border-radius:10px;margin-bottom:14px">
      <span style="width:8px;height:8px;border-radius:50%;background:#CB2CFB;box-shadow:0 0 0 3px rgba(255,255,255,.25)"></span>
      <span style="font-size:13px;color:white;font-weight:500">All clear — no pending intakes, closings, or overdue files today</span>
    </div>` : ''}
    ${needsAttention.length > 0 ? `
    <div class="shd shd-red"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Incomplete — Past Close Date, Not Marked Closed (${needsAttention.length})</div>
    <div class="card" style="margin-bottom:14px;border-left:4px solid #dc2626">
      ${makeTable(needsAttention, false, 'buyer')}
    </div>` : ''}
    ${pending.length > 0 ? `
    <div class="shd shd-purple"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Needs Attention — New Formstack (${pending.length})</div>
    <div style="margin-bottom:14px;display:flex;flex-direction:column;gap:6px">
      ${pending.map(pendingCard).join('')}
    </div>` : ''}
    ${closingsTodaySection}
    </div>
    <div data-tab="buyers">
    ${(() => { const nb = needsAttention.filter(([,t]) => t.type === 'buyer' || t.type === 'buyer-new-build'); return nb.length ? `<div class="shd shd-red"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Incomplete — Past Close Date, Not Marked Closed (${nb.length})</div><div class="card" style="margin-bottom:14px;border-left:4px solid #dc2626">${makeTable(nb, false, 'buyer')}</div>` : ''; })()}
    ${(() => { const pb = pending.filter(([,t]) => t.type === 'buyer' || t.type === 'buyer-new-build'); return pb.length ? `<div class="shd shd-purple"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Needs Setup (${pb.length})</div><div style="margin-bottom:14px;display:flex;flex-direction:column;gap:6px">${pb.map(pendingCard).join('')}</div>` : ''; })()}
    ${closingsTodaySection}
    <div class="shd shd-blue"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> Active Transactions — Buyers</div>
    <div class="card" style="margin-bottom:14px">
      ${active.length === 0 ? '<div class="empty">No active transactions.</div>' : makeTable([...active].sort((a,b) => { const da = a[1].fields?.closeDate || '9999-99-99', db = b[1].fields?.closeDate || '9999-99-99'; return da < db ? -1 : da > db ? 1 : 0; }), false, 'buyer')}
    </div>
    <div class="shd shd-blue"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> Active Transactions — Sellers</div>
    <div class="card" style="margin-bottom:14px">
      ${listingUC.length === 0 ? '<div class="empty">No listings under contract.</div>' : makeTable(listingUC, false, 'uc')}
    </div>
    </div>
    <div data-tab="listings">
    ${(() => { const pl = pending.filter(([,t]) => t.type === 'listing' || t.type === 'listing-uc'); return pl.length ? `<div class="shd shd-purple"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Needs Setup (${pl.length})</div><div style="margin-bottom:14px;display:flex;flex-direction:column;gap:6px">${pl.map(pendingCard).join('')}</div>` : ''; })()}
    ${(() => {
      const resi = listings.filter(([, t]) => (t.fields?.propertyType) !== 'Land');
      const land = listings.filter(([, t]) => (t.fields?.propertyType) === 'Land');
      return `
    <div class="shd shd-blue"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.59 3.24H4a1 1 0 0 0-1 1v5.59a2 2 0 0 0 .59 1.41l9.58 9.59a2 2 0 0 0 2.83 0l4.59-4.59a2 2 0 0 0 0-2.83z"/><circle cx="7.5" cy="7.5" r=".5"/></svg> Listings — Residential (${resi.length})</div>
    <div class="card" style="margin-bottom:14px">
      ${resi.length === 0 ? '<div class="empty">No residential listings.</div>' : makeTable(resi, false, 'listing')}
    </div>
    <div class="shd shd-green"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg> Listings — Land (${land.length})</div>
    <div class="card" style="margin-bottom:14px">
      ${land.length === 0 ? '<div class="empty">No land listings.</div>' : makeTable(land, false, 'listing')}
    </div>`;
    })()}
    </div>
    <div data-tab="dash">
    ${(() => {
      function monthLabel(t) {
        const d = t.fields?.closeDate || t.fields?.contractDate;
        if (d) { const [y,m] = d.split('-'); return `${['','January','February','March','April','May','June','July','August','September','October','November','December'][+m]} ${y}`; }
        if (t.createdAt) { const dt = new Date(t.createdAt); return dt.toLocaleDateString('en-US',{month:'long',year:'numeric'}); }
        return 'Unknown';
      }
      function monthSort(label) {
        const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const [m, y] = label.split(' ');
        return `${y}-${String(months.indexOf(m)+1).padStart(2,'0')}`;
      }
      function makeMonthGroups(list, sectionLabel, icon) {
        if (!list.length) return '';
        const groups = {};
        for (const [id,t] of list) {
          const ml = monthLabel(t);
          if (!groups[ml]) groups[ml] = [];
          groups[ml].push([id,t]);
        }
        const sortedMonths = Object.keys(groups).sort((a,b) => monthSort(b).localeCompare(monthSort(a)));
        const rows = sortedMonths.map((month, i) => {
          const mId = `m-${sectionLabel.replace(/\s/g,'')}-${i}`;
          const count = groups[month].length;
          return `<div style="margin-bottom:4px;border:1px solid #e8ecf3;border-radius:7px;overflow:hidden">
            <div onclick="toggleM('${mId}')" style="display:flex;justify-content:space-between;align-items:center;padding:4px 11px;background:#fafbfd;cursor:pointer;font-size:11.5px;font-weight:400;color:#4b5563">
              <span>${month} <span style="background:#eef1f6;color:#8896a5;border-radius:8px;padding:0 7px;font-size:10.5px;margin-left:6px">${count}</span></span>
              <span id="arr-${mId}" style="font-size:10px;color:#9aa6b5">▼</span>
            </div>
            <div id="${mId}" style="display:none">${makeTable(groups[month], true, 'buyer')}</div>
          </div>`;
        }).join('');
        const secId = `sec-${sectionLabel.replace(/\s/g,'')}`;
        return `<div class="shd shd-gray" onclick="toggleM('${secId}')" style="cursor:pointer;justify-content:space-between;font-weight:400;padding:5px 13px;font-size:11px">
          <span>${icon} ${sectionLabel} <span style="background:rgba(255,255,255,.22);border-radius:8px;padding:0 8px;font-size:11px;margin-left:4px">${list.length}</span></span>
          <span id="arr-${secId}" style="font-size:11px">▼</span>
        </div>
        <div id="${secId}" style="display:none;margin-bottom:20px;margin-top:6px">${rows}</div>`;
      }
      return makeMonthGroups(closed,'Closed Transactions',`<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`) + makeMonthGroups(cancelled,'Cancelled Transactions',`<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`);
    })()}
    </div>
  </div>

  <div class="task-panel"${showDashTasks ? '' : ' style="display:none"'}>
    ${(() => {
      if (!showDashTasks) return '';
      const today = todayAZ();

      // Compute one transaction's due tasks and render its block; null if nothing due.
      function txnBlock(id, t) {
        const items = txnItems(t);
        const fields = t.fields || {};
        const contractDate = fields.contractDate || '';
        const closeDate = fields.closeDate || '';
        const isListingTxn = t.type === 'listing' || t.type === 'listing-uc';
        const ucDate = fields.ucDate || '';
        const checked = t.checked || {};
        const notes = t.notes || {};
        const pastDue = [], dueToday = [];
        let ucp = false;
        for (const item of items) {
          if (item.section === 'Under Contract') ucp = true;
          if (item.indent || checked[item.id]) continue;
          const auto = calcDueDateISO(item.day, isListingTxn ? (ucp ? ucDate : contractDate) : contractDate, closeDate);
          const due = notes[item.id]?.due || auto;
          if (!due) continue;
          if (due < today) pastDue.push(item);
          else if (due === today) dueToday.push(item);
        }
        // This transaction's manual tasks join its block on their day
        const escT = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
        const mtPast = [], mtToday = [];
        for (const m of (t.manualTasks || [])) {
          if (m.done) continue;
          if (m.due && m.due < today) mtPast.push(m);
          else if (m.due === today) mtToday.push(m);
        }
        if (!pastDue.length && !dueToday.length && !mtPast.length && !mtToday.length) return null;
        const shortAddr = (t.address || '(no address)').replace(/,.*$/, '');
        const mtRow = (m, color) => `<div class="task-item"><input type="checkbox" id="dm-${id}-${m.id}" onchange="dashManualDone('${id}','${m.id}',this.checked)"><label for="dm-${id}-${m.id}" style="color:${color}">${escT(m.text)} <span style="font-size:10px;color:#a21caf;font-weight:600">· task</span></label></div>`;
        let inner = `<div class="task-group-name" style="font-size:11px;font-weight:500;color:#4a1160;padding:5px 0 3px;border-bottom:1px solid #e0e4f0;margin-bottom:4px">${shortAddr}</div>`;
        if (pastDue.length) inner += pastDue.map(item => `<div class="task-item"><input type="checkbox" id="dt-${id}-${item.id}" onchange="dashCheck('${id}','${item.id}',this.checked)"><label for="dt-${id}-${item.id}" style="color:#dc2626">${item.label}</label></div>`).join('');
        inner += mtPast.map(m => mtRow(m, '#dc2626')).join('');
        if (dueToday.length) inner += dueToday.map(item => `<div class="task-item"><input type="checkbox" id="dt-${id}-${item.id}" onchange="dashCheck('${id}','${item.id}',this.checked)"><label for="dt-${id}-${item.id}" style="color:#15803d">${item.label}</label></div>`).join('');
        inner += mtToday.map(m => mtRow(m, '#15803d')).join('');
        return { past: pastDue.length + mtPast.length, todayN: dueToday.length + mtToday.length, html: `<div style="padding:8px 12px;border-bottom:1px solid #f0f2f8">${inner}</div>` };
      }

      // Render a labeled coordinator section (optionally hidden if empty).
      function coordSection(label, txns, hideIfEmpty) {
        let past = 0, todayN = 0; const blocks = [];
        for (const [id, t] of txns) { const b = txnBlock(id, t); if (!b) continue; past += b.past; todayN += b.todayN; blocks.push(b.html); }
        if (hideIfEmpty && !blocks.length) return '';
        const badges = [
          past ? `<span style="background:#dc2626;color:white;border-radius:10px;padding:1px 7px;font-size:10px;font-weight:600">⚠ ${past}</span>` : '',
          todayN ? `<span style="background:#15803d;color:white;border-radius:10px;padding:1px 7px;font-size:10px;font-weight:600">✓ ${todayN}</span>` : ''
        ].filter(Boolean).join(' ');
        const inner = blocks.length ? blocks.join('') : '<div class="task-panel-empty" style="padding:8px 12px">Nothing due</div>';
        const secId = 'coord-' + label.replace(/[^a-z0-9]/gi, '');
        return `<div class="card" style="padding:0;overflow:hidden;margin-bottom:12px">
          <div class="detail-sidebar-hdr" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;cursor:pointer;user-select:none" onclick="toggleCoord('${secId}')">
            <span>${label} ${badges}</span><span id="${secId}-arrow">▾</span>
          </div>
          <div id="${secId}-body">${inner}</div>
        </div>`;
      }

      if (tc === 'admin') {
        const bu = [...active, ...listingUC];
        const joana    = bu.filter(([,t]) => (t.fields?.tcName) === 'Joana Guzman');
        const ashley   = bu.filter(([,t]) => (t.fields?.tcName) === 'Ashley Belliveau');
        const cinnamon = [...listings]; // pre-UC listings = Cinnamon's setup phase
        const others   = bu.filter(([,t]) => { const n = t.fields?.tcName; return n !== 'Joana Guzman' && n !== 'Ashley Belliveau'; });
        return `<div class="detail-sidebar-hdr" style="margin-bottom:10px;border-radius:9px"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg> Tasks by Coordinator</div>`
          + coordSection('Joana Guzman', joana)
          + coordSection('Ashley Belliveau', ashley)
          + coordSection('Cinnamon Kumler', cinnamon)
          + coordSection('Unassigned', others, true);
      }

      // Each coordinator sees ONLY their own due tasks: TCs (Joana/Ashley) their assigned
      // buyers + UC listings; the Listing Coordinator (Cinnamon) her pre-UC listing setups.
      const taskSource = LISTING_COORDS.includes(tc) ? [...listings] : [...active, ...listingUC];
      let totalPast = 0, totalToday = 0; const txnGroups = [];
      for (const [id, t] of taskSource.filter(isMine)) { const b = txnBlock(id, t); if (!b) continue; totalPast += b.past; totalToday += b.todayN; txnGroups.push(b.html); }
      const hdrBadges = [
        totalPast ? `<span style="background:#dc2626;color:white;border-radius:10px;padding:2px 8px;font-size:11px;font-weight:600">⚠ ${totalPast} past due</span>` : '',
        totalToday ? `<span style="background:#15803d;color:white;border-radius:10px;padding:2px 8px;font-size:11px;font-weight:600">✓ ${totalToday} today</span>` : ''
      ].filter(Boolean).join(' ');
      const body = txnGroups.length ? txnGroups.join('') : '<div class="task-panel-empty">No tasks due today</div>';
      return `<div class="detail-sidebar-hdr" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg> Tasks ${hdrBadges}</div><div class="card" style="padding:0;overflow:hidden">${body}</div>`;
    })()}
  </div>
</div>
</div>

${(todayAZ() === '2026-07-31' && ['Ashley Belliveau','Joana Guzman','Cinnamon Kumler'].includes(tc)) || ((!tc || tc === 'admin') && todayAZ() <= '2026-07-31') ? `
<div class="modal-bg" id="jnote" onclick="if(event.target===this)this.classList.remove('open')">
  <div class="modal" style="width:460px;text-align:center">
    <div style="font-size:14px;color:#66187E;line-height:1.7;font-style:italic">
      "There is no path to Happiness. Happiness is the path.<br>
      There is no path to Love. Love is the path.<br>
      There is no path to Peace. Peace is the path."
    </div>
    <div style="font-size:11.5px;color:#8896a5;margin-top:8px">— Way of the Peaceful Warrior (one of my favorite books)</div>
    <div style="font-size:15px;color:#66187E;font-weight:600;letter-spacing:.04em;margin-top:16px">HAPPY FRIDAY ☀️ — Justine</div>
    <div style="margin-top:12px">
      <button onclick="document.getElementById('jnote').classList.remove('open')" style="background:none;border:none;color:#8896a5;font-size:15px;cursor:pointer;padding:4px 10px">✕</button>
    </div>
  </div>
</div>
<script>
  ${(!tc || tc === 'admin') ? `document.getElementById('jnote').classList.add('open');` : `try { if (!localStorage.jnote20260731) { document.getElementById('jnote').classList.add('open'); localStorage.jnote20260731 = '1'; } } catch (e) { document.getElementById('jnote').classList.add('open'); }`}
</script>` : ''}
${popupTasks.length ? `
<div class="modal-bg open" id="task-popup" onclick="if(event.target===this)this.classList.remove('open')">
  <div class="modal" style="width:470px">
    <h2>⚠️ ${tc.split(' ')[0]} — please update! ${popupTasks.length} item${popupTasks.length > 1 ? 's need' : ' needs'} you today:</h2>
    ${popupTasks.map(x => `
    <a href="/t/${x.id}?tc=${encodeURIComponent(tc)}" style="display:block;text-decoration:none;border:1px solid #e5eaf1;border-left:4px solid ${x.due < todayAZ() ? '#dc2626' : '#15803d'};border-radius:9px;padding:9px 12px;margin-bottom:8px">
      <div style="font-weight:600;font-size:13px;color:#66187E">${x.text}</div>
      <div style="font-size:11.5px;color:#5b6b7f;margin-top:2px">${x.address} · due ${x.due === todayAZ() ? 'today' : x.due}</div>
    </a>`).join('')}
    <div class="modal-actions" style="margin-top:10px">
      <button class="btn" onclick="document.getElementById('task-popup').classList.remove('open')">Got it</button>
    </div>
  </div>
</div>` : ''}
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
const IS_ADMIN = ${JSON.stringify(isAdmin)};
function delGate(label) {
  return confirm('Do you want to delete ' + label + '? This cannot be undone.');
}
async function adminDelete(id) {
  if (!delGate('this file')) return;
  const r = await fetch('/api/transactions/' + id, { method:'DELETE' });
  if (!r.ok) { const j = await r.json().catch(function(){ return {}; }); alert(j.error || 'Could not delete.'); return; }
  location.reload();
}
function showTab(name) {
  document.querySelectorAll('[data-tab]').forEach(el => el.style.display = el.dataset.tab === name ? '' : 'none');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('on', b.dataset.for === name));
  try { localStorage.tcTab = name; } catch(e) {}
}
showTab((function(){ try { return localStorage.tcTab || 'dash'; } catch(e) { return 'dash'; } })());
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
async function dashManualDone(txnId, mtId, checked) {
  await fetch('/api/transactions/' + txnId + '/manual-tasks/' + mtId, {
    method:'POST', headers:{'Content-Type':'application/json'}, keepalive:true,
    body: JSON.stringify({ done: checked })
  });
  const box = document.getElementById('dm-' + txnId + '-' + mtId);
  if (box) box.closest('.task-item').style.opacity = checked ? '0.4' : '';
}
function toggleM(id) {
  const el = document.getElementById(id);
  const arr = document.getElementById('arr-' + id);
  if (!el) return;
  const open = el.style.display === 'none';
  el.style.display = open ? '' : 'none';
  if (arr) arr.textContent = open ? '▲' : '▼';
}
async function setFsType(id, type, btn) {
  await fetch('/api/transactions/' + id + '/type', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({type})
  });
  btn.closest('div').querySelectorAll('button').forEach(b => {
    const active = b === btn;
    b.style.background = active ? '#CB2CFB' : 'white';
    b.style.color = active ? 'white' : '#64748b';
    b.style.borderColor = active ? '#CB2CFB' : '#e2e8f0';
  });
}
function toggleCoord(id) {
  const body = document.getElementById(id + '-body');
  const arrow = document.getElementById(id + '-arrow');
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : '';
  if (arrow) arrow.textContent = open ? '▸' : '▾';
}
async function setStatus(id, status, force) {
  const res = await fetch('/api/transactions/' + id + '/status', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({status, force: !!force})
  });
  const out = await res.json().catch(function(){ return {}; });
  if (out.error) {
    if (IS_ADMIN && confirm('⚠ ' + out.error + '\\n\\nClose it anyway (admin override)?')) return setStatus(id, status, true);
    if (!IS_ADMIN) alert('⚠ ' + out.error);
    return;
  }
  location.reload();
}
async function deleteTxn(id, label, btn) {
  if (!delGate('"' + label + '"')) return;
  const r = await fetch('/api/transactions/' + id, { method:'DELETE' });
  if (!r.ok) { const j = await r.json(); alert(j.error || 'Could not delete.'); return; }
  location.reload();
}
function weekendDayName(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T12:00:00').getDay();
  return d === 0 ? 'Sunday' : d === 6 ? 'Saturday' : null;
}
async function create() {
  const addr = document.getElementById('f-address').value;
  const type = document.getElementById('f-type').value;
  const contractDate = document.getElementById('f-contract').value;
  const closeDate = document.getElementById('f-close').value;
  // Only COE can never fall on a weekend (title/recording are closed).
  if (type !== 'listing') {
    const we = weekendDayName(closeDate);
    if (we) { alert('⚠ Close of Escrow (COE) cannot be a weekend!\\n\\n' + closeDate + ' is a ' + we + ' — please pick a weekday.'); return; }
  }
  const body = {
    type,
    address: addr,
    linkedListingId: type === 'listing-uc' ? document.getElementById('f-linked').value : null,
    fields: {
      address: addr,
      clientName: document.getElementById('f-client').value,
      agentPartner1: document.getElementById('f-agent').value,
      contractDate,
      closeDate,
    }
  };
  const res = await fetch('/api/transactions', {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
  });
  const t = await res.json();
  if (t.error) { alert('⚠ ' + t.error); return; }
  window.location.href = '/t/' + t.id + '?tc=${tc}';
}
document.getElementById('modal').addEventListener('click', function(e) {
  if (e.target === this) this.classList.remove('open');
});
</script>
</body></html>`;
}

const TC_NAMES = ["Joana Guzman", "Ashley Belliveau", "Cinnamon Kumler"];
const TC_COLORS = ["#9333ea", "#0d5c2e", "#b45309"];
const TC_ROLES = { "Cinnamon Kumler": "Listing Coordinator" };
// People with full admin-level access (see all transactions AND all tasks)
const ADMIN_TCS = ["Scott Kumler"];
// Listing Coordinators: own the listing-INPUT (pre–Under Contract) tasks only.
// The moment a listing goes Under Contract, its tasks hand off to the assigned TC.
const LISTING_COORDS = ["Cinnamon Kumler"];

function getTCSelectHTML() {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>The Kumler Group — Transaction Hub</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 100 100%27><circle cx=%2750%27 cy=%2750%27 r=%2748%27 fill=%27%23CB2CFB%27/><path d=%27M28 52 50 34 72 52%27 stroke=%27white%27 stroke-width=%278%27 fill=%27none%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/><path d=%27M34 50 V74 H66 V50%27 stroke=%27white%27 stroke-width=%278%27 fill=%27none%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/></svg>">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Inter',-apple-system,Helvetica,sans-serif; background:#fdfbfe; color:#1c1524; min-height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; padding:30px 0; }
  .logo { text-align:center; padding:0 20px; }
  .logo img { max-width:min(380px,84vw); height:auto; }
  .sub { text-align:center; font-size:14px; font-weight:400; color:#7a6d85; margin-top:22px; }
  .select-wrap { display:flex; flex-direction:column; align-items:center; padding:26px 20px 0; }
  .tc-grid { display:flex; flex-wrap:wrap; gap:16px; justify-content:center; max-width:760px; }
  .tc-card { background:white; border-radius:16px; box-shadow:0 2px 10px rgba(102,24,126,.06); padding:26px 24px; cursor:pointer; text-align:center; width:210px; border:1.5px solid #eadef0; transition:all .15s; text-decoration:none; color:inherit; }
  .tc-card:hover { transform:translateY(-3px); border-color:#CB2CFB; box-shadow:0 10px 28px rgba(102,24,126,.16); }
  .tc-avatar { width:56px; height:56px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:20px; font-weight:600; color:white; margin:0 auto 12px; background:linear-gradient(135deg,#66187E,#CB2CFB); }
  .tc-name { font-size:15px; font-weight:600; color:#1c1524; }
  .tc-role { font-size:12px; color:#8a7d95; margin-top:3px; font-weight:400; }
  .foot { text-align:center; padding:16px; font-size:10.5px; font-weight:500; letter-spacing:.14em; text-transform:uppercase; color:#c3b5cd; }
</style>
<script>
const TC_PASSCODES = { 'Joana Guzman': '5211', 'Cinnamon Kumler': '0007', 'Scott Kumler': '0070' };
function tcLogin(name) {
  const required = TC_PASSCODES[name];
  if (!required) { window.location.href = '/?tc=' + encodeURIComponent(name); return; }
  const code = prompt('Enter passcode:');
  if (code === required) { window.location.href = '/?tc=' + encodeURIComponent(name); }
  else if (code !== null) { alert('Incorrect passcode.'); }
}
function adminLogin() {
  const code = prompt('Enter passcode:');
  if (code === '0001') { window.location.href = '/?tc=admin'; }
  else if (code !== null) { alert('Incorrect passcode.'); }
}
</script>
</head>
<body>
<div class="logo"><img src="/logo.png" alt="The Kumler Group"></div>
<div class="sub">Transaction Hub — select your name</div>
<div class="select-wrap">
  <div class="tc-grid">
    ${(() => {
      const people = [
        { name: 'Joana Guzman',     role: 'Transaction Coordinator', color: '#9333ea', onclick: "tcLogin('Joana Guzman')" },
        { name: 'Ashley Belliveau', role: 'Transaction Coordinator', color: '#0d5c2e', onclick: "tcLogin('Ashley Belliveau')" },
        { name: 'Cinnamon Kumler',  role: 'Listing Coordinator',     color: '#b45309', onclick: "tcLogin('Cinnamon Kumler')" },
        { name: 'Justine Johnston', role: 'Director of Operations',  color: '#7e22ce', onclick: 'adminLogin()' },
        { name: 'Scott Kumler',     role: 'Team Lead',               color: '#0f766e', onclick: "tcLogin('Scott Kumler')" },
      ];
      people.sort((a, b) => a.name.split(' ')[0].localeCompare(b.name.split(' ')[0]));
      return people.map((p) => {
        const initials = p.name.split(' ').map(w => w[0]).join('');
        return `<a class="tc-card" href="javascript:void(0)" onclick="${p.onclick}">
          <div class="tc-avatar">${initials}</div>
          <div class="tc-name">${p.name}</div>
          <div class="tc-role">${p.role}</div>
        </a>`;
      }).join('');
    })()}
  </div>
  <a href="https://kumler-hub.onrender.com" style="margin-top:30px;font-size:12px;font-weight:600;color:#66187E;text-decoration:none;border:1px solid #eadef0;border-radius:99px;padding:8px 20px;background:white">← Back</a>
</div>
</body></html>`;
}

// ─── SERVER ──────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);
  const pathname = url.pathname;

  if (pathname === "/logo.png") {
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" });
    return res.end(fs.readFileSync(path.join(__dirname, "logo.png")));
  }

  if (req.method === "GET" && pathname === "/api/debug/rawfields") {
    const data = await loadData();
    const pending = Object.entries(data.transactions).filter(([,t]) => t.status === 'pending' && t._rawFields);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(pending.map(([id,t]) => ({ id, _rawFields: t._rawFields })), null, 2));
    return;
  }

  if (req.method === "POST" && pathname === "/api/transactions") {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", async () => {
      const parsed = JSON.parse(body);
      const fields = parsed.fields || {};
      if (parsed.type !== 'listing') {
        const we = weekendDayNameSrv(fields.closeDate);
        const err = we ? 'Close of Escrow (COE) cannot be a weekend — ' + fields.closeDate + ' is a ' + we + '.' : null;
        if (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err + ' Please pick a weekday.' }));
          return;
        }
      }
      const id = crypto.randomBytes(6).toString("hex");
      if (parsed.address) { parsed.address = String(parsed.address).toUpperCase(); fields.address = parsed.address; }
      const txn = { id, ...parsed, checked: {}, notes: {}, fields, createdAt: Date.now() };
      await withData(data => { data.transactions[id] = txn; });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(txn));
    });
    return;
  }

  // ── Manual tasks: extra to-dos in a transaction's task bar, pinned to a day ──
  const mtCreate = pathname.match(/^\/api\/transactions\/([^/]+)\/manual-tasks$/);
  if (req.method === "POST" && mtCreate) {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", async () => {
      const { text, due } = JSON.parse(body);
      const task = { id: crypto.randomBytes(5).toString("hex"),
                     text: String(text || '').trim(), due: due || '', done: false, createdAt: Date.now() };
      if (task.text) {
        await withData(data => {
          const t = data.transactions[mtCreate[1]];
          if (t) {
            if (!t.manualTasks) t.manualTasks = [];
            t.manualTasks.push(task);
          }
        });
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(task));
    });
    return;
  }
  const mtOne = pathname.match(/^\/api\/transactions\/([^/]+)\/manual-tasks\/([^/]+)$/);
  if (req.method === "POST" && mtOne) {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", async () => {
      const { done } = JSON.parse(body);
      await withData(data => {
        const m = (data.transactions[mtOne[1]]?.manualTasks || []).find(x => x.id === mtOne[2]);
        if (m) m.done = !!done;
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }
  if (req.method === "DELETE" && mtOne) {
    await withData(data => {
      const t = data.transactions[mtOne[1]];
      if (t) t.manualTasks = (t.manualTasks || []).filter(x => x.id !== mtOne[2]);
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  const statusMatch = pathname.match(/^\/api\/transactions\/([^/]+)\/status$/);
  if (req.method === "POST" && statusMatch) {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", async () => {
      const txId = statusMatch[1];
      const { status, force } = JSON.parse(body);
      let result = { ok: true };
      await withData(data => {
        const t = data.transactions[txId];
        if (!t) { result = { ok: false }; return; }
        // A file can't be closed until its whole checklist is checked off
        // (admins may force after an explicit confirm).
        if (status === 'closed' && !force) {
          const items = txnItems(t);
          const remaining = items.filter(i => !(t.checked || {})[i.id]).length;
          if (remaining > 0) {
            result = { ok: false, remaining, error: remaining + " checklist item(s) are still unchecked — a file can't be closed until everything is complete." };
            return;
          }
        }
        t.status = status;
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    });
    return;
  }

  const typeMatch = pathname.match(/^\/api\/transactions\/([^/]+)\/type$/);
  if (req.method === "POST" && typeMatch) {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", async () => {
      const txId = typeMatch[1];
      const { type } = JSON.parse(body);
      await withData(data => { if (data.transactions[txId]) data.transactions[txId].type = type; });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  const deleteMatch = pathname.match(/^\/api\/transactions\/([^/]+)$/);
  if (req.method === "DELETE" && deleteMatch) {
    const delId = deleteMatch[1];
    const blocked = await withData(data => {
      if (Object.values(data.transactions).find(t => t.linkedListingId === delId)) return true;
      delete data.transactions[delId];
      return false;
    });
    if (blocked) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: 'This transaction has a linked Listing UC and cannot be deleted.' }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  const checkMatch = pathname.match(/^\/api\/transactions\/([^/]+)\/check$/);
  if (req.method === "POST" && checkMatch) {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", async () => {
      const txId = checkMatch[1];
      const { itemId, checked } = JSON.parse(body);
      await withData(data => {
        const t = data.transactions[txId];
        if (t) {
          if (!t.checked) t.checked = {};
          t.checked[itemId] = checked;
          // remember when each item was ticked, so oversight can hover for the date
          if (!t.checkedAt) t.checkedAt = {};
          if (checked) t.checkedAt[itemId] = Date.now();
          else delete t.checkedAt[itemId];
        }
      });
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
      const txId = noteMatch[1];
      const { itemId, field, val } = JSON.parse(body);
      await withData(data => {
        const t = data.transactions[txId];
        if (t) {
          // Older webhook-created transactions were missing the notes object
          // entirely, which made every note save crash and vanish
          if (!t.notes) t.notes = {};
          if (!t.notes[itemId]) t.notes[itemId] = {};
          t.notes[itemId][field] = val;
        }
      });
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
      const txId = fieldMatch[1];
      const { key, val } = JSON.parse(body);
      const result = await withData(data => {
        const t = data.transactions[txId];
        if (!t) return { ok: false };
        const listingType = t.type === 'listing' || t.type === 'listing-uc';
        const dateLabel = key === 'closeDate' ? 'Close of Escrow (COE)' : null;
        const wknd = dateLabel && weekendDayNameSrv(val);
        if (wknd) return { ok: false, error: dateLabel + ' cannot be a weekend — ' + val + ' is a ' + wknd + '. Please pick a weekday.' };
        if (!t.fields) t.fields = {};
        if (key === 'address') val = String(val || '').toUpperCase();
        t.fields[key] = val;
        if (key === 'address') t.address = val;
        // A listing going Under Contract hands off to the TC doing the contract:
        // if a buy-side file is linked to this listing, take its TC.
        if (key === 'ucDate' && val && listingType && !t.fields.tcName) {
          for (const other of Object.values(data.transactions)) {
            if (other.linkedListingId === txId && other.fields?.tcName) { t.fields.tcName = other.fields.tcName; break; }
          }
        }
        // Auto-activate pending listings once agreement, start, and expiration dates are all set
        if (t.status === 'pending' && (t.type === 'listing' || t.type === 'listing-uc') &&
            t.fields.contractDate && t.fields.listingStartDate && t.fields.listingExpDate) {
          t.status = 'active';
          return { ok: true, activated: true };
        }
        return { ok: true, activated: false };
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    });
    return;
  }

  const contMatch = pathname.match(/^\/api\/transactions\/([^/]+)\/contingencies$/);
  if (req.method === "POST" && contMatch) {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", async () => {
      const txId = contMatch[1];
      const { contingencies } = JSON.parse(body);
      await withData(data => {
        if (data.transactions[txId]) {
          data.transactions[txId].contingencies = Array.isArray(contingencies) ? contingencies : [];
        }
      });
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

        // Parse Formstack sub-field strings like "first = Justine last = Johnston"
        const subVal = (str, subKey) => {
          if (!str) return '';
          const m = str.match(new RegExp(`${subKey}\\s*=\\s*([^=]+?)(?:\\s+\\w+\\s*=|$)`));
          return m ? m[1].trim() : '';
        };

        // Agent
        const agentRaw   = get('Agent Partner Name');
        const agentFirst = subVal(agentRaw, 'first') || get('Agent Partner Name First');
        const agentLast  = subVal(agentRaw, 'last')  || get('Agent Partner Name Last');
        const agentName  = [agentFirst, agentLast].filter(Boolean).join(' ') || agentRaw;
        const agentEmail = get('Agent Partner Email');
        const agentPhone = get('Agent Partner Cell Number');

        // TC Name — Formstack sends "Who Is Your Transaction Coordinator?" with an email
        const tcRaw   = get('Who Is Your Transaction Coordinator?', 'Transaction Coordinator', 'TC Name', 'Assigned TC', 'Transaction Coordinator Name');
        const tcFirst = subVal(tcRaw, 'first') || get('Transaction Coordinator First');
        const tcLast  = subVal(tcRaw, 'last')  || get('Transaction Coordinator Last');
        let tcName    = [tcFirst, tcLast].filter(Boolean).join(' ') || tcRaw;
        // Map email or partial/misspelled name to the canonical TC name
        const tcLower = tcName.toLowerCase();
        for (const canonical of TC_NAMES) {
          if (tcLower.includes(canonical.split(' ')[0].toLowerCase())) { tcName = canonical; break; }
        }
        if (tcLower.includes('joanna')) tcName = 'Joana Guzman';

        // Address
        const addrRaw = get('Subject Property Address');
        const addr1   = subVal(addrRaw, 'address') || get('Subject Property Address Address Line 1');
        const city    = subVal(addrRaw, 'city')    || get('Subject Property Address City');
        const state   = subVal(addrRaw, 'state')   || get('Subject Property Address State');
        const zip     = subVal(addrRaw, 'zip')     || get('Subject Property Address ZIP Code');
        const address = [addr1, city, state, zip].filter(Boolean).join(', ') || addrRaw;

        // Detect form type: listing form has "Seller 1 Name", escrow has "Client 1 Name"
        const hasSeller = !!(p['Seller 1 Name'] || p['Seller 1 Name First'] || p['Seller 1 Name Last'] || p['Seller/Client Email']);
        const type = hasSeller ? 'listing' : 'buyer';

        // Parse a name field that may be "first = X last = Y" or separate First/Last keys
        const parseName = (raw, keyFirst, keyLast) => {
          const r = get(raw);
          const first = subVal(r, 'first') || get(keyFirst);
          const last  = subVal(r, 'last')  || get(keyLast);
          return [first, last].filter(Boolean).join(' ') || r;
        };

        // Client/Seller names
        let clientName = '';
        if (hasSeller) {
          const s1 = parseName('Seller 1 Name', 'Seller 1 Name First', 'Seller 1 Name Last');
          const s2 = parseName('Seller 2 Name', 'Seller 2 Name First', 'Seller 2 Name Last');
          const s3 = parseName('Seller 3 Name', 'Seller 3 Name First', 'Seller 3 Name Last');
          clientName = [s1, s2, s3].filter(Boolean).join(' & ');
        } else {
          const c1 = parseName('Client 1 Name', 'Client 1 Name First', 'Client 1 Name Last');
          const c2 = parseName('Client 2 Name', 'Client 2 Name First', 'Client 2 Name Last');
          const c3 = parseName('Client 3 Name', 'Client 3 Name First', 'Client 3 Name Last');
          clientName = [c1, c2, c3].filter(Boolean).join(' & ');
        }

        // Dates — Formstack sends whatever the agent typed ("08/28/2026",
        // "August 2026", …). Store ISO or nothing; the raw text stays in
        // _rawFields and a bad string here crashes every dashboard render.
        const toISO = s => {
          s = String(s || '').trim();
          if (!s) return '';
          if (/^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T12:00:00').getTime())) return s;
          const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
          if (m) {
            const iso = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
            if (!isNaN(new Date(iso + 'T12:00:00').getTime())) return iso;
          }
          return '';
        };
        const closeDate = toISO(get('Estimated closing date (Month and Year OK)?', 'Estimated closing date'));
        const listingStartDate = toISO(get('What Date Do You and Your Client Want The Listing Active on the MLS?'));
        const notes = get('Any other important information or notes you want/need your transaction coordinator to know?', 'Additional info (optional)', 'Long Answer');

        // If an escrow comes in for a property we already have a listing for,
        // link the new buy-side file to that listing automatically.
        // Match on house number + first street-name word, ignoring punctuation
        // and directionals (N/S/E/W), so formatting differences still match.
        const addrKey = a => {
          const s = String(a || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
          const m = s.match(/^(\d+)\s+(.*)$/);
          if (!m) return null;
          const words = m[2].split(' ').filter(w => !['n','s','e','w','north','south','east','west'].includes(w));
          return words[0] ? m[1] + '|' + words[0] : null;
        };

        const id = 'txn_' + Date.now();
        await withData(data => {
          let linkedListingId = null;
          if (type === 'buyer') {
            const key = addrKey(address);
            if (key) {
              for (const [oid, o] of Object.entries(data.transactions)) {
                if ((o.type === 'listing' || o.type === 'listing-uc') && o.status !== 'cancelled' &&
                    addrKey(o.address || o.fields?.address) === key) { linkedListingId = oid; break; }
              }
            }
          }
          data.transactions[id] = {
            type,
            ...(linkedListingId ? { linkedListingId } : {}),
            address: (address || '(Address pending)').toUpperCase(),
            status: 'pending',
            createdAt: Date.now(),
            _rawFields: p,
            fields: {
              clientName,
              tcName,
              agentPartner1: agentName,
              agentPartner1Email: agentEmail,
              agentPartner1Phone: agentPhone,
              closeDate,
              listingStartDate,
              notes,
            },
            checked: {},
            notes: {},
          };
        });
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
    // Cross-links between the sides of the same deal: linkedListingId points
    // from a child file (buy side / UC file) to its listing; show chips both ways.
    const chipFor = t => (t.type === 'buyer' || t.type === 'buyer-new-build') ? ['Linked Buy Side', 'View Buy Side']
      : t.type === 'listing-uc' ? ['Linked UC File', 'View Under Contract File']
      : ['Linked Listing', 'View Original Listing'];
    const related = [];
    const target = tx.linkedListingId && data.transactions[tx.linkedListingId];
    if (target) {
      const [label, text] = chipFor(target);
      related.push({ id: tx.linkedListingId, label, text });
    }
    for (const [oid, o] of Object.entries(data.transactions)) {
      if (o.linkedListingId === txMatch[1]) {
        const [label, text] = chipFor(o);
        related.push({ id: oid, label, text });
      }
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(getHTML(tx, txMatch[1], tc, related));
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

function parseSubField(str, key) {
  if (!str) return '';
  const m = str.match(new RegExp(`${key}\\s*=\\s*([^=]+?)(?:\\s+\\w+\\s*=|$)`));
  return m ? m[1].trim() : '';
}

async function migrateAddresses() {
  const data = await loadData();
  let changed = false;
  for (const t of Object.values(data.transactions)) {
    // Heal transactions created by the Formstack webhook before it set up the
    // notes object (it wrote "itemNotes" instead) — without this, saving a note
    // on them crashed and the note was lost
    if (!t.notes) { t.notes = t.itemNotes || {}; changed = true; }
    if (!t.checked) { t.checked = {}; changed = true; }
    const addr = t.address || '';
    if (/address\s*=/.test(addr)) {
      const a = parseSubField(addr, 'address');
      const city = parseSubField(addr, 'city');
      const state = parseSubField(addr, 'state');
      const zip = parseSubField(addr, 'zip');
      t.address = [a, city, state, zip].filter(Boolean).join(', ') || addr;
      changed = true;
    }
    // Fix agent name "first = X last = Y" format
    const ag = t.fields?.agentPartner1 || '';
    if (/first\s*=/.test(ag)) {
      const first = parseSubField(ag, 'first');
      const last  = parseSubField(ag, 'last');
      t.fields.agentPartner1 = [first, last].filter(Boolean).join(' ') || ag;
      changed = true;
    }
    // Fix client name
    const cl = t.fields?.clientName || '';
    if (/first\s*=/.test(cl)) {
      const first = parseSubField(cl, 'first');
      const last  = parseSubField(cl, 'last');
      t.fields.clientName = [first, last].filter(Boolean).join(' ') || cl;
      changed = true;
    }
    // Listings carry an LC (Listing Coordinator); the TC slot stays blank until
    // the listing goes Under Contract, then belongs to whoever runs the contract.
    if (t.type === 'listing' || t.type === 'listing-uc') {
      if (!t.fields.lcName) { t.fields.lcName = 'Cinnamon Kumler'; changed = true; }
      if (t.type === 'listing' && !t.fields.ucDate && t.fields.tcName === 'Cinnamon Kumler') {
        t.fields.tcName = '';
        changed = true;
      }
    }
  }
  if (changed) await saveData(data);
}

initDB().then(async () => {
  await migrateAddresses();
  server.listen(PORT, () => console.log(`Transaction Hub running on port ${PORT}`));
}).catch(err => { console.error("DB init failed:", err); process.exit(1); });
