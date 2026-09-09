import { render } from "preact";

interface ActivityHistogramProps {
  bins: readonly number[];
  from: number;
  to: number;
  formatTime: (time: number) => string;
}

const ActivityHistogram = ({ bins, from, to, formatTime }: ActivityHistogramProps) => {
  const max = Math.max(0, ...bins);
  return (
    <>
      {bins.map((count, index) => (
        <span
          // The bucket index is stable for the lifetime of one histogram.
          key={index}
          style={{ height: count > 0 ? `max(2px, ${(count / max) * 100}%)` : "0" }}
          title={`${formatTime(from + ((to - from) * index) / bins.length)} · ${Math.round(count).toLocaleString()} recorded samples (approx.)`}
        />
      ))}
    </>
  );
};

export const renderActivityHistogram = (root: HTMLElement, props: ActivityHistogramProps): void => {
  render(<ActivityHistogram {...props} />, root);
};
