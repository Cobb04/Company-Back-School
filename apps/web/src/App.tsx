import { useState, useMemo, useCallback, useEffect } from "react";
import type { PlanEvaluateResponse, ScoredTrain, ReturnPlan, Preference, LeaveReason } from "@return-school/shared";

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

/**
 * Compute date string offset by N days from the given YYYY-MM-DD input.
 *
 * Uses UTC arithmetic exclusively — NEVER converts through local timezone
 * or toISOString(), because "2026-06-27T00:00:00" in +08:00 becomes
 * "2026-06-26T16:00:00.000Z" and slice(0,10) shifts the calendar date.
 */
export function addDays(dateStr: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return dateStr;

  const year = Number(m[1]);
  const month = Number(m[2]); // 1-based
  const day = Number(m[3]);

  // Build a UTC timestamp — no local-timezone contamination
  const utcMs = Date.UTC(year, month - 1, day + days);
  if (isNaN(utcMs)) return dateStr;

  const d = new Date(utcMs);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
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
  const [extremeSpeedMode, setExtremeSpeedMode] = useState(false);
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
  const [result, setResult] = useState<PlanEvaluateResponse | null>(null);
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
      extremeSpeedMode,
    };
    if (stationEntry !== null) body.stationEntryBufferMinutes = stationEntry;
    if (risk !== null) body.riskBufferMinutes = risk;

    fetch("/api/plan/evaluate", {
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
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col bg-gray-50 px-3 sm:px-4 py-6 sm:py-8 overflow-x-hidden">
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
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900
                         focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500
                         min-h-[44px]"
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
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900
                         focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500
                         min-h-[44px]"
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
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900
                         focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500
                         min-h-[44px]"
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
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900
                         focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500
                         min-h-[44px]"
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
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900
                         placeholder-gray-300
                         focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500
                         min-h-[44px]"
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
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900
                         placeholder-gray-300
                         focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500
                         min-h-[44px]"
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
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900
                         focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500
                         min-h-[44px]"
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
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900
                           focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500
                           min-h-[44px]"
              />
              <input
                type="time"
                value={firstExamTime}
                onChange={(e) => setFirstExamTime(e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900
                           focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500
                           min-h-[44px]"
              />
            </div>
          </label>
        </div>

        {/* Advanced Settings toggle */}
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="mt-4 flex w-full items-center justify-between rounded-lg border
                     border-gray-200 px-4 py-3 text-sm text-gray-600
                     hover:bg-gray-50 transition-colors min-h-[44px]"
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
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900
                           placeholder-gray-300
                           focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500
                           min-h-[44px]"
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
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900
                           placeholder-gray-300
                           focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500
                           min-h-[44px]"
              />
            </label>
          </div>
        )}

        {/* Extreme Speed Mode Toggle (S5) */}
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={extremeSpeedMode}
              onChange={(e) => setExtremeSpeedMode(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-amber-300 text-amber-600
                         focus:ring-amber-500"
            />
            <div className="flex-1">
              <span className="text-sm font-semibold text-amber-800">
                ⚠️ 极速冒险模式 <span className="text-xs font-normal text-amber-600">不推荐</span>
              </span>
              <p className="mt-0.5 text-xs text-amber-600">
                使用小红书极速进站数据，风险自负
              </p>
              {extremeSpeedMode && (
                <div className="mt-2 rounded bg-amber-100/50 px-3 py-2 text-xs text-amber-700 space-y-1">
                  <p>开启后将应用更激进的缓冲策略：</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    <li>风险缓冲降至 <strong>5 分钟</strong></li>
                    <li>进站缓冲使用小红书实测最短时间（8-10 分钟）</li>
                    <li>可能产生更早出发、更高风险的结果</li>
                  </ul>
                </div>
              )}
            </div>
          </label>
        </div>

        {/* Search button */}
        <button
          type="button"
          onClick={handleSearch}
          disabled={loading}
          className="mt-6 w-full rounded-lg bg-blue-600 px-4 py-3.5 text-white font-medium
                     hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed
                     transition-colors min-h-[48px]"
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
        <>
          {/* Plan Summary Bar */}
          {result.plans.length > 0 && (
            <PlanSummary plans={result.plans} leaveSuggestion={result.leaveSuggestion} />
          )}

          {/* Leave Suggestion */}
          <LeaveSuggestionBanner suggestion={result.leaveSuggestion} />

          {/* Comparison List */}
          <section className="mt-6 rounded-xl bg-white p-6 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  车次对比列表
                </h2>
                <p className="text-sm text-gray-500">
                  共 {result.groupedTrains.recommend.length + result.groupedTrains.optional.length + result.groupedTrains.notRecommended.length} 个车次 · 安全出发时间{" "}
                  <span className="font-mono font-semibold text-blue-600">
                    {result.safeDepartureTime}
                  </span>
                  {" · "}偏好：{PREFERENCE_LABELS[preference]}
                </p>
              </div>
            </div>

            {/* Extreme Speed Mode Indicator */}
            {result.extremeSpeedMode.active && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                <p className="font-semibold">⚠️ 极速冒险模式已启用</p>
                <p className="mt-1">
                  全局进站缓冲 <strong>{result.extremeSpeedMode.stationEntryBufferMinutes} 分钟</strong>（保守取各站最大值）
                  {" · "}风险缓冲 <strong>{result.extremeSpeedMode.riskBufferMinutes} 分钟</strong>
                </p>
                {Object.keys(result.extremeSpeedMode.xhsStationTimes).length > 0 && (
                  <ul className="mt-1 text-xs text-amber-600 space-y-0.5">
                    {Object.entries(result.extremeSpeedMode.xhsStationTimes).map(([station, minutes]) => (
                      <li key={station}>小红书数据：{station} 最快进站 {minutes} 分钟</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {result.groupedTrains.recommend.length === 0 &&
             result.groupedTrains.optional.length === 0 &&
             result.groupedTrains.notRecommended.length === 0 ? (
              <div className="py-12 text-center text-gray-400">
                <p className="text-lg">未找到可用车次</p>
                <p className="mt-1 text-sm">
                  尝试调整出发城市或目的城市
                </p>
              </div>
            ) : (
              <>
                {/* Desktop: Table view (hidden on mobile) */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b-2 border-gray-200 text-left text-xs uppercase text-gray-500">
                        <th className="whitespace-nowrap pb-2 pr-3">车次</th>
                        <th className="whitespace-nowrap pb-2 pr-3">出发 → 到达</th>
                        <th className="whitespace-nowrap pb-2 pr-3">出发时间</th>
                        <th className="whitespace-nowrap pb-2 pr-3">到达时间</th>
                        <th className="whitespace-nowrap pb-2 pr-3">到校时间</th>
                        <th className="whitespace-nowrap pb-2 pr-3">历时</th>
                        <th className="whitespace-nowrap pb-2 pr-3">价格</th>
                        <th className="whitespace-nowrap pb-2 pr-3">考试缓冲</th>
                        <th className="whitespace-nowrap pb-2 pr-3">舒适度</th>
                        <th className="whitespace-nowrap pb-2 pr-3">评分</th>
                        <th className="whitespace-nowrap pb-2 pr-3">风险</th>
                        <th className="whitespace-nowrap pb-2">推荐</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...result.groupedTrains.recommend, ...result.groupedTrains.optional, ...result.groupedTrains.notRecommended].map((train) => (
                        <TrainRow key={train.id} train={train} />
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile: Card view (hidden on desktop) */}
                <div className="sm:hidden space-y-3">
                  {[...result.groupedTrains.recommend, ...result.groupedTrains.optional, ...result.groupedTrains.notRecommended].map((train) => (
                    <TrainCard key={train.id} train={train} />
                  ))}
                </div>
              </>
            )}
          </section>

          {/* S6: Action Area — collapsible, below comparison list */}
          <ActionArea primaryPlan={result.plans[0] ?? null} />
        </>
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

  const schoolTime = extractTime(train.estimatedSchoolArrival);
  const examBufferStr =
    train.examBufferMinutes < 0
      ? "考试已开始"
      : `${Math.floor(train.examBufferMinutes / 60)}h${train.examBufferMinutes % 60}m`;
  const examBufferColor =
    train.examBufferMinutes < 0
      ? "text-red-600 font-semibold"
      : train.examBufferMinutes < 60
        ? "text-red-600"
        : train.examBufferMinutes < 120
          ? "text-yellow-600"
          : "text-green-600";

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
      <td className="whitespace-nowrap py-3 pr-3 font-mono text-gray-600">
        {schoolTime}
      </td>
      <td className="whitespace-nowrap py-3 pr-3 text-gray-600">
        {durationStr}
      </td>
      <td className="whitespace-nowrap py-3 pr-3 font-mono text-gray-900">
        ¥{train.price}
      </td>
      <td className="whitespace-nowrap py-3 pr-3">
        <span className={`text-xs ${examBufferColor}`}>
          {examBufferStr}
        </span>
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

/** Mobile card view for a single scored train. */
function TrainCard({ train }: { train: ScoredTrain }) {
  const isRecommend = train.decision === "recommend";
  const isNotRecommended = train.decision === "not_recommended";

  const departTime = extractTime(train.departureTime);
  const arriveTime = extractTime(train.arrivalTime);
  const schoolTime = extractTime(train.estimatedSchoolArrival);

  const durationHours = Math.floor(train.durationMinutes / 60);
  const durationMins = train.durationMinutes % 60;
  const durationStr =
    durationHours > 0
      ? `${durationHours}h${String(durationMins).padStart(2, "0")}m`
      : `${durationMins}m`;

  const examBufferStr =
    train.examBufferMinutes < 0
      ? "考试已开始"
      : `${Math.floor(train.examBufferMinutes / 60)}h${train.examBufferMinutes % 60}m`;

  const examBufferColor =
    train.examBufferMinutes < 0
      ? "text-red-600 font-semibold"
      : train.examBufferMinutes < 60
        ? "text-red-600"
        : train.examBufferMinutes < 120
          ? "text-yellow-600"
          : "text-green-600";

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

  const comfortBadgeColor =
    train.comfortLevel === "comfortable"
      ? "bg-green-100 text-green-700"
      : train.comfortLevel === "uncomfortable"
        ? "bg-orange-100 text-orange-700"
        : "bg-gray-100 text-gray-600";

  return (
    <div
      className={`rounded-xl border p-4 ${
        isRecommend
          ? "border-blue-200 bg-blue-50/50"
          : isNotRecommended
            ? "border-gray-200 opacity-60"
            : "border-gray-200"
      }`}
    >
      {/* Header row: train number + decision badge */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {isRecommend && <span>⭐</span>}
          <span className="font-mono font-semibold text-gray-900 text-base">
            {train.trainNumber}
          </span>
          <span className="text-xs text-gray-400">{train.trainType}</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${riskBadgeColor}`}
          >
            {RISK_LABELS[train.riskLevel]}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${decisionBadgeColor}`}
          >
            {DECISION_LABELS[train.decision]}
          </span>
        </div>
      </div>

      {/* Route */}
      <div className="text-sm text-gray-700 mb-2">
        <span>{train.departureStation}</span>
        <span className="mx-1 text-gray-300">→</span>
        <span>{train.arrivalStation}</span>
      </div>

      {/* Time grid: 2x2 */}
      <div className="grid grid-cols-2 gap-2 mb-2 text-xs">
        <div>
          <span className="text-gray-400">出发</span>
          <span className="ml-1 font-mono font-semibold text-gray-900">{departTime}</span>
        </div>
        <div>
          <span className="text-gray-400">到达</span>
          <span className="ml-1 font-mono font-semibold text-gray-900">{arriveTime}</span>
        </div>
        <div>
          <span className="text-gray-400">到校</span>
          <span className="ml-1 font-mono text-gray-600">{schoolTime}</span>
        </div>
        <div>
          <span className="text-gray-400">历时</span>
          <span className="ml-1 text-gray-600">{durationStr}</span>
        </div>
      </div>

      {/* Bottom row: price, exam buffer, comfort, score */}
      <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-gray-100">
        <div className="flex items-center gap-3 text-xs">
          <span className="font-mono font-semibold text-gray-900">¥{train.price}</span>
          <span className={examBufferColor}>
            缓冲 {examBufferStr}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${comfortBadgeColor}`}>
            {COMFORT_LABELS[train.comfortLevel]}
          </span>
        </div>
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
      </div>
    </div>
  );
}

/** Display the primary plan summary bar. */
function PlanSummary({
  plans,
}: {
  plans: ReturnPlan[];
  leaveSuggestion: PlanEvaluateResponse["leaveSuggestion"];
}) {
  const primary = plans[0];
  if (!primary) return null;

  const train = primary.train;
  const departTime = extractTime(train.departureTime);
  const arriveTime = extractTime(train.arrivalTime);
  const schoolTime = extractTime(train.estimatedSchoolArrival);

  return (
    <section className="mt-6 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 p-5 sm:p-6 text-white shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-blue-100 truncate">
            {primary.title}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xl sm:text-2xl font-bold">
            <span className="font-mono">{train.trainNumber}</span>
            <span className="text-blue-100 text-sm sm:text-base">
              {train.departureStation}
              <span className="mx-1">→</span>
              {train.arrivalStation}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs sm:text-sm text-blue-100">
            <span>出发 <span className="font-mono font-semibold text-white">{departTime}</span></span>
            <span>到达 <span className="font-mono font-semibold text-white">{arriveTime}</span></span>
            <span>到校 <span className="font-mono font-semibold text-white">{schoolTime}</span></span>
            <span>票价 <span className="font-semibold text-white">¥{train.price}</span></span>
            <span>评分 <span className="font-semibold text-white">{train.score}/100</span></span>
          </div>
          {primary.risks.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {primary.risks.map((r, i) => (
                <span
                  key={i}
                  className="rounded-full bg-red-400/30 px-2 py-0.5 text-xs text-white"
                >
                  ⚠ {r}
                </span>
              ))}
            </div>
          )}
        </div>
        {train.decision === "recommend" && (
          <div className="rounded-full bg-white/20 px-4 py-2 text-sm font-semibold">
            ⭐ 推荐方案
          </div>
        )}
      </div>
    </section>
  );
}

/** Leave suggestion banner. */
function LeaveSuggestionBanner({
  suggestion,
}: {
  suggestion: PlanEvaluateResponse["leaveSuggestion"];
}) {
  if (!suggestion) return null;

  const leaveHours = Math.floor(suggestion.suggestedEarlyDepartureMinutes / 60);
  const leaveMins = suggestion.suggestedEarlyDepartureMinutes % 60;

  return (
    <section
      className={`mt-4 rounded-xl p-5 shadow-sm ${
        suggestion.needLeave
          ? "bg-amber-50 border border-amber-200"
          : "bg-green-50 border border-green-200"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="text-xl">
          {suggestion.needLeave ? "⚠️" : "✅"}
        </span>
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900">
            {suggestion.needLeave ? "建议请假" : "无需请假"}
          </h3>
          <p className="mt-1 text-sm text-gray-600">{suggestion.reason}</p>
          {suggestion.needLeave && suggestion.suggestedEarlyDepartureMinutes > 0 && (
            <p className="mt-2 text-sm font-medium text-amber-700">
              建议提前
              {leaveHours > 0 ? ` ${leaveHours} 小时` : ""}
              {leaveMins > 0 ? ` ${leaveMins} 分钟` : ""}
              出发
            </p>
          )}
        </div>
      </div>
    </section>
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

// ============================================================
// S6: Action Area — Leave Message Generator + Checklist
// ============================================================

const REASON_LABELS: Record<LeaveReason, string> = {
  "生病": "生病",
  "考试": "考试",
  "组会": "组会",
  "家庭原因": "家庭原因",
};

function ActionArea({
  primaryPlan,
}: {
  primaryPlan: ReturnPlan | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [recipientName, setRecipientName] = useState("");
  const [reason, setReason] = useState<LeaveReason>("考试");
  const [message, setMessage] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Checklist from the primary plan (already computed by planning-core)
  const checklist = primaryPlan?.checklist ?? [];

  // Checklist checked state
  const [checkedItems, setCheckedItems] = useState<boolean[]>([]);

  // Reset checked items when checklist changes
  useEffect(() => {
    setCheckedItems(checklist.map(() => false));
  }, [checklist]);

  const handleGenerate = useCallback(async () => {
    if (!primaryPlan) return;
    if (recipientName.trim() === "") {
      setMessageError("请输入称呼");
      return;
    }

    setMessageError(null);
    setGenerating(true);

    const train = primaryPlan.train;
    const departTime = extractTime(train.departureTime);
    // Derive date from the selected train's own departure time,
    // never from the mutable form state — avoids date/train mismatch.
    const departDate = train.departureTime.slice(0, 10);

    try {
      const res = await fetch("/api/plan/leave-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientName: recipientName.trim(),
          reason,
          trainNumber: train.trainNumber,
          departureStation: train.departureStation,
          departureTime: departTime,
          arrivalStation: train.arrivalStation,
          departDate,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setMessage(data.message);
        setCopied(false);
      } else {
        setMessageError(data.error ?? "生成失败");
        setMessage(null);
      }
    } catch {
      setMessageError("网络请求失败");
      setMessage(null);
    } finally {
      setGenerating(false);
    }
  }, [primaryPlan, recipientName, reason]);

  const handleCopy = useCallback(async () => {
    if (!message) return;
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = message;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [message]);

  const toggleCheckItem = useCallback((index: number) => {
    setCheckedItems((prev) => {
      const next = [...prev];
      next[index] = !next[index];
      return next;
    });
  }, []);

  return (
    <section className="mt-4 rounded-xl bg-white shadow-sm">
      {/* Collapse toggle */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between rounded-xl px-4 sm:px-6 py-4
                   text-left hover:bg-gray-50 transition-colors min-h-[48px]"
      >
        <div>
          <h2 className="text-lg font-semibold text-gray-900">行动区</h2>
          <p className="text-sm text-gray-500">
            请假文案生成 · 出发前清单
          </p>
        </div>
        <span className="text-gray-400 text-lg">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-6 py-5 space-y-6">
          {/* ---- Leave Message Generator ---- */}
          <div>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">
              请假文案生成
            </h3>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Recipient name */}
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">
                  称呼
                </span>
                <input
                  type="text"
                  value={recipientName}
                  onChange={(e) => {
                    setRecipientName(e.target.value);
                    setMessage(null);
                    setMessageError(null);
                  }}
                  placeholder="例如：王经理"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900
                             placeholder-gray-300
                             focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500
                             min-h-[44px]"
                />
              </label>

              {/* Reason selector */}
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">
                  请假原因
                </span>
                <select
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value as LeaveReason);
                    setMessage(null);
                    setMessageError(null);
                  }}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900
                             focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500
                             min-h-[44px]"
                >
                  {(Object.keys(REASON_LABELS) as LeaveReason[]).map((r) => (
                    <option key={r} value={r}>
                      {REASON_LABELS[r]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Generate button */}
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating || !primaryPlan}
              className="mt-3 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white
                         hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed
                         transition-colors min-h-[44px]"
            >
              {generating ? "生成中…" : "生成"}
            </button>

            {/* Error */}
            {messageError && (
              <p className="mt-2 text-sm text-red-600">{messageError}</p>
            )}

            {/* Message preview + copy button */}
            {message && (
              <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
                <pre className="whitespace-pre-wrap text-sm text-gray-800 font-sans leading-relaxed break-words">
                  {message}
                </pre>
                <button
                  type="button"
                  onClick={handleCopy}
                  className={`mt-3 w-full rounded-lg px-3 py-2.5 text-sm font-medium transition-colors min-h-[44px] ${
                    copied
                      ? "bg-green-100 text-green-700"
                      : "bg-gray-200 text-gray-700 hover:bg-gray-300 active:bg-gray-400"
                  }`}
                >
                  {copied ? "已复制 ✓" : "一键复制"}
                </button>
              </div>
            )}
          </div>

          {/* ---- Checklist ---- */}
          <div>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">
              出发前清单
            </h3>

            {checklist.length === 0 ? (
              <p className="text-sm text-gray-400">
                暂无可用的出发清单
              </p>
            ) : (
              <ul className="space-y-2">
                {checklist.map((item, i) => (
                  <li key={i}>
                    <label
                      className={`flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors min-h-[44px] ${
                        checkedItems[i]
                          ? "border-green-200 bg-green-50"
                          : "border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checkedItems[i] ?? false}
                        onChange={() => toggleCheckItem(i)}
                        className="h-5 w-5 rounded border-gray-300 text-blue-600
                                   focus:ring-blue-500 shrink-0"
                      />
                      <span
                        className={`text-sm ${
                          checkedItems[i]
                            ? "text-gray-500 line-through"
                            : "text-gray-800"
                        }`}
                      >
                        {item}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
