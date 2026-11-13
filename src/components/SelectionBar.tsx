type SelectionBarProps = {
  canGroup: boolean;
  canUngroup: boolean;
  canDetach: boolean;
  groups: { id: string; label: string }[];
  onGroup: () => void;
  onUngroup: () => void;
  onDetach: () => void;
  onAddTo: (groupId: string) => void;
};

export function SelectionBar({
  canGroup,
  canUngroup,
  canDetach,
  groups,
  onGroup,
  onUngroup,
  onDetach,
  onAddTo,
}: SelectionBarProps) {
  if (!canGroup && !canUngroup && !canDetach && groups.length === 0) return null;
  return (
    <div className="selection-bar">
      {canGroup ? (
        <button type="button" onClick={onGroup}>
          Group
        </button>
      ) : null}
      {canUngroup ? (
        <button type="button" onClick={onUngroup}>
          Ungroup
        </button>
      ) : null}
      {canDetach ? (
        <button type="button" onClick={onDetach}>
          Remove from group
        </button>
      ) : null}
      {groups.length > 0 ? (
        <label>
          Move to
          <select
            aria-label="Move selected notes to a group"
            defaultValue=""
            onChange={(event) => {
              if (event.target.value) onAddTo(event.target.value);
              event.target.value = '';
            }}
          >
            <option value="" disabled>
              Group
            </option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.label || 'Group'}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
