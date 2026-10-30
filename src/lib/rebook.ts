export type RebookReservation = {
  start_time: string;
  end_time: string;
  rate_type: "hourly" | "daily" | "monthly";
};

export type RebookSearch = {
  start: string;
  length: number;
  rate: "hourly" | "daily" | "monthly";
};

export function rebookSearch(prev: RebookReservation): RebookSearch {
  const start = new Date(Date.now() + 15 * 60_000);
  start.setSeconds(0, 0);
  if (start.getMinutes() < 30) {
    start.setMinutes(30, 0, 0);
  } else {
    start.setHours(start.getHours() + 1, 0, 0, 0);
  }

  const durMs =
    new Date(prev.end_time).getTime() - new Date(prev.start_time).getTime();
  let duration: number;
  if (prev.rate_type === "hourly") {
    duration = Math.max(0.5, Math.round((durMs / 3_600_000) * 2) / 2);
  } else if (prev.rate_type === "daily") {
    duration = Math.max(1, Math.round(durMs / 86_400_000));
  } else {
    duration = Math.max(1, Math.round(durMs / (30 * 86_400_000)));
  }

  return { start: start.toISOString(), length: duration, rate: prev.rate_type };
}