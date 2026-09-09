import { render } from "preact";
import { playerColor } from "../bluemap-adapter.js";

interface PlayerFilterProps {
  names: ReadonlyMap<number, string>;
  selected: ReadonlySet<number>;
  onChange: (player: number, selected: boolean) => void;
}

const PlayerFilter = ({ names, selected, onChange }: PlayerFilterProps) => (
  <>
    {[...names].map(([id, name]) => (
      <label key={id}>
        <input
          type="checkbox"
          checked={selected.has(id)}
          onChange={(event) => onChange(id, event.currentTarget.checked)}
        />
        <i class="history-player-color" style={{ background: playerColor(id) }} />
        {name}
      </label>
    ))}
  </>
);

export const renderPlayerFilter = (root: HTMLElement, props: PlayerFilterProps): void => {
  render(<PlayerFilter {...props} />, root);
};
