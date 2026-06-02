/**
 * Golden parity tests for data-packet payload parsing (body summaries).
 * Covers K10 / K21 raw-motion, R17 optical, and K18 normal-history against the
 * preserved synthetic frame fixtures.
 */
import { parseFrameHex } from './index';
import { loadFixture, loadHex } from '../testing/fixtures';

function parse(name: string) {
  return parseFrameHex('GOOSE', loadHex(`synthetic/${name}.hex`));
}

describe('data-packet body summaries (golden)', () => {
  it('parses a K10 raw-motion frame', () => {
    const { expected } = loadFixture<any>('synthetic/goose_v5_k10_motion_summary_short.fixture.json');
    const frame = parse('goose_v5_k10_motion_summary_short');
    expect(frame.packetType).toBe(expected.packet_type);
    expect(frame.packetTypeName).toBe(expected.packet_type_name);

    expect(frame.parsedPayload?.kind).toBe('data_packet');
    if (frame.parsedPayload?.kind !== 'data_packet') return;
    const pp = frame.parsedPayload;
    expect(pp.packetK).toBe(10);
    expect(pp.domain).toBe('raw_motion_stream_result');
    expect(pp.statusOrStream).toBe(1);
    expect(pp.bodyOffset).toBe(13);

    expect(pp.bodySummary?.kind).toBe('raw_motion_k10');
    if (pp.bodySummary?.kind !== 'raw_motion_k10') return;
    expect(pp.bodySummary.heartRate).toBe(expected.parsed_payload.body_summary.heart_rate);
    const ax = pp.bodySummary.axes[0];
    const exAx = expected.parsed_payload.body_summary.axes[0];
    expect(ax.name).toBe(exAx.name);
    expect(ax.offset).toBe(exAx.offset);
    expect(ax.expectedCount).toBe(exAx.expected_count);
    expect(ax.parsedCount).toBe(exAx.parsed_count);
    expect(ax.min).toBe(exAx.min);
    expect(ax.max).toBe(exAx.max);
    expect(ax.sum).toBe(exAx.sum);
    expect(ax.preview).toEqual(exAx.preview);
  });

  it('parses a K21 raw-motion frame', () => {
    const { expected } = loadFixture<any>('synthetic/goose_v5_k21_motion_summary_short.fixture.json');
    const frame = parse('goose_v5_k21_motion_summary_short');
    expect(frame.packetType).toBe(expected.packet_type);

    if (frame.parsedPayload?.kind !== 'data_packet') throw new Error('expected data_packet');
    const bs = frame.parsedPayload.bodySummary;
    expect(bs?.kind).toBe('raw_motion_k21');
    if (bs?.kind !== 'raw_motion_k21') return;
    expect(bs.fieldX).toBe(expected.parsed_payload.body_summary.field_x);
    expect(bs.group1Count).toBe(expected.parsed_payload.body_summary.group_1_count);
    expect(bs.group2Count).toBe(expected.parsed_payload.body_summary.group_2_count);
    const exAx = expected.parsed_payload.body_summary.axes[0];
    expect(bs.axes[0].preview).toEqual(exAx.preview);
    expect(bs.axes[0].min).toBe(exAx.min);
    expect(bs.axes[0].max).toBe(exAx.max);
    expect(bs.axes[0].sum).toBe(exAx.sum);
  });

  it('parses an R17 optical frame', () => {
    const { expected } = loadFixture<any>('synthetic/goose_v5_r17_optical_summary.fixture.json');
    const frame = parse('goose_v5_r17_optical_summary');
    expect(frame.payloadHex).toBe(expected.payload_hex);

    if (frame.parsedPayload?.kind !== 'data_packet') throw new Error('expected data_packet');
    const bs = frame.parsedPayload.bodySummary;
    expect(bs?.kind).toBe('r17_optical_or_labrador_filtered');
    if (bs?.kind !== 'r17_optical_or_labrador_filtered') return;
    const ex = expected.parsed_payload.body_summary;
    expect(bs.flags).toBe(ex.flags);
    expect(bs.flagBit9).toBe(ex.flag_bit_9);
    expect(bs.flagBit11).toBe(ex.flag_bit_11);
    expect(bs.channelsOrGain).toEqual(ex.channels_or_gain);
    expect(bs.sampleCount).toBe(ex.sample_count);
    expect(bs.samples?.preview).toEqual(ex.samples.preview);
    expect(bs.samples?.min).toBe(ex.samples.min);
    expect(bs.samples?.max).toBe(ex.samples.max);
    expect(bs.samples?.sum).toBe(ex.samples.sum);
  });

  it('parses a K18 normal-history frame with HR marker and timestamps', () => {
    const { expected } = loadFixture<any>('synthetic/goose_v5_historical_k18_packet.fixture.json');
    const frame = parse('goose_v5_historical_k18_packet');
    expect(frame.payloadHex).toBe(expected.payload_hex);

    if (frame.parsedPayload?.kind !== 'data_packet') throw new Error('expected data_packet');
    const pp = frame.parsedPayload;
    expect(pp.counterOrPage).toBe(expected.parsed_payload.counter_or_page);
    expect(pp.timestampSeconds).toBe(expected.parsed_payload.timestamp_seconds);
    expect(pp.timestampSubseconds).toBe(expected.parsed_payload.timestamp_subseconds);
    expect(pp.hrMarkerOffset).toBe(expected.parsed_payload.hr_marker_offset);
    expect(pp.hrPresentMarker).toBe(expected.parsed_payload.hr_present_marker);
    expect(pp.bodyHex).toBe(expected.parsed_payload.body_hex);

    const bs = pp.bodySummary;
    expect(bs?.kind).toBe('normal_history');
    if (bs?.kind !== 'normal_history') return;
    expect(bs.hrPresent).toBe(expected.parsed_payload.body_summary.hr_present);
    expect(bs.markerValue).toBe(expected.parsed_payload.body_summary.marker_value);
  });
});
