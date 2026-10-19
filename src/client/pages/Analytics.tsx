import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppBar } from '../components/AppBar'
import { Card, EmptyState, Spinner, StatCard } from '../components/Primitives'
import { useToast } from '../components/Toast'
import { contentApi } from '../api'

type WorkspaceAnalytics = {
  clients: number
  projects: number
  thisMonth: number
  pending: number
  topClients: { id: string; name: string; accentColor: string; approved: number; pending: number }[]
  trend: { day: string; count: number }[]
}

export function Analytics() {
  const { notify } = useToast()
  const [data, setData] = useState<WorkspaceAnalytics | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await contentApi.workspaceAnalytics())
    } catch {
      notify('Could not load analytics.', 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    void load()
  }, [load])

  const maxTrend = data ? Math.max(1, ...data.trend.map((t) => t.count)) : 1

  return (
    <div className="app-shell">
      <AppBar />
      <main className="container">
        <div className="page-head">
          <h1>Analytics</h1>
          <p>Aggregated across every client and project in this workspace.</p>
        </div>

        {loading || !data ? (
          <div className="list-loading"><Spinner label="Loading analytics" /></div>
        ) : data.clients === 0 ? (
          <EmptyState title="No data yet" description="Add a client and start collecting testimonials to see analytics." action={<Link to="/clients" className="btn btn-primary btn-sm">Add a client</Link>} />
        ) : (
          <>
            <div className="stats-grid">
              <StatCard label="Clients" value={data.clients} />
              <StatCard label="Projects" value={data.projects} />
              <StatCard label="This month" value={data.thisMonth} hint="New submissions" />
              <StatCard label="Pending" value={data.pending} hint="Awaiting review" accent />
            </div>

            <div className="detail-grid">
              <Card className="card-pad">
                <h3 className="section-title">Top clients</h3>
                {data.topClients.length === 0 ? (
                  <p className="muted">No approved testimonials yet.</p>
                ) : (
                  <ul className="item-list">
                    {data.topClients.map((c) => (
                      <li key={c.id} className="item-row">
                        <Link to={`/clients/${c.id}`} className="client-link">
                          <span className="dot" style={{ background: c.accentColor }} aria-hidden="true" />
                          <strong>{c.name}</strong>
                        </Link>
                        <span className="muted">{c.approved} approved · {c.pending} pending</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card className="card-pad">
                <h3 className="section-title">Submissions · last 30 days</h3>
                {data.trend.length === 0 ? (
                  <p className="muted">Nothing submitted in the last 30 days.</p>
                ) : (
                  <div className="bar-chart" role="img" aria-label="Daily submissions over the last 30 days">
                    {data.trend.map((t) => (
                      <div key={t.day} className="bar" style={{ height: `${Math.round((t.count / maxTrend) * 100)}%` }} title={`${t.day}: ${t.count}`} />
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
