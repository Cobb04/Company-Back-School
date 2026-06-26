import { useState, useEffect, useRef } from "react";
import type { SafeDepartureOutput } from "@return-school/shared";

export default function App() {
  const [clockOutTime, setClockOutTime] = useState("18:00");
  const [companyToStationStr, setCompanyToStationStr] = useState("30");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [stationEntryBufferStr, setStationEntryBufferStr] = useState("30");
  const [riskBufferStr, setRiskBufferStr] = useState("15");

  const [result, setResult] = useState<SafeDepartureOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Abort any in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Parse minute fields with unified parser
    const companyToStation = parseMinutesStr(companyToStationStr);
    const stationEntry = parseMinutesStr(stationEntryBufferStr);
    const risk = parseMinutesStr(riskBufferStr);

    // Validate required fields before calling API
    if (!clockOutTime) {
      setLoading(false);
      setResult(null);
      setError("请选择下班时间");
      return;
    }
    if (companyToStation === null) {
      setLoading(false);
      setResult(null);
      setError("公司到高铁站时间必须为非负整数");
      return;
    }
    if (stationEntryBufferStr !== "" && stationEntry === null) {
      setLoading(false);
      setResult(null);
      setError("进站缓冲时间必须为非负整数");
      return;
    }
    if (riskBufferStr !== "" && risk === null) {
      setLoading(false);
      setResult(null);
      setError("风险缓冲时间必须为非负整数");
      return;
    }

    setError(null);
    setLoading(true);

    const body: Record<string, unknown> = {
      clockOutTime,
      companyToStationMinutes: companyToStation,
    };
    if (stationEntry !== null) {
      body.stationEntryBufferMinutes = stationEntry;
    }
    if (risk !== null) {
      body.riskBufferMinutes = risk;
    }

    fetch("/api/plan/safe-departure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = await res.json();
        if (!controller.signal.aborted) {
          if (res.ok) {
            setResult(data);
            setError(null);
          } else {
            setResult(null);
            setError(data.error ?? "请求失败");
          }
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setResult(null);
          setError(err instanceof Error ? err.message : "网络请求失败");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [clockOutTime, companyToStationStr, stationEntryBufferStr, riskBufferStr]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col bg-gray-50 px-4 py-8">
      {/* Header */}
      <header className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900">安全出发时间计算器</h1>
        <p className="mt-2 text-sm text-gray-500">
          输入下班时间和通勤信息，计算最早可出发的高铁时间
        </p>
      </header>

      {/* Form */}
      <section className="rounded-xl bg-white p-6 shadow-sm">
        {/* Clock-out time */}
        <label className="mb-4 block">
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

        {/* Company-to-station minutes */}
        <label className="mb-4 block">
          <span className="mb-1 block text-sm font-medium text-gray-700">
            公司到高铁站时间（分钟）
          </span>
          <input
            type="number"
            min={0}
            step={1}
            value={companyToStationStr}
            onChange={(e) => setCompanyToStationStr(e.target.value)}
            placeholder="例如 30"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900
                       placeholder-gray-300
                       focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>

        {/* Advanced Settings toggle */}
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="mb-4 flex w-full items-center justify-between rounded-lg border
                     border-gray-200 px-3 py-2 text-sm text-gray-600
                     hover:bg-gray-50 transition-colors"
        >
          <span>高级设置</span>
          <span className="text-gray-400">{showAdvanced ? "▲" : "▼"}</span>
        </button>

        {showAdvanced && (
          <div className="mb-4 space-y-4 rounded-lg bg-gray-50 p-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">
                进站缓冲时间（分钟）
              </span>
              <span className="mb-1 block text-xs text-gray-400">
                默认 30 分钟
              </span>
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
              <span className="mb-1 block text-xs text-gray-400">
                默认 15 分钟
              </span>
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
      </section>

      {/* Result display */}
      <section className="mt-6 rounded-xl bg-white p-6 shadow-sm">
        <h2 className="text-sm font-medium text-gray-500">最早可出发时间</h2>

        {loading && (
          <p className="mt-2 text-sm text-gray-400">计算中…</p>
        )}

        {!loading && error && (
          <p className="mt-2 text-sm text-red-500">{error}</p>
        )}

        {!loading && result?.safeDepartureTime && (
          <>
            <p className="mt-2 text-3xl font-bold text-blue-600">
              {result.safeDepartureTime}
            </p>
            <div className="mt-4 space-y-1 border-t border-gray-100 pt-4 text-xs text-gray-400">
              <p>
                下班 {clockOutTime}
                + 通勤 {parseMinutesStr(companyToStationStr) ?? 0}min
                {(!stationEntryBufferStr ||
                  (parseMinutesStr(stationEntryBufferStr) ?? 0) > 0) &&
                  ` + 进站缓冲 ${stationEntryBufferStr || "30"}min`}
                {(!riskBufferStr ||
                  (parseMinutesStr(riskBufferStr) ?? 0) > 0) &&
                  ` + 风险缓冲 ${riskBufferStr || "15"}min`}
              </p>
            </div>
          </>
        )}

        {!loading && !error && !result?.safeDepartureTime && (
          <p className="mt-2 text-sm text-gray-400">请输入完整信息</p>
        )}
      </section>
    </main>
  );
}

/**
 * Parse a minute string to a non-negative integer.
 *
 * Only accepts strings matching `/^\d+$/` — pure decimal digits.
 * Returns `null` for empty strings, scientific notation ("1e2"),
 * decimals ("1.5"), negatives ("-5"), or any other non-digit content.
 */
function parseMinutesStr(s: string): number | null {
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
}
