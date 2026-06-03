#!/usr/bin/env node
/**
 * Decode an Android `btsnoop_hci.log` capture of the WHOOP app <-> band BLE session into a
 * readable WHOOP command/response/event trace — the raw material for replicating gen5 auth.
 *
 * Pipeline: btsnoop records -> HCI ACL packets -> L2CAP (ATT channel, CID 0x0004) -> ATT PDUs
 * (Write Command/Request + Handle Value Notification/Indication) -> per-(handle,direction) byte
 * streams -> WHOOP frames (0xAA framing) -> {packetType, sequence, commandOrEvent, payload}.
 *
 * Usage:  node scripts/decode-btsnoop.mjs <btsnoop_hci.log> [--all]
 *   --all   print every WHOOP frame (default: focus on commands/responses/events, summarize data)
 *
 * No dependencies. WHOOP frame layout (gen5): byte0=0xAA, [2..4]=declaredLen u16 LE (payload+crc32),
 * [4..6]=flags, [6..8]=hdr CRC16, [8..8+declaredLen]=payload(+4 CRC32). payload[0]=packetType,
 * payload[1]=sequence, payload[2]=commandOrEvent.
 */
import { readFileSync } from 'node:fs';

const PACKET_TYPE = {
  35: 'COMMAND',
  36: 'COMMAND_RESPONSE',
  40: 'REALTIME_DATA',
  47: 'HISTORICAL_DATA',
  48: 'EVENT',
  49: 'METADATA',
};

const COMMAND_NAME = {
  3: 'toggle_realtime_hr', 10: 'set_clock', 11: 'get_clock', 20: 'abort_historical',
  22: 'send_historical_data', 23: 'historical_data_result', 26: 'get_battery', 34: 'get_data_range',
  81: 'start_raw_data', 82: 'stop_raw_data', 96: 'enter_high_freq_sync', 97: 'exit_high_freq_sync',
  105: 'toggle_imu_historical', 106: 'toggle_imu', 107: 'enable_optical', 108: 'toggle_optical',
  115: 'start_device_config_key_exchange', 116: 'send_next_device_config',
  117: 'start_feature_flag_key_exchange', 118: 'send_next_feature_flag',
  119: 'set_device_config_value', 120: 'set_feature_flag_value',
  121: 'get_device_config_value', 128: 'get_feature_flag_value', 145: 'get_hello',
};

const AUTH_COMMANDS = new Set([115, 116, 117, 118, 119, 120, 121, 128, 145]);

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

/** Parse a btsnoop file into records: {tsUs, flags, data}. */
function parseBtsnoop(buf) {
  if (buf.length < 16 || buf.toString('latin1', 0, 8) !== 'btsnoop\0') {
    fail('not a btsnoop file (missing "btsnoop" magic). On Android pull /data/misc/bluetooth/logs/btsnoop_hci.log');
  }
  const datalink = buf.readUInt32BE(12);
  const records = [];
  let off = 16;
  while (off + 24 <= buf.length) {
    const inclLen = buf.readUInt32BE(off + 4);
    const flags = buf.readUInt32BE(off + 8);
    const tsUs = Number(buf.readBigInt64BE(off + 16));
    const start = off + 24;
    const end = start + inclLen;
    if (end > buf.length) break;
    records.push({ flags, tsUs, data: buf.subarray(start, end) });
    off = end;
  }
  return { datalink, records };
}

/**
 * From an HCI record, return ACL fragments {handle, pb, dir, l2cap} or null.
 * datalink 1002 = HCI UART (H4, 1-byte type prefix); 1001 = HCI BSCP; common Android = 1002.
 * Record flag bit0 = direction (1 = received/from controller).
 */
function hciAclPayload(rec, datalink) {
  let d = rec.data;
  let hciType;
  if (datalink === 1002) {
    hciType = d[0];
    d = d.subarray(1);
  } else {
    // Assume HCI with no H4 prefix is uncommon here; treat as raw and sniff for ACL (type 2).
    hciType = d[0];
    d = d.subarray(1);
  }
  if (hciType !== 0x02) return null; // ACL data only
  if (d.length < 4) return null;
  const handleField = d.readUInt16LE(0);
  const handle = handleField & 0x0fff;
  const pb = (handleField >> 12) & 0x3; // 0b00 continuation, 0b10 first non-flushable
  const len = d.readUInt16LE(2);
  const acl = d.subarray(4, 4 + len);
  const dir = rec.flags & 0x1 ? 'in' : 'out'; // in = from band, out = from phone
  return { handle, pb, dir, acl };
}

/** Reassemble L2CAP across ACL fragments per connection handle; emit complete ATT PDUs. */
function* attPdus(records, datalink) {
  const partial = new Map(); // handle -> {buf, need}
  for (const rec of records) {
    const frag = hciAclPayload(rec, datalink);
    if (!frag) continue;
    const key = `${frag.handle}:${frag.dir}`;
    if (frag.pb === 0x1 || frag.pb === 0x3) {
      // continuation fragment
      const p = partial.get(key);
      if (!p) continue;
      p.buf = Buffer.concat([p.buf, frag.acl]);
    } else {
      // first fragment: starts a new L2CAP PDU (len u16 LE + CID u16 LE + payload)
      if (frag.acl.length < 4) continue;
      const l2Len = frag.acl.readUInt16LE(0);
      const cid = frag.acl.readUInt16LE(2);
      partial.set(key, { buf: frag.acl, need: l2Len + 4, cid });
    }
    const p = partial.get(key);
    if (p && p.buf.length >= p.need) {
      if (p.cid === 0x0004) {
        yield { dir: frag.dir, att: p.buf.subarray(4, p.need) };
      }
      partial.delete(key);
    }
  }
}

