// Monthly Group Meetings — agents pick their name, then a date. A date disappears once it
// reaches the cap. Seat counting happens on the server inside the hub's
// serialized write queue, so two agents taking the last seat at the same moment
// cannot both succeed. A choice is final; only Operations can undo one.
const ROSTER = ["Akanksha Tomar", "Angela Massey", "Annie Clark", "Arielle Jaime", "Ashleigh DiFilippantonio", "Ashton Kaufman", "Benjamin Veader", "Brandi Romero", "Brittany Abrams", "Cierra Farrow-Boyle", "Crystal Martinez", "Darlena Barley", "Dennis Sadberry", "Donica Sadberry", "Hector Torres", "India Blackshear", "Jenny Cohen", "Jessenia Zinner", "Josh Valead", "Joyce Mireault", "Kahila White", "Keith Glass", "Kira Warrens", "Kye Mingus", "Kyle Olson", "Lake Porter", "Leah Hawkins", "Michael Tarver", "Prakash Agrawal", "Sara Daly", "Thomas Doheny", "Time Isufi"];

const MEET_PATHS = ["/meetings", "/api/meetings/signup", "/api/meetings/remove", "/api/meetings/config"];
export const isMeetingPath = p => MEET_PATHS.includes(p);
export const rosterNames = () => ROSTER.slice();

export function normalize(m) {
  return {
    cap: Number(m?.cap) > 0 ? Number(m.cap) : 9,
    dates: Array.isArray(m?.dates) ? m.dates : [],
    signups: m?.signups && typeof m.signups === "object" ? m.signups : {},
  };
}

// Only current agents' bookings leave the server. A departed agent's row can
// linger in storage, and it should not travel to the browser in the page source.
export function rosterSignups(m) {
  const onRoster = new Set(ROSTER);
  const out = {};
  for (const [agent, dateId] of Object.entries(m.signups || {})) if (onRoster.has(agent)) out[agent] = dateId;
  return out;
}

export function tally(m) {
  const out = {};
  const onRoster = new Set(ROSTER);
  for (const d of m.dates) out[d.id] = [];
  // A seat belongs to a current agent. Someone taken off the roster frees theirs
  // automatically, so a departure does not leave a ghost booking behind.
  for (const [agent, dateId] of Object.entries(m.signups)) if (out[dateId] && onRoster.has(agent)) out[dateId].push(agent);
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.localeCompare(b));
  return out;
}

const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

export function whenLabel(d) {
  if (!d?.iso) return "";
  const dt = new Date(d.iso + "T12:00:00");
  const day = dt.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  if (!d.time) return day;
  const [h, mm] = d.time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return day + " · " + h12 + ":" + String(mm).padStart(2, "0") + " " + ampm;
}

