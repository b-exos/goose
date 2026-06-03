/**
 * WHOOP command framing for the command_to_strap characteristic.
 *
 * Wraps the protocol frame builder (`buildV5CommandFrame`) with a small monotonically
 * increasing sequence counter. Command numbers are from the reference `commands.rs`.
 *
 * Payload byte layouts for set_clock and historical_data_result are inferred (the original
 * byte-level builders lived in the now-removed Swift client); they follow the obvious
 * conventions and are validated on-device, the same way `toggle_realtime_hr` was.
 */
import { buildV5CommandFrame, COMMAND_GET_HELLO } from '../core/protocol';

export { COMMAND_GET_HELLO };

/** Command numbers (from `docs/rust-reference/src/commands.rs`). */
export const COMMAND_TOGGLE_REALTIME_HR = 3; // toggle_realtime_hr (on/off byte)
export const COMMAND_SET_CLOCK = 10; // set_clock (u32 LE seconds + u16 LE subseconds)
export const COMMAND_GET_CLOCK = 11; // get_clock
export const COMMAND_ABORT_HISTORICAL = 20; // abort_historical_transmits
export const COMMAND_SEND_HISTORICAL_DATA = 22; // send_historical_data
export const COMMAND_HISTORICAL_DATA_RESULT = 23; // historical_data_result (disposition byte)
export const COMMAND_GET_BATTERY_LEVEL = 26; // get_battery_level
export const COMMAND_GET_DATA_RANGE = 34; // get_data_range
export const COMMAND_ENTER_HIGH_FREQ_SYNC = 96; // enter bulk-history sync mode
export const COMMAND_EXIT_HIGH_FREQ_SYNC = 97; // exit bulk-history sync mode
export const COMMAND_START_RAW_DATA = 81; // start realtime raw data stream
export const COMMAND_STOP_RAW_DATA = 82; // stop realtime raw data stream
export const COMMAND_START_DEVICE_CONFIG_KEY_EXCHANGE = 115; // begin auth/key exchange
export const COMMAND_GET_DEVICE_CONFIG_VALUE = 121; // read a device-config value (read-only)
export const COMMAND_GET_FEATURE_FLAG_VALUE = 128; // read a feature flag (read-only)
export const COMMAND_TOGGLE_IMU_MODE_HISTORICAL = 105; // motion buffering → sleep
export const COMMAND_TOGGLE_IMU_MODE = 106; // realtime IMU
export const COMMAND_ENABLE_OPTICAL_DATA = 107; // realtime optical R20
export const COMMAND_TOGGLE_OPTICAL_MODE = 108; // optical/R17 → RR intervals (HRV/recovery)
export const COMMAND_SEND_R10_R11_REALTIME = 63; // realtime raw motion (R10/R11)
export const COMMAND_TOGGLE_PERSISTENT_R20 = 153; // persistent optical R20 stream
export const COMMAND_TOGGLE_PERSISTENT_R21 = 154; // persistent motion R21 stream

/**
 * Sensor-toggle payload used by the WHOOP app for the IMU/optical/persistent commands:
 * `[revision, enabled]` (revision pinned to 1). Plain `[1]` (single byte) was insufficient —
 * the band ACKs it but won't stream. Matches the original Goose `revisionBoolean`.
 */
function revisionBoolean(enabled: boolean): Uint8Array {
  return new Uint8Array([1, enabled ? 1 : 0]);
}

/** little-endian u32 bytes. */
function u32le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

/** Issues framed commands with an auto-incrementing 1-byte sequence. */
export class CommandSequencer {
  private sequence = 0;

  private nextSequence(): number {
    this.sequence = (this.sequence + 1) & 0xff;
    return this.sequence;
  }

  /** Build a framed command (frame bytes ready to write to command_to_strap). */
  build(command: number, data: Uint8Array = new Uint8Array()): Uint8Array {
    return buildV5CommandFrame(this.nextSequence(), command, data);
  }

  getHello(): Uint8Array {
    return this.build(COMMAND_GET_HELLO);
  }

  /** Toggle realtime heart-rate packets (on/off byte payload). */
  toggleRealtimeHr(enable: boolean): Uint8Array {
    return this.build(COMMAND_TOGGLE_REALTIME_HR, new Uint8Array([enable ? 1 : 0]));
  }

  /** Set the band RTC to `unixSeconds` (subseconds 0). */
  setClock(unixSeconds: number): Uint8Array {
    return this.build(COMMAND_SET_CLOCK, new Uint8Array([...u32le(unixSeconds), 0, 0]));
  }

  getClock(): Uint8Array {
    return this.build(COMMAND_GET_CLOCK);
  }

  getBatteryLevel(): Uint8Array {
    return this.build(COMMAND_GET_BATTERY_LEVEL);
  }