/** Extract (handle, value, dir) from an ATT PDU we care about. */
function attValue(pdu) {
  const op = pdu.att[0];
  // Write Request 0x12 / Write Command 0x52 / Signed Write 0xD2: handle(2) + value
  if (op === 0x12 || op === 0x52 || op === 0xd2) {
    return { kind: 'write', handle: pdu.att.readUInt16LE(1), value: pdu.att.subarray(3), dir: pdu.dir };
  }
  // Handle Value Notification 0x1B / Indication 0x1D: handle(2) + value
  if (op === 0x1b || op === 0x1d) {
    return { kind: 'notify', handle: pdu.att.readUInt16LE(1), value: pdu.att.subarray(3), dir: pdu.dir };
  }
  // Prepare Write 0x16: handle(2) + offset(2) + part — used for long writes
  if (op === 0x16) {
    return { kind: 'write', handle: pdu.att.readUInt16LE(1), value: pdu.att.subarray(5), dir: pdu.dir };
  }
  return null;
}

/** Scan a byte stream for WHOOP frames (0xAA framed), returning parsed summaries. */
function extractWhoopFrames(buf) {
  const frames = [];
  let i = 0;
  while (i < buf.length) {
    if (buf[i] !== 0xaa) { i++; continue; }
    if (i + 8 > buf.length) break;
    const declaredLen = buf.readUInt16LE(i + 2);
    const total = 8 + declaredLen;
    if (declaredLen < 4 || i + total > buf.length) { i++; continue; }
    const payload = buf.subarray(i + 8, i + 8 + declaredLen - 4); // strip trailing CRC32
    if (payload.length < 1) { i++; continue; }
    frames.push({
      packetType: payload[0],
      sequence: payload[1] ?? null,
      commandOrEvent: payload[2] ?? null,
      payloadHex: payload.toString('hex'),
    });
    i += total;
  }
  return frames;
}

function main() {
  const file = process.argv[2];
  const showAll = process.argv.includes('--all');
  if (!file) fail('usage: node scripts/decode-btsnoop.mjs <btsnoop_hci.log> [--all]');

  const buf = readFileSync(file);
  const { datalink, records } = parseBtsnoop(buf);
  console.log(`btsnoop: datalink=${datalink} records=${records.length}`);

  // Collect ATT values per (handle,dir) and concatenate to recover the WHOOP byte streams.
  const streams = new Map(); // key -> Buffer
  let attCount = 0;
  for (const pdu of attPdus(records, datalink)) {
    const v = attValue(pdu);
    if (!v || v.value.length === 0) continue;
    attCount++;
    const key = `${v.handle}:${v.dir}:${v.kind}`;
    streams.set(key, Buffer.concat([streams.get(key) ?? Buffer.alloc(0), v.value]));
  }
  console.log(`att PDUs with values: ${attCount}; streams: ${streams.size}`);

  // Extract WHOOP frames from every stream, tag with direction.
  const all = [];
  for (const [key, sbuf] of streams) {
    const [handle, dir, kind] = key.split(':');
    for (const f of extractWhoopFrames(sbuf)) all.push({ ...f, handle, dir, kind });
  }
  if (all.length === 0) {
    console.log('\nNo WHOOP frames found. The values may be fragmented differently — re-run with --all and inspect, or share the file.');
    return;
  }

  // Summary by packet type.
  const byType = {};
  for (const f of all) byType[PACKET_TYPE[f.packetType] ?? `type${f.packetType}`] = (byType[PACKET_TYPE[f.packetType] ?? `type${f.packetType}`] ?? 0) + 1;
  console.log('\nframe types:', JSON.stringify(byType));

  // The handshake: print all commands/responses/events; for data, only counts unless --all.
  console.log('\n=== command / response / event trace ===');
  for (const f of all) {
    const isData = f.packetType === 40 || f.packetType === 47;
    if (isData && !showAll) continue;
    const name = f.packetType === 35 || f.packetType === 36 ? COMMAND_NAME[f.commandOrEvent] ?? '' : '';
    const star = AUTH_COMMANDS.has(f.commandOrEvent) && (f.packetType === 35 || f.packetType === 36) ? '  <== AUTH' : '';
    console.log(
      `[${f.dir}] ${PACKET_TYPE[f.packetType] ?? `type${f.packetType}`} seq=${f.sequence} cmd/evt=${f.commandOrEvent}${name ? ` (${name})` : ''} len=${f.payloadHex.length / 2} hex=${f.payloadHex}${star}`,
    );
  }

  // Focused auth dump.
  const auth = all.filter((f) => (f.packetType === 35 || f.packetType === 36) && AUTH_COMMANDS.has(f.commandOrEvent));
  console.log(`\n=== auth/key-exchange frames (${auth.length}) ===`);
  for (const f of auth) {
    console.log(`[${f.dir}] cmd/evt=${f.commandOrEvent} (${COMMAND_NAME[f.commandOrEvent]}) hex=${f.payloadHex}`);
  }
}

main();
