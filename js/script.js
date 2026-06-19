// =======================================================================
//  お天気グランス（東京・6区） / script.js  ―  Open-Meteo 予報API（APIキー不要）
//  -----------------------------------------------------------------------
//  見やすさ最優先：区はボタン選択（6区）。色は「意味のある軸（気温・降水・曜日）」だけ。
//  気温と降水確率は折れ線グラフ。上段は◀▶/スワイプで 昨日↔今日↔翌日… と日替え。
//
//  STEP番号＝プログラムが実際に動く順番。index.html STEP 08 から続く。
//    STEP 09〜13  部品（天気ラベル／日付関数／色／6区座標）
//    STEP 14      起動：区ボタン生成＋日替えナビ（◀▶/スワイプ）の登録／初期表示
//    STEP 15〜22  loadWeather（区→緯度経度→予報取得→週間と当日を描画）
//    STEP 23      changeDay：日を1つ進める/戻す（再取得せず保持データで描き直し）
//    STEP 24      renderDay：選択中の日の上段＋チャートを描く
//    STEP 25      buildDayChart：気温/降水確率の折れ線（SVG）
//    STEP 26      renderWeek：週間（今日起点・固定）   STEP 27 catch
// =======================================================================


// STEP 09 | 部品：天気コード(WMO) → 日本語ラベル（t=詳しい / s=短い）
const WEATHER = {
  0:{t:"快晴",s:"快晴"}, 1:{t:"晴れ",s:"晴"}, 2:{t:"くもり時々晴れ",s:"曇"}, 3:{t:"くもり",s:"曇"},
  45:{t:"霧",s:"霧"}, 48:{t:"霧氷",s:"霧"},
  51:{t:"弱い霧雨",s:"雨"}, 53:{t:"霧雨",s:"雨"}, 55:{t:"強い霧雨",s:"雨"},
  56:{t:"着氷性の霧雨",s:"雨"}, 57:{t:"着氷性の霧雨",s:"雨"},
  61:{t:"弱い雨",s:"雨"}, 63:{t:"雨",s:"雨"}, 65:{t:"強い雨",s:"大雨"},
  66:{t:"着氷性の雨",s:"雨"}, 67:{t:"着氷性の雨",s:"雨"},
  71:{t:"弱い雪",s:"雪"}, 73:{t:"雪",s:"雪"}, 75:{t:"強い雪",s:"大雪"}, 77:{t:"雪あられ",s:"雪"},
  80:{t:"にわか雨",s:"雨"}, 81:{t:"にわか雨",s:"雨"}, 82:{t:"激しいにわか雨",s:"大雨"},
  85:{t:"にわか雪",s:"雪"}, 86:{t:"強いにわか雪",s:"雪"},
  95:{t:"雷雨",s:"雷"}, 96:{t:"雷雨（ひょう）",s:"雷"}, 99:{t:"雷雨（ひょう）",s:"雷"},
};
function wx(code) { return WEATHER[code] || { t: "不明", s: "—" }; }

// STEP 10 | 部品：曜日テーブル＋日付/時刻の関数
const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
function dayLabel(s)  { return WEEK[new Date(s).getDay()]; }
function dateLabel(s) { const d = new Date(s); return (d.getMonth() + 1) + "月" + d.getDate() + "日"; }
function hourLabel(s) { return new Date(s).getHours() + "時"; }
function mdLabel(s)   { const d = new Date(s); return (d.getMonth() + 1) + "/" + d.getDate(); }
function pad2(n)      { return (n < 10 ? "0" : "") + n; }
function r(n) { return Math.round(n); }

// STEP 11 | 部品：色の関数（意味のある軸だけ）
function tempColor(t) {
  if (t <= 4)  return "#3a67a8"; if (t <= 9)  return "#4a90d9"; if (t <= 14) return "#37a3a3";
  if (t <= 19) return "#5aa86a"; if (t <= 23) return "#e0b13c"; if (t <= 27) return "#e8902c";
  if (t <= 31) return "#e8643c"; return "#d83a2a";
}
function precipColor(p) {
  if (p >= 80) return "#1b5a96"; if (p >= 50) return "#2b6fb0";
  if (p >= 20) return "#5a97cf"; return "#9bb8d4";
}
function dowColor(s) {
  const d = new Date(s).getDay(); return d === 0 ? "#c0392b" : d === 6 ? "#2b6fb0" : "#1a1a1a";
}
function wxColor(code) {
  if (code === 0 || code === 1) return "#e8902c";
  if (code === 95 || code === 96 || code === 99) return "#7a5bb0";
  if ([71,73,75,77,85,86].indexOf(code) >= 0) return "#5aa0d6";
  if ([45,48].indexOf(code) >= 0) return "#9098a0";
  if (code >= 51) return "#2b6fb0";
  return "#7a7a7a";
}

