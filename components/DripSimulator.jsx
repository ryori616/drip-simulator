import { useState, useMemo, useCallback } from "react";
import {
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, ReferenceLine,
} from "recharts";

// ─── Color tokens ───────────────────────────────────────────────────────────
const C = {
  bg:       "#06090f",
  surface:  "#0d1520",
  border:   "#162032",
  accent:   "#3b82f6",
  accentDim:"#1d3a6a",
  green:    "#22d3a5",
  amber:    "#f59e0b",
  purple:   "#a78bfa",
  muted:    "#4a5a72",
  text:     "#d1dde8",
  textSub:  "#6b7c93",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const yen = (n, d = 0) =>
  "¥" + Number(n).toLocaleString("ja-JP", { maximumFractionDigits: d });
const num = (n, d = 0) =>
  Number(n).toLocaleString("ja-JP", { maximumFractionDigits: d });
const pct = (n) => (n * 100).toFixed(1) + "%";

const TAX = 0.20315;
const UNIT = 100;

// ─── Simulation core ─────────────────────────────────────────────────────────
function simulate({ initShares, initInvestYen, periodicYen, periodicYears,
  currentPrice, currentDps, dpsGrowthPct, priceGrowthPct,
  dividendFreq, simYears, nisa }) {

  const dpsG = dpsGrowthPct / 100;
  const priceG = priceGrowthPct / 100;
  const taxRate = nisa ? 0 : TAX;
  const periods = dividendFreq; // 1 or 2

  let shares = initShares;
  // 一括初期投資
  if (initInvestYen > 0) shares += initInvestYen / currentPrice;

  let price = currentPrice;
  let dps = currentDps;
  let cashCarry = 0;

  const rows = [];
  rows.push({
    year: 0,
    price: +price.toFixed(0),
    dps: +dps.toFixed(2),
    shares: +shares.toFixed(2),
    value: +(shares * price).toFixed(0),
    divGross: 0, divNet: 0, sharesAdded: 0,
    yoc: +(dps / currentPrice * 100).toFixed(2),
    cumCost: (initShares * currentPrice) + initInvestYen,
  });

  let cumCost = (initShares * currentPrice) + initInvestYen;

  for (let y = 1; y <= simYears; y++) {
    price *= (1 + priceG);
    dps   *= (1 + dpsG);

    // 定期投入（年初）
    if (y <= periodicYears && periodicYen > 0) {
      const pool = periodicYen + cashCarry;
      const invest = Math.floor(pool / UNIT) * UNIT;
      cashCarry = pool - invest;
      shares += invest / price;
      cumCost += periodicYen;
    }

    // 配当 → 再投資
    let divGrossTotal = 0, divNetTotal = 0, sharesAdded = 0;
    for (let p = 0; p < periods; p++) {
      const gross = shares * (dps / periods);
      const net   = gross * (1 - taxRate);
      const invest = Math.floor(net / UNIT) * UNIT;
      shares += invest / price;
      sharesAdded += invest / price;
      divGrossTotal += gross;
      divNetTotal   += net;
    }

    rows.push({
      year: y,
      price: +price.toFixed(0),
      dps:   +dps.toFixed(2),
      shares: +shares.toFixed(2),
      value:  +(shares * price).toFixed(0),
      divGross: +divGrossTotal.toFixed(0),
      divNet:   +divNetTotal.toFixed(0),
      sharesAdded: +sharesAdded.toFixed(3),
      yoc: +(dps / currentPrice * 100).toFixed(2),
      cumCost: +cumCost.toFixed(0),
    });
  }
  return rows;
}

// ─── Fetch stock data via Claude API ─────────────────────────────────────────
async function fetchStockData(code) {
  const prompt = `日本株の証券コード「${code}」について、以下の情報を調べてJSON形式のみで返してください。他の文字列は一切不要。

{
  "name": "会社名（日本語）",
  "price": 現在の株価（円、数値のみ）,
  "dps": 直近実績の年間1株配当（円、数値のみ）,
  "dividendFreq": 年間配当回数（1または2の整数）,
  "dpsCAGR10y": 過去10年のDPS年平均成長率（%、数値のみ。不明なら5）,
  "priceCAGR10y": 過去10年の株価年平均成長率（%、数値のみ。不明なら5）,
  "note": "配当の特記事項があれば30字以内で（なければ空文字）"
}

データが不明・非上場の場合はnameに「不明」と入れ他は0を返す。`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  const text = data.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("");
  const clean = text.replace(/```json|```/g, "").trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("JSON parse failed");
  return JSON.parse(match[0]);
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function InputRow({ label, value, onChange, type = "number", min, max, step = 1, unit, hint }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display:"block", fontSize:11, color:C.textSub, fontWeight:600,
        letterSpacing:".06em", textTransform:"uppercase", marginBottom:5 }}>
        {label}
      </label>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <input
          type={type} value={value} min={min} max={max} step={step}
          onChange={e => onChange(type === "number" ? +e.target.value : e.target.value)}
          style={{
            flex:1, background:"#0a1018", border:`1px solid ${C.border}`,
            borderRadius:8, color:C.text, padding:"9px 12px", fontSize:14,
            fontFamily:"'JetBrains Mono', monospace", outline:"none",
          }}
        />
        {unit && <span style={{ fontSize:12, color:C.muted, whiteSpace:"nowrap" }}>{unit}</span>}
      </div>
      {hint && <div style={{ fontSize:10, color:C.muted, marginTop:4 }}>{hint}</div>}
    </div>
  );
}

