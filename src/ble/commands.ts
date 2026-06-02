/**
 * WHOOP command framing for the command_to_strap characteristic.
 *
 * Wraps the protocol frame builder (`buildV5CommandFrame`) with a small monotonically
 * increasing sequence counter. Only GET_HELLO is named so far (matching the ported
 * `command_name` table); richer commands (alarms, historical sync) are added as their
 * command numbers are validated.
 */
import { buildV5CommandFrame, COMMAND_GET_HELLO } from '../core/protocol';

export { COMMAND_GET_HELLO };

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

  /** Build the GET_HELLO handshake command. */
  getHello(): Uint8Array {
    return this.build(COMMAND_GET_HELLO);
  }
}
