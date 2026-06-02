/** Tests that command frames build into valid, parseable WHOOP frames. */
import { parseFrame } from '../core/protocol';
import {
  COMMAND_GET_HELLO,
  COMMAND_HISTORICAL_DATA_RESULT,
  COMMAND_SEND_HISTORICAL_DATA,
  COMMAND_SET_CLOCK,
  COMMAND_TOGGLE_REALTIME_HR,
  CommandSequencer,
} from './commands';

describe('CommandSequencer', () => {
  it('builds a valid GET_HELLO command frame', () => {
    const frame = parseFrame('GOOSE', new CommandSequencer().getHello());
    expect(frame.headerCrcValid).toBe(true);
    expect(frame.payloadCrcValid).toBe(true);
    expect(frame.packetType).toBe(35); // COMMAND
    expect(frame.commandOrEvent).toBe(COMMAND_GET_HELLO);
  });

  it('builds a realtime-HR toggle with the on/off byte', () => {
    const sequencer = new CommandSequencer();
    const on = parseFrame('GOOSE', sequencer.toggleRealtimeHr(true));
    expect(on.commandOrEvent).toBe(COMMAND_TOGGLE_REALTIME_HR);
    expect(on.payloadCrcValid).toBe(true);
    // payload = [COMMAND(35), sequence, command(3), enableByte(1)]
    expect(on.payloadHex.slice(0, 2)).toBe('23'); // 0x23 = 35
    expect(on.payloadHex.slice(4, 8)).toBe('0301'); // command 3, enable 1
  });

  it('builds set_clock with a little-endian u32 seconds payload', () => {
    const frame = parseFrame('GOOSE', new CommandSequencer().setClock(0x01020304));
    expect(frame.commandOrEvent).toBe(COMMAND_SET_CLOCK);
    // payload = [COMMAND(35), seq, 10, 04,03,02,01, 00,00]
    expect(frame.payloadHex.slice(4, 6)).toBe('0a'); // command 10
    expect(frame.payloadHex.slice(6, 14)).toBe('04030201'); // u32 LE
  });

  it('builds historical sync commands', () => {
    const sequencer = new CommandSequencer();
    expect(parseFrame('GOOSE', sequencer.sendHistoricalData()).commandOrEvent).toBe(
      COMMAND_SEND_HISTORICAL_DATA,
    );
    const ack = parseFrame('GOOSE', sequencer.historicalDataResult(true));
    expect(ack.commandOrEvent).toBe(COMMAND_HISTORICAL_DATA_RESULT);
    expect(ack.payloadHex.slice(6, 8)).toBe('01'); // success byte
  });

  it('increments the sequence per command', () => {
    const sequencer = new CommandSequencer();
    const first = parseFrame('GOOSE', sequencer.getHello());
    const second = parseFrame('GOOSE', sequencer.getHello());
    expect(second.sequence).toBe((first.sequence ?? 0) + 1);
  });
});