function SliderRow({ label, value, onChange, min, max, step = 0.5, color = C.accent, hist, unit = "%" }) {
  return (
    <div style={{ marginBottom:14 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
        <span style={{ fontSize:11, color:C.textSub, fontWeight:600, letterSpacing:".06em", textTransform:"uppercase" }}>
          {label}
        </span>
        <span style={{ fontSize:15, fontWeight:800, color, fontFamily:"monospace" }}>{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(+e.target.value)}
        style={{ width:"100%", accentColor:color }} />
      {hist != null &&
        <div style={{ fontSize:10, color:C.muted, marginTop:3 }}>過去実績: {hist}%</div>}
    </div>
  );
}

function StatCard({ label, value, sub, color = C.accent }) {
  return (
    <div style={{ background:C.surface, border:`1px solid ${C.border}`,
      borderRadius:12, padding:"14px 18px" }}>
      <div style={{ fontSize:10, color:C.muted, fontWeight:700, letterSpacing:".1em",
        textTransform:"uppercase", marginBottom:8 }}>{label}</div>
      <div style={{ fontSize:20, fontWeight:800, color, letterSpacing:"-.02em",
        fontFamily:"'JetBrains Mono',monospace" }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:C.textSub, marginTop:4 }}>{sub}</div>}
    </div>
  );
}