// STEP 12 | 部品：状態メッセージ表示（→ index.html STEP 04）
function setStatus(msg, isError) { $("#status").text(msg || "").toggleClass("is-error", !!isError); }

// STEP 13 | 部品：選べる6区の座標 [緯度,経度]（指定順）＋前回の区を記憶
const WARDS = {
  "千代田区":[35.6940,139.7536], "中央区":[35.6707,139.7720], "豊島区":[35.7263,139.7161],
  "新宿区":[35.6938,139.7036],   "渋谷区":[35.6640,139.6982], "品川区":[35.6092,139.7301],
};
const WARD_KEY = "weather_tokyo_ward";
function loadWard() { return localStorage.getItem(WARD_KEY) || "新宿区"; }
function saveWard(name) { localStorage.setItem(WARD_KEY, name); }

// 取得した天気データと、表示中の日（offset）を保持する箱（再取得せず日替えするため）
let DATA = null;        // APIの戻り（current/hourly/daily）
let TODAY_IDX = 0;      // daily配列の中で「今日」が何番目か
let OFFSET = 0;         // 表示中の日（0=今日 / +1=明日 / -1=昨日 …）
let MIN_OFFSET = 0, MAX_OFFSET = 0;   // 行ける範囲（昨日〜6日先）


// STEP 14 |【実行の入口】DOM準備完了で起動（呼び出し元：index.html STEP 08）
$(function () {
  // 14-a｜6区の選択ボタンを作る（→ index.html STEP 03b。ラベルは「区」を省いて短く）
  $("#wards").html(Object.keys(WARDS).map(function (n) {
    return '<button type="button" class="ward-btn" data-ward="' + n + '">' + n.replace("区", "") + '</button>';
  }).join(""));

  // 14-b｜区ボタン：押したらその区の天気を取り直す → STEP 15
  $("#wards").on("click", ".ward-btn", function () { selectWard($(this).data("ward")); });

  // 14-c｜日替えナビ：◀=前日 / ▶=翌日 → STEP 23
  $("#prevDay").on("click", function () { changeDay(-1); });
  $("#nextDay").on("click", function () { changeDay(1); });

  // 14-d｜スワイプでも日替え（#today上で左右）：左→翌日 / 右→前日
  let sx = null;
  $("#today").on("touchstart", function (e) { sx = e.originalEvent.touches[0].clientX; });
  $("#today").on("touchend", function (e) {
    if (sx === null) return;
    const dx = e.originalEvent.changedTouches[0].clientX - sx; sx = null;
    if (dx < -40) changeDay(1); else if (dx > 40) changeDay(-1);
  });

  // 14-e｜前回の区を選択して初期表示
  selectWard(loadWard());
});

// 14-f｜区を選ぶ：ボタンの選択状態を切替えて天気取得（loadWeather＝STEP 15）
function selectWard(ward) {
  $(".ward-btn").removeClass("is-active");
  $('.ward-btn[data-ward="' + ward + '"]').addClass("is-active");
  loadWeather(ward);
}


// =======================================================================
//  loadWeather：区 → 天気を取得 → 週間と当日を描画（STEP 15〜22／27）
// =======================================================================
async function loadWeather(ward) {
  // STEP 15 | 「取得中…」（setStatus＝STEP 12）
  setStatus("取得中…", false);
  try {
    // STEP 16 | 区 → 緯度経度（内蔵リスト WARDS＝STEP 13。通信なしで即決定）
    const pos = WARDS[ward] || WARDS["新宿区"];
    const lat = pos[0], lon = pos[1];

    // STEP 18 | この区を記憶（次回すぐ表示。saveWard＝STEP 13）
    saveWard(ward);

    // STEP 19 | 予報API：昨日(past_days=1)＋今日から7日。hourlyに体感/湿度/風も（日替えで使う）
    const url = "https://api.open-meteo.com/v1/forecast"
      + "?latitude=" + lat + "&longitude=" + lon
      + "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m"
      + "&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation_probability"
      + "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"
      + "&wind_speed_unit=ms&timezone=auto&past_days=1&forecast_days=7";
    DATA = await (await fetch(url)).json();

    // 「今日」がdaily配列の何番目か／行ける範囲（昨日〜6日先）を計算
    const todayStr = DATA.current.time.slice(0, 10);     // "2026-06-19"
    TODAY_IDX = DATA.daily.time.indexOf(todayStr);
    if (TODAY_IDX < 0) TODAY_IDX = 0;
    MIN_OFFSET = -TODAY_IDX;                              // 通常 -1（昨日）
    MAX_OFFSET = DATA.daily.time.length - 1 - TODAY_IDX;  // 通常 +6
    OFFSET = 0;                                          // まずは今日

    renderWeek();   // STEP 20 →（本体 STEP 26）週間（今日起点・固定）
    renderDay();    // STEP 21 →（本体 STEP 24）選択中の日（最初は今日）

    // STEP 22 | 表示してメッセージを消す
    $("#today, #week").prop("hidden", false);
    setStatus("", false);
  } catch (error) {
    // STEP 27 | 通信エラー
    console.log(error);
    setStatus("天気の取得に失敗しました。通信環境を確認して再度お試しください。", true);
  }
}


