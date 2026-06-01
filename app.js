// 영화관 데이터: OpenStreetMap Overpass API (cinema)
// 지도: Leaflet + OSM 타일

let map;
let userMarker;
let cinemaLayer = L.layerGroup();
let selectedMarker = null;

// ✅ 커스텀 핀 아이콘 생성 함수
function makeIcon(color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="42" viewBox="0 0 28 42">
    <path d="M14 0C6.27 0 0 6.27 0 14c0 10.5 14 28 14 28s14-17.5 14-28C28 6.27 21.73 0 14 0z" fill="${color}" stroke="#fff" stroke-width="1.5"/>
    <circle cx="14" cy="14" r="6" fill="#fff" opacity="0.9"/>
  </svg>`;
  return L.icon({
    iconUrl: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
    iconSize: [28, 42],
    iconAnchor: [14, 42],
    popupAnchor: [0, -36]
  });
}

const ICON_MULTIPLEX = makeIcon('#e74c3c');   // 빨간색 — 멀티플렉스
const ICON_INDIE     = makeIcon('#27ae60');   // 초록색 — 독립·기타
const ICON_USER      = makeIcon('#3498db');   // 파란색 — 내 위치

let allCinemas = [];
let currentFilter = 'all';

let currentPos = { lat: 37.5665, lon: 126.9780 }; // 기본값(서울시청)
const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");

// ✅ 어르신 모드 상태
let seniorMode = false;
let coachStep = 0;

const btnSenior = document.getElementById("btnSenior");
const coachEl = document.getElementById("coach");
const coachTitleEl = document.getElementById("coachTitle");
const coachTextEl = document.getElementById("coachText");
const coachNextEl = document.getElementById("coachNext");
const coachCloseEl = document.getElementById("coachClose");
const toastEl = document.getElementById("toast");


window.addEventListener("DOMContentLoaded", () => {
  initMap();
  registerSW();
  wireUI();
  locateUser(false);
});


function initMap() {
  map = L.map("map", { zoomControl: true }).setView([currentPos.lat, currentPos.lon], 13);

  // 밝은 타일 사용 (CartoDB Positron — 화이트 테마에 어울림)
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
  }).addTo(map);

  cinemaLayer.addTo(map);

  map.on("click", (e) => {

    if (seniorMode) toast("지금 누르신 건 ‘검색 위치 선택’이에요. 이제 ‘주변 검색’을 눌러보세요.");

  const { lat, lng } = e.latlng;

  // 기존 선택 핀 있으면 제거
  if (selectedMarker) {
    selectedMarker.remove();
  }

  // 새 핀 생성
  selectedMarker = L.marker([lat, lng]).addTo(map)
    .bindPopup("선택한 위치 기준으로 검색")
    .openPopup();

  // 기준 위치를 이 좌표로 변경
  currentPos = { lat, lon: lng };

  setStatus(`선택 위치: ${lat.toFixed(5)}, ${lng.toFixed(5)} (이 위치 기준 검색 가능)`);
});

}

function wireUI() {
  const btnLocate = document.getElementById("btnLocate");
  if (btnLocate) {
    btnLocate.addEventListener("click", () => locateUser(true));
  }

  const btnSearch = document.getElementById("btnSearch");
  if (btnSearch) {
    btnSearch.addEventListener("click", () => searchCinemas());
  }

  const btnSenior = document.getElementById("btnSenior");
  if (btnSenior) {
    btnSenior.addEventListener("click", toggleSeniorMode);
  }

  const coachNext = document.getElementById("coachNext");
  if (coachNext) {
    coachNext.addEventListener("click", nextCoachStep);
  }

  const coachClose = document.getElementById("coachClose");
  if (coachClose) {
    coachClose.addEventListener("click", closeCoach);
  }

  const btnFilterAll = document.getElementById("btnFilterAll");
  const btnFilterMultiplex = document.getElementById("btnFilterMultiplex");
  const btnFilterIndie = document.getElementById("btnFilterIndie");

  if (btnFilterAll) btnFilterAll.addEventListener("click", () => setFilter('all'));
  if (btnFilterMultiplex) btnFilterMultiplex.addEventListener("click", () => setFilter('multiplex'));
  if (btnFilterIndie) btnFilterIndie.addEventListener("click", () => setFilter('indie'));
}


function setStatus(msg) {
  statusEl.textContent = msg;
}

async function locateUser(moveMap) {
  if (!navigator.geolocation) {
    setStatus("이 브라우저는 위치 기능을 지원하지 않아요.");
    return;
  }

  setStatus("내 위치 가져오는 중… (권한 허용 필요)");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      currentPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      setStatus(`내 위치: ${currentPos.lat.toFixed(5)}, ${currentPos.lon.toFixed(5)}`);

      if (userMarker) userMarker.remove();
      userMarker = L.marker([currentPos.lat, currentPos.lon], { icon: ICON_USER }).addTo(map).bindPopup("내 위치");

      if (moveMap) map.setView([currentPos.lat, currentPos.lon], 14);
    },
    (err) => {
      setStatus(`위치 가져오기 실패: ${err.message} (기본 위치로 표시 중)`);
      if (moveMap) map.setView([currentPos.lat, currentPos.lon], 13);
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

function metersToKm(m) {
  return (m / 1000).toFixed(2);
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(a));
}

async function searchCinemas() {
  if (!currentPos?.lat || !currentPos?.lon) {
    setStatus("먼저 '내 위치로' 버튼을 눌러주세요.");
    return;
  }

  const radius = parseInt(document.getElementById("radius").value, 10);

  setStatus(`주변 영화관 검색 중… (${metersToKm(radius)}km)`);
  listEl.innerHTML = "";
  cinemaLayer.clearLayers();

  const url = `/api/cinemas?lat=${currentPos.lat}&lon=${currentPos.lon}&radius=${radius}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error || "서버 응답 오류");
    }
    
    const items = await response.json();

    if (items.length === 0) {
      const filtersEl = document.getElementById("filters");
      if (filtersEl) filtersEl.classList.add("hidden");
      setStatus("근처 영화관을 못 찾았어요. 반경을 늘려보세요.");
      return;
    }

    allCinemas = items;
    const filtersEl = document.getElementById("filters");
    if (filtersEl) filtersEl.classList.remove("hidden");

    // 범례 보이기
    const legendEl = document.getElementById("legend");
    if (legendEl) legendEl.classList.remove("hidden");
    
    setFilter('all');
  } catch (e) {
    setStatus(`검색 실패: ${e.message}`);
  }
}

