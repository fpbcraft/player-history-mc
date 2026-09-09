import { render } from "preact";

interface EventFilterProps {
  types: ReadonlySet<string>;
  disabled: ReadonlySet<string>;
  onChange: (type: string, visible: boolean) => void;
}

const eventLabel = (type: string): string => type.toLowerCase().replaceAll("_", " ");

const EventFilter = ({ types, disabled, onChange }: EventFilterProps) => (
  <>
    {[...types].map((type) => (
      <label key={type}>
        <input
          type="checkbox"
          aria-label={eventLabel(type)}
          checked={!disabled.has(type)}
          onChange={(event) => onChange(type, event.currentTarget.checked)}
        />
        {eventLabel(type)}
      </label>
    ))}
  </>
);

export const renderEventFilter = (root: HTMLElement, props: EventFilterProps): void => {
  render(<EventFilter {...props} />, root);
};
