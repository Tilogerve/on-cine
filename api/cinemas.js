// api/cinemas.js

// 두 좌표 간의 거리(m) 계산 함수 (서버 측 연산)
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

export default async function handler(req, res) {
  // CORS 헤더 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // OPTIONS 예비 요청 처리
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { lat, lon, radius } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ error: "lat and lon parameters are required." });
  }

  const userLat = parseFloat(lat);
  const userLon = parseFloat(lon);
  const searchRadius = parseInt(radius || "3000", 10);

  // Overpass Query Language
  const query = `
[out:json][timeout:15];
(
  node["amenity"="cinema"](around:${searchRadius},${userLat},${userLon});
  way["amenity"="cinema"](around:${searchRadius},${userLat},${userLon});
  relation["amenity"="cinema"](around:${searchRadius},${userLat},${userLon});
);
out tags center;
`.trim();

  // 대피용 다중 백업 엔드포인트 목록
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter"
  ];

  let lastErr = null;

  for (const url of endpoints) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: "data=" + encodeURIComponent(query)
      });

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      const rawData = await response.json();
      
      // 영화관 정보 가공 및 거리 정렬 후 JSON 반환
      const items = (rawData.elements || [])
        .map((el) => {
          const latVal = el.lat ?? el.center?.lat;
          const lonVal = el.lon ?? el.center?.lon;
          if (typeof latVal !== "number" || typeof lonVal !== "number") return null;

          const name = el.tags?.name || "이름 없음";
          const addr =
            el.tags?.["addr:full"] ||
            [el.tags?.["addr:city"], el.tags?.["addr:district"], el.tags?.["addr:street"], el.tags?.["addr:housenumber"]]
              .filter(Boolean)
              .join(" ") ||
            el.tags?.["addr:street"] ||
            "";

          const dist = haversineMeters(userLat, userLon, latVal, lonVal);
          const osmUrl = `https://www.openstreetmap.org/${el.type}/${el.id}`;
          const naviUrl = `https://www.google.com/maps/dir/?api=1&destination=${latVal},${lonVal}`;

          return { name, addr, lat: latVal, lon: lonVal, dist, osmUrl, naviUrl };
        })
        .filter(Boolean)
        .sort((a, b) => a.dist - b.dist);

      return res.status(200).json(items);
    } catch (e) {
      lastErr = e;
    }
  }

  return res.status(500).json({ error: "Overpass API request failed", details: lastErr?.message });
}
