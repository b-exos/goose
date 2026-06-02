/**
 * Constant tables and name lookups for the frame protocol.
 * Ported from `docs/rust-reference/src/protocol.rs`.
 */

export const PACKET_TYPE = {
  COMMAND: 35,
  COMMAND_RESPONSE: 36,
  PUFFIN_COMMAND: 37,
  PUFFIN_COMMAND_RESPONSE: 38,
  REALTIME_DATA: 40,
  REALTIME_RAW_DATA: 43,
  HISTORICAL_DATA: 47,
  EVENT: 48,
  METADATA: 49,
  CONSOLE_LOGS: 50,
  REALTIME_IMU_DATA_STREAM: 51,
  HISTORICAL_IMU_DATA_STREAM: 52,
  RELATIVE_PUFFIN_EVENTS: 53,
  PUFFIN_EVENTS_FROM_STRAP: 54,
  RELATIVE_BATTERY_PACK_CONSOLE_LOGS: 55,
  PUFFIN_METADATA: 56,
} as const;

export const COMMAND_GET_HELLO = 145;

const PACKET_TYPE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(PACKET_TYPE).map(([name, value]) => [value, name]),
);

/** Human-readable packet type name, or null if unknown. */
export function packetTypeName(packetType: number): string | null {
  return PACKET_TYPE_NAMES[packetType] ?? null;
}

/** Command name lookup (only GET_HELLO is currently named). */
export function commandName(command: number): string | null {
  return command === COMMAND_GET_HELLO ? 'GET_HELLO' : null;
}

const STRAP_EVENT_NAMES: Record<number, string> = {
  0: 'UNDEFINED',
  1: 'ERROR',
  2: 'CONSOLE_OUTPUT',
  3: 'BATTERY_LEVEL',
  4: 'SYSTEM_CONTROL',
  7: 'CHARGING_ON',
  8: 'CHARGING_OFF',
  9: 'WRIST_ON',
  10: 'WRIST_OFF',
  11: 'BLE_CONNECTION_UP',
  12: 'BLE_CONNECTION_DOWN',
  13: 'RTC_LOST',
  14: 'DOUBLE_TAP',
  15: 'BOOT',
  16: 'SET_RTC',
  17: 'TEMPERATURE_LEVEL',
  18: 'PAIRING_MODE',
  28: 'FLASH_INIT_COMPLETE',
  29: 'STRAP_CONDITION_REPORT',
  33: 'BLE_REALTIME_HR_ON',
  34: 'BLE_REALTIME_HR_OFF',
  56: 'STRAP_DRIVEN_ALARM_SET',
  57: 'STRAP_DRIVEN_ALARM_EXECUTED',
  58: 'APP_DRIVEN_ALARM_EXECUTED',
  59: 'STRAP_DRIVEN_ALARM_DISABLED',
  60: 'HAPTICS_FIRED',
  63: 'EXTENDED_BATTERY_INFORMATION',
  96: 'HIGH_FREQ_SYNC_PROMPT',
  97: 'HIGH_FREQ_SYNC_ENABLED',
  98: 'HIGH_FREQ_SYNC_DISABLED',
  100: 'HAPTICS_TERMINATED',
  109: 'BATTERY_PACK_INFO',
  123: 'GENERIC_FIRMWARE_EVENT',
};

/** Strap event name, or null if unknown. */
export function strapEventName(eventId: number): string | null {
  return STRAP_EVENT_NAMES[eventId] ?? null;
}

const DATA_PACKET_DOMAINS: Record<number, string> = {
  7: 'legacy_raw_or_research_counted',
  9: 'normal_history_with_hr_marker',
  12: 'normal_history_with_hr_marker',
  18: 'normal_history_with_hr_marker',
  24: 'normal_history_with_hr_marker',
  10: 'raw_motion_stream_result',
  21: 'raw_motion_stream_result',
  11: 'raw_stream_counted',
  16: 'raw_ecg_labrador',
  17: 'r17_optical_or_labrador_filtered',
  19: 'research_packet',
  22: 'research_packet',
  20: 'raw_or_research_counted',
  25: 'pulse_information_packet',
  26: 'pulse_information_packet',
};

/** Domain label for a data-packet K value, or null if unknown. */
export function dataPacketDomain(packetK: number): string | null {
  return DATA_PACKET_DOMAINS[packetK] ?? null;
}

/** Byte offset of the HR-present marker for a history K value, or null. */
export function historyHrMarkerOffset(packetK: number): number | null {
  switch (packetK) {
    case 7:
      return 27;
    case 9:
    case 12:
    case 24:
      return 17;
    case 18:
      return 14;
    default:
      return null;
  }
}