// STEP 23 | changeDay：表示する日を delta だけ動かす（範囲内なら描き直し。再取得しない）
function changeDay(delta) {
  if (!DATA) return;
  const next = OFFSET + delta;
  if (next < MIN_OFFSET || next > MAX_OFFSET) return;   // 昨日〜6日先の外は無視
  OFFSET = next;
  renderDay();
}

// 表示中の日の「天気/体感/湿度/風」をまとめる（今日＝実況 / 他＝その日の正午を代表に）
// ※気温の見出し（大きい数字）は別途：今日＝実況、他＝その日の最高
function dayContext() {
  const d = DATA.daily, sel = TODAY_IDX + OFFSET, date = d.time[sel], isToday = (OFFSET === 0);
  let app = null, hum = null, wind = null, code;
  if (isToday) {
    const c = DATA.current;
    app = c.apparent_temperature; hum = c.relative_humidity_2m; wind = c.wind_speed_10m; code = c.weather_code;
  } else {
    code = d.weather_code[sel];                                   // その日を代表する天気
    const h = DATA.hourly, hi = h.time.indexOf(date + "T12:00");  // 体感/湿度/風は正午を代表に
    if (hi >= 0) { app = h.apparent_temperature[hi]; hum = h.relative_humidity_2m[hi]; wind = h.wind_speed_10m[hi]; }
  }
  return { sel: sel, date: date, isToday: isToday, app: app, hum: hum, wind: wind, code: code };
}

// 日の呼び名（昨日/今日/明日/明後日。それ以外は空＝日付＋曜日だけ表示）
function relName(o) { return o === -1 ? "昨日" : o === 0 ? "今日" : o === 1 ? "明日" : o === 2 ? "明後日" : ""; }

// hourlyから「ある日・ある時刻」の気温（無ければnull）。朝/昼/夜の表示に使う（#4対応）
function tempAtHour(date, hour) {
  const i = DATA.hourly.time.indexOf(date + "T" + pad2(hour) + ":00");
  return i >= 0 ? DATA.hourly.temperature_2m[i] : null;
}

// 「傘いる？」の3パターン判定（その日の最大降水確率で）
function umbrella(pop) {
  if (pop >= 60) return { word: "はい",           note: "雨の可能性が高い", cls: "v-yes" };
  if (pop >= 30) return { word: "持って出かけて", note: "にわか雨に注意",   cls: "v-maybe" };
  return                  { word: "いいえ",         note: "傘は不要",         cls: "v-no" };
}