function setFilter(filterType) {
  currentFilter = filterType;
  
  const btnAll = document.getElementById("btnFilterAll");
  const btnMulti = document.getElementById("btnFilterMultiplex");
  const btnIndie = document.getElementById("btnFilterIndie");
  
  if (btnAll) btnAll.classList.toggle("active", filterType === 'all');
  if (btnMulti) btnMulti.classList.toggle("active", filterType === 'multiplex');
  if (btnIndie) btnIndie.classList.toggle("active", filterType === 'indie');
  
  renderCinemas();
}

function isMultiplex(name) {
  const n = name.toLowerCase().replace(/\s+/g, '');
  return n.includes("cgv") || n.includes("메가박스") || n.includes("megabox") || n.includes("롯데시네마") || n.includes("lottecinema");
}

function renderCinemas() {
  listEl.innerHTML = "";
  cinemaLayer.clearLayers();

  let filtered = allCinemas;
  if (currentFilter === 'multiplex') {
    filtered = allCinemas.filter(it => isMultiplex(it.name));
  } else if (currentFilter === 'indie') {
    filtered = allCinemas.filter(it => !isMultiplex(it.name));
  }

  setStatus(`영화관 ${filtered.length}개 발견! (가까운 순)`);

  if (filtered.length === 0) {
    const li = document.createElement("li");
    li.className = "item";
    li.innerHTML = `<div class="name" style="text-align: center; color: var(--muted); padding: 20px 0;">조건에 맞는 영화관이 없습니다.</div>`;
    listEl.appendChild(li);
    return;
  }

  // 지도 마커 + 리스트
  filtered.forEach((it) => {
    const multiplex = isMultiplex(it.name);
    const icon = multiplex ? ICON_MULTIPLEX : ICON_INDIE;
    const typeClass = multiplex ? 'multiplex' : 'indie';
    const typeLabel = multiplex ? '멀티플렉스' : '독립·기타';

    const marker = L.marker([it.lat, it.lon], { icon })
      .bindPopup(`<b>${escapeHtml(it.name)}</b><br/><span style="color:${multiplex ? '#e74c3c' : '#27ae60'}">${typeLabel}</span><br/>${escapeHtml(it.addr || "")}<br/>거리: ${Math.round(it.dist)}m`);
    cinemaLayer.addLayer(marker);

    marker.on("click", () => {
      if (seniorMode) toast("지금 누르신 건 '영화관 선택'이에요. 영화관 정보를 보고 있어요.");
    });

    const li = document.createElement("li");
    li.className = "item";
    li.innerHTML = `
      <div class="name"><span class="pin-badge ${typeClass}"></span>${escapeHtml(it.name)}</div>
      <div class="meta">
        <div>거리: ${Math.round(it.dist)}m</div>
        ${it.addr ? `<div>주소: ${escapeHtml(it.addr)}</div>` : ""}
        <div>
          <a href="${it.naviUrl}" target="_blank" rel="noreferrer">길찾기</a>
          ·
          <a href="${it.osmUrl}" target="_blank" rel="noreferrer">OSM 보기</a>
        </div>
      </div>
    `;
    li.addEventListener("click", () => {
      if (seniorMode) {
        toast("지금 누르신 건 ‘영화관 선택’이에요. 지도가 이동했어요.");
      }
      map.setView([it.lat, it.lon], 16);
      marker.openPopup();
    });
    listEl.appendChild(li);
  });

  // 화면에 다 보이게
  const bounds = L.latLngBounds(filtered.map((i) => [i.lat, i.lon]));
  if (userMarker) bounds.extend(userMarker.getLatLng());
  if (bounds.isValid()) {
    map.fitBounds(bounds.pad(0.2));
  }
}

