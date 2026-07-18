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
  const res = await fetch(`${SIGNAL_BASE_URL}/api/maps/list.php`);
  if (!res.ok) throw new Error("Failed to list maps");
  const data = (await res.json()) as { maps: MapSummary[] };
  return data.maps;
}

export async function getMap(id: string): Promise<MapData> {
  const res = await fetch(`${SIGNAL_BASE_URL}/api/maps/get.php?id=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error("Failed to load map");
  return res.json() as Promise<MapData>;
}

export async function saveMap(map: MapData): Promise<void> {
  const res = await fetch(`${SIGNAL_BASE_URL}/api/maps/save.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(map),
  });
  if (!res.ok) throw new Error("Failed to save map");
}

export async function deleteMap(id: string): Promise<void> {
  const res = await fetch(`${SIGNAL_BASE_URL}/api/maps/delete.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw new Error("Failed to delete map");
}
