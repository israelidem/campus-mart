"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiClientError, apiPatch, apiPost } from "@/lib/api/client";

/**
 * Campus delivery locations (PRD §28).
 *
 * Coordinates are optional but they are what makes the delivery fee reflect
 * distance; without them the campus falls back to its base fee. Locations are
 * deactivated rather than deleted, because past orders still name them.
 */

export type DeliveryLocationRow = {
  id: string;
  name: string;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  isActive: boolean;
};

export function DeliveryLocationManager({ locations }: { locations: DeliveryLocationRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setIsBusy(true);
    try {
      await action();
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : "Something went wrong. Please try again.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function create() {
    await run(async () => {
      await apiPost("/api/delivery-locations", {
        name,
        description: description.trim() === "" ? undefined : description.trim(),
        latitude: latitude.trim() === "" ? undefined : Number(latitude),
        longitude: longitude.trim() === "" ? undefined : Number(longitude),
      });
      setName("");
      setDescription("");
      setLatitude("");
      setLongitude("");
    });
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <Card>
        <h2 className="font-medium">Add a location</h2>
        <div className="mt-3 space-y-3">
          <div>
            <label className="block text-sm" htmlFor="location-name">
              Name
            </label>
            <input
              id="location-name"
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-current/20 px-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm" htmlFor="location-description">
              Description (optional)
            </label>
            <input
              id="location-description"
              value={description}
              maxLength={300}
              onChange={(event) => setDescription(event.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-current/20 px-2 text-sm"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-sm" htmlFor="location-latitude">
                Latitude (optional)
              </label>
              <input
                id="location-latitude"
                inputMode="decimal"
                value={latitude}
                onChange={(event) => setLatitude(event.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-current/20 px-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm" htmlFor="location-longitude">
                Longitude (optional)
              </label>
              <input
                id="location-longitude"
                inputMode="decimal"
                value={longitude}
                onChange={(event) => setLongitude(event.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-current/20 px-2 text-sm"
              />
            </div>
          </div>

          <Button isLoading={isBusy} disabled={name.trim().length < 2} onClick={() => void create()}>
            Add location
          </Button>
        </div>
      </Card>

      {locations.length === 0 ? (
        <Card>
          <p className="text-sm">
            No delivery locations yet. Students cannot check out until at least one exists.
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {locations.map((location) => (
            <li key={location.id}>
              <Card>
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-medium">{location.name}</h3>
                  <span className="text-sm opacity-70">
                    {location.isActive ? "active" : "inactive"}
                  </span>
                </div>
                {location.description ? (
                  <p className="mt-1 text-sm opacity-70">{location.description}</p>
                ) : null}
                <p className="mt-1 text-sm opacity-70">
                  {location.latitude !== null && location.longitude !== null
                    ? `${location.latitude}, ${location.longitude}`
                    : "No coordinates — orders here are charged the base delivery fee"}
                </p>
                <div className="mt-3">
                  <Button
                    variant={location.isActive ? "outline" : "primary"}
                    size="sm"
                    isLoading={isBusy}
                    onClick={() =>
                      void run(() =>
                        apiPatch(`/api/delivery-locations/${location.id}`, {
                          isActive: !location.isActive,
                        }),
                      )
                    }
                  >
                    {location.isActive ? "Deactivate" : "Reactivate"}
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
