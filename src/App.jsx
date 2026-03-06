import React, { useState, useMemo, useEffect, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { DESTINATIONS } from "./data";

// ─── НАДІЙНІ ІКОНКИ LEAFLET ─────────────────────────────────────────────
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// ─── ДОПОМІЖНІ КОНСТАНТИ ──────────────────────────────────────────────────
const MONTHS_MAP = [
  { val: 0, label: "Всі місяці (Усереднено)" }, 
  { val: 1, label: "Січень" }, { val: 2, label: "Лютий" }, { val: 3, label: "Березень" }, 
  { val: 4, label: "Квітень" }, { val: 5, label: "Травень" }, { val: 6, label: "Червень" }, 
  { val: 7, label: "Липень" }, { val: 8, label: "Серпень" }, { val: 9, label: "Вересень" }, 
  { val: 10, label: "Жовтень" }, { val: 11, label: "Листопад" }, { val: 12, label: "Грудень" }
];

// ─── УТИЛІТИ РОЗРАХУНКУ БЮДЖЕТУ (без змін) ─────────────────────────────────
function calculateDetailedBudget(dest, days, month, family) {
  const totalPeople = family.adults + family.teens + family.children + family.infants;
  const flyingPeople = family.adults + family.teens + family.children;
  const familyWeight = (family.adults * 1) + (family.teens * 1) + (family.children * 0.7) + (family.infants * 0.1);
  const costMultiplier = familyWeight / 4.5; 
  const housingRooms = Math.max(1, Math.ceil(totalPeople / 2));
  const housingMultiplier = housingRooms / 3;

  let seasonMulti = 1.0;
  let isOffSeason = false;
  
  if (month !== 0 && dest.climate?.bestMonths?.length > 0) {
    if (dest.climate.bestMonths.includes(month)) {
      seasonMulti = 1.3;
    } else {
      seasonMulti = 0.85; 
      isOffSeason = true;
    }
  }

  const tc = dest.travel?.transportCosts || { train: 0, plane: 0, bus: 0, ferry: 0, car: 0, total: 0 };
  const isFlight = dest.mode === "plane";

  const groundTransport = (tc.train + tc.bus + tc.car) * 2 * costMultiplier;
  const airWaterTransport = (tc.plane + tc.ferry) * 2 * seasonMulti * costMultiplier;
  const bagsNeeded = Math.ceil(flyingPeople / 2);
  const luggageFee = isFlight ? (bagsNeeded * 60) : 0; 
  const transportTotal = groundTransport + airWaterTransport + luggageFee;

  const needsTransit = dest.travel?.timeHours > 20;
  const transitCost = needsTransit ? ((housingRooms * 60) + (familyWeight * 20)) * 2 : 0; 

  const baseHousing = dest.budget?.dailyHousing || 0;
  const cleaningFee = 40 * housingRooms; 
  const cityTax = 2 * (family.adults + family.teens) * days; 
  const housingTotal = (baseHousing * housingMultiplier * days * seasonMulti) + cleaningFee + cityTax;

  const foodTotal = (dest.budget?.dailyFood || 0) * costMultiplier * days;

  const entertainmentDaily = (dest.familyScore || 3) * 5 * familyWeight; 
  const entertainmentTotal = entertainmentDaily * days;

  const subTotal = transportTotal + transitCost + housingTotal + foodTotal + entertainmentTotal;
  const contingency = Math.round(subTotal * 0.10);
  const grandTotal = Math.round(subTotal + contingency);

  return {
    grandTotal,
    seasonMulti,
    isOffSeason,
    needsTransit,
    totalPeople,
    housingRooms,
    breakdown: {
      transport: Math.round(transportTotal),
      transit: Math.round(transitCost),
      housing: Math.round(housingTotal),
      food: Math.round(foodTotal),
      entertainment: Math.round(entertainmentTotal),
      contingency
    }
  };
}

// ─── ІНШІ УТИЛІТИ ─────────────────────────────────────────────────────────
function waterColor(t) {
  if (!t) return { bg: "#334155", text: "#94a3b8" };
  if (t < 20) return { bg: "#1e3a8a", text: "#93c5fd" };
  if (t < 25) return { bg: "#065f46", text: "#6ee7b7" };
  return { bg: "#92400e", text: "#fcd34d" };
}

function budgetLabel(totalPrice, days, totalPeople) {
  const safeDays = Math.max(1, days);
  const safePeople = Math.max(1, totalPeople);
  const perPersonDaily = totalPrice / safeDays / safePeople;
  
  if (perPersonDaily < 70) return { label: "Економ", color: "#10b981" };
  if (perPersonDaily < 130) return { label: "Середній", color: "#3b82f6" };
  return { label: "Преміум", color: "#f59e0b" };
}

function getDaysLabel(d) {
  const mod10 = d % 10;
  const mod100 = d % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "дні";
  return "днів";
}

const getTransportIcon = (mode) => {
  if (mode === "plane") return "✈️";
  if (mode === "bus") return "🚌";
  if (mode === "train") return "🚂";
  return "🚗";
};
// ─── MapBoundsFit ───────────────────────────────────────────────────────
function MapBoundsFit({ markers }) {
  const map = useMap();

  useEffect(() => {
    if (markers.length > 0) {
      setTimeout(() => {
        const bounds = L.latLngBounds(markers.map(m => [m.lat, m.lng]));
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 10 });
      }, 150);
    }
  }, [markers, map]);

  return null;
}

