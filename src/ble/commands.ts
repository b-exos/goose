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
}