export function meetingsHTML(m, isAdmin) {
  const t = tally(m);
  const taken = id => (t[id] || []).length;
  // Agents only see dates with room left; a full date is gone for them.
  const visible = m.dates.filter(d => isAdmin || taken(d.id) < m.cap);
  const cards = visible.map(d => {
    const n = taken(d.id), full = n >= m.cap;
    return `<div class="date${full ? " full" : ""}">
      <div class="d-when">${esc(whenLabel(d))}</div>
      ${isAdmin ? `<div class="d-seats">${full ? "Full" : (m.cap - n) + " of " + m.cap + " seats left"}</div>` : ""}
      ${full ? "" : `<button class="pick" onclick="pick('${d.id}')">Take a seat</button>`}
      ${isAdmin ? `<div class="who">${n ? (t[d.id] || []).map(nm => `<div class="w"><span>${esc(nm)}</span><button class="x" title="Remove" onclick="removeAgent('${esc(nm)}')">&times;</button></div>`).join("") : "<div class='none'>nobody yet</div>"}</div>` : ""}
    </div>`;
  }).join("");

  const unsigned = ROSTER.filter(n => !m.signups[n]);

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Monthly Group Meetings — The Kumler Group</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 100 100%27><circle cx=%2750%27 cy=%2750%27 r=%2748%27 fill=%27%23CB2CFB%27/><path d=%27M30 52 44 66 70 36%27 stroke=%27white%27 stroke-width=%279%27 fill=%27none%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/></svg>">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Inter',-apple-system,Helvetica,sans-serif; background:#fdfbfe; color:#1c1524; padding:30px 16px 60px; }
  .wrap { max-width:760px; margin:0 auto; }
  .logo { text-align:center; }
  .logo img { max-width:min(280px,74vw); height:auto; }
  h1 { text-align:center; font-size:21px; font-weight:600; margin-top:14px; }
  .sub { text-align:center; font-size:13px; color:#7a6d85; margin:6px 0 4px; }
  .step { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.1em; color:#b3a6bf; margin:26px 0 8px; }
  select { width:100%; max-width:330px; border:1.5px solid #e4d9ec; border-radius:10px; padding:12px 14px; font-size:15px; font-family:inherit; background:white; color:#1c1524; outline:none; appearance:none; cursor:pointer;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%2366187E' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); background-repeat:no-repeat; background-position:right 13px center; background-size:11px; padding-right:34px; }
  select:focus { border-color:#CB2CFB; }
  .dates { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .date { background:white; border:1.5px solid #eadef0; border-radius:14px; padding:16px 18px; box-shadow:0 2px 10px rgba(102,24,126,.05); transition:border-color .14s ease, box-shadow .14s ease; }
  .date:hover { border-color:#CB2CFB; box-shadow:0 4px 14px rgba(203,44,251,.13); }
  .date.full { opacity:.55; }
  .d-when { font-size:14.5px; font-weight:600; line-height:1.35; }
  .d-seats { font-size:12px; color:#8a7d95; margin-top:4px; }
  .pick { margin-top:13px; width:100%; padding:10px; border:0; border-radius:9px; font-family:inherit; font-size:13px; font-weight:600; color:white; background:linear-gradient(135deg,#66187E,#CB2CFB); cursor:pointer; }
  .booked { background:#faf0fe; border:1.5px solid #CB2CFB; border-radius:12px; padding:15px 17px; margin-top:12px; font-size:13.5px; line-height:1.5; }
  .booked b { color:#66187E; }
  .booked .fine { display:block; margin-top:5px; font-size:12px; color:#8a7d95; }
  .who { margin-top:12px; border-top:1px solid #f3ecf7; padding-top:8px; }
  .who .w { display:flex; justify-content:space-between; align-items:center; font-size:12.5px; padding:3px 0; }
  .who .x { background:none; border:0; color:#c3b5cd; cursor:pointer; font-size:16px; line-height:1; }
  .who .x:hover { color:#b3005c; }
  .who .none { font-size:12px; color:#c3b5cd; }
  .admin { background:white; border:1.5px solid #eadef0; border-radius:14px; padding:18px; margin-top:26px; }
  .admin h2 { font-size:13px; font-weight:600; }
  .admin p { font-size:12px; color:#8a7d95; margin-top:3px; }
  .admin label { font-size:11.5px; font-weight:600; color:#4a4453; display:block; margin:12px 0 3px; }
  .admin textarea, .admin input { width:100%; border:1.5px solid #e4d9ec; border-radius:9px; padding:9px 12px; font-family:inherit; font-size:13.5px; outline:none; }
  .admin button { margin-top:12px; padding:10px 20px; border:0; border-radius:9px; font-family:inherit; font-size:13px; font-weight:600; color:white; background:#66187E; cursor:pointer; }
  .pending { margin-top:14px; font-size:12.5px; color:#8a7d95; line-height:1.7; }
  .pending b { color:#1c1524; font-weight:600; }
  .footnote { text-align:center; font-size:12px; color:#a99bb5; margin-top:22px; line-height:1.6; }
  .msg { text-align:center; font-size:13px; font-weight:600; color:#b3005c; margin-top:14px; min-height:18px; }
  .empty { text-align:center; color:#a99bb5; font-size:13px; padding:26px 0; background:white; border:1.5px solid #eadef0; border-radius:14px; }
  .backrow { text-align:center; margin-top:30px; }
  .done-card { background:white; border:1.5px solid #CB2CFB; border-radius:16px; box-shadow:0 6px 26px rgba(203,44,251,.16); padding:34px 26px; text-align:center; margin-top:10px; }
  .done-card .tick { width:52px; height:52px; margin:0 auto 14px; border-radius:50%; background:linear-gradient(135deg,#66187E,#CB2CFB); color:white; font-size:26px; line-height:52px; }
  .done-card h2 { font-size:19px; font-weight:600; }
  .done-card .dn-name { font-size:14px; color:#8a7d95; margin-top:8px; }
  .done-card .dn-when { font-size:17px; font-weight:600; color:#66187E; margin-top:4px; }
  .done-card .dn-callout { margin-top:20px; background:#faf0fe; border:1.5px solid #e8c8f7; border-radius:12px; padding:16px 18px; }
  .done-card .dn-callout p { font-size:15px; color:#3d3547; line-height:1.55; margin:0; }
  .done-card .dn-callout p + p { margin-top:8px; }
  .done-card .dn-callout b { color:#66187E; font-weight:700; }
  .done-card .dn-fine { font-size:12px; color:#a99bb5; margin-top:10px; }
  .cf-wrap { position:fixed; inset:0; background:rgba(28,21,36,.34); backdrop-filter:blur(2px); display:none; align-items:center; justify-content:center; padding:20px; z-index:60; }
  .cf { background:white; border:1.5px solid #eadef0; border-radius:16px; box-shadow:0 18px 50px rgba(102,24,126,.22); padding:26px 24px; width:100%; max-width:330px; text-align:center; }
  .cf h2 { font-size:15px; font-weight:600; }
  .cf p { font-size:13.5px; color:#4a4453; margin-top:10px; line-height:1.5; }
  .cf p b { color:#66187E; font-size:14.5px; }
  .cf .warn { font-size:12px; color:#8a7d95; margin-top:8px; }
  .cf .go { width:100%; margin-top:16px; padding:11px; border:0; border-radius:9px; font-family:inherit; font-size:13px; font-weight:600; color:white; background:linear-gradient(135deg,#66187E,#CB2CFB); cursor:pointer; }
  .cf .no { width:100%; margin-top:9px; padding:9px; border:0; background:none; font-family:inherit; font-size:12.5px; font-weight:500; color:#8a7d95; cursor:pointer; }
  .backrow a { font-size:12px; font-weight:600; color:#66187E; text-decoration:none; border:1px solid #eadef0; border-radius:99px; padding:8px 20px; background:white; }
</style></head><body>
<div class="wrap">
  <div class="logo"><img src="/logo.png" alt="The Kumler Group"></div>
  <h1>Monthly Group Meetings</h1>
  <div class="sub">Pick your name, then choose a date.</div>

  <div id="booking">
  <div class="step">Step 1 — your name</div>
  <select id="agent" onchange="nameChanged()">
    <option value="">Select your name…</option>
    ${ROSTER.map(n => `<option>${esc(n)}</option>`).join("")}
  </select>
  <div id="booked"></div>

  <div class="step">Step 2 — choose a date</div>
  ${visible.length ? `<div class="dates">${cards}</div>` : "<div class='empty'>Every date is full.</div>"}
  <div class="msg" id="msg"></div>
  </div>

  <div id="done" style="display:none">
    <div class="done-card">
      <div class="tick">&#10003;</div>
      <h2>You&rsquo;re booked</h2>
      <p class="dn-name" id="dn-who"></p>
      <p class="dn-when" id="dn-when"></p>
      <div class="dn-callout">
        <p>These meetings repeat <b>monthly</b>.</p>
        <p>Your <b>calendar invite will be sent separately</b> &mdash; watch your email.</p>
      </div>
    </div>
  </div>

  ${isAdmin ? `<div class="admin">
    <h2>Admin</h2>
    <p>One line per date: <code>YYYY-MM-DD HH:MM</code> in 24-hour time. Removing a line frees its seats.</p>
    <label>Dates</label>
    <textarea id="cfg-dates" rows="6">${esc(m.dates.map(d => d.iso + (d.time ? " " + d.time : "")).join("\n"))}</textarea>
    <label>Seats per date</label>
    <input id="cfg-cap" type="number" min="1" value="${m.cap}">
    <button onclick="saveCfg()">Save</button>
    <div class="pending">Not signed up yet (<b>${unsigned.length}</b> of ${ROSTER.length}): ${unsigned.length ? esc(unsigned.join(", ")) : "everyone is in"}</div>
  </div>` : ""}

  ${isAdmin ? `<div class="backrow"><a href="/">← Back</a></div>` : ""}
</div>
<div class="cf-wrap" id="confirm">
  <div class="cf">
    <h2>Confirm your seat</h2>
    <p><b id="cf-who"></b><br><span id="cf-when"></span></p>
    <p class="warn">You will get a monthly calendar invite for this!</p>
    <button class="go" onclick="doBook()">Book it</button>
    <button class="no" onclick="cancelBook()">Cancel</button>
  </div>
</div>
<script>
const SIGNUPS = ${JSON.stringify(rosterSignups(m))};
const LABELS = ${JSON.stringify(Object.fromEntries(m.dates.map(d => [d.id, whenLabel(d)])))};
const $ = id => document.getElementById(id);
let PENDING = null;
function nameChanged() {
  const who = $("agent").value, has = SIGNUPS[who];
  $("booked").innerHTML = has
    ? '<div class="booked">You are booked for <b>' + (LABELS[has] || "a date") + '</b>.<span class="fine">Need to change it? Ask the DOO — sign-ups are final once made.</span></div>'
    : "";
  $("msg").textContent = "";
}
async function post(path, body) {
  const r = await fetch(path + location.search, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: r.ok, data: await r.json().catch(() => ({})) };
}
async function pick(dateId) {
  const who = $("agent").value;
  if (!who) { $("msg").textContent = "Pick your name first."; return; }
  if (SIGNUPS[who]) { $("msg").textContent = "You are already booked."; return; }
  PENDING = dateId;
  $("cf-who").textContent = who;
  $("cf-when").textContent = LABELS[dateId] || "this date";
  $("confirm").style.display = "flex";
}
async function doBook() {
  const who = $("agent").value;
  $("confirm").style.display = "none";
  const { ok, data } = await post("/api/meetings/signup", { agent: who, dateId: PENDING });
  if (!ok) { $("msg").textContent = data.error || "That did not work."; setTimeout(() => location.reload(), 1200); return; }
  $("dn-who").textContent = who;
  $("dn-when").textContent = LABELS[PENDING] || "your date";
  $("booking").style.display = "none";
  $("done").style.display = "";
}
function cancelBook() { $("confirm").style.display = "none"; PENDING = null; }
async function removeAgent(name) {
  if (!confirm("Remove " + name + " from their date?")) return;
  await post("/api/meetings/remove", { agent: name });
  location.reload();
}
async function saveCfg() {
  const dates = $("cfg-dates").value.split(String.fromCharCode(10)).map(s => s.trim()).filter(Boolean);
  const cap = parseInt($("cfg-cap").value, 10);
  const { ok, data } = await post("/api/meetings/config", { dates, cap });
  if (!ok) { $("msg").textContent = data.error || "Could not save."; return; }
  location.reload();
}
</script>
</body></html>`;
}
