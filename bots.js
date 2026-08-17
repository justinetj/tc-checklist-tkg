// AI Assistants (bot tracker) — ported from kumler-hub so it lives on the same
// service as the TC checklist. Pulls live from Follow Up Boss; snapshots go to
// the shared bot_store table, so the history built up in the hub carries over.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pool = null;
export function setBotPool(p) { pool = p; }

const BOT_PATHS = ["/bot-tracker", "/bot-tracker/login", "/api/bots/summary"];
export const isBotPath = pathname => BOT_PATHS.includes(pathname);

// ── Bot tracker access gate ──────────────────────────────────────────────────
// The tracker lists real FUB lead names, so the passcode is checked here rather
// than in the page — on a public URL a client-side check is readable in source.
// BOT_SECRET keeps sessions alive across restarts; without it, a restart just
// means everyone signs in again.
const BOT_PASSCODE = process.env.BOT_PASSCODE || "3315";
const BOT_SECRET = process.env.BOT_SECRET || crypto.randomBytes(32).toString("hex");
const botToken = () => crypto.createHmac("sha256", BOT_SECRET).update(BOT_PASSCODE).digest("hex");
function botAuthed(req) {
  const raw = req.headers.cookie || "";
  const hit = raw.split(";").map(c => c.trim()).find(c => c.startsWith("bt="));
  if (!hit) return false;
  const got = Buffer.from(hit.slice(3));
  const want = Buffer.from(botToken());
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
function botLoginPage(err) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Assistants — The Kumler Group</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Inter',-apple-system,Helvetica,sans-serif; background:#fdfbfe; color:#1c1524; min-height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; padding:30px 20px; }
  .card { background:white; border:1.5px solid #eadef0; border-radius:16px; box-shadow:0 2px 10px rgba(102,24,126,.06); padding:30px 28px; width:100%; max-width:330px; text-align:center; }
  h1 { font-size:16px; font-weight:600; }
  p { font-size:12.5px; color:#8a7d95; margin-top:6px; }
  input { width:100%; margin-top:18px; padding:11px 14px; font-family:inherit; font-size:15px; text-align:center; letter-spacing:.3em; border:1.5px solid #eadef0; border-radius:10px; outline:none; }
  input:focus { border-color:#CB2CFB; }
  button { width:100%; margin-top:12px; padding:11px; font-family:inherit; font-size:13px; font-weight:600; color:white; background:linear-gradient(135deg,#66187E,#CB2CFB); border:0; border-radius:10px; cursor:pointer; }
  .err { margin-top:14px; font-size:12px; font-weight:600; color:#b3005c; }
  .back { display:inline-block; margin-top:22px; font-size:12px; font-weight:600; color:#66187E; text-decoration:none; border:1px solid #eadef0; border-radius:99px; padding:8px 20px; background:white; }
</style></head><body>
<form class="card" method="POST" action="/bot-tracker/login">
  <h1>AI Assistants</h1>
  <p>Enter the passcode to continue.</p>
  <input name="code" type="password" inputmode="numeric" autocomplete="off" autofocus>
  <button type="submit">Continue</button>
  ${err ? '<div class="err">Incorrect passcode.</div>' : ""}
</form>
<a class="back" href="/">← Back</a>
</body></html>`;
}

// ── AI bot tracker (FUB) ─────────────────────────────────────────────────────
// Key comes from the env var if one is set, otherwise from bot_store in the
// database. The database is the deployed path: it saves hand-editing env vars
// on a service where a mistyped key name takes the whole checklist down.
// The local file is the last resort, for running on Justine's Mac.
let fubKeyCache = null;
async function fubKey() {
  if (process.env.FUB_API_KEY) return process.env.FUB_API_KEY;
  if (fubKeyCache) return fubKeyCache;
  try {
    await botDb();
    const r = await pool.query(`SELECT value FROM bot_store WHERE key = 'fubKey'`);
    const v = r.rows[0]?.value;
    const k = typeof v === "string" ? v : v?.key;
    if (k) { fubKeyCache = k; return k; }
  } catch {}
  try {
    const cfg = JSON.parse(fs.readFileSync("/Users/justine/Claude/realtor-lead-guard/config.json", "utf8"));
    return cfg.apiKey || "";
  } catch { return ""; }
}
async function fubGet(p) {
  const auth = "Basic " + Buffer.from((await fubKey()) + ":").toString("base64");
  const r = await fetch("https://api.followupboss.com/v1/" + p, { headers: { Authorization: auth } });
  if (!r.ok) throw new Error("FUB " + r.status);
  return r.json();
}
let botCache = { at: 0, data: null };
let hwUserId = null;
async function getHwUserId() {
  if (hwUserId) return hwUserId;
  const r = await fubGet("users?limit=100&fields=id,name");
  const hw = (r.users || []).find(u => (u.name || "").toLowerCase().includes("house whisper"));
  hwUserId = hw ? hw.id : 68;
  return hwUserId;
}
let botInit;
async function botDb() {
  if (!pool) throw new Error("no database configured");
  if (!botInit) botInit = pool.query(`CREATE TABLE IF NOT EXISTS bot_store (key TEXT PRIMARY KEY, value JSONB NOT NULL)`);
  await botInit;
}
async function botLoad() {
  await botDb();
  const r = await pool.query(`SELECT value FROM bot_store WHERE key = 'snapshots'`);
  return r.rows[0]?.value || {};
}
async function botSave(snaps) {
  await pool.query(`INSERT INTO bot_store (key, value) VALUES ('snapshots', $1)
    ON CONFLICT (key) DO UPDATE SET value = $1`, [JSON.stringify(snaps)]);
}


// Only called for paths isBotPath() claims, so every branch below answers the
// request and the caller does not fall through to its own routing.
export function handleBots(req, res) {
  if (req.url.split("?")[0] === "/bot-tracker/login" && req.method === "POST") {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on("end", () => {
      const code = new URLSearchParams(body).get("code") || "";
      if (code !== BOT_PASSCODE) {
        res.writeHead(401, { "Content-Type": "text/html" });
        return res.end(botLoginPage(true));
      }
      res.writeHead(302, {
        "Set-Cookie": `bt=${botToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${req.headers["x-forwarded-proto"] === "https" ? "; Secure" : ""}`,
        Location: "/bot-tracker",
      });
      res.end();
    });
    return;
  }
  if (req.url.split("?")[0] === "/bot-tracker") {
    if (!botAuthed(req)) {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(botLoginPage(false));
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(fs.readFileSync(path.join(__dirname, "bot-tracker.html")));
  }
  if (req.url.split("?")[0] === "/api/bots/summary") {
    if (!botAuthed(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end('{"error":"unauthorized"}');
    }
    if (botCache.data && Date.now() - botCache.at < 10 * 60 * 1000) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(botCache.data);
    }
    (async () => {
      try {
        const TAGS = { transfer: "hw_transfer_call", intro: "hw_3way_intro", converted: "hw_converted", felix: "FELIX AI HANDOFF" };
        const total = async tag => ((await fubGet("people?tags=" + encodeURIComponent(tag) + "&limit=1&fields=id"))._metadata || {}).total || 0;
        const members = async tag => ((await fubGet("people?tags=" + encodeURIComponent(tag) + "&limit=100&fields=id,name,created,assignedTo&sort=-created")).people || []).map(x => ({ id: x.id, name: x.name || "(no name)", created: x.created, agent: x.assignedTo || "" }));

        const [tTransfer, tIntro, tConverted, tFelix, rTransfer, rIntro, rConverted, rFelix, hwId] = await Promise.all([
          total(TAGS.transfer), total(TAGS.intro), total(TAGS.converted), total(TAGS.felix),
          members(TAGS.transfer), members(TAGS.intro), members(TAGS.converted), members(TAGS.felix), getHwUserId(),
        ]);

        // Real event dates: for HW-tagged leads, the date of their latest answered HW call
        for (const list of [rTransfer, rIntro, rConverted]) {
          for (const m of list) {
            try {
              const cr = await fubGet("calls?personId=" + m.id + "&limit=100");
              const hwCalls = (cr.calls || []).filter(c => c.userId === hwId && (c.duration || 0) > 30);
              m.date = hwCalls.length ? hwCalls[0].created : null;
            } catch { m.date = null; }
          }
        }
        // Felix handoffs: date we first saw the tag (builds going forward)
        try {
          const snaps0 = await botLoad();
          const seen = snaps0.felixSeen || {};
          const firstRun = !snaps0.felixSeen;
          const todayISO2 = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Phoenix" })).toLocaleDateString("en-CA");
          let dirty = false;
          for (const m of rFelix) {
            if (!(m.id in seen)) { seen[m.id] = firstRun ? null : todayISO2; dirty = true; }
            m.date = seen[m.id];
          }
          if (dirty) { snaps0.felixSeen = seen; await botSave(snaps0); }
        } catch { for (const m of rFelix) m.date = null; }

        // Connections: every distinct person carrying any of the three HW tags.
        // The tags overlap heavily — a transferred lead is usually tagged
        // converted too — so the union is deduped by person, and each one
        // carries the routes it came in through.
        const ROUTE = { transfer: "Live transfer", intro: "3-way intro", converted: "Converted" };
        const connMap = new Map();
        for (const [label, list] of [["transfer", rTransfer], ["intro", rIntro], ["converted", rConverted]]) {
          for (const m of list) {
            if (!connMap.has(m.id)) connMap.set(m.id, { name: m.name, agent: m.agent, date: m.date || null, created: m.created, routes: [] });
            const c = connMap.get(m.id);
            c.routes.push(ROUTE[label]);
            if (!c.date && m.date) c.date = m.date;
          }
        }
        const connections = [...connMap.values()]
          .sort((a, b) => String(b.date || b.created || "").localeCompare(String(a.date || a.created || "")))
          .map(({ created, ...c }) => c);
        const tConnections = connections.length;

        // Appointments: set = booked with a bot lead; met = the meeting happened
        const hwIds = new Set([...rTransfer, ...rIntro, ...rConverted].map(m => m.id));
        const felixIds = new Set(rFelix.map(m => m.id));
        const MET = new Set(["Showed Homes", "Signed BBA", "Listing Agreement Signed", "Did Not Sign BBA", "Listing Agreement Not Signed", "Answered Phone Call"]);
        const appts = { hw: { set: 0, met: 0 }, felix: { set: 0, met: 0 } };
        const memberById = new Map();
        for (const m of [...rTransfer, ...rIntro, ...rConverted, ...rFelix]) if (!memberById.has(m.id)) memberById.set(m.id, m);
        const apptLists = { hwSet: [], hwMet: [], felixSet: [], felixMet: [] };
        let apUrl = "appointments?limit=100";
        for (let page = 0; page < 60; page++) {
          const r = await fubGet(apUrl);
          const batch = r.appointments || [];
          for (const a of batch) {
            if ((a.start || a.created || "") < "2026-08-01") continue;
            const pids = (a.invitees || []).map(v => v.personId).filter(Boolean);
            const outcome = typeof a.outcome === "string" ? a.outcome : (a.outcome && a.outcome.name) || "";
            const met = MET.has(outcome);
            const entryFor = pid => { const m = memberById.get(pid); return { name: m ? m.name : "(lead)", agent: m ? m.agent : "", date: a.start || a.created }; };
            const hwPid = pids.find(id => hwIds.has(id));
            if (hwPid !== undefined) { appts.hw.set++; apptLists.hwSet.push(entryFor(hwPid)); if (met) { appts.hw.met++; apptLists.hwMet.push(entryFor(hwPid)); } }
            const fxPid = pids.find(id => felixIds.has(id));
            if (fxPid !== undefined) { appts.felix.set++; apptLists.felixSet.push(entryFor(fxPid)); if (met) { appts.felix.met++; apptLists.felixMet.push(entryFor(fxPid)); } }
          }
          const nxt = (r._metadata || {}).nextLink;
          if (!nxt || !batch.length) break;
          apUrl = nxt.split("/v1/")[1];
        }

        // HW calls back through the start of last week (AZ Mondays)
        const azNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Phoenix" }));
        const mon = new Date(azNow); mon.setHours(0, 0, 0, 0); mon.setDate(mon.getDate() - ((azNow.getDay() + 6) % 7));
        const prevMon = new Date(mon); prevMon.setDate(prevMon.getDate() - 7);
        const nextMon = new Date(mon); nextMon.setDate(nextMon.getDate() + 7);
        // Today's own window, so the top of the card moves day to day.
        const dayStart = new Date(azNow); dayStart.setHours(0, 0, 0, 0);
        const dayNext = new Date(dayStart); dayNext.setDate(dayNext.getDate() + 1);
        const dayPrev = new Date(dayStart); dayPrev.setDate(dayPrev.getDate() - 1);
        // All-time reach-out. The metadata total covers every call on record
        // without paging through them, which is the only affordable way to get
        // a lifetime figure out of six figures' worth of calls.
        let allDials = null;
        try { allDials = ((await fubGet("calls?userId=" + hwId + "&limit=1&fields=id"))._metadata || {}).total ?? null; } catch {}
        let calls = [], truncated = false;
        let callUrl = "calls?userId=" + hwId + "&limit=100";
        for (let page = 0; page < 60; page++) {
          const r = await fubGet(callUrl);
          const batch = r.calls || [];
          calls = calls.concat(batch);
          if (batch.length && new Date(batch[batch.length - 1].created) < prevMon) break;
          const nxt = (r._metadata || {}).nextLink;
          if (!nxt || !batch.length) break;
          callUrl = nxt.split("/v1/")[1];
          if (page === 59) truncated = true;
        }
        const callStats = (a, b) => {
          const cs = calls.filter(c => { const d = new Date(c.created); return d >= a && d < b; });
          const answered = cs.filter(c => (c.duration || 0) > 30);
          return { dials: cs.length, answered: answered.length,
                   engaged: new Set(answered.map(c => c.personId)).size,
                   pickup: cs.length ? Math.round(answered.length / cs.length * 100) : 0 };
        };

        // daily snapshot of tag totals (builds week-over-week trends)
        let weekDelta = null;
        try {
          const snaps = await botLoad();
          const today = azNow.toLocaleDateString("en-CA");
          if (!snaps[today]) { snaps[today] = { transfer: tTransfer, intro: tIntro, converted: tConverted, felix: tFelix, connections: tConnections }; await botSave(snaps); }
          const monISO = mon.toLocaleDateString("en-CA");
          const prevMonISO = prevMon.toLocaleDateString("en-CA");
          const at = iso => { const ks = Object.keys(snaps).filter(k => k <= iso).sort(); return ks.length ? snaps[ks[ks.length - 1]] : null; };
          const sMon = at(monISO), sPrev = at(prevMonISO);
          if (sMon) {
            // Snapshots written before connections existed have no such key, so
            // fall back to the current total for a 0 delta rather than NaN.
            const cAt = s => (s && s.connections !== undefined ? s.connections : tConnections);
            weekDelta = {
              now: { transfer: tTransfer - sMon.transfer, intro: tIntro - sMon.intro, converted: tConverted - sMon.converted, felix: tFelix - sMon.felix, connections: tConnections - cAt(sMon) },
              prev: sPrev && sPrev !== sMon ? { transfer: sMon.transfer - sPrev.transfer, intro: sMon.intro - sPrev.intro, converted: sMon.converted - sPrev.converted, felix: sMon.felix - sPrev.felix, connections: cAt(sMon) - cAt(sPrev) } : null,
            };
          }
        } catch {}

        const payload = JSON.stringify({
          tags: { transfer: tTransfer, intro: tIntro, converted: tConverted, felix: tFelix, connections: tConnections },
          connections,
          recent: { transfer: rTransfer.map(({id, ...m}) => m), intro: rIntro.map(({id, ...m}) => m), converted: rConverted.map(({id, ...m}) => m), felix: rFelix.map(({id, ...m}) => m) },
          calls: { today: callStats(dayStart, dayNext), yesterday: callStats(dayPrev, dayStart), thisWeek: callStats(mon, nextMon), lastWeek: callStats(prevMon, mon), allDials, truncated },
          appts,
          apptLists,
          weekDelta,
          weekLabel: mon.toLocaleDateString("en-US", { month: "numeric", day: "numeric" }) + " - " + new Date(nextMon.getTime() - 864e5).toLocaleDateString("en-US", { month: "numeric", day: "numeric" }),
        });
        botCache = { at: Date.now(), data: payload };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(payload);
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }
}