// STEP 24 | renderDay：選択中の日の上段＋チャートを描く（→ index.html STEP 05）
function renderDay() {
  if (!DATA) return;
  const d = DATA.daily, ctx = dayContext(), rel = relName(OFFSET);

  // 日付ステッパー（例：今日 6/19（金））と、端での矢印の無効化
  $("#dayLabel").text((rel ? rel + " " : "") + mdLabel(ctx.date) + "（" + dayLabel(ctx.date) + "）");
  $("#prevDay").toggleClass("is-off", OFFSET <= MIN_OFFSET);
  $("#nextDay").toggleClass("is-off", OFFSET >= MAX_OFFSET);

  // 結論ファースト：いま傘いる？（その日の最大降水確率から3パターン。今日以外は日名で）
  const u = umbrella(d.precipitation_probability_max[ctx.sel]);
  const q = OFFSET === 0 ? "いま傘いる？" : (rel || mdLabel(ctx.date)) + "傘いる？";
  $("#verdict").attr("class", "verdict " + u.cls)
    .html('<span class="v-q">' + q + '</span><span class="v-a">' + u.word + '</span><span class="v-note">' + u.note + '</span>');

  // 大きな気温：今日＝実況 / 他の日＝その日の最高（正午固定をやめた＝#4対応）
  const bigTemp = ctx.isToday ? DATA.current.temperature_2m : d.temperature_2m_max[ctx.sel];
  $("#todayTemp").text(r(bigTemp) + "°");
  $("#todayWx").text(wx(ctx.code).t).css("color", wxColor(ctx.code));
  $("#todayFeel").text(ctx.app != null ? "体感 " + r(ctx.app) + "°" : "");

  // 朝/昼/夜の気温（時間帯の推移が分かるように＝#4対応。06/12/18時）
  const am = tempAtHour(ctx.date, 6), noon = tempAtHour(ctx.date, 12), pm = tempAtHour(ctx.date, 18);
  $("#partsOfDay").html(
    (am   != null ? '朝 <b>' + r(am)   + '°</b>　' : '') +
    (noon != null ? '昼 <b>' + r(noon) + '°</b>　' : '') +
    (pm   != null ? '夜 <b>' + r(pm)   + '°</b>'   : '')
  );

  // 指標：気温群（最高/最低）＋状況群（雨/湿度/風）。湿度/風が無い日は「—」
  $("#hilo").html(
    pair("最高", r(d.temperature_2m_max[ctx.sel]) + "°") +
    pair("最低", r(d.temperature_2m_min[ctx.sel]) + "°")
  );
  $("#cond").html(
    pair("雨",   d.precipitation_probability_max[ctx.sel] + "%") +
    pair("湿度", ctx.hum != null ? ctx.hum + "%" : "—") +
    pair("風",   ctx.wind != null ? r(ctx.wind) + "m/s" : "—")
  );

  // チャート見出し（今日＝これから／他＝その日）＋折れ線チャート → STEP 25
  $("#chartLabel").text(OFFSET === 0 ? "これから（気温と降水）" : (rel || mdLabel(ctx.date)) + "の気温と降水");
  $("#hourChart").html(buildDayChart(ctx));
}
function pair(label, value) {
  return '<div class="metric"><span class="lbl">' + label + '</span><span class="val">' + value + '</span></div>';
}


// STEP 25 | buildDayChart（SVG）：気温＝折れ線（上）／降水確率＝折れ線+塗り（下）。3時間ごと8コマ。
function buildDayChart(ctx) {
  const h = DATA.hourly, COUNT = 8, STEP = 3;

  // 開始位置：今日＝今の時刻以降 / 他の日＝その日の0時から
  let start = 0;
  if (ctx.isToday) {
    const now = new Date(DATA.current.time);
    for (let i = 0; i < h.time.length; i++) { if (new Date(h.time[i]) >= now) { start = i; break; } }
  } else {
    const s = h.time.indexOf(ctx.date + "T00:00"); start = s >= 0 ? s : 0;
  }

  const idx = [];
  for (let k = 0; k < COUNT; k++) { const i = start + k * STEP; if (i < h.time.length) idx.push(i); }
  const temps = idx.map(function (i) { return h.temperature_2m[i]; });
  const pops  = idx.map(function (i) { return h.precipitation_probability[i]; });

  const W = 320, padL = 18, padR = 18, tTop = 38, tBot = 88, pTop = 122, pBot = 156;
  const stepX = idx.length > 1 ? (W - padL - padR) / (idx.length - 1) : 0;
  let tmin = Math.min.apply(null, temps), tmax = Math.max.apply(null, temps);
  if (tmin === tmax) { tmin -= 1; tmax += 1; }
  const xOf  = function (k) { return padL + k * stepX; };
  const tyOf = function (t) { return tTop + (1 - (t - tmin) / (tmax - tmin)) * (tBot - tTop); };
  const pyOf = function (p) { return pBot - (p / 100) * (pBot - pTop); };

  let tLine = "", tDots = "", tLabels = "", pLine = "", pPts = "", pLabels = "", times = "";
  idx.forEach(function (i, k) {
    const cx = xOf(k), ty = tyOf(temps[k]), py = pyOf(pops[k]);
    tLine   += (k === 0 ? "M" : "L") + cx.toFixed(1) + " " + ty.toFixed(1) + " ";
    tDots   += '<circle cx="' + cx + '" cy="' + ty.toFixed(1) + '" r="3.2" fill="' + tempColor(temps[k]) + '"/>';
    tLabels += '<text x="' + cx + '" y="' + (ty - 9).toFixed(1) + '" text-anchor="middle" font-size="12" font-weight="700" fill="#1a1a1a">' + r(temps[k]) + '°</text>';
    pLine   += (k === 0 ? "M" : "L") + cx.toFixed(1) + " " + py.toFixed(1) + " ";
    pPts    += cx.toFixed(1) + " " + py.toFixed(1) + " ";
    pLabels += '<text x="' + cx + '" y="' + (py - 7).toFixed(1) + '" text-anchor="middle" font-size="10" font-weight="700" fill="#1a1a1a">' + pops[k] + '%</text>';
    times   += '<text x="' + cx + '" y="180" text-anchor="middle" font-size="11" fill="#9098a0">' + hourLabel(h.time[i]) + '</text>';
  });
  const area = "M " + xOf(0).toFixed(1) + " " + pBot + " L " + pPts + "L " + xOf(idx.length - 1).toFixed(1) + " " + pBot + " Z";

  return '<div class="legend"><span class="lg lg--t">気温</span><span class="lg lg--p">降水確率</span></div>'
    + '<svg viewBox="0 0 320 188" role="img" aria-label="気温と降水確率の折れ線グラフ">'
    + '<line x1="' + padL + '" y1="' + pBot + '" x2="' + (W - padR) + '" y2="' + pBot + '" stroke="#e6e8eb"/>'
    + '<path d="' + area + '" fill="#dceaf7"/>'
    + '<path d="' + pLine + '" fill="none" stroke="#2b6fb0" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>'
    + '<path d="' + tLine + '" fill="none" stroke="#e0843c" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>'
    + tDots + tLabels + pLabels + times
    + '</svg>';
}