const TipBase = ({ active, payload, label, offsetYear }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:"#0a111c", border:`1px solid ${C.border}`,
      borderRadius:8, padding:"10px 14px", fontSize:12, color:C.text }}>
      <div style={{ fontWeight:700, color:C.accent, marginBottom:6 }}>
        {typeof label === "number" ? `${label + offsetYear}年` : label}
      </div>
      {payload.map((p, i) => (
        <div key={i} style={{ color:p.color || C.text, marginBottom:2 }}>
          {p.name}: {typeof p.value === "number" ? yen(p.value) : p.value}
        </div>
      ))}
    </div>
  );
};

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function App() {
  // --- fetch state
  const [codeInput, setCodeInput] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [stockName, setStockName] = useState("");
  const [fetchNote, setFetchNote] = useState("");

  // --- investment params
  const [currentPrice, setCurrentPrice]   = useState(1312);
  const [currentDps,   setCurrentDps]     = useState(47);
  const [dividendFreq, setDividendFreq]   = useState(2);
  const [initShares,   setInitShares]     = useState(0);
  const [initInvest,   setInitInvest]     = useState(0);
  const [periodicYen,  setPeriodicYen]    = useState(1100000);
  const [periodicYears,setPeriodicYears]  = useState(10);
  const [simYears,     setSimYears]       = useState(20);
  const [nisa,         setNisa]           = useState(false);

  // --- growth params
  const [dpsGrowth,   setDpsGrowth]   = useState(14.3);
  const [priceGrowth, setPriceGrowth] = useState(9.0);
  const [histDps,     setHistDps]     = useState(14.3);
  const [histPrice,   setHistPrice]   = useState(9.0);

  // --- UI
  const [tab, setTab] = useState("value");

  const handleFetch = useCallback(async () => {
    const code = codeInput.trim();
    if (!code) return;
    setFetching(true); setFetchError("");
    try {
      const d = await fetchStockData(code);
      if (d.name === "不明") { setFetchError("銘柄が見つかりませんでした"); setFetching(false); return; }
      setStockName(d.name);
      setCurrentPrice(d.price);
      setCurrentDps(d.dps);
      setDividendFreq(d.dividendFreq || 2);
      setDpsGrowth(d.dpsCAGR10y);
      setPriceGrowth(d.priceCAGR10y);
      setHistDps(d.dpsCAGR10y);
      setHistPrice(d.priceCAGR10y);
      setFetchNote(d.note || "");
    } catch (e) { setFetchError("取得失敗。手動で入力してください。"); }
    setFetching(false);
  }, [codeInput]);

  const sim = useMemo(() => simulate({
    initShares, initInvestYen: initInvest,
    periodicYen, periodicYears,
    currentPrice, currentDps,
    dpsGrowthPct: dpsGrowth, priceGrowthPct: priceGrowth,
    dividendFreq, simYears, nisa,
  }), [initShares, initInvest, periodicYen, periodicYears,
    currentPrice, currentDps, dpsGrowth, priceGrowth,
    dividendFreq, simYears, nisa]);

  const startYear = new Date().getFullYear();
  const last = sim[sim.length - 1];
  const half = sim[Math.round(simYears / 2)];
  const totalCost = sim[simYears]?.cumCost ?? 0;
  const roi = last.value / totalCost;

  const chartData = sim.map(r => ({ ...r, label: `${startYear + r.year}` }));

  // ─── Styles ────────────────────────────────────────────────────────────────
  const S = {
    root: { minHeight:"100vh", background:C.bg, color:C.text,
      fontFamily:"'Inter','Noto Sans JP',sans-serif" },
    header: { padding:"28px 32px 22px",
      borderBottom:`1px solid ${C.border}`,
      background:"linear-gradient(135deg,#07121f 0%,#0c1a2e 100%)" },
    eyebrow: { fontSize:10, fontWeight:700, letterSpacing:".2em",
      color:C.accent, textTransform:"uppercase", marginBottom:8 },
    h1: { fontSize:26, fontWeight:900, letterSpacing:"-.03em",
      color:"#e8f1fa", marginBottom:6, lineHeight:1.1 },
    headerSub: { fontSize:12, color:C.textSub },
    two: { display:"grid", gridTemplateColumns:"300px 1fr",
      gap:0, minHeight:"calc(100vh - 110px)" },
    panel: { borderRight:`1px solid ${C.border}`,
      padding:"24px 20px", overflowY:"auto",
      background:"#090e18" },
    main: { padding:"24px 28px", overflowY:"auto" },
    sectionLabel: { fontSize:10, fontWeight:700, letterSpacing:".12em",
      color:C.muted, textTransform:"uppercase",
      borderBottom:`1px solid ${C.border}`,
      paddingBottom:6, marginBottom:14, marginTop:20 },
    fetchRow: { display:"flex", gap:8, marginBottom:6 },
    fetchInput: { flex:1, background:"#0a1018",
      border:`1px solid ${C.accentDim}`,
      borderRadius:8, color:C.text, padding:"9px 12px",
      fontSize:14, fontFamily:"monospace", outline:"none" },
    fetchBtn: { background:C.accent, border:"none", borderRadius:8,
      color:"#fff", fontWeight:700, fontSize:13,
      padding:"9px 16px", cursor:"pointer" },
    stockBadge: { display:"inline-block", background:"#0d1e36",
      border:`1px solid ${C.accentDim}`, borderRadius:6,
      padding:"4px 10px", fontSize:11, color:C.accent,
      marginBottom:10, fontWeight:600 },
    nisoRow: { display:"flex", alignItems:"center", gap:8,
      background:"#0a1810", border:"1px solid #143322",
      borderRadius:8, padding:"10px 14px", marginBottom:14,
      cursor:"pointer" },
    statsGrid: { display:"grid",
      gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",
      gap:10, marginBottom:20 },
    tabs: { display:"flex", gap:4, marginBottom:16 },
    tabBtn: (a) => ({
      padding:"7px 18px", borderRadius:6, fontSize:12, fontWeight:700,
      cursor:"pointer", border:"none",
      background: a ? C.accent : "rgba(30,41,59,.4)",
      color: a ? "#fff" : C.muted, transition:"all .15s",
    }),
    chartWrap: { background:C.surface, border:`1px solid ${C.border}`,
      borderRadius:12, padding:"20px 16px 12px", marginBottom:14 },
    chartLabel: { fontSize:11, color:C.muted, marginBottom:10 },
    tableWrap: { background:C.surface, border:`1px solid ${C.border}`,
      borderRadius:12, overflow:"auto", maxHeight:480, marginBottom:14 },
    th: { padding:"8px 10px", textAlign:"right", fontSize:10,
      color:C.muted, fontWeight:700, borderBottom:`1px solid ${C.border}`,
      background:"#090e18", position:"sticky", top:0, whiteSpace:"nowrap" },
    td: (c, bold) => ({ padding:"6px 10px", textAlign:"right",
      color: c || C.text, borderBottom:`1px solid #0c1520`,
      fontFamily:"'JetBrains Mono',monospace", fontSize:11.5,
      fontWeight: bold ? 700 : 400 }),
    disc: { fontSize:10, color:C.muted, lineHeight:1.8,
      background:"#090e18", border:`1px solid ${C.border}`,
      borderRadius:8, padding:"12px 16px" },
  };

  const Tip = (props) => <TipBase {...props} offsetYear={startYear} />;

  return (
    <div style={S.root}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.eyebrow}>DRIP Simulator · Japan Equities</div>
        <div style={S.h1}>配当再投資シミュレーター</div>
        <div style={S.headerSub}>
          証券コードで自動取得 or 手動入力 ｜ キンカブ100円単位 ｜ 税引後
        </div>
      </div>

      <div style={S.two}>
        {/* ── Left panel: inputs ── */}
        <div style={S.panel}>
          {/* 銘柄取得 */}
          <div style={S.sectionLabel}>銘柄データ取得</div>
          <div style={S.fetchRow}>
            <input
              style={S.fetchInput}
              placeholder="証券コード（例：8593）"
              value={codeInput}
              onChange={e => setCodeInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleFetch()}
            />
            <button style={S.fetchBtn} onClick={handleFetch} disabled={fetching}>
              {fetching ? "…" : "取得"}
            </button>
          </div>
          {stockName && <div style={S.stockBadge}>✓ {stockName}</div>}
          {fetchNote && <div style={{ fontSize:10, color:C.amber, marginBottom:8 }}>⚠ {fetchNote}</div>}
          {fetchError && <div style={{ fontSize:11, color:"#f87171", marginBottom:8 }}>{fetchError}</div>}

          {/* 銘柄基本情報（手動入力） */}
          <div style={S.sectionLabel}>銘柄情報（手動で編集可）</div>
          <InputRow label="現在株価" value={currentPrice} onChange={setCurrentPrice} min={1} unit="円" />
          <InputRow label="年間DPS（直近実績）" value={currentDps} onChange={setCurrentDps} min={0} step={0.5} unit="円" />
          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:11, color:C.textSub, fontWeight:600, letterSpacing:".06em",
              textTransform:"uppercase", display:"block", marginBottom:6 }}>配当回数</label>
            <div style={{ display:"flex", gap:8 }}>
              {[1, 2, 4].map(f => (
                <button key={f} onClick={() => setDividendFreq(f)}
                  style={{ flex:1, padding:"8px 0", borderRadius:8, border:"none", fontSize:13,
                    fontWeight:700, cursor:"pointer",
                    background: dividendFreq === f ? C.accent : "#0a1018",
                    color: dividendFreq === f ? "#fff" : C.muted,
                    border: `1px solid ${dividendFreq === f ? C.accent : C.border}` }}>
                  年{f}回
                </button>
              ))}
            </div>
          </div>

          {/* 原資 */}
          <div style={S.sectionLabel}>原資の設定</div>
          <InputRow label="初期保有株数" value={initShares} onChange={setInitShares} min={0} unit="株"
            hint="すでに保有している株数" />
          <InputRow label="一括初期投資" value={initInvest} onChange={setInitInvest} min={0} step={10000} unit="円"
            hint="現在株価で買付（端数は現金留保）" />
          <InputRow label="定期投入（年額）" value={periodicYen} onChange={setPeriodicYen} min={0} step={100000} unit="円"
            hint="毎年年初に追加投入" />
          <InputRow label="定期投入 継続年数" value={periodicYears} onChange={setPeriodicYears} min={0} max={simYears} unit="年" />

          {/* NISA */}
          <div style={S.nisoRow} onClick={() => setNisa(!nisa)}>
            <div style={{ width:18, height:18, borderRadius:4,
              background: nisa ? C.green : "transparent",
              border: `2px solid ${nisa ? C.green : C.muted}`,
              display:"flex", alignItems:"center", justifyContent:"center" }}>
              {nisa && <span style={{ fontSize:12, color:"#000", fontWeight:900 }}>✓</span>}
            </div>
            <div>
              <div style={{ fontSize:12, fontWeight:700, color:C.text }}>NISA成長投資枠を利用</div>
              <div style={{ fontSize:10, color:C.muted }}>配当課税ゼロ（20.315%→0%）</div>
            </div>
          </div>

          {/* 成長率 */}
          <div style={S.sectionLabel}>成長率の仮定（スライダー）</div>
          <SliderRow label="DPS年間成長率" value={dpsGrowth} onChange={setDpsGrowth}
            min={0} max={25} color={C.accent} hist={histDps || null} />
          <SliderRow label="株価年間成長率" value={priceGrowth} onChange={setPriceGrowth}
            min={-5} max={25} color={C.purple} hist={histPrice || null} />
          <SliderRow label="シミュレーション期間" value={simYears} onChange={setSimYears}
            min={5} max={40} step={5} color={C.amber} unit="年" />

        </div>

        {/* ── Right main: results ── */}
        <div style={S.main}>
          {/* KPIs */}
          <div style={S.statsGrid}>
            <StatCard label="投入元本合計" value={yen(totalCost)} color={C.muted}
              sub={`初期投資 + 定期投入累計`} />
            <StatCard label={`${simYears/2}年後 評価額`} value={yen(half?.value ?? 0)} color={C.accent}
              sub={`${startYear + (simYears/2)}年時点`} />
            <StatCard label={`${simYears}年後 評価額`} value={yen(last.value)} color={C.amber}
              sub={`${num(last.shares, 1)}株 × ${yen(last.price)}`} />
            <StatCard label={`${simYears}年後 年間配当（税後）`} value={yen(last.divNet)} color={C.purple}
              sub={`月換算 ${yen(Math.round(last.divNet / 12))}`} />
            <StatCard label="元本対比リターン" value={`${roi.toFixed(1)}x`} color={C.green}
              sub={`取得原価比 ${pct(roi - 1)} 増`} />
            <StatCard label={`${simYears}年後 YoC`} value={`${last.yoc}%`} color={C.green}
              sub={`現在利回り ${(currentDps / currentPrice * 100).toFixed(2)}% → ${simYears}年後`} />
          </div>

          {/* Tabs */}
          <div style={S.tabs}>
            {[["value","📈 評価額推移"],["div","💴 配当推移"],["yoc","📊 YoC推移"],["table","📋 年次明細"]].map(([k,l]) => (
              <button key={k} style={S.tabBtn(tab===k)} onClick={()=>setTab(k)}>{l}</button>
            ))}
          </div>

          {tab === "value" && (
            <div style={S.chartWrap}>
              <div style={S.chartLabel}>評価額 vs 投入元本（万円）</div>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={chartData} margin={{top:10,right:10,left:10,bottom:0}}>
                  <defs>
                    <linearGradient id="gv" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={C.accent} stopOpacity={.35}/>
                      <stop offset="95%" stopColor={C.accent} stopOpacity={.02}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                  <XAxis dataKey="label" tick={{fill:C.muted,fontSize:11}}/>
                  <YAxis tickFormatter={v=>`${num(v/10000)}万`} tick={{fill:C.muted,fontSize:11}} width={72}/>
                  <Tooltip content={<Tip/>}/>
                  <Legend wrapperStyle={{fontSize:12}}/>
                  <Area type="monotone" dataKey="value" name="評価額"
                    stroke={C.accent} fill="url(#gv)" strokeWidth={2}/>
                  <Area type="monotone" dataKey="cumCost" name="投入元本"
                    stroke={C.muted} fill="none" strokeWidth={1.5} strokeDasharray="5 3"/>
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {tab === "div" && (
            <div style={S.chartWrap}>
              <div style={S.chartLabel}>年間配当（税後）推移（万円）</div>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData.slice(1)} margin={{top:10,right:10,left:10,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                  <XAxis dataKey="label" tick={{fill:C.muted,fontSize:11}}/>
                  <YAxis tickFormatter={v=>`${num(v/10000)}万`} tick={{fill:C.muted,fontSize:11}} width={72}/>
                  <Tooltip content={<Tip/>}/>
                  <Bar dataKey="divNet" name="配当（税後）" fill={C.purple} radius={[3,3,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {tab === "yoc" && (
            <div style={S.chartWrap}>
              <div style={S.chartLabel}>Yield on Cost（取得原価比利回り）推移</div>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={chartData} margin={{top:10,right:10,left:10,bottom:0}}>
                  <defs>
                    <linearGradient id="gy" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={C.green} stopOpacity={.4}/>
                      <stop offset="95%" stopColor={C.green} stopOpacity={.02}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                  <XAxis dataKey="label" tick={{fill:C.muted,fontSize:11}}/>
                  <YAxis tickFormatter={v=>`${v}%`} tick={{fill:C.muted,fontSize:11}} width={52}/>
                  <Tooltip formatter={v=>`${v}%`} contentStyle={{background:"#0a111c",border:`1px solid ${C.border}`}}/>
                  <Area type="monotone" dataKey="yoc" name="YoC"
                    stroke={C.green} fill="url(#gy)" strokeWidth={2}/>
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {tab === "table" && (
            <div style={S.tableWrap}>
              <table style={{ width:"100%", borderCollapse:"collapse",
                fontSize:11.5, fontFamily:"'JetBrains Mono',monospace" }}>
                <thead>
                  <tr>
                    {["年","株価(円)","DPS(円)","株数","評価額(万)","配当税後(円)","YoC","追加株数","元本(万)"].map((h,i)=>(
                      <th key={i} style={{...S.th, textAlign: i===0?"left":"right"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sim.map((r,i)=>{
                    const hl = r.year === simYears;
                    const cc = hl ? C.amber : undefined;
                    return (
                      <tr key={i} style={hl?{background:"rgba(245,158,11,.05)"}:{}}>
                        <td style={{...S.td(cc),textAlign:"left",fontWeight:hl?700:400}}>
                          {startYear+r.year}
                        </td>
                        <td style={S.td(cc)}>{num(r.price)}</td>
                        <td style={S.td(cc)}>{num(r.dps,1)}</td>
                        <td style={S.td(cc)}>{num(r.shares,1)}</td>
                        <td style={S.td(hl?C.amber:C.green,hl)}>{num(r.value/10000,1)}</td>
                        <td style={S.td(hl?C.amber:C.purple)}>{r.divNet?num(r.divNet):"—"}</td>
                        <td style={S.td(hl?C.amber:C.green)}>{r.yoc}%</td>
                        <td style={S.td(cc)}>{r.sharesAdded||"—"}</td>
                        <td style={S.td(cc)}>{num(r.cumCost/10000,1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={S.disc}>
            ⚠️ <strong>前提・注意事項</strong>　配当再投資はキンカブ（SMBC日興）の100円単位購入を想定。端数は翌年繰越。
            NISA利用時は配当課税ゼロとして計算（株式数比例配分方式の選択が必要）。
            自動取得データはWebから参照した参考値。最新の決算・配当予想は各社IRで確認のこと。
            将来の増配・株価を一切保証するものではない。
          </div>
        </div>
      </div>
    </div>
  );
}