// XSS 방지용(기본)
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// PWA: Service Worker 등록
function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch (_) {
      // 조용히 무시(개발 중이면 흔함)
    }
  });
}

console.log("postOverpass:", typeof postOverpass);

function toggleSeniorMode() {
  seniorMode = !seniorMode;
  document.body.classList.toggle("senior", seniorMode);
  btnSenior.textContent = seniorMode ? "쉬운 모드: ON" : "쉬운 모드: OFF";

  if (seniorMode) {
    coachStep = 0;
    openCoach();
    showCoachStep();
    toast("쉬운 모드를 켰어요. 안내를 따라 해보세요.");
  } else {
    closeCoach();
    toast("쉬운 모드를 껐어요.");
  }
}

function openCoach() {
  coachEl.classList.remove("hidden");
}

function closeCoach() {
  coachEl.classList.add("hidden");
}

function showCoachStep() {
  const steps = [
    {
      title: "1단계: 위치 확인",
      text: "먼저 ‘내 위치로’ 버튼을 눌러요. 위치를 허용하면 현재 위치가 표시돼요."
    },
    {
      title: "2단계: 주변 영화관 찾기",
      text: "그 다음 ‘주변 검색’ 버튼을 눌러요. 가까운 영화관 목록이 아래에 나타나요."
    },
    {
      title: "3단계: 영화관 선택하기",
      text: "목록에서 영화관을 누르거나, 지도에서 핀을 눌러요. 선택한 영화관으로 지도가 이동해요."
    }
  ];

  const s = steps[Math.min(coachStep, steps.length - 1)];
  coachTitleEl.textContent = s.title;
  coachTextEl.textContent = s.text;

  coachNextEl.textContent = coachStep >= steps.length - 1 ? "완료" : "다음";
}

function nextCoachStep() {
  // 마지막이면 닫기
  if (coachNextEl.textContent === "완료") {
    closeCoach();
    toast("좋아요! 이제 영화관을 눌러보세요.");
    return;
  }
  coachStep += 1;
  showCoachStep();
}

function toast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.remove("hidden");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.add("hidden"), 2200);
}
