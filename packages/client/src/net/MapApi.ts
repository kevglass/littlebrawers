import type { MapData } from "@brawlers/shared";
import { SIGNAL_BASE_URL } from "./config";

export interface MapSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  updatedAt: number;
}

export async function listMaps(): Promise<MapSummary[]> {
  // Cache-bust: an intermediate cache (hosting-level page cache, not the browser) has been
  // observed serving a stale, pre-existing response for this URL indefinitely regardless of
  // the no-store headers the server sends, so force a unique URL on every call.
  const res = await fetch(`${SIGNAL_BASE_URL}/api/maps/list.php?_=${Date.now()}`);
  if (!res.ok) throw new Error("Failed to list maps");
  const data = (await res.json()) as { maps: MapSummary[] };
  return data.maps;
}

export async function getMap(id: string): Promise<MapData> {
  const res = await fetch(`${SIGNAL_BASE_URL}/api/maps/get.php?id=${encodeURIComponent(id)}&_=${Date.now()}`);
  if (!res.ok) throw new Error("Failed to load map");
  return res.json() as Promise<MapData>;
}
