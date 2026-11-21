"use strict";
// 骨折カード：骨折アシストのデータを暗記カードにして、間隔反復（忘れかけた頃に再出題）で回す。
// 学習記録はこの端末の localStorage にだけ保存する（送信しない）。

const VERSION = "2026-11-21";
const KEY = "fc-state-v1";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let CARDS = [];
let S = { cards: {}, newPerDay: 10, newDay: -1, newCount: 0, group: "全部", bone: "" };
let queue = [];        // 今回のセッションで出す順番（カードID）
let flipped = false;

// ---- 保存（プライベートモード等で使えなくても動くように try/catch） ----
function load() {
  try { const v = JSON.parse(localStorage.getItem(KEY)); if (v) S = Object.assign(S, v); } catch (e) {}
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
}
function today() {
  const d = new Date();
  return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
}

// ---- 出題の順番 ----
function inFilter(c) {
  if (S.group !== "全部" && c.group !== S.group) return false;
  if (S.bone && c.bone_id !== S.bone) return false;
  return true;
}
function newLeft() {
  if (S.newDay !== today()) { S.newDay = today(); S.newCount = 0; }
  return Math.max(0, S.newPerDay - S.newCount);
}
function buildQueue(extraNew = 0) {
  const t = today();
  const pool = CARDS.filter(inFilter);
  const due = pool.filter((c) => S.cards[c.id] && S.cards[c.id].due <= t)
    .sort((a, b) => S.cards[a.id].due - S.cards[b.id].due);
  const fresh = pool.filter((c) => !S.cards[c.id]).slice(0, newLeft() + extraNew);
  queue = due.map((c) => c.id).concat(fresh.map((c) => c.id));
}

// 採点 → 次に出す日を決める
function rate(id, r) {
  const t = today();
  const st = S.cards[id];
  const isNew = !st;
  const s = st || { ivl: 0, reps: 0, lapses: 0, due: t };
  if (isNew) S.newCount++;
  if (r === "again") {
    s.ivl = 0; s.lapses++; s.due = t;
    // 同じセッションの3枚あとにもう一度出す
    queue.splice(Math.min(3, queue.length), 0, id);
  } else if (r === "hard") {
    s.ivl = s.ivl ? Math.max(1, Math.round(s.ivl * 1.2)) : 1;
    s.due = t + s.ivl;
  } else {
    s.ivl = s.ivl ? Math.min(180, Math.round(s.ivl * 2.5)) : 3;
    s.due = t + s.ivl;
  }
  s.reps++;
  S.cards[id] = s;
  save();
}