// STEP 26 | renderWeek：週間（今日起点・固定。日替えしても変わらない）。気温＝レンジバー、降水＝黒%＋青バー
function renderWeek() {
  const daily = DATA.daily;
  // 週間は「今日から7日」を対象に（past_daysの昨日は除く）
  const from = TODAY_IDX, to = Math.min(daily.time.length, TODAY_IDX + 7);

  let wMin = Infinity, wMax = -Infinity;
  for (let i = from; i < to; i++) {
    if (daily.temperature_2m_min[i] < wMin) wMin = daily.temperature_2m_min[i];
    if (daily.temperature_2m_max[i] > wMax) wMax = daily.temperature_2m_max[i];
  }
  if (wMin === wMax) { wMin -= 1; wMax += 1; }
  const range = wMax - wMin;

  // 見出し行（％が「降水」と分かるように／各列の意味を明示）
  $("#weekList").empty().append(
    '<li class="day day--head">' +
      '<span></span>' +
      '<span class="h" style="text-align:center">天気</span>' +
      '<span class="h" style="text-align:center">気温</span>' +
      '<span class="h" style="text-align:center">気温差</span>' +
      '<span class="h" style="text-align:right">降水</span>' +
    '</li>'
  );
  for (let i = from; i < to; i++) {
    const w = wx(daily.weather_code[i]), pop = daily.precipitation_probability_max[i];
    const lo = daily.temperature_2m_min[i], hi = daily.temperature_2m_max[i];
    const left = (lo - wMin) / range * 100;
    let width = (hi - lo) / range * 100; if (width < 6) width = 6;
    const isToday = (i === TODAY_IDX), md = mdLabel(daily.time[i]);
    const name = isToday ? '今日<small>' + md + '</small>'
                         : dayLabel(daily.time[i]) + '<small>' + md + '</small>';

    $("#weekList").append(
      '<li class="day' + (isToday ? ' is-today' : '') + '">' +
        '<span class="day__name" style="color:' + dowColor(daily.time[i]) + '">' + name + '</span>' +
        '<span class="day__wx" style="color:' + wxColor(daily.weather_code[i]) + '">' + w.s + '</span>' +
        '<span class="day__range">' +
          '<b class="day__lo">' + r(lo) + '°</b>' +
          '<span class="day__bar"><i style="left:' + left.toFixed(1) + '%;width:' + width.toFixed(1) +
            '%;background:linear-gradient(90deg,' + tempColor(lo) + ',' + tempColor(hi) + ')"></i></span>' +
          '<b class="day__hi">' + r(hi) + '°</b>' +
        '</span>' +
        '<span class="day__diff">' + (r(hi) - r(lo)) + '°</span>' +
        '<span class="day__pop"><b>' + pop + '%</b><span class="pbar"><i style="width:' + pop + '%;background:' + precipColor(pop) + '"></i></span></span>' +
      '</li>'
    );
  }
}
