/**
 * WHOOP BLE GATT profile (service + characteristic UUIDs by generation/role).
 *
 * Ported from `docs/rust-reference/src/openwhoop_reference.rs`. Gen5 is the WHOOP 5.0
 * "Goose" band this app targets; Gen4 is retained for completeness.
 */
import type { DeviceType } from '../core/protocol';

export type WhoopGeneration = 'gen4' | 'gen5';

export type WhoopCharacteristicRole =
  | 'command_to_strap' // write commands to the band
  | 'command_from_strap' // notify: command responses
  | 'events_from_strap' // notify: events
  | 'data_from_strap' // notify: realtime/historical data
  | 'memfault'; // notify: diagnostic logs

export interface WhoopGenerationProfile {
  generation: WhoopGeneration;
  /** Protocol DeviceType used when parsing this generation's frames. */
  deviceType: DeviceType;
  serviceUuid: string;
  characteristics: Record<WhoopCharacteristicRole, string>;
}

export const WHOOP_GEN5: WhoopGenerationProfile = {
  generation: 'gen5',
  deviceType: 'GOOSE',
  serviceUuid: 'fd4b0001-cce1-4033-93ce-002d5875f58a',
  characteristics: {
    command_to_strap: 'fd4b0002-cce1-4033-93ce-002d5875f58a',
    command_from_strap: 'fd4b0003-cce1-4033-93ce-002d5875f58a',
    events_from_strap: 'fd4b0004-cce1-4033-93ce-002d5875f58a',
    data_from_strap: 'fd4b0005-cce1-4033-93ce-002d5875f58a',
    memfault: 'fd4b0007-cce1-4033-93ce-002d5875f58a',
  },
};

export const WHOOP_GEN4: WhoopGenerationProfile = {
  generation: 'gen4',
  deviceType: 'GEN4',
  serviceUuid: '61080001-8d6d-82b8-614a-1c8cb0f8dcc6',
  characteristics: {
    command_to_strap: '61080002-8d6d-82b8-614a-1c8cb0f8dcc6',
    command_from_strap: '61080003-8d6d-82b8-614a-1c8cb0f8dcc6',
    events_from_strap: '61080004-8d6d-82b8-614a-1c8cb0f8dcc6',
    data_from_strap: '61080005-8d6d-82b8-614a-1c8cb0f8dcc6',
    memfault: '61080007-8d6d-82b8-614a-1c8cb0f8dcc6',
  },
};

export const WHOOP_PROFILES: WhoopGenerationProfile[] = [WHOOP_GEN5, WHOOP_GEN4];

/** The notify characteristics a client subscribes to for inbound frames. */
export const INBOUND_ROLES: WhoopCharacteristicRole[] = [
  'command_from_strap',
  'events_from_strap',
  'data_from_strap',
];

/** Look up a profile by its advertised service UUID (case-insensitive), or null. */
export function profileForServiceUuid(serviceUuid: string): WhoopGenerationProfile | null {
  const normalized = serviceUuid.trim().toLowerCase();
  return WHOOP_PROFILES.find((p) => p.serviceUuid === normalized) ?? null;
}

/** Resolve a characteristic UUID for a profile + role. */
export function characteristicUuid(
  profile: WhoopGenerationProfile,
  role: WhoopCharacteristicRole,
): string {
  return profile.characteristics[role];
}
