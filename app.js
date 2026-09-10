const sampleSpots = [
  {name:"草津PA", kind:"PA", km:42.3, minutes:33},
  {name:"土山SA", kind:"SA", km:78.6, minutes:57},
  {name:"刈谷PA", kind:"PA", km:164.2, minutes:122},
  {name:"NEOPASA岡崎", kind:"SA", km:195.8, minutes:143},
  {name:"EXPASA浜名湖", kind:"SA", km:249.1, minutes:176},
  {name:"牧之原SA", kind:"SA", km:292.8, minutes:207},
  {name:"EXPASA足柄", kind:"SA", km:397.4, minutes:281}
];

const destination = document.querySelector("#destination");
const searchBtn = document.querySelector("#searchBtn");
const locateBtn = document.querySelector("#locateBtn");
const statusEl = document.querySelector("#status");
const spotsEl = document.querySelector("#spots");
const countEl = document.querySelector("#count");
const summaryEl = document.querySelector("#summary");
const totalDistanceEl = document.querySelector("#totalDistance");
const etaEl = document.querySelector("#eta");
const remainingTimeEl = document.querySelector("#remainingTime");

function formatTime(date) {
  return date.toLocaleTimeString("ja-JP", {hour:"2-digit", minute:"2-digit"});
}

function render(spots, totalKm, totalMinutes) {
  const now = new Date();
  const eta = new Date(now.getTime() + totalMinutes * 60000);

  totalDistanceEl.textContent = `${totalKm.toFixed(1)} km`;
  etaEl.textContent = formatTime(eta);
  remainingTimeEl.textContent = `${Math.floor(totalMinutes/60)}時間${totalMinutes%60}分`;
  summaryEl.classList.remove("hidden");

  spotsEl.innerHTML = spots.map((s, i) => {
    const arrival = new Date(now.getTime() + s.minutes * 60000);
    return `
      <article class="spot">
        <div class="badge">${s.kind === "SA" ? "S" : "P"}</div>
        <div>
          <h3>${s.name}</h3>
          <p>${s.kind} ・ 到着予定 ${formatTime(arrival)}</p>
        </div>
        <div class="distance">
          <strong>${s.km.toFixed(1)} km</strong>
          <span>あと ${s.minutes}分</span>
        </div>
      </article>`;
  }).join("");
  countEl.textContent = `${spots.length}か所`;
}

function searchRoute() {
  const dest = destination.value.trim();
  if (!dest) {
    statusEl.textContent = "目的地を入力してください。";
    return;
  }
  statusEl.textContent = `「${dest}」へのプロトタイプルートを表示しています。`;
  // 実運用ではここをルートAPI呼び出しに置き換えます。
  render(sampleSpots, 496.0, 387);
}

searchBtn.addEventListener("click", searchRoute);
destination.addEventListener("keydown", e => {
  if (e.key === "Enter") searchRoute();
});

locateBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    statusEl.textContent = "このブラウザでは位置情報を利用できません。";
    return;
  }
  statusEl.textContent = "現在地を取得しています…";
  navigator.geolocation.getCurrentPosition(
    pos => {
      statusEl.textContent = `現在地を取得しました（緯度 ${pos.coords.latitude.toFixed(4)} / 経度 ${pos.coords.longitude.toFixed(4)}）。`;
    },
    () => {
      statusEl.textContent = "位置情報を取得できませんでした。Safariの位置情報許可を確認してください。";
    },
    {enableHighAccuracy:true, timeout:10000}
  );
});
