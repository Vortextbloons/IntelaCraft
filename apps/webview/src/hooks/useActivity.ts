import { useCallback, useMemo, useState } from "react";
import type { ActivityRecord } from "../types";

export function useActivity() {
  const [activity, setActivity] = useState<ActivityRecord[]>([]);
  const [activityFilter, setActivityFilter] = useState("");

  const filteredActivity = useMemo(
    () =>
      activityFilter
        ? activity.filter(
            (r) =>
              r.type.includes(activityFilter) ||
              r.taskId?.includes(activityFilter) ||
              r.actionId?.includes(activityFilter),
          )
        : activity,
    [activity, activityFilter],
  );

  return {
    activity,
    setActivity,
    activityFilter,
    setActivityFilter,
    filteredActivity,
  };
}
