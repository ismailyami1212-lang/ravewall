import { useSession } from '../session'

/**
 * Switches the active workspace. Every API request is then scoped to the chosen
 * workspace via the x-workspace-id header, so the rest of the console follows.
 */
export function WorkspaceSwitcher() {
  const { memberships, workspaceId, setWorkspaceId } = useSession()

  if (!memberships.length) return null

  return (
    <label className="ws-switch" title="Switch workspace">
      <span className="sr-only">Active workspace</span>
      <span className="ws-switch-icon" aria-hidden="true">
        ⌂
      </span>
      <select
        className="ws-switch-select"
        value={workspaceId ?? ''}
        onChange={(event) => void setWorkspaceId(event.target.value || null)}
        aria-label="Active workspace"
      >
        {memberships.map((m) => (
          <option key={m.workspaceId} value={m.workspaceId}>
            {m.workspaceName} · {m.role}
          </option>
        ))}
      </select>
    </label>
  )
}
