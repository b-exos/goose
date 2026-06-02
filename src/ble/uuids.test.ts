/** Tests for WHOOP GATT profile lookups. */
import { characteristicUuid, INBOUND_ROLES, profileForServiceUuid, WHOOP_GEN5 } from './uuids';

describe('WHOOP uuids', () => {
  it('resolves the gen5 profile from its service uuid (case-insensitive)', () => {
    expect(profileForServiceUuid('FD4B0001-CCE1-4033-93CE-002D5875F58A')).toBe(WHOOP_GEN5);
    expect(profileForServiceUuid('  fd4b0001-cce1-4033-93ce-002d5875f58a  ')).toBe(WHOOP_GEN5);
  });

  it('returns null for an unknown service uuid', () => {
    expect(profileForServiceUuid('0000180d-0000-1000-8000-00805f9b34fb')).toBeNull();
  });

  it('maps gen5 to the GOOSE device type and command characteristic', () => {
    expect(WHOOP_GEN5.deviceType).toBe('GOOSE');
    expect(characteristicUuid(WHOOP_GEN5, 'command_to_strap')).toBe(
      'fd4b0002-cce1-4033-93ce-002d5875f58a',
    );
  });

  it('subscribes to the three inbound notify roles', () => {
    expect(INBOUND_ROLES).toEqual(['command_from_strap', 'events_from_strap', 'data_from_strap']);
  });
});
