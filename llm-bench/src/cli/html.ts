import type { Run, TaskResult, RunSummary } from "../core/result";
import { computeRunSummary } from "../core/result";
import { loadBenchmark } from "../benchmarks/loader";
import type { Task } from "../core/task";

function escapeHtml(str: string | undefined | null): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatExpected(expected: unknown): string {
  if (expected === undefined || expected === null) return "N/A";
  if (typeof expected === "string") return expected;
  if (typeof expected === "number" || typeof expected === "boolean") return String(expected);
  try {
    return JSON.stringify(expected, null, 2);
  } catch {
    return String(expected);
  }
}

function formatDateGroup(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

function getSessionId(run: Run): string {
  try {
    const d = new Date(run.startedAt);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${day} ${h}:${min}`;
  } catch {
    return run.id;
  }
}

export async function generateHtmlReport(runs: Run[], benchmarksDir?: string): Promise<string> {
  if (runs.length === 0) {
    return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;"><h1>No benchmark runs found to generate report.</h1></body></html>`;
  }

  // 1. Group runs by session/date
  const sessionMap = new Map<string, { sessionKey: string; label: string; date: string; runs: Run[] }>();
  for (const r of runs) {
    const sessionKey = getSessionId(r);
    const label = formatDateGroup(r.startedAt);
    if (!sessionMap.has(sessionKey)) {
      sessionMap.set(sessionKey, { sessionKey, label, date: r.startedAt, runs: [] });
    }
    sessionMap.get(sessionKey)!.runs.push(r);
  }

  const allSessions = Array.from(sessionMap.values()).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  // 2. Group runs by benchmarkId with strict deduplication (latest run per model)
  const benchmarkMap = new Map<string, Run[]>();
  for (const r of runs) {
    if (!benchmarkMap.has(r.benchmarkId)) {
      benchmarkMap.set(r.benchmarkId, []);
    }
    benchmarkMap.get(r.benchmarkId)!.push(r);
  }

  const allBenchmarkIds = Array.from(benchmarkMap.keys()).sort();

  // Load benchmark task definitions from filesystem datasets
  const benchmarkTasksMap = new Map<string, Map<string, Task>>();
  for (const bId of allBenchmarkIds) {
    try {
      const loadedBench = await loadBenchmark(bId, benchmarksDir ?? "./benchmarks");
      const tasks = await loadedBench.loadTasks();
      const tMap = new Map<string, Task>();
      for (const t of tasks) {
        tMap.set(t.id, t);
      }
      benchmarkTasksMap.set(bId, tMap);
    } catch {
      benchmarkTasksMap.set(bId, new Map());
    }
  }

  // 3. Compute deduplicated per-model global stats across benchmarks
  interface ModelGlobalStats {
    modelId: string;
    provider: string;
    totalBenchmarks: number;
    benchmarkScores: Map<string, number>; // benchmarkId -> accuracy (0-1)
    overallAccuracy: number;
    overallScore: number;
    totalCostUsd: number;
    totalLatencyMs: number;
    totalTasks: number;
    totalPassedTasks: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  }

  const modelStatsMap = new Map<string, ModelGlobalStats>();

  for (const [benchId, benchRuns] of benchmarkMap.entries()) {
    // Pick ONLY the latest run per model for each benchmark to ensure NO duplicates
    const latestByModel = new Map<string, { run: Run; summary: RunSummary }>();
    
    // Sort chronologically descending
    const sortedRuns = [...benchRuns].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );

    for (const r of sortedRuns) {
      if (!latestByModel.has(r.modelId)) {
        const summary = r.summary ?? computeRunSummary(r, r.results);
        latestByModel.set(r.modelId, { run: r, summary });
      }
    }

    for (const [modelId, { run, summary }] of latestByModel.entries()) {
      if (!modelStatsMap.has(modelId)) {
        modelStatsMap.set(modelId, {
          modelId,
          provider: (run.modelConfig as any)?.provider ?? "model",
          totalBenchmarks: 0,
          benchmarkScores: new Map(),
          overallAccuracy: 0,
          overallScore: 0,
          totalCostUsd: 0,
          totalLatencyMs: 0,
          totalTasks: 0,
          totalPassedTasks: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
        });
      }

      const stats = modelStatsMap.get(modelId)!;
      stats.totalBenchmarks++;
      stats.benchmarkScores.set(benchId, summary.accuracy);
      stats.totalCostUsd += summary.totalCostUsd;
      stats.totalLatencyMs += summary.averageLatencyMs;
      stats.totalTasks += summary.totalTasks;
      stats.totalPassedTasks += summary.passedTasks;
      stats.totalInputTokens += summary.totalInputTokens;
      stats.totalOutputTokens += summary.totalOutputTokens;
    }
  }

  // Compute overall averages
  const globalModelList = Array.from(modelStatsMap.values()).map((stats) => {
    stats.overallAccuracy = stats.totalTasks > 0 ? stats.totalPassedTasks / stats.totalTasks : 0;
    const scores = Array.from(stats.benchmarkScores.values());
    stats.overallScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    return stats;
  }).sort((a, b) => b.overallAccuracy - a.overallAccuracy);
  const topGlobalModel = globalModelList[0]?.modelId ?? "-";
  const topGlobalScore = globalModelList[0] ? (globalModelList[0].overallAccuracy * 100).toFixed(1) : "0";
  const totalTasksAll = globalModelList.reduce((acc, m) => Math.max(acc, m.totalTasks), 0);
  const totalSpendAll = globalModelList.reduce((acc, m) => acc + m.totalCostUsd, 0);
  const isAllCompleted = runs.every((r) => r.status === "completed" || r.status === "failed");
  const reportGeneratedAt = new Date().toLocaleString();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LLM Benchmark Suite - Unified Report</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111827;
      --card-border: #1f2937;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --primary: #6366f1;
      --primary-gradient: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
      --success: #10b981;
      --danger: #ef4444;
      --warning: #f59e0b;
      --info: #3b82f6;
      --mono: 'JetBrains Mono', monospace;
      --sans: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
    }

    [data-theme="light"] {
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --card-border: #e2e8f0;
      --text: #0f172a;
      --text-muted: #64748b;
      --primary: #4f46e5;
      --primary-gradient: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--sans);
      background-color: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 1.5rem;
      transition: background-color 0.2s, color 0.2s;
    }

    .container { max-width: 1400px; margin: 0 auto; }

    /* Live Status Pill */
    .live-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      padding: 0.35rem 0.8rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 700;
      font-family: var(--mono);
    }
    .live-pill.running {
      background: rgba(245, 158, 11, 0.15);
      color: var(--warning);
      border: 1px solid rgba(245, 158, 11, 0.35);
    }
    .live-pill.completed {
      background: rgba(16, 185, 129, 0.15);
      color: var(--success);
      border: 1px solid rgba(16, 185, 129, 0.35);
    }
    .live-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
    }
    .live-pill.running .live-dot {
      animation: pulse 1.5s infinite ease-in-out;
    }
    @keyframes pulse {
      0% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.3; transform: scale(1.3); }
      100% { opacity: 1; transform: scale(1); }
    }
    .header-title h1 {
      font-size: 1.85rem;
      font-weight: 800;
      letter-spacing: -0.025em;
      background: var(--primary-gradient);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .meta-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 0.35rem;
      font-size: 0.8rem;
      color: var(--text-muted);
    }
    .meta-item {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      background: var(--card-bg);
      padding: 0.2rem 0.65rem;
      border-radius: 6px;
      border: 1px solid var(--card-border);
      font-family: var(--mono);
      font-size: 0.75rem;
    }

    .header-controls {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .theme-toggle {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 0.45rem 0.9rem;
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.8rem;
      font-weight: 600;
    }
    .theme-toggle:hover { border-color: var(--primary); }

    /* Session Banner */
    .session-banner {
      background: rgba(99, 102, 241, 0.08);
      border: 1px solid rgba(99, 102, 241, 0.25);
      border-radius: 10px;
      padding: 0.85rem 1.25rem;
      margin-bottom: 1.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.75rem;
    }
    .session-info {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.85rem;
    }
    .session-select {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 0.4rem 0.85rem;
      border-radius: 6px;
      font-size: 0.82rem;
      font-family: var(--mono);
      outline: none;
      cursor: pointer;
    }
    .session-select:focus { border-color: var(--primary); }

    /* Nav Tabs */
    .nav-tabs {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1.5rem;
      border-bottom: 1px solid var(--card-border);
      padding-bottom: 0.5rem;
      overflow-x: auto;
    }
    .nav-tab {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-muted);
      padding: 0.55rem 1.1rem;
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.875rem;
      font-weight: 600;
      white-space: nowrap;
      transition: all 0.15s;
    }
    .nav-tab:hover {
      color: var(--text);
      background: rgba(255, 255, 255, 0.04);
    }
    .nav-tab.active {
      background: var(--card-bg);
      color: #818cf8;
      border-color: var(--primary);
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .tab-pane { display: none; }
    .tab-pane.active { display: block; }

    /* KPI Grid */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .kpi-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 1.1rem;
      position: relative;
      overflow: hidden;
    }
    .kpi-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; height: 3px;
      background: var(--primary-gradient);
    }
    .kpi-card.green::before { background: linear-gradient(90deg, #10b981, #059669); }
    .kpi-card.amber::before { background: linear-gradient(90deg, #f59e0b, #d97706); }
    .kpi-card.blue::before { background: linear-gradient(90deg, #3b82f6, #2563eb); }
    .kpi-label {
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 0.35rem;
    }
    .kpi-value {
      font-size: 1.5rem;
      font-weight: 800;
      color: var(--text);
      margin-bottom: 0.2rem;
    }
    .kpi-subtext {
      font-size: 0.8rem;
      color: var(--text-muted);
      font-family: var(--mono);
    }

    /* Section Cards */
    .section-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 1.25rem;
      margin-bottom: 1.5rem;
    }
    .section-title {
      font-size: 1.1rem;
      font-weight: 700;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .table-responsive { overflow-x: auto; }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.85rem;
    }
    th {
      padding: 0.65rem 0.85rem;
      background: rgba(0, 0, 0, 0.15);
      color: var(--text-muted);
      font-weight: 600;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid var(--card-border);
    }
    td {
      padding: 0.75rem 0.85rem;
      border-bottom: 1px solid var(--card-border);
      vertical-align: middle;
    }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: rgba(99, 102, 241, 0.03); }

    .model-name { font-weight: 700; font-size: 0.9rem; }
    .model-provider { font-size: 0.72rem; color: var(--text-muted); font-family: var(--mono); }

    .score-cell {
      font-family: var(--mono);
      font-weight: 700;
      font-size: 0.85rem;
    }
    .score-cell.high { color: var(--success); }
    .score-cell.mid { color: var(--warning); }
    .score-cell.low { color: var(--danger); }

    .progress-bar-container {
      width: 100%;
      height: 6px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 3px;
      overflow: hidden;
      margin-top: 0.2rem;
    }
    .progress-bar {
      height: 100%;
      background: var(--primary-gradient);
      border-radius: 3px;
    }

    /* Status Pills */
    .status-pill {
      display: inline-flex;
      align-items: center;
      padding: 0.2rem 0.45rem;
      border-radius: 4px;
      font-size: 0.72rem;
      font-weight: 700;
      font-family: var(--mono);
    }
    .status-pill.pass { background: rgba(16, 185, 129, 0.15); color: var(--success); }
    .status-pill.fail { background: rgba(239, 68, 68, 0.15); color: var(--danger); }

    /* Task Accordion */
    .task-card {
      background: rgba(0, 0, 0, 0.18);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      margin-bottom: 0.85rem;
      overflow: hidden;
    }
    .task-header {
      padding: 0.85rem 1rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      user-select: none;
      background: rgba(255, 255, 255, 0.01);
    }
    .task-header:hover { background: rgba(99, 102, 241, 0.04); }
    .task-title {
      font-weight: 700;
      font-family: var(--mono);
      font-size: 0.88rem;
    }
    .task-body {
      padding: 1.1rem;
      border-top: 1px solid var(--card-border);
      display: none;
      background: rgba(0, 0, 0, 0.28);
    }
    .task-card.open .task-body { display: block; }

    /* Callout Boxes */
    .callout {
      border-radius: 6px;
      padding: 0.85rem;
      margin-bottom: 1rem;
      font-size: 0.83rem;
      border-left: 3px solid;
    }
    .callout-prompt {
      background: rgba(59, 130, 246, 0.08);
      border-left-color: var(--info);
    }
    .callout-expected {
      background: rgba(16, 185, 129, 0.08);
      border-left-color: var(--success);
    }
    .callout-title {
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.35rem;
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }

    pre code {
      display: block;
      padding: 0.65rem;
      background: #030712;
      border-radius: 5px;
      font-family: var(--mono);
      font-size: 0.78rem;
      overflow-x: auto;
      color: #e5e7eb;
      margin-top: 0.35rem;
      border: 1px solid #1f2937;
    }

    /* Filters */
    .filter-bar {
      display: flex;
      gap: 0.65rem;
      margin-bottom: 1rem;
      flex-wrap: wrap;
    }
    .filter-input {
      background: var(--bg);
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 0.45rem 0.75rem;
      border-radius: 6px;
      font-size: 0.82rem;
      outline: none;
    }
    .filter-input:focus { border-color: var(--primary); }

    .footer {
      text-align: center;
      font-size: 0.78rem;
      color: var(--text-muted);
      margin-top: 2.5rem;
      padding-top: 1.25rem;
      border-top: 1px solid var(--card-border);
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <div class="header-title">
        <h1>LLM Benchmark Suite</h1>
        <div class="meta-pills">
          <span class="meta-item">📅 ${escapeHtml(reportGeneratedAt)}</span>
          <span class="meta-item">📚 ${allBenchmarkIds.length} Benchmarks</span>
          <span class="meta-item">🤖 ${globalModelList.length} Unique Models</span>
          <span class="meta-item">🧪 ${totalTasksAll} Tasks</span>
        </div>
      </div>
      <div class="header-controls">
        <div class="live-pill ${isAllCompleted ? "completed" : "running"}">
          <span class="live-dot"></span>
          <span id="live-text">${isAllCompleted ? "✓ Benchmark Complete" : "⏳ Live Running (Checking every 10s)..."}</span>
        </div>
        <button class="theme-toggle" onclick="toggleTheme()">🌓 Theme</button>
      </div>
    </div>

    <!-- Navigation Tabs -->
    <div class="nav-tabs">
      <button class="nav-tab active" data-tab="overview" onclick="switchTab('overview', this)">🌐 Global Overview</button>
      ${allBenchmarkIds
        .map((bId) => {
          const tabKey = bId.replace(/[^a-zA-Z0-9_-]/g, "_");
          let icon = "📊";
          if (bId.includes("coding")) icon = "💻";
          else if (bId.includes("reasoning")) icon = "🧠";
          else if (bId.includes("math")) icon = "🧮";
          else if (bId.includes("instruction")) icon = "📝";
          else if (bId.includes("structured")) icon = "⚙️";

          return `<button class="nav-tab" data-tab="${tabKey}" onclick="switchTab('${tabKey}', this)">${icon} ${escapeHtml(bId)}</button>`;
        })
        .join("")}
    </div>

    <!-- TAB 1: Global Overview -->
    <div id="tab-overview" class="tab-pane active">
      <!-- Global KPIs -->
      <div class="kpi-grid">
        <div class="kpi-card green">
          <div class="kpi-label">Top Global Performer</div>
          <div class="kpi-value">${escapeHtml(topGlobalModel)}</div>
          <div class="kpi-subtext">${topGlobalScore}% Global Pass Rate</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Benchmark Suites</div>
          <div class="kpi-value">${allBenchmarkIds.length}</div>
          <div class="kpi-subtext">${totalTasksAll} Total Unique Tasks</div>
        </div>
        <div class="kpi-card amber">
          <div class="kpi-label">Models Tested</div>
          <div class="kpi-value">${globalModelList.length}</div>
          <div class="kpi-subtext">${globalModelList.map((m) => m.modelId).slice(0, 2).join(", ")}...</div>
        </div>
        <div class="kpi-card blue">
          <div class="kpi-label">Total Execution Spend</div>
          <div class="kpi-value">$${totalSpendAll.toFixed(4)}</div>
          <div class="kpi-subtext">Across all recorded runs</div>
        </div>
      </div>

      <!-- Cross-Benchmark Performance Matrix -->
      <div class="section-card">
        <div class="section-title">🏆 Cross-Benchmark Performance Leaderboard</div>
        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th>Overall Pass</th>
                ${allBenchmarkIds.map((b) => `<th>${escapeHtml(b)}</th>`).join("")}
                <th>Total Cost</th>
                <th>Avg Latency</th>
              </tr>
            </thead>
            <tbody>
              ${globalModelList
                .map((m) => {
                  const passPercent = Math.round(m.overallAccuracy * 100);
                  return `
                  <tr>
                    <td>
                      <div class="model-name">${escapeHtml(m.modelId)}</div>
                      <div class="model-provider">${escapeHtml(m.provider)}</div>
                    </td>
                    <td>
                      <div style="font-weight: 700;">${passPercent}% (${m.totalPassedTasks}/${m.totalTasks})</div>
                      <div class="progress-bar-container">
                        <div class="progress-bar" style="width: ${passPercent}%;"></div>
                      </div>
                    </td>
                    ${allBenchmarkIds
                      .map((bId) => {
                        const score = m.benchmarkScores.get(bId);
                        if (score === undefined) return `<td><span style="color:var(--text-muted);">-</span></td>`;
                        const pct = Math.round(score * 100);
                        const cls = pct >= 80 ? "high" : pct >= 50 ? "mid" : "low";
                        return `<td><span class="score-cell ${cls}">${pct}%</span></td>`;
                      })
                      .join("")}
                    <td><span style="font-family:var(--mono);font-weight:600;">$${m.totalCostUsd.toFixed(4)}</span></td>
                    <td><span style="font-family:var(--mono);">${(m.totalLatencyMs / 1000).toFixed(2)}s</span></td>
                  </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- TABS 2..N: Benchmark Category Deep Dives -->
    ${allBenchmarkIds
      .map((bId) => {
        const tabKey = bId.replace(/[^a-zA-Z0-9_-]/g, "_");
        const bRuns = benchmarkMap.get(bId)!;
        const bTaskLookup = benchmarkTasksMap.get(bId) ?? new Map<string, Task>();

        // Group tasks in this benchmark with deduplicated model results (latest per model)
        const taskMap = new Map<string, { id: string; prompt?: string; expected?: string; results: Map<string, TaskResult> }>();
        
        // Sort runs newest first
        const sortedRuns = [...bRuns].sort(
          (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
        );

        for (const r of sortedRuns) {
          for (const res of r.results) {
            const taskFromFs = bTaskLookup.get(res.taskId);
            const details = res.details as any;

            let prompt = taskFromFs?.prompt ?? details?.prompt;
            let expectedVal = (taskFromFs as any)?.expected ??
              (taskFromFs as any)?.pattern ??
              (taskFromFs as any)?.schema ??
              (taskFromFs as any)?.evaluation?.command ??
              details?.expected;

            if (!taskMap.has(res.taskId)) {
              taskMap.set(res.taskId, {
                id: res.taskId,
                prompt,
                expected: formatExpected(expectedVal),
                results: new Map(),
              });
            } else {
              const entry = taskMap.get(res.taskId)!;
              if (!entry.prompt && prompt) entry.prompt = prompt;
              if ((!entry.expected || entry.expected === "N/A") && expectedVal) {
                entry.expected = formatExpected(expectedVal);
              }
            }

            // Only set if not already set by newer run -> guarantees deduplication!
            if (!taskMap.get(res.taskId)!.results.has(r.modelId)) {
              taskMap.get(res.taskId)!.results.set(r.modelId, res);
            }
          }
        }

        const bTasks = Array.from(taskMap.values()).sort((a, b) =>
          a.id.localeCompare(b.id, undefined, { numeric: true })
        );

        // Deduplicate runs per model for the benchmark leaderboard
        const latestLeaderboardRuns = new Map<string, { run: Run; summary: RunSummary }>();
        for (const r of sortedRuns) {
          if (!latestLeaderboardRuns.has(r.modelId)) {
            const summary = r.summary ?? computeRunSummary(r, r.results);
            latestLeaderboardRuns.set(r.modelId, { run: r, summary });
          }
        }

        const bSummaries = Array.from(latestLeaderboardRuns.values()).sort(
          (a, b) => b.summary.accuracy - a.summary.accuracy
        );

        return `
        <div id="tab-${tabKey}" class="tab-pane">
          <!-- Benchmark Summary Card -->
          <div class="section-card">
            <div class="section-title">📊 ${escapeHtml(bId)} — Leaderboard</div>
            <div class="table-responsive">
              <table>
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Pass Rate</th>
                    <th>Avg Score</th>
                    <th>Cost</th>
                    <th>Avg Latency</th>
                    <th>Tokens (In / Out)</th>
                  </tr>
                </thead>
                <tbody>
                  ${bSummaries
                    .map(({ run, summary }) => {
                      const passPct = Math.round(summary.accuracy * 100);
                      return `
                      <tr data-session="${escapeHtml(getSessionId(run))}">
                        <td>
                          <div class="model-name">${escapeHtml(run.modelId)}</div>
                          <div class="model-provider">${escapeHtml((run.modelConfig as any)?.provider ?? "model")}</div>
                        </td>
                        <td>
                          <div style="font-weight:700;">${passPct}% (${summary.passedTasks}/${summary.totalTasks})</div>
                          <div class="progress-bar-container">
                            <div class="progress-bar" style="width:${passPct}%;"></div>
                          </div>
                        </td>
                        <td><span style="font-family:var(--mono);font-weight:600;">${summary.averageScore.toFixed(2)}</span></td>
                        <td><span style="font-family:var(--mono);font-weight:600;">$${summary.totalCostUsd.toFixed(4)}</span></td>
                        <td><span style="font-family:var(--mono);">${(summary.averageLatencyMs / 1000).toFixed(2)}s</span></td>
                        <td><span style="font-family:var(--mono);font-size:0.75rem;">${summary.totalInputTokens.toLocaleString()} / ${summary.totalOutputTokens.toLocaleString()}</span></td>
                      </tr>
                      `;
                    })
                    .join("")}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Task Breakdown & Deep Dive -->
          <div class="section-card">
            <div class="section-title">🔍 Task Breakdown & Deep Dive</div>
            
            <div class="filter-bar">
              <input type="text" class="filter-input" placeholder="Search task prompt or ID..." oninput="filterTasksInTab('${tabKey}', this.value)">
            </div>

            <div id="tasks-container-${tabKey}">
              ${bTasks
                .map((task) => {
                  const modelResults = Array.from(task.results.entries());

                  return `
                  <div class="task-card" data-task-id="${escapeHtml(task.id)}">
                    <div class="task-header" onclick="this.parentElement.classList.toggle('open')">
                      <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">
                        <span class="task-title">${escapeHtml(task.id)}</span>
                        <div style="display:flex;gap:0.35rem;flex-wrap:wrap;">
                          ${modelResults
                            .map(([mId, res]) => `<span class="status-pill ${res.passed ? "pass" : "fail"}">${escapeHtml(mId)}: ${res.passed ? "✓ PASS" : "✗ FAIL"}</span>`)
                            .join("")}
                        </div>
                      </div>
                      <div style="font-size:0.78rem;color:var(--text-muted);">Expand Details ▼</div>
                    </div>
                    
                    <div class="task-body">
                      <!-- Master Prompt Box -->
                      <div class="callout callout-prompt">
                        <div class="callout-title" style="color:var(--info);">📋 Master Prompt / Instruction</div>
                        <div style="white-space:pre-wrap;">${escapeHtml(task.prompt ?? "No prompt recorded.")}</div>
                      </div>

                      <!-- Expected Evaluation Box -->
                      <div class="callout callout-expected">
                        <div class="callout-title" style="color:var(--success);">🎯 Evaluation Target / Expected Criteria</div>
                        <pre><code>${escapeHtml(task.expected ?? "Exact test assertion")}</code></pre>
                      </div>

                      <!-- Model Candidate Responses -->
                      <div style="margin-top:1rem;">
                        <div style="font-size:0.8rem;font-weight:700;margin-bottom:0.6rem;color:var(--text-muted);text-transform:uppercase;">
                          Model Candidate Outputs
                        </div>
                        ${modelResults
                          .map(([mId, res]) => {
                            return `
                            <div style="background:rgba(0,0,0,0.25);border:1px solid var(--card-border);border-radius:6px;padding:0.85rem;margin-bottom:0.75rem;">
                              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.4rem;">
                                <div style="display:flex;align-items:center;gap:0.5rem;">
                                  <strong>${escapeHtml(mId)}</strong>
                                  <span class="status-pill ${res.passed ? "pass" : "fail"}">${res.passed ? "✓ PASS" : "✗ FAIL"}</span>
                                </div>
                                <div style="font-family:var(--mono);font-size:0.75rem;color:var(--text-muted);">
                                  Score: <b>${res.score.toFixed(2)}</b> | Latency: <b>${(res.latencyMs / 1000).toFixed(2)}s</b> | Cost: <b>$${res.costUsd.toFixed(5)}</b> | Tokens: In <b>${res.inputTokens}</b> / Out <b>${res.outputTokens}</b>
                                </div>
                              </div>

                              ${res.error ? `<div style="color:var(--danger);font-size:0.8rem;margin:0.35rem 0;"><b>Error:</b> ${escapeHtml(res.error)}</div>` : ""}

                              ${
                                res.details && (res.details as any).passed !== undefined
                                  ? `<div style="font-size:0.8rem;color:var(--success);margin:0.25rem 0;">
                                      <b>Test Results:</b> ${(res.details as any).passed} passed, ${(res.details as any).failed ?? 0} failed (Total ${(res.details as any).total})
                                    </div>`
                                  : ""
                              }

                              ${
                                res.details && (res.details as any).appliedFiles && (res.details as any).appliedFiles.length > 0
                                  ? `<div style="font-size:0.8rem;color:#a5b4fc;margin:0.25rem 0;">
                                      <b>Modified Files:</b> ${(res.details as any).appliedFiles.join(", ")}
                                    </div>`
                                  : ""
                              }

                              <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.4rem;">Model Response:</div>
                              <pre><code>${escapeHtml(res.response.length > 1200 ? res.response.slice(0, 1200) + "\n...(truncated for display)" : res.response)}</code></pre>
                            </div>
                            `;
                          })
                          .join("")}
                      </div>
                    </div>
                  </div>
                  `;
                })
                .join("")}
            </div>
          </div>
        </div>
        `;
      })
      .join("")}

    <!-- Footer -->
    <div class="footer">
      Generated by <b>LLM Benchmark & Evaluation Framework</b> (Bun + TypeScript) • Unified Multi-Benchmark Report
    </div>
  </div>
  <script>
    const IS_COMPLETED = ${isAllCompleted ? "true" : "false"};
    let refreshInterval = null;

    if (!IS_COMPLETED) {
      let secondsLeft = 10;
      refreshInterval = setInterval(() => {
        secondsLeft--;
        const textElem = document.getElementById('live-text');
        if (textElem && secondsLeft > 0) {
          textElem.innerText = "⏳ Live Running (Refresh in " + secondsLeft + "s)...";
        }
        if (secondsLeft <= 0) {
          window.location.reload();
        }
      }, 1000);
    }

    function toggleTheme() {
      const current = document.documentElement.getAttribute('data-theme');
      const target = current === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', target);
      localStorage.setItem('theme', target);
    }

    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
      document.documentElement.setAttribute('data-theme', savedTheme);
    }

    function switchTab(tabKey, btn) {
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

      if (btn) {
        btn.classList.add('active');
      } else {
        const matchingBtn = document.querySelector('button[data-tab="' + tabKey + '"]');
        if (matchingBtn) matchingBtn.classList.add('active');
      }

      const pane = document.getElementById('tab-' + tabKey);
      if (pane) pane.classList.add('active');
    }

    function filterTasksInTab(tabKey, query) {
      const q = query.toLowerCase();
      const container = document.getElementById('tasks-container-' + tabKey);
      if (!container) return;

      container.querySelectorAll('.task-card').forEach(card => {
        const text = card.innerText.toLowerCase();
        if (text.includes(q)) {
          card.style.display = 'block';
        } else {
          card.style.display = 'none';
        }
      });
    }
  </script>
</body>
</html>`;
}
