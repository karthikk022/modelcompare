import { Chart, registerables } from 'chart.js'
import { useEffect, useRef } from 'react'
import type { Model } from '../types'

Chart.register(...registerables)

interface Props {
  models: Model[]
  compareMode?: 'benchmarks' | 'radar' | 'pricing'
}

const BENCH_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316']

export function BenchmarkChart({ models }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<Chart | null>(null)

  useEffect(() => {
    if (!canvasRef.current || models.length === 0) return
    if (chartRef.current) { chartRef.current.destroy() }

    const benchKeys = [...new Set(models.flatMap(m => Object.keys(m.benchmarks || {})))]
    if (benchKeys.length === 0) return

    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: benchKeys,
        datasets: models.map((m, i) => ({
          label: m.name,
          data: benchKeys.map(k => m.benchmarks?.[k] ?? null),
          backgroundColor: BENCH_COLORS[i % BENCH_COLORS.length] + 'cc',
          borderColor: BENCH_COLORS[i % BENCH_COLORS.length],
          borderWidth: 1,
          borderRadius: 4,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#8b8fa3' } },
        },
        scales: {
          x: { ticks: { color: '#8b8fa3' }, grid: { color: '#2d3142' } },
          y: { beginAtZero: true, max: 100, ticks: { color: '#8b8fa3', callback: v => v + '%' }, grid: { color: '#2d3142' } },
        },
      },
    })
    return () => { if (chartRef.current) chartRef.current.destroy() }
  }, [models])

  if (models.length === 0) return null
  return <div className="chart-container"><h3>Benchmark Scores (%)</h3><div className="chart-wrapper"><canvas ref={canvasRef} /></div></div>
}

export function RadarChart({ models }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<Chart | null>(null)

  useEffect(() => {
    if (!canvasRef.current || models.length === 0) return
    if (chartRef.current) { chartRef.current.destroy() }

    const allScores = models.map(m => m.scores || {})
    const keys = [...new Set(allScores.flatMap(s => Object.keys(s)))]
    if (keys.length === 0) return

    chartRef.current = new Chart(canvasRef.current, {
      type: 'radar',
      data: {
        labels: keys,
        datasets: models.map((m, i) => ({
          label: m.name,
          data: keys.map(k => (m.scores as any)?.[k] ?? 0),
          backgroundColor: BENCH_COLORS[i % BENCH_COLORS.length] + '33',
          borderColor: BENCH_COLORS[i % BENCH_COLORS.length],
          borderWidth: 2,
          pointBackgroundColor: BENCH_COLORS[i % BENCH_COLORS.length],
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#8b8fa3' } },
        },
        scales: {
          r: {
            beginAtZero: true,
            max: 100,
            ticks: { color: '#8b8fa3', backdropColor: 'transparent' },
            grid: { color: '#2d3142' },
            pointLabels: { color: '#e4e6f0' },
          },
        },
      },
    })
    return () => { if (chartRef.current) chartRef.current.destroy() }
  }, [models])

  if (models.length === 0) return null
  return <div className="chart-container"><h3>Capability Radar</h3><div className="chart-wrapper"><canvas ref={canvasRef} /></div></div>
}

export function PricingChart({ models }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<Chart | null>(null)

  useEffect(() => {
    if (!canvasRef.current || models.length === 0) return
    if (chartRef.current) { chartRef.current.destroy() }

    const hasPricing = models.some(m => m.inputPrice != null || m.outputPrice != null)
    if (!hasPricing) return

    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: models.map(m => m.name),
        datasets: [
          {
            label: 'Input ($/M tokens)',
            data: models.map(m => m.inputPrice ?? 0),
            backgroundColor: '#6366f1cc',
            borderColor: '#6366f1',
            borderWidth: 1,
            borderRadius: 4,
          },
          {
            label: 'Output ($/M tokens)',
            data: models.map(m => m.outputPrice ?? 0),
            backgroundColor: '#22c55ecc',
            borderColor: '#22c55e',
            borderWidth: 1,
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#8b8fa3' } },
        },
        scales: {
          x: { ticks: { color: '#8b8fa3' }, grid: { color: '#2d3142' } },
          y: { beginAtZero: true, ticks: { color: '#8b8fa3', callback: v => '$' + v }, grid: { color: '#2d3142' } },
        },
      },
    })
    return () => { if (chartRef.current) chartRef.current.destroy() }
  }, [models])

  if (models.length === 0) return null
  return <div className="chart-container"><h3>Pricing ($/M tokens)</h3><div className="chart-wrapper"><canvas ref={canvasRef} /></div></div>
}

export function UsageChart({ usage }: { usage: { timestamp: string; totalTokens: number; cost: number }[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<Chart | null>(null)

  useEffect(() => {
    if (!canvasRef.current || usage.length === 0) return
    if (chartRef.current) { chartRef.current.destroy() }

    const labels = usage.slice(-30).map(u => (u.timestamp || '').slice(0, 10))
    const tokens = usage.slice(-30).map(u => u.totalTokens)
    const costs = usage.slice(-30).map(u => u.cost)

    chartRef.current = new Chart(canvasRef.current, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Tokens', data: tokens, borderColor: '#6366f1', backgroundColor: '#6366f133', fill: true, tension: 0.3, pointRadius: 2 },
          { label: 'Cost ($)', data: costs, borderColor: '#22c55e', backgroundColor: '#22c55e33', fill: true, tension: 0.3, pointRadius: 2, yAxisID: 'y1' },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#8b8fa3' } } },
        scales: {
          x: { ticks: { color: '#8b8fa3', maxTicksLimit: 10 }, grid: { color: '#2d3142' } },
          y: { ticks: { color: '#8b8fa3' }, grid: { color: '#2d3142' } },
          y1: { position: 'right', ticks: { color: '#8b8fa3' }, grid: { drawOnChartArea: false } },
        },
      },
    })
    return () => { if (chartRef.current) chartRef.current.destroy() }
  }, [usage.length])

  if (usage.length === 0) return null
  return <div className="chart-container"><h3>Usage History</h3><div className="chart-wrapper" style={{ height: 250 }}><canvas ref={canvasRef} /></div></div>
}
