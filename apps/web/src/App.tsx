import { useState, useMemo, useCallback } from "react";
import type { TrainSearchResponse, ScoredTrain, Preference } from "@return-school/shared";

const PREFERENCE_LABELS: Record<Preference, string> = {
  price_sensitive: "价格敏感",
  time_sensitive: "时间敏感",
  balanced: "都还行",
};

const DECISION_LABELS: Record<string, string> = {
  recommend: "推荐",
  optional: "可选",
  not_recommended: "不推荐",
};

const RISK_LABELS: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
};

const COMFORT_LABELS: Record<string, string> = {
  comfortable: "舒适",
  uncomfortable: "艰苦",
  unknown: "未知",
};

/** Compute date string N days before the given date. */
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function App() {
  // --- Form state ---
  const [departureCity, setDepartureCity] = useState("上海");
  const [destinationCity, setDestinationCity] = useState("烟台");
  const [preference, setPreference] = useState<Preference>("balanced");
  const [clockOutTime, setClockOutTime] = useState("18:00");
  const [companyToStationStr, setCompanyToStationStr] = useState("30");
  const [firstExamDate, setFirstExamDate] = useState("2026-06-27");
  const [firstExamTime, setFirstExamTime] = useState("09:00");
  const [departDate, setDepartDate] = useState(() => addDays("2026-06-27", -1));
  const [stationToSchoolStr, setStationToSchoolStr] = useState("30");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [stationEntryBufferStr, setStationEntryBufferStr] = useState("30");
  const [riskBufferStr, setRiskBufferStr] = useState("15");

  // Auto-derive departDate from firstExamDate when it changes
  const derivedDepartDate = useMemo(() => addDays(firstExamDate, -1), [firstExamDate]);

  const handleExamDateChange = useCallback((newExamDate: string) => {
    setFirstExamDate(newExamDate);
    setDepartDate(addDays(newExamDate, -1));
  }, []);

  // --- Result state ---
  const [result, setResult] = useState<TrainSearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handleSearch() {
    // Validate
    const companyToStation = parseMinutesStr(companyToStationStr);
    if (companyToStation === null) {
      setError("公司到高铁站时间必须为非负整数");
      return;
    }
    const stationToSchool = parseMinutesStr(stationToSchoolStr);
    if (stationToSchool === null) {
      setError("高铁站到学校时间必须为非负整数");
      return;
    }
    const stationEntry = parseMinutesStr(stationEntryBufferStr);
    if (stationEntryBufferStr !== "" && stationEntry === null) {
      setError("进站缓冲时间必须为非负整数");
      return;
    }
    const risk = parseMinutesStr(riskBufferStr);
    if (riskBufferStr !== "" && risk === null) {
      setError("风险缓冲时间必须为非负整数");
      return;
    }

    setError(null);
    setLoading(true);

    const firstExamAt = `${firstExamDate}T${firstExamTime}:00+08:00`;

    // Build station-to-school map (apply same minutes to all destination stations)
    const stationToSchoolMinutes: Record<string, number> = {};
    const stations = departureCity === "上海"
      ? ["烟台站", "烟台南站"]
      : ["上海虹桥", "上海站", "上海南站"];
    for (const s of stations) {
      stationToSchoolMinutes[s] = stationToSchool!;
    }

    const body: Record<string, unknown> = {
      departureCity,
      destinationCity,
      departDate,
      preference,
      clockOutTime,
      companyToStationMinutes: companyToStation,
      firstExamAt,
      stationToSchoolMinutes,
    };
    if (stationEntry !== null) body.stationEntryBufferMinutes = stationEntry;
    if (risk !== null) body.riskBufferMinutes = risk;

    fetch("/api/train/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) {
          setResult(data);
          setError(null);
        } else {
          setResult(null);
          setError(data.error ?? "搜索失败");
        }
      })
      .catch((err) => {
        setResult(null);
        setError(err instanceof Error ? err.message : "网络请求失败");
      })
      .finally(() => setLoading(false));
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col bg-gray-50 px-4 py-8">
      {/* Header */}
      <header className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900">返校高铁规划</h1>
        <p className="mt-2 text-sm text-gray-500">
          输入出发城市、目的城市和偏好，查看评分排序后的车次对比
        </p>
      </header>

      {/* Form */}
      <section className="rounded-xl bg-white p-6 shadow-sm">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Departure city */}
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">
              出发城市
            </span>
            <select
              value={departureCity}
              onChange={(e) => setDepartureCity(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900
                         focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="上海">上海</option>
            </select>
          </label>

          {/* Destination city */}
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">
              目的城市
            </span>
            <select
              value={destinationCity}
              onChange={(e) => setDestinationCity(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900
                         focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="烟台">烟台</option>
            </select>
          </label>

          {/* Preference */}
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">
              偏好设置
            </span>
            <select
              value={preference}
              onChange={(e) => setPreference(e.target.value as Preference)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900
                         focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="price_sensitive">价格敏感</option>
              <option value="time_sensitive">时间敏感</option>
              <option value="balanced">都还行</option>
            </select>
          </label>

          {/* Clock-out time */}
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">
              下班时间
            </span>
            <input
              type="time"
              value={clockOutTime}
              onChange={(e) => setClockOutTime(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900
                         focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>

          {/* Company-to-station */}
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">
              公司到高铁站（分钟）
            </span>
            <input
              type="number"
              min={0}
              step={1}
              value={companyToStationStr}
              onChange={(e) => setCompanyToStationStr(e.target.value)}
              placeholder="30"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900
                         placeholder-gray-300
                         focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>

          {/* Station-to-school */}
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">
              高铁站到学校（分钟）
            </span>
            <input
              type="number"
              min={0}
              step={1}
              value={stationToSchoolStr}
              onChange={(e) => setStationToSchoolStr(e.target.value)}
              placeholder="30"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900
                         placeholder-gray-300
                         focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>

          {/* Depart date (auto-derived from exam, overridable) */}
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">
              出发日期
            </span>
            <span className="mb-1 block text-xs text-gray-400">
              默认考试前一天（{derivedDepartDate}）
            </span>
            <input
              type="date"
              value={departDate}
              onChange={(e) => setDepartDate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900
                         focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>

          {/* First exam date */}
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-medium text-gray-700">
              最早考试时间
            </span>
            <div className="flex gap-2">
              <input
                type="date"
                value={firstExamDate}
                onChange={(e) => handleExamDateChange(e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-gray-900
                           focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                type="time"
                value={firstExamTime}
                onChange={(e) => setFirstExamTime(e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-gray-900
                           focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </label>
        </div>

        {/* Advanced Settings toggle */}
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="mt-4 flex w-full items-center justify-between rounded-lg border
                     border-gray-200 px-3 py-2 text-sm text-gray-600
                     hover:bg-gray-50 transition-colors"
        >
          <span>高级设置</span>
          <span className="text-gray-400">{showAdvanced ? "▲" : "▼"}</span>
        </button>

        {showAdvanced && (
          <div className="mt-4 grid grid-cols-1 gap-4 rounded-lg bg-gray-50 p-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">
                进站缓冲时间（分钟）
              </span>
              <span className="mb-1 block text-xs text-gray-400">默认 30</span>
              <input
                type="number"
                min={0}
                step={1}
                value={stationEntryBufferStr}
                onChange={(e) => setStationEntryBufferStr(e.target.value)}
                placeholder="30"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900
                           placeholder-gray-300
                           focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">
                风险缓冲时间（分钟）
              </span>
              <span className="mb-1 block text-xs text-gray-400">默认 15</span>
              <input
                type="number"
                min={0}
                step={1}
                value={riskBufferStr}
                onChange={(e) => setRiskBufferStr(e.target.value)}
                placeholder="15"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900
                           placeholder-gray-300
                           focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </label>
          </div>
        )}

        {/* Search button */}
        <button
          type="button"
          onClick={handleSearch}
          disabled={loading}
          className="mt-6 w-full rounded-lg bg-blue-600 px-4 py-3 text-white font-medium
                     hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed
                     transition-colors"
        >
          {loading ? "搜索中…" : "搜索车次"}
        </button>
      </section>

      {/* Error */}
      {error && (
        <section className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-600">
          {error}
        </section>
      )}

      {/* Results */}
      {result && (
        <section className="mt-6 rounded-xl bg-white p-6 shadow-sm">
          {/* Summary */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                车次对比列表
              </h2>
              <p className="text-sm text-gray-500">
                共 {result.total} 个车次 · 安全出发时间{" "}
                <span className="font-mono font-semibold text-blue-600">
                  {result.safeDepartureTime}
                </span>
                {" · "}偏好：{PREFERENCE_LABELS[preference]}
              </p>
            </div>
          </div>

          {result.trains.length === 0 ? (
            <div className="py-12 text-center text-gray-400">
              <p className="text-lg">未找到可用车次</p>
              <p className="mt-1 text-sm">
                尝试调整出发城市或目的城市
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-gray-200 text-left text-xs uppercase text-gray-500">
                    <th className="whitespace-nowrap pb-2 pr-3">车次</th>
                    <th className="whitespace-nowrap pb-2 pr-3">出发 → 到达</th>
                    <th className="whitespace-nowrap pb-2 pr-3">出发时间</th>
                    <th className="whitespace-nowrap pb-2 pr-3">到达时间</th>
                    <th className="whitespace-nowrap pb-2 pr-3">历时</th>
                    <th className="whitespace-nowrap pb-2 pr-3">价格</th>
                    <th className="whitespace-nowrap pb-2 pr-3">舒适度</th>
                    <th className="whitespace-nowrap pb-2 pr-3">评分</th>
                    <th className="whitespace-nowrap pb-2 pr-3">风险</th>
                    <th className="whitespace-nowrap pb-2">推荐</th>
                  </tr>
                </thead>
                <tbody>
                  {result.trains.map((train) => (
                    <TrainRow key={train.id} train={train} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

/** Display a single train row in the comparison table. */
function TrainRow({ train }: { train: ScoredTrain }) {
  const isRecommend = train.decision === "recommend";
  const isNotRecommended = train.decision === "not_recommended";

  const departTime = extractTime(train.departureTime);
  const arriveTime = extractTime(train.arrivalTime);

  const durationHours = Math.floor(train.durationMinutes / 60);
  const durationMins = train.durationMinutes % 60;
  const durationStr =
    durationHours > 0
      ? `${durationHours}h${String(durationMins).padStart(2, "0")}m`
      : `${durationMins}m`;

  const comfortBadgeColor =
    train.comfortLevel === "comfortable"
      ? "bg-green-100 text-green-700"
      : train.comfortLevel === "uncomfortable"
        ? "bg-orange-100 text-orange-700"
        : "bg-gray-100 text-gray-600";

  const riskBadgeColor =
    train.riskLevel === "low"
      ? "bg-green-100 text-green-700"
      : train.riskLevel === "medium"
        ? "bg-yellow-100 text-yellow-700"
        : "bg-red-100 text-red-700";

  const decisionBadgeColor =
    train.decision === "recommend"
      ? "bg-blue-100 text-blue-700"
      : train.decision === "optional"
        ? "bg-gray-100 text-gray-600"
        : "bg-red-50 text-red-500";

  return (
    <tr
      className={`border-b border-gray-100 ${
        isRecommend ? "bg-blue-50/50" : ""
      } ${isNotRecommended ? "opacity-60" : ""}`}
    >
      <td className="whitespace-nowrap py-3 pr-3">
        <div className="flex items-center gap-1">
          {isRecommend && <span title="推荐">⭐</span>}
          <span className="font-mono font-semibold text-gray-900">
            {train.trainNumber}
          </span>
          <span className="text-xs text-gray-400">{train.trainType}</span>
        </div>
      </td>
      <td className="whitespace-nowrap py-3 pr-3 text-gray-700">
        <span>{train.departureStation}</span>
        <span className="mx-1 text-gray-300">→</span>
        <span>{train.arrivalStation}</span>
      </td>
      <td className="whitespace-nowrap py-3 pr-3 font-mono text-gray-900">
        {departTime}
      </td>
      <td className="whitespace-nowrap py-3 pr-3 font-mono text-gray-900">
        {arriveTime}
      </td>
      <td className="whitespace-nowrap py-3 pr-3 text-gray-600">
        {durationStr}
      </td>
      <td className="whitespace-nowrap py-3 pr-3 font-mono text-gray-900">
        ¥{train.price}
      </td>
      <td className="whitespace-nowrap py-3 pr-3">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${comfortBadgeColor}`}
        >
          {COMFORT_LABELS[train.comfortLevel]}
        </span>
      </td>
      <td className="whitespace-nowrap py-3 pr-3">
        <span
          className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
            train.score >= 52
              ? "bg-green-100 text-green-700"
              : train.score >= 35
                ? "bg-yellow-100 text-yellow-700"
                : "bg-red-100 text-red-700"
          }`}
        >
          {train.score}
        </span>
      </td>
      <td className="whitespace-nowrap py-3 pr-3">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${riskBadgeColor}`}
        >
          {RISK_LABELS[train.riskLevel]}
        </span>
      </td>
      <td className="whitespace-nowrap py-3">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${decisionBadgeColor}`}
        >
          {DECISION_LABELS[train.decision]}
        </span>
      </td>
    </tr>
  );
}

/** Parse a minute string to a non-negative integer. */
function parseMinutesStr(s: string): number | null {
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
}

/** Extract "HH:mm" from an ISO 8601 datetime string. */
function extractTime(iso: string): string {
  const match = iso.match(/T(\d{2}):(\d{2})/);
  if (match) return `${match[1]}:${match[2]}`;
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return iso;
  }
}