// ─── UI КОМПОНЕНТИ ──────────────────────────────────────────────────────
const Badge = ({ children, bg = "#334155", color = "white", title = "" }) => (
  <span title={title} style={{ background: bg, color, padding: "3px 10px", borderRadius: "8px", fontSize: "10px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.5px" }}>{children}</span>
);

const TimeBar = ({ h }) => {
  const pct = Math.min((h / 36) * 100, 100);
  let bgColor = "#f59e0b";
  if (h <= 18) bgColor = "#10b981";
  else if (h <= 24) bgColor = "#3b82f6";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: "100px" }}>
      <div style={{ flex: 1, background: "#e2e8f0", borderRadius: "10px", height: "8px", overflow: "hidden" }}>
        <div style={{ width: pct + "%", background: bgColor, height: "100%" }} />
      </div>
      <span style={{ fontSize: "13px", fontWeight: 800 }}>{h}г</span>
    </div>
  );
};

const FamilyCounter = ({ label, value, onChange, min = 0 }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "white", padding: "8px 14px", borderRadius: "10px", border: "1px solid #cbd5e1", flex: "1 1 200px" }}>
    <span style={{ fontSize: "13px", fontWeight: 700, color: "#334155" }}>{label}</span>
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      <button onClick={() => onChange(Math.max(min, value - 1))} style={{ width: "28px", height: "28px", borderRadius: "8px", border: "none", background: "#f1f5f9", cursor: "pointer", fontWeight: 900, color: "#475569" }}>−</button>
      <span style={{ fontSize: "15px", fontWeight: 800, minWidth: "16px", textAlign: "center" }}>{value}</span>
      <button onClick={() => onChange(value + 1)} style={{ width: "28px", height: "28px", borderRadius: "8px", border: "none", background: "#e2e8f0", cursor: "pointer", fontWeight: 900, color: "#0f172a" }}>+</button>
    </div>
  </div>
);