// ---- 表示部品 ----
function badges(c) {
  let h = "";
  if (c.weak === "unverified") h += '<span class="badge unverified">未確認</span>';
  if (c.weak === "rough") h += '<span class="badge rough">目安</span>';
  if (c.new) h += '<span class="badge new">追加</span>';
  return h;
}
function mainAnswer(c) {
  if (c.cons && c.cons.duration) return { k: "固定期間（保存）", v: c.cons.duration };
  if (c.surg) return { k: "手術が基本（時期）", v: "手術：" + (c.surg.timing || "—") };
  return { k: "方針", v: c.standard };
}
function kv(k, v) { return v ? `<div class="kv"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>` : ""; }
function list(items) { return items && items.length ? `<ul class="plain">${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""; }

function answerHTML(c) {
  const m = mainAnswer(c);
  let h = `<div class="big"><div class="k">${badges(c)}${esc(m.k)}</div><div class="v">${esc(m.v)}</div></div>`;
  if (c.cons) {
    h += kv("固定の方法", c.cons.method);
    h += kv("範囲・肢位", c.cons.range_position);
  }
  h += kv("基本方針", c.standard);
  if (c.followup && c.followup.length) {
    h += `<div class="kv"><div class="k">その後（受診・X線・リハ）</div><ul class="tl">${c.followup.map((f) =>
      `<li><span class="when">${esc(f.when)}</span><span>${esc(f.what)}</span></li>`).join("")}</ul></div>`;
  }
  if (c.bg && c.bg.length) {
    h += `<div class="kv"><div class="k">患者背景で変わること</div><ul class="tl">${c.bg.map((b) =>
      `<li><span class="when">${esc(b.who)}</span><span>${esc(b.plan)}</span></li>`).join("")}</ul></div>`;
  }
  if (c.cons && (c.cons.indication || c.cons.notes)) {
    h += `<details><summary>保存の適応・注意</summary>${kv("適応", c.cons.indication)}${kv("注意", c.cons.notes)}</details>`;
  }
  if (c.surg) {
    h += `<details><summary>手術適応・術式</summary><div class="kv"><div class="k">適応</div>${list(c.surg.indication)}</div>`
      + `<div class="kv"><div class="k">術式</div>${list(c.surg.options)}</div>${kv("時期", c.surg.timing)}</details>`;
  }
  if (c.pitfalls && c.pitfalls.length) h += `<details><summary>落とし穴</summary>${list(c.pitfalls)}</details>`;
  return h;
}

// ---- 学習画面 ----
function renderCounts() {
  const t = today();
  const pool = CARDS.filter(inFilter);
  const learned = pool.filter((c) => S.cards[c.id]).length;
  const dueN = queue.filter((id) => S.cards[id]).length;
  const newN = queue.length - dueN;
  $("#counts").innerHTML = `残り <b>${queue.length}</b> 枚（復習 ${dueN}・新規 ${newN}）／ 学習済み ${learned} / ${pool.length} 枚`;
}
function renderStage() {
  renderCounts();
  const id = queue[0];
  if (!id) {
    const pool = CARDS.filter(inFilter);
    const unseen = pool.filter((c) => !S.cards[c.id]).length;
    const next = pool.map((c) => S.cards[c.id]).filter(Boolean).map((s) => s.due).sort((a, b) => a - b)[0];
    const nextTxt = next != null ? `次の復習は${next - today() <= 0 ? "今日" : (next - today()) + "日後"}。` : "";
    $("#stage").innerHTML = `<div class="card done"><p><b>今日の分は終わりました。</b></p><p>${nextTxt}${unseen ? `まだ出ていないカードが ${unseen} 枚あります。` : ""}</p>`
      + (unseen ? `<button id="more" type="button">新しいカードをあと5枚</button>` : "") + `</div>`;
    const more = $("#more");
    if (more) more.onclick = () => { buildQueue(5); flipped = false; renderStage(); };
    return;
  }
  const c = CARDS.find((x) => x.id === id);
  const st = S.cards[id];
  const tag = st ? (st.lapses ? `復習（忘れた ${st.lapses}回）` : "復習") : "新規";
  let h = `<div class="card"><div class="crumb">${esc(c.group)} ＞ ${esc(c.bone)} ・ ${tag}</div>`
    + `<div class="title">${esc(c.name)}</div>`
    + `<details><summary>病型の見分け方を見る</summary><p>${esc(c.criteria)}</p></details>`;
  if (!flipped) {
    h += `<div class="ask">固定の方法・期間は？ その後（シーネ／装具・リハ・荷重）は？</div></div>`
      + `<div class="btns"><button class="show" id="show" type="button">答えを見る</button></div>`;
  } else {
    h += `<div><span class="badge urg">${esc(c.urgency)}</span></div>${answerHTML(c)}</div>`
      + `<div class="btns"><button class="again" data-r="again">忘れた<small>すぐ再出題</small></button>`
      + `<button class="hard" data-r="hard">あやふや<small>明日</small></button>`
      + `<button class="good" data-r="good">覚えた<small>${st && st.ivl ? Math.min(180, Math.round(st.ivl * 2.5)) : 3}日後</small></button></div>`;
  }
  $("#stage").innerHTML = h;
  if (!flipped) $("#show").onclick = () => { flipped = true; renderStage(); };
  else document.querySelectorAll(".btns [data-r]").forEach((b) => b.onclick = () => {
    rate(id, b.dataset.r);
    queue.shift(); // 先頭＝今のカードを外す（「忘れた」の再出題分は rate() で3番目以降に差し込み済み）
    flipped = false;
    renderStage();
    window.scrollTo({ top: 0 });
  });
}
function renderFilters() {
  const groups = ["全部", "上肢", "下肢", "体幹"];
  $("#groups").innerHTML = groups.map((g) => `<button data-g="${g}" class="${S.group === g ? "on" : ""}">${g}</button>`).join("");
  document.querySelectorAll("#groups button").forEach((b) => b.onclick = () => {
    S.group = b.dataset.g; S.bone = ""; save(); renderFilters(); buildQueue(); flipped = false; renderStage();
  });
  const bones = [];
  CARDS.forEach((c) => { if ((S.group === "全部" || c.group === S.group) && !bones.find((b) => b.id === c.bone_id)) bones.push({ id: c.bone_id, name: c.bone }); });
  $("#bone").innerHTML = `<option value="">すべての骨</option>` + bones.map((b) => `<option value="${esc(b.id)}" ${S.bone === b.id ? "selected" : ""}>${esc(b.name)}</option>`).join("");
  $("#bone").onchange = (e) => { S.bone = e.target.value; save(); buildQueue(); flipped = false; renderStage(); };
}

// ---- 早見表 ----
function renderList() {
  const q = $("#q").value.trim().toLowerCase();
  const hit = CARDS.filter((c) => !q || (c.bone + c.name + c.criteria + (c.cons ? c.cons.method : "")).toLowerCase().includes(q));
  let h = "", last = "";
  hit.forEach((c) => {
    if (c.bone !== last) { h += `<div class="bonehead">${esc(c.bone)}</div>`; last = c.bone; }
    const m = mainAnswer(c);
    h += `<details class="row"><summary><span class="nm">${esc(c.name)}</span><span class="du">${badges(c)}${esc(m.v)}</span></summary>`
      + `<div class="body">${answerHTML(c)}</div></details>`;
  });
  $("#rows").innerHTML = h || `<p class="crumb">該当なし</p>`;
}

// ---- 設定 ----
function renderSettings() {
  $("#newPerDay").value = String(S.newPerDay);
  const learned = Object.keys(S.cards).length;
  const mastered = Object.values(S.cards).filter((s) => s.ivl >= 21).length;
  $("#progress").textContent = `学習済み ${learned} / ${CARDS.length} 枚（うち3週間以上の間隔まで覚えた ${mastered} 枚）`;
}

function showTab(t) {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
  ["study", "list", "settings"].forEach((s) => $("#" + s).hidden = s !== t);
  if (t === "list") renderList();
  if (t === "settings") renderSettings();
  if (t === "study") { buildQueue(); flipped = false; renderStage(); }
  window.scrollTo({ top: 0 });
}

async function init() {
  load();
  $("#ver").textContent = `版 ${VERSION}`;
  try {
    const r = await fetch("data/cards.json");
    CARDS = await r.json();
  } catch (e) {
    $("#stage").innerHTML = `<div class="card">データを読み込めませんでした。電波のある所で一度開いてください。</div>`;
    return;
  }
  document.querySelectorAll("#tabs button").forEach((b) => b.onclick = () => showTab(b.dataset.tab));
  $("#q").oninput = renderList;
  $("#newPerDay").onchange = (e) => { S.newPerDay = Number(e.target.value); save(); renderSettings(); };
  $("#resetAll").onclick = () => {
    if (confirm("学習記録をすべて消して最初からやり直しますか？（元に戻せません）")) {
      S.cards = {}; S.newCount = 0; save(); renderSettings();
    }
  };
  renderFilters();
  buildQueue();
  renderStage();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}
init();