  /** Ask the band for its available historical data range. */
  getDataRange(): Uint8Array {
    return this.build(COMMAND_GET_DATA_RANGE);
  }

  /** Request the band stream its buffered historical data. */
  sendHistoricalData(): Uint8Array {
    return this.build(COMMAND_SEND_HISTORICAL_DATA);
  }

  /** Acknowledge a completed historical transfer (success/failure disposition byte). */
  historicalDataResult(success: boolean): Uint8Array {
    return this.build(COMMAND_HISTORICAL_DATA_RESULT, new Uint8Array([success ? 1 : 0]));
  }

  /** Abort any in-flight historical transmit. */
  abortHistoricalTransmits(): Uint8Array {
    return this.build(COMMAND_ABORT_HISTORICAL);
  }

  /** Enter the band's bulk-history (high-frequency) sync mode. */
  enterHighFreqSync(): Uint8Array {
    return this.build(COMMAND_ENTER_HIGH_FREQ_SYNC);
  }

  /** Exit the bulk-history sync mode. */
  exitHighFreqSync(): Uint8Array {
    return this.build(COMMAND_EXIT_HIGH_FREQ_SYNC);
  }

  /** Toggle historical IMU (motion) buffering — the source for sleep detection. */
  toggleImuModeHistorical(enable: boolean): Uint8Array {
    return this.build(COMMAND_TOGGLE_IMU_MODE_HISTORICAL, new Uint8Array([enable ? 1 : 0]));
  }

  /** Toggle realtime IMU (motion) streaming. */
  toggleImuMode(enable: boolean): Uint8Array {
    return this.build(COMMAND_TOGGLE_IMU_MODE, revisionBoolean(enable));
  }

  /** Enable realtime optical (R20) data. */
  enableOpticalData(enable: boolean): Uint8Array {
    return this.build(COMMAND_ENABLE_OPTICAL_DATA, revisionBoolean(enable));
  }

  /** Toggle the optical stream mode — the source for R17 RR intervals (HRV/recovery). */
  toggleOpticalMode(enable: boolean): Uint8Array {
    return this.build(COMMAND_TOGGLE_OPTICAL_MODE, revisionBoolean(enable));
  }

  /** Start the realtime raw-data stream. */
  startRawData(): Uint8Array {
    return this.build(COMMAND_START_RAW_DATA);
  }

  /** Stop the realtime raw-data stream. */
  stopRawData(): Uint8Array {
    return this.build(COMMAND_STOP_RAW_DATA);
  }

  /**
   * The WHOOP-app "start physiology capture" sequence (ported from the original Goose
   * `startPhysiologyCapture`): HR + R10/R11 + IMU + persistent R21 (motion) + optical enable +
   * optical mode + persistent R20 (optical). This exact set with `[1,1]` payloads is what makes
   * the band actually stream motion/optical/pulse families, not just HR. Returned in order; the
   * client sends them spaced ~250ms apart.
   */
  physiologyStartFrames(): Uint8Array[] {
    return [
      this.build(COMMAND_TOGGLE_REALTIME_HR, new Uint8Array([1])),
      this.build(COMMAND_SEND_R10_R11_REALTIME, new Uint8Array([1])),
      this.build(COMMAND_TOGGLE_IMU_MODE, revisionBoolean(true)),
      this.build(COMMAND_TOGGLE_PERSISTENT_R21, revisionBoolean(true)),
      this.build(COMMAND_ENABLE_OPTICAL_DATA, revisionBoolean(true)),
      this.build(COMMAND_TOGGLE_OPTICAL_MODE, revisionBoolean(true)),
      this.build(COMMAND_TOGGLE_PERSISTENT_R20, revisionBoolean(true)),
    ];
  }

  /** The reverse "stop physiology capture" sequence (disables every stream the start enabled). */
  physiologyStopFrames(): Uint8Array[] {
    return [
      this.build(COMMAND_TOGGLE_PERSISTENT_R20, revisionBoolean(false)),
      this.build(COMMAND_TOGGLE_OPTICAL_MODE, revisionBoolean(false)),
      this.build(COMMAND_ENABLE_OPTICAL_DATA, revisionBoolean(false)),
      this.build(COMMAND_TOGGLE_PERSISTENT_R21, revisionBoolean(false)),
      this.build(COMMAND_TOGGLE_IMU_MODE, revisionBoolean(false)),
      this.build(COMMAND_SEND_R10_R11_REALTIME, new Uint8Array([0])),
      this.build(COMMAND_TOGGLE_REALTIME_HR, new Uint8Array([0])),
    ];
  }

  /** Begin the device-config key exchange (the band's auth handshake entry point). */
  startDeviceConfigKeyExchange(): Uint8Array {
    return this.build(COMMAND_START_DEVICE_CONFIG_KEY_EXCHANGE);
  }
}
