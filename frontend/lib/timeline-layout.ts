import type { TimelineItem } from "@/components/timeline/Timeline";

export type PositionedItem = TimelineItem & {
  top: number;
  left: string;
  width: string;
};

export const START_HOUR = 0;
export const PX_PER_HOUR = 64;
const CARD_HEIGHT = 28;
const COLUMN_WIDTH = "48%";
const COLUMN_GAP_LEFT = "52%";

function itemTop(item: TimelineItem): number {
  const d = new Date(item.time);
  const hour = d.getHours() + d.getMinutes() / 60;
  return (hour - START_HOUR) * PX_PER_HOUR;
}

/**
 * Positions timeline items by real time, but groups any items whose 28px
 * card would visually overlap the previous one into a "cluster" and splits
 * clusters into up to 2 side-by-side columns (extra rows for a 3rd+ item in
 * the same tight cluster) instead of letting them collide. Items 30+
 * minutes apart never cluster at this card height, so a normal schedule
 * renders with no special-casing.
 */
export function computeLayout(items: TimelineItem[]): PositionedItem[] {
  const sorted = [...items].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));

  const clusters: TimelineItem[][] = [];
  let clusterEnd = -Infinity;
  for (const item of sorted) {
    const top = itemTop(item);
    if (clusters.length > 0 && top < clusterEnd) {
      clusters[clusters.length - 1].push(item);
    } else {
      clusters.push([item]);
    }
    clusterEnd = Math.max(clusterEnd, top + CARD_HEIGHT);
  }

  const positioned: PositionedItem[] = [];
  for (const cluster of clusters) {
    if (cluster.length === 1) {
      positioned.push({ ...cluster[0], top: itemTop(cluster[0]), left: "0%", width: "100%" });
      continue;
    }
    const clusterTop = itemTop(cluster[0]);
    cluster.forEach((item, i) => {
      const row = Math.floor(i / 2);
      const col = i % 2;
      positioned.push({
        ...item,
        top: clusterTop + row * CARD_HEIGHT,
        left: col === 0 ? "0%" : COLUMN_GAP_LEFT,
        width: COLUMN_WIDTH,
      });
    });
  }
  return positioned;
}
