import clsx from 'clsx'

export interface StatTileProps {
  label: string
  value: string | number
  trend?: { direction: 'up' | 'down'; label: string }
}

export function StatTile({ label, value, trend }: StatTileProps) {
  return (
    <div className="stat-tile">
      <div className="stat-tile-label">{label}</div>
      <div className="stat-tile-value">{value}</div>
      {trend && (
        <div className={clsx('stat-tile-trend', `stat-tile-trend-${trend.direction}`)}>
          {trend.direction === 'up' ? '↑' : '↓'} {trend.label}
        </div>
      )}
    </div>
  )
}