// ─── DestinationCard ────────────────────────────────────────────────────
const DestinationCard = React.memo(function DestinationCard({ d, budgetObj, isEx, onToggle, tripDays, family }) {
  const bLabel = budgetLabel(budgetObj.grandTotal, tripDays, budgetObj.totalPeople);
  const wColor = waterColor(d.climate?.waterTempSummerMax);
  const isOffSeason = budgetObj.isOffSeason;

  const bookingUrl = useMemo(() => {
    const childrenCount = family.teens + family.children + family.infants;
    let ages =[];
    for (let i = 0; i < family.teens; i++) ages.push(15);
    for (let i = 0; i < family.children; i++) ages.push(8);
    for (let i = 0; i < family.infants; i++) ages.push(1);
    const agesParam = ages.map(age => "&age=" + age).join('');
    return "https://www.booking.com/searchresults.html?ss=" + encodeURIComponent(d.name) +
           "&group_adults=" + family.adults +
           "&req_adults=" + family.adults +
           "&group_children=" + childrenCount +
           "&req_children=" + childrenCount + agesParam;
  },[d.name, family]);

  return (
    <div style={{ background: "white", borderRadius: "16px", overflow: "hidden", border: "1px solid " + (isEx ? "#cbd5e1" : "transparent"), boxShadow: isEx ? "0 10px 25px rgba(0,0,0,0.1)" : "0 2px 8px rgba(0,0,0,0.04)", transition: "all 0.3s ease" }}>
      <div onClick={() => onToggle(d.id)} style={{ display: "flex", flexWrap: "wrap", padding: "18px 25px", alignItems: "center", cursor: "pointer", gap: "12px", borderBottom: isEx ? "1px solid #f1f5f9" : "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: "1 1 200px", minWidth: "180px" }}>
          <span style={{ fontSize: "24px" }}>{d.flag}</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: "16px", color: "#0f172a" }}>
              {d.name} {getTransportIcon(d.mode)}
              {isOffSeason && <span title="Не найкращий сезон" style={{ fontSize: "10px", fontWeight: 800, color: "#b45309", background: "#fef3c7", padding: "3px 7px", borderRadius: "6px", marginLeft: "8px" }}>⚠️ Не сезон</span>}
            </div>
            <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, marginTop: "4px" }}>
              <Badge bg="#f1f5f9" color="#475569">{d.region}</Badge>
            </div>
          </div>
        </div>
        <div style={{ flex: "0 0 140px" }}><TimeBar h={d.travel?.timeHours || 0} /></div>
        <div style={{ textAlign: "center", flex: "0 0 100px" }}>
          {d.climate?.canSwim ? <Badge bg={wColor.bg} color={wColor.text}>{d.climate.waterTempSummerMax}°С Море</Badge> : <span style={{ fontSize: "12px", color: "#94a3b8", fontWeight: 700 }}>Без моря</span>}
        </div>
        <div style={{ textAlign: "center", flex: "0 0 80px", fontSize: "13px", color: "#f59e0b", fontWeight: 800 }}>
          {"★".repeat(d.familyScore || 0)}{"☆".repeat(5 - (d.familyScore || 0))}
        </div>
        <div style={{ textAlign: "right", color: "#0f172a", fontWeight: 900, fontSize: "16px", flex: "0 0 130px" }}>
          ~€{budgetObj.grandTotal} <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 600 }}>/ {tripDays} дн.</span>
          <div style={{ marginTop: "4px" }}><Badge bg={bLabel.color} color="white">{bLabel.label}</Badge></div>
        </div>
        <div style={{ textAlign: "right", color: "#94a3b8", fontSize: "14px" }}>{isEx ? "▲" : "▼"}</div>
      </div>

      {isEx && (
        <div style={{ padding: "25px", background: "#f8fafc", display: "grid", gridTemplateColumns: "minmax(300px, 1fr) minmax(300px, 1.2fr)", gap: "30px" }}>
          <div>
            <h4 style={{ margin: "0 0 15px 0", color: "#ea580c", fontSize: "12px", letterSpacing: "1px", textTransform: "uppercase" }}>📊 Кошторис на {budgetObj.totalPeople} осіб</h4>
            <div style={{ background: "white", borderRadius: "12px", padding: "15px", border: "1px solid #e2e8f0", fontSize: "13px" }}>
              <div style={{ marginBottom: "12px", paddingBottom: "12px", borderBottom: "1px dashed #cbd5e1" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, color: "#334155" }}>
                  <span>🛫 Транспорт (туди й назад)</span> <span>€{budgetObj.breakdown.transport}</span>
                </div>
                <div style={{ color: "#64748b", fontSize: "11px", marginTop: "4px" }}>
                  Квитки для {budgetObj.totalPeople} ос. + {d.mode === 'plane' ? "оплата багажу" : "місцевий доїзд"}. 
                  {budgetObj.seasonMulti !== 1 && " (Коеф. сезону " + budgetObj.seasonMulti + "x)"}
                </div>
              </div>

              <div style={{ marginBottom: "12px", paddingBottom: "12px", borderBottom: "1px dashed #cbd5e1" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, color: "#334155" }}>
                  <span>🏠 Житло (~{budgetObj.housingRooms} кімнат)</span> <span>€{budgetObj.breakdown.housing}</span>
                </div>
                <div style={{ color: "#64748b", fontSize: "11px", marginTop: "4px" }}>
                  {tripDays} ночей + прибирання + тур. збір.
                  {isOffSeason && <span style={{ color: "#166534", fontWeight: 700 }}> Несезонна знижка (коеф. {budgetObj.seasonMulti}x).</span>}
                  {!isOffSeason && budgetObj.seasonMulti > 1 && <span style={{ color: "#9a3412" }}> Сезонна надбавка (коеф. {budgetObj.seasonMulti}x).</span>}
                </div>
              </div>

              <div style={{ marginBottom: "12px", paddingBottom: "12px", borderBottom: "1px dashed #cbd5e1" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, color: "#334155" }}>
                  <span>🍽 Харчування</span> <span>€{budgetObj.breakdown.food}</span>
                </div>
              </div>

              <div style={{ marginBottom: "12px", paddingBottom: "12px", borderBottom: "1px dashed #cbd5e1" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, color: "#334155" }}>
                  <span>🎟 Розваги і локальний транспорт</span> <span>€{budgetObj.breakdown.entertainment}</span>
                </div>
              </div>

              {budgetObj.needsTransit && (
                <div style={{ marginBottom: "12px", paddingBottom: "12px", borderBottom: "1px dashed #cbd5e1", color: "#b45309" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
                    <span>🛏 Транзит (2 ночі в дорозі)</span> <span>€{budgetObj.breakdown.transit}</span>
                  </div>
                  <div style={{ fontSize: "11px", marginTop: "4px" }}>
                    Через довгу дорогу (понад 20 год) додано готель + їжу.
                  </div>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, color: "#64748b" }}>
                <span>🛡 Буфер (+10% резерв)</span> <span>€{budgetObj.breakdown.contingency}</span>
              </div>
            </div>

            <div style={{ background: "#0f172a", color: "white", padding: "12px 15px", borderRadius: "10px", marginTop: "10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 800, fontSize: "12px", textTransform: "uppercase" }}>Всього під ключ:</span>
              <span style={{ fontWeight: 900, fontSize: "20px" }}>€{budgetObj.grandTotal}</span>
            </div>
          </div>

          <div>
            <h4 style={{ margin: "0 0 15px 0", color: "#3b82f6", fontSize: "12px", letterSpacing: "1px", textTransform: "uppercase" }}>🗺️ Маршрут та програма</h4>
            
            <div style={{ background: "white", padding: "15px", borderRadius: "12px", border: "1px solid #e2e8f0", marginBottom: "15px" }}>
              {d.travel?.legs?.map((leg, i) => <div key={i} style={{ fontSize: "13px", fontWeight: 600, marginBottom: "6px", color: "#334155" }}>📍 {leg}</div>)}
              <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px dashed #cbd5e1", fontSize: "12px", display: "flex", justifyContent: "space-between", color: "#64748b", fontWeight: 600 }}>
                <span>Пересадок: <b style={{ color: d.travel?.transfers === 0 ? "#10b981" : "#0f172a" }}>{d.travel?.transfers}</b></span>
                <span>Відстань: <b>~{d.travel?.distanceKm} км</b></span>
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "15px" }}>
              {d.highlights?.map((h, i) => (
                <span key={i} style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: "20px", padding: "6px 12px", fontSize: "12px", fontWeight: 600, color: "#1e293b" }}>
                  <span style={{ color: "#10b981", marginRight: "4px" }}>✓</span>{h}
                </span>
              ))}
            </div>

            <p style={{ fontSize: "13px", fontStyle: "italic", color: "#475569", background: "#f1f5f9", padding: "12px", borderRadius: "8px" }}>"{d.notes}"</p>
            
            <div style={{ marginTop: "20px", display: "flex", gap: "10px" }}>
              <a href={bookingUrl} target="_blank" rel="noreferrer" style={{ flex: 1, background: "#0f172a", color: "white", padding: "12px", borderRadius: "8px", textAlign: "center", textDecoration: "none", fontWeight: 700, fontSize: "13px" }}>🏨 Житло на {budgetObj.totalPeople} осіб</a>
              {d.mode === "plane" && (
                <a href={"https://www.google.com/flights?q=flights+to+" + encodeURIComponent(d.name)} target="_blank" rel="noreferrer" style={{ flex: 1, background: "#3b82f6", color: "white", padding: "12px", borderRadius: "8px", textAlign: "center", textDecoration: "none", fontWeight: 700, fontSize: "13px" }}>✈️ Авіаквитки</a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
// ─── ГОЛОВНИЙ КОМПОНЕНТ ──────────────────────────────────────────────────
export default function FamilyTravelPlanner() {
  const [viewMode, setViewMode] = useState("list");           
  const [tripDays, setTripDays] = useState(7);
  const [search, setSearch] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(0);
  const [expanded, setExpanded] = useState(null);
  const [visibleCount, setVisibleCount] = useState(20);

  const [family, setFamily] = useState({ adults: 2, teens: 1, children: 2, infants: 1 });
  const totalPeople = family.adults + family.teens + family.children + family.infants;

  const [onlySwim, setOnlySwim] = useState(false);
  const [modeFilter, setModeFilter] = useState("all");
  const [maxBudget, setMaxBudget] = useState(30000);
  const [sortBy, setSortBy] = useState("rank");
  const [maxDailyBudget, setMaxDailyBudget] = useState(2000);
  const [filterAges, setFilterAges] = useState({ toddler: false, schoolAge: false, teen: false });

  // Скидаємо стан тільки якщо змінилися реальні фільтри (але НЕ viewMode і не expanded)
  useEffect(() => {
    setExpanded(null);
    setVisibleCount(20);
  },[search, selectedMonth, onlySwim, modeFilter, maxBudget, maxDailyBudget, filterAges, family, tripDays]);

  useEffect(() => {
    if (viewMode === "list" && expanded) {
      setTimeout(() => {
        const el = document.getElementById("card-" + expanded);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 150);
    }
  }, [expanded, viewMode]);

  const processedList = useMemo(() => {
    let a = [...DESTINATIONS];
    
    if (search) {
      const q = search.toLowerCase();
      a = a.filter(d => (d.name + " " + d.country + " " + d.region).toLowerCase().includes(q));
    }
    
    if (onlySwim) a = a.filter(d => d.climate?.canSwim);
    if (modeFilter !== "all") a = a.filter(d => d.mode === modeFilter);
    
    // Розраховуємо бюджет одразу для всіх карток (1 раз)
    a = a.map(d => ({
      ...d,
      budgetObj: calculateDetailedBudget(d, tripDays, selectedMonth, family)
    }));

    a = a.filter(d => maxBudget >= 30000 || d.budgetObj.grandTotal <= maxBudget);
    
    if (maxDailyBudget < 2000) {
      a = a.filter(d => {
        const dailyBurnRate = (d.budgetObj.breakdown.housing + d.budgetObj.breakdown.food + d.budgetObj.breakdown.entertainment) / tripDays;
        return dailyBurnRate <= maxDailyBudget;
      });
    }
    
    if (filterAges.toddler)   a = a.filter(d => d.kidFriendly?.toddler);
    if (filterAges.schoolAge) a = a.filter(d => d.kidFriendly?.schoolAge);
    if (filterAges.teen)      a = a.filter(d => d.kidFriendly?.teen);

    if (sortBy === "time")  a.sort((x, y) => (x.travel?.timeHours || 0) - (y.travel?.timeHours || 0));
    if (sortBy === "price") a.sort((x, y) => x.budgetObj.grandTotal - y.budgetObj.grandTotal);
    if (sortBy === "score") a.sort((x, y) => (y.familyScore || 0) - (x.familyScore || 0));

    return a;
  },[search, selectedMonth, onlySwim, modeFilter, maxBudget, maxDailyBudget, filterAges, tripDays, sortBy, family]);

  const handleToggle = useCallback((id) => setExpanded(prev => prev === id ? null : id),[]);
  
  // ВИПРАВЛЕНА ФУНКЦІЯ ПЕРЕХОДУ З МАПИ
  const handleShowDetailFromMap = useCallback((id) => {
    const index = processedList.findIndex(item => item.id === id);
    if (index !== -1 && index >= visibleCount) {
      setVisibleCount(index + 10);
    }
    setViewMode("list");
    setExpanded(id);
  }, [processedList, visibleCount]);

  return (
    <div style={{ background: "#f8fafc", color: "#1e293b", minHeight: "100vh", padding: "20px", fontFamily: "'Inter', sans-serif" }}>
      
      {/* HEADER & CONTROLS */}
      <div style={{ maxWidth: "1200px", margin: "0 auto", background: "white", padding: "25px", borderRadius: "16px", boxShadow: "0 4px 15px rgba(0,0,0,0.05)", marginBottom: "20px" }}>
        
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "15px", marginBottom: "20px" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 900, color: "#0f172a" }}>🗺️ Kyiv Family Vacation <span style={{ color: "#3b82f6" }}>PRO</span></h1>
            <p style={{ margin: "5px 0 0", color: "#64748b", fontSize: "14px", fontWeight: 600 }}>Точна логістика та бюджет на {totalPeople} осіб • знайдено: {processedList.length}</p>
          </div>
          <div style={{ display: "flex", gap: "8px", background: "#f1f5f9", padding: "6px", borderRadius: "12px" }}>
            <button onClick={() => setViewMode("list")} style={{ padding: "8px 16px", borderRadius: "8px", fontWeight: 800, border: "none", background: viewMode === "list" ? "white" : "transparent", color: viewMode === "list" ? "#0f172a" : "#64748b", boxShadow: viewMode === "list" ? "0 2px 4px rgba(0,0,0,0.1)" : "none", cursor: "pointer", transition: "all 0.2s" }}>📋 Список</button>
            <button onClick={() => setViewMode("map")} style={{ padding: "8px 16px", borderRadius: "8px", fontWeight: 800, border: "none", background: viewMode === "map" ? "#10b981" : "transparent", color: viewMode === "map" ? "white" : "#64748b", boxShadow: viewMode === "map" ? "0 2px 4px rgba(0,0,0,0.1)" : "none", cursor: "pointer", transition: "all 0.2s" }}>🗺️ Мапа</button>
          </div>
        </div>

        <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "12px", border: "1px solid #e2e8f0", marginBottom: "20px" }}>
          <div style={{ fontSize: "11px", fontWeight: 900, color: "#3b82f6", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "12px" }}>👨‍👩‍👧‍👦 Налаштування складу родини</div>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <FamilyCounter label="Дорослі (18+)" value={family.adults} onChange={v => setFamily({...family, adults: v})} min={1} />
            <FamilyCounter label="Підлітки (12-17)" value={family.teens} onChange={v => setFamily({...family, teens: v})} />
            <FamilyCounter label="Діти (3-11)" value={family.children} onChange={v => setFamily({...family, children: v})} />
            <FamilyCounter label="Немовлята (0-2)" value={family.infants} onChange={v => setFamily({...family, infants: v})} />
          </div>
        </div>

        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 180px" }}>
            <div style={{ fontSize: "11px", fontWeight: 800, color: "#64748b", marginBottom: "6px", textTransform: "uppercase" }}>🔍 Пошук</div>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Місто або країна..." style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid #cbd5e1", fontWeight: 600, boxSizing: "border-box" }} />
          </div>

          <div style={{ flex: "1 1 160px" }}>
            <div style={{ fontSize: "11px", fontWeight: 800, color: "#64748b", marginBottom: "6px", textTransform: "uppercase" }}>📅 Перевірка сезону</div>
            <select value={selectedMonth} onChange={e => setSelectedMonth(Number(e.target.value))} style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid #cbd5e1", fontWeight: 600, background: "white", cursor: "pointer" }}>
              {MONTHS_MAP.map(m => <option key={m.val} value={m.val}>{m.label}</option>)}
            </select>
          </div>

          <div style={{ flex: "1 1 130px" }}>
            <div style={{ fontSize: "11px", fontWeight: 800, color: "#64748b", marginBottom: "6px", textTransform: "uppercase" }}>🚀 Транспорт</div>
            <select value={modeFilter} onChange={e => setModeFilter(e.target.value)} style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid #cbd5e1", fontWeight: 600, background: "white", cursor: "pointer" }}>
              <option value="all">Всі варіанти</option><option value="train">🚂 Потяг</option><option value="plane">✈️ Літак</option><option value="bus">🚌 Автобус</option>
            </select>
          </div>

          <div style={{ flex: "1 1 150px" }}>
            <div style={{ fontSize: "11px", fontWeight: 800, color: "#64748b", marginBottom: "6px", textTransform: "uppercase" }}>↕️ Сортування</div>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid #cbd5e1", fontWeight: 600, background: "white", cursor: "pointer" }}>
              <option value="rank">За рейтингом</option><option value="time">За часом у дорозі</option><option value="price">За загальною ціною</option><option value="score">За сімейним балом</option>
            </select>
          </div>

          <div style={{ flex: "1 1 200px", background: "#f1f5f9", padding: "10px 16px", borderRadius: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px", fontSize: "11px", fontWeight: 800 }}>
              <span style={{ color: "#475569", textTransform: "uppercase" }}>🗓️ Тривалість</span><span style={{ color: "#3b82f6" }}>{tripDays} {getDaysLabel(tripDays).toUpperCase()}</span>
            </div>
            <input type="range" min="3" max="21" value={tripDays} onChange={e => setTripDays(Number(e.target.value))} style={{ width: "100%", cursor: "pointer" }} />
          </div>

          <div style={{ flex: "1 1 200px", background: "#f1f5f9", padding: "10px 16px", borderRadius: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px", fontSize: "11px", fontWeight: 800 }}>
              <span style={{ color: "#475569", textTransform: "uppercase" }}>💶 Макс. бюджет</span><span style={{ color: "#10b981" }}>{maxBudget >= 30000 ? "Без ліміту" : "€" + maxBudget}</span>
            </div>
            <input type="range" min="1000" max="30000" step="500" value={maxBudget} onChange={e => setMaxBudget(Number(e.target.value))} style={{ width: "100%", cursor: "pointer" }} />
          </div>

          <div style={{ flex: "0 0 auto" }}>
            <div style={{ fontSize: "11px", fontWeight: 800, color: "#64748b", marginBottom: "6px", textTransform: "uppercase" }}>🏖️ Фільтр</div>
            <button onClick={() => setOnlySwim(v => !v)} style={{ padding: "10px 16px", borderRadius: "10px", border: "2px solid", borderColor: onlySwim ? "#3b82f6" : "#cbd5e1", background: onlySwim ? "#eff6ff" : "white", color: onlySwim ? "#3b82f6" : "#64748b", fontWeight: 800, cursor: "pointer", fontSize: "13px" }}>
              🌊 {onlySwim ? "Тільки море ✓" : "Тільки море"}
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "flex-start", marginTop: "16px", paddingTop: "16px", borderTop: "1px solid #f1f5f9" }}>
          <div style={{ flex: "1 1 280px", background: "#f8fafc", padding: "12px 16px", borderRadius: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
              <span style={{ fontSize: "11px", fontWeight: 800, color: "#475569", textTransform: "uppercase" }}>💶 Витрати на день ({totalPeople} осіб)</span>
              <span style={{ fontSize: "12px", fontWeight: 800, color: "#10b981" }}>{maxDailyBudget >= 2000 ? "Без ліміту" : "≤ €" + maxDailyBudget + "/день"}</span>
            </div>
            <input type="range" min="100" max="2000" step="50" value={maxDailyBudget} onChange={e => setMaxDailyBudget(Number(e.target.value))} style={{ width: "100%", cursor: "pointer" }} />
          </div>

          <div style={{ flex: "1 1 320px" }}>
            <div style={{ fontSize: "11px", fontWeight: 800, color: "#475569", textTransform: "uppercase", marginBottom: "10px" }}>⚙️ Фільтр за зручностями для віку:</div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {[ { key: "toddler", label: "Малюки", icon: "🧸", color: "#f59e0b" }, { key: "schoolAge", label: "Школярі", icon: "⚽", color: "#3b82f6" }, { key: "teen", label: "Підлітки", icon: "🎮", color: "#8b5cf6" }].map(({ key, label, icon, color }) => (
                <button key={key} onClick={() => setFilterAges(prev => ({ ...prev,[key]: !prev[key] }))} style={{ padding: "8px 14px", borderRadius: "20px", border: "2px solid", borderColor: filterAges[key] ? color : "#e2e8f0", background: filterAges[key] ? color + "18" : "white", color: filterAges[key] ? color : "#64748b", fontWeight: 700, cursor: "pointer", fontSize: "12px", display: "flex", alignItems: "center", gap: "6px", transition: "all 0.2s" }}>
                  {icon} {label} {filterAges[key] ? "✓" : ""}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        {viewMode === "map" ? (
          <div style={{ height: "75vh", borderRadius: "16px", overflow: "hidden", border: "1px solid #e2e8f0", boxShadow: "0 4px 20px rgba(0,0,0,0.05)" }}>
            <MapContainer center={[48.8566, 15.3522]} zoom={4} style={{ height: "100%", width: "100%" }}>
            <TileLayer 
  url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
  attribution='&copy; OpenStreetMap contributors &copy; CartoDB'
/>
              
              <MapBoundsFit markers={processedList} />
              
              {processedList.map((d) => (
                <Marker key={d.id} position={[d.lat, d.lng]}>
                  <Popup>
                    <div style={{ fontFamily: "Inter", minWidth: "180px" }}>
                      <strong style={{ fontSize: "14px" }}>{d.flag} {d.name}</strong>
                      <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>В дорозі: {d.travel?.timeHours}г</div>
                      <div style={{ fontSize: "12px", color: "#64748b" }}>Бюджет на {totalPeople} ос.: ~€{d.budgetObj.grandTotal}</div>
                      <div style={{ display: "flex", gap: "3px", marginTop: "6px" }}>
                        {d.kidFriendly?.toddler   && <span style={{ background: "#fef3c7", color: "#92400e", borderRadius: "4px", padding: "1px 5px", fontSize: "10px", fontWeight: 700 }}>🧸</span>}
                        {d.kidFriendly?.schoolAge && <span style={{ background: "#dbeafe", color: "#1e40af", borderRadius: "4px", padding: "1px 5px", fontSize: "10px", fontWeight: 700 }}>⚽</span>}
                        {d.kidFriendly?.teen      && <span style={{ background: "#ede9fe", color: "#5b21b6", borderRadius: "4px", padding: "1px 5px", fontSize: "10px", fontWeight: 700 }}>🎮</span>}
                      </div>
                      <button onClick={() => handleShowDetailFromMap(d.id)} style={{ marginTop: "10px", width: "100%", padding: "6px", background: "#3b82f6", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: 700 }}>Детальніше →</button>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            
            {processedList.slice(0, visibleCount).map(item => (
              <div key={item.id} id={"card-" + item.id}>
                <DestinationCard 
                  d={item} 
                  budgetObj={item.budgetObj}
                  isEx={expanded === item.id} 
                  onToggle={handleToggle} 
                  tripDays={tripDays} 
                  family={family} 
                />
              </div>
            ))}
            
            {visibleCount < processedList.length && (
              <button 
                onClick={() => setVisibleCount(prev => prev + 20)}
                style={{ padding: "14px", background: "#f1f5f9", color: "#334155", border: "2px dashed #cbd5e1", borderRadius: "12px", cursor: "pointer", fontWeight: 800, fontSize: "14px", transition: "all 0.2s" }}
              >
                ⬇️ Показати ще 20 напрямків (залишилось {processedList.length - visibleCount})
              </button>
            )}
            
            {processedList.length === 0 && (
              <div style={{ padding: "40px", textAlign: "center", color: "#64748b", fontWeight: 600 }}>
                😔 За вашими фільтрами нічого не знайдено. Спробуйте збільшити бюджет або змінити параметри.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
