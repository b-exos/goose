/**
 * WHOOP BLE client over react-native-ble-plx.
 *
 * Replaces the Swift `GooseBLEClient`. Scans for the WHOOP service, connects, subscribes to
 * the inbound notify characteristics, deframes/parses notifications via `NotificationRouter`,
 * and writes framed commands. Inbound parsed frames are delivered to a callback (the app
 * routes them to capture import + the bleStore).
 *
 * Native module — exercised on device, not in jest. The pure pieces it composes
 * (uuids, base64, notifications, commands) are unit-tested separately.
 */
import { BleManager, State, type Device, type Subscription } from 'react-native-ble-plx';
import { base64ToBytes, bytesToBase64 } from './base64';
import { CommandSequencer } from './commands';
import { NotificationRouter, type InboundFrame } from './notifications';
import {
  characteristicUuid,
  INBOUND_ROLES,
  WHOOP_GEN5,
  type WhoopGenerationProfile,
} from './uuids';

export type ConnectionState = 'idle' | 'scanning' | 'connecting' | 'connected' | 'disconnected';

export interface DiscoveredDevice {
  id: string;
  name: string | null;
  rssi: number | null;
}

export interface BleClientEvents {
  onStateChange?: (state: ConnectionState) => void;
  onDeviceDiscovered?: (device: DiscoveredDevice) => void;
  onFrame?: (frame: InboundFrame) => void;
  onError?: (message: string) => void;
}

export class GooseBleClient {
  private readonly manager = new BleManager();
  private readonly sequencer = new CommandSequencer();
  private router = new NotificationRouter(WHOOP_GEN5.deviceType);
  private device: Device | null = null;
  private subscriptions: Subscription[] = [];
  private stateSubscription: Subscription | null = null;

  constructor(
    private readonly events: BleClientEvents = {},
    private readonly profile: WhoopGenerationProfile = WHOOP_GEN5,
  ) {}

  /**
   * Scan for WHOOP bands. Waits for the Bluetooth adapter to report `PoweredOn` before
   * scanning (calling `startDeviceScan` earlier throws "BluetoothLE is in unknown state"),
   * and surfaces a clear message when BLE is unavailable (e.g. on a simulator).
   */
  startScan(): void {
    this.events.onStateChange?.('scanning');
    // `emitCurrentState: true` delivers the current state immediately.
    this.stateSubscription = this.manager.onStateChange((state) => {
      if (state === State.PoweredOn) {
        this.beginDeviceScan();
        return;
      }
      if (
        state === State.Unsupported ||
        state === State.PoweredOff ||
        state === State.Unauthorized
      ) {
        this.events.onError?.(unavailableMessage(state));
        this.stopScan();
      }
      // Resetting / Unknown: keep waiting for a definitive state.
    }, true);
  }

  private beginDeviceScan(): void {
    this.manager.startDeviceScan([this.profile.serviceUuid], null, (error, device) => {
      if (error) {
        this.events.onError?.(error.message);
        this.stopScan();
        return;
      }
      if (device) {
        this.events.onDeviceDiscovered?.({ id: device.id, name: device.name, rssi: device.rssi });
      }
    });
  }

  /** Stop scanning and return to idle. Safe to call when not scanning. */
  stopScan(): void {
    this.manager.stopDeviceScan();
    this.stateSubscription?.remove();
    this.stateSubscription = null;
    this.events.onStateChange?.('idle');
  }

  /** Connect to a device, discover services, and subscribe to inbound notifications. */
  async connect(deviceId: string): Promise<void> {
    this.stopScan();
    this.events.onStateChange?.('connecting');
    this.router = new NotificationRouter(this.profile.deviceType);
    try {
      const device = await this.manager.connectToDevice(deviceId);
      this.device = device;
      await device.discoverAllServicesAndCharacteristics();
      device.onDisconnected(() => {
        this.cleanupSubscriptions();
        this.device = null;
        this.events.onStateChange?.('disconnected');
      });
      for (const role of INBOUND_ROLES) {
        this.subscribeRole(device, role);
      }
      this.events.onStateChange?.('connected');
      // Sync the band clock so historical timestamps are anchored to real time.
      await this.sendSetClock(Math.floor(Date.now() / 1000)).catch(() => undefined);
    } catch (error) {
      this.events.onError?.(error instanceof Error ? error.message : String(error));
      this.events.onStateChange?.('disconnected');
    }
  }

  private subscribeRole(device: Device, role: (typeof INBOUND_ROLES)[number]): void {
    const subscription = device.monitorCharacteristicForService(
      this.profile.serviceUuid,
      characteristicUuid(this.profile, role),
      (error, characteristic) => {
        if (error) {
          this.events.onError?.(error.message);
          return;
        }
        if (!characteristic?.value) return;
        const chunk = base64ToBytes(characteristic.value);
        for (const frame of this.router.ingest(role, chunk)) {
          this.events.onFrame?.(frame);
        }
      },
    );
    this.subscriptions.push(subscription);
  }

  /** Write a framed command to the command_to_strap characteristic. */
  async sendCommand(frame: Uint8Array): Promise<void> {
    if (!this.device) throw new Error('not connected');
    await this.device.writeCharacteristicWithResponseForService(
      this.profile.serviceUuid,
      characteristicUuid(this.profile, 'command_to_strap'),
      bytesToBase64(frame),
    );
  }

  /** Send the GET_HELLO handshake. */
  sendGetHello(): Promise<void> {
    return this.sendCommand(this.sequencer.getHello());
  }

  /** Start or stop realtime heart-rate streaming from the band. */
  sendToggleRealtimeHr(enable: boolean): Promise<void> {
    return this.sendCommand(this.sequencer.toggleRealtimeHr(enable));
  }

  /** Set the band RTC (seconds since epoch). */
  sendSetClock(unixSeconds: number): Promise<void> {
    return this.sendCommand(this.sequencer.setClock(unixSeconds));
  }

  /** Ask the band for its available historical data range. */
  sendGetDataRange(): Promise<void> {
    return this.sendCommand(this.sequencer.getDataRange());
  }

  /** Request the band stream buffered historical data. */
  sendHistoricalData(): Promise<void> {
    return this.sendCommand(this.sequencer.sendHistoricalData());
  }

  /** Acknowledge a completed historical transfer. */
  sendHistoricalDataResult(success: boolean): Promise<void> {
    return this.sendCommand(this.sequencer.historicalDataResult(success));
  }

  /** Abort any in-flight historical transmit. */
  sendAbortHistorical(): Promise<void> {
    return this.sendCommand(this.sequencer.abortHistoricalTransmits());
  }

  /** Request the current battery level. */
  sendGetBatteryLevel(): Promise<void> {
    return this.sendCommand(this.sequencer.getBatteryLevel());
  }

  /** Enter the band's bulk-history (high-frequency) sync mode. */
  sendEnterHighFreqSync(): Promise<void> {
    return this.sendCommand(this.sequencer.enterHighFreqSync());
  }

  /** Exit the bulk-history sync mode. */
  sendExitHighFreqSync(): Promise<void> {
    return this.sendCommand(this.sequencer.exitHighFreqSync());
  }

  /** Enable/disable historical IMU (motion) buffering — feeds sleep detection. */
  sendToggleImuModeHistorical(enable: boolean): Promise<void> {
    return this.sendCommand(this.sequencer.toggleImuModeHistorical(enable));
  }

  /** Enable/disable realtime IMU (motion) streaming — feeds live motion/sleep. */
  sendToggleImuMode(enable: boolean): Promise<void> {
    return this.sendCommand(this.sequencer.toggleImuMode(enable));
  }

  /**
   * Send the WHOOP-app physiology-capture sequence (HR + R10/R11 + IMU + persistent R21 +
   * optical + persistent R20), spaced ~250ms apart like the original app — the sequence that
   * actually unlocks motion/optical/pulse streaming.
   */
  async startPhysiologyCapture(): Promise<void> {
    await this.sendSequenceSpaced(this.sequencer.physiologyStartFrames());
  }

  /** Disable the physiology-capture streams. */
  async stopPhysiologyCapture(): Promise<void> {
    await this.sendSequenceSpaced(this.sequencer.physiologyStopFrames());
  }

  private async sendSequenceSpaced(frames: Uint8Array[], gapMs = 250): Promise<void> {
    for (let i = 0; i < frames.length; i++) {
      await this.sendCommand(frames[i]);
      if (i < frames.length - 1) await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
  }

  /** Start/stop the realtime raw-data stream. */
  sendRawData(start: boolean): Promise<void> {
    return this.sendCommand(start ? this.sequencer.startRawData() : this.sequencer.stopRawData());
  }

  /** Begin the device-config key exchange (auth handshake entry point). */
  sendStartKeyExchange(): Promise<void> {
    return this.sendCommand(this.sequencer.startDeviceConfigKeyExchange());
  }

  /** Enable/disable optical (R17) streaming — the source for RR intervals (HRV/recovery). */
  async sendEnableOptical(enable: boolean): Promise<void> {
    await this.sendCommand(this.sequencer.enableOpticalData(enable));
    await this.sendCommand(this.sequencer.toggleOpticalMode(enable));
  }

  async disconnect(): Promise<void> {
    this.cleanupSubscriptions();
    if (this.device) {
      await this.manager.cancelDeviceConnection(this.device.id).catch(() => undefined);
      this.device = null;
    }
    this.events.onStateChange?.('disconnected');
  }

  /** Release native resources. */
  destroy(): void {
    this.cleanupSubscriptions();
    this.manager.destroy();
  }

  private cleanupSubscriptions(): void {
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions = [];
    this.stateSubscription?.remove();
    this.stateSubscription = null;
  }
}

/** Human-readable message for a non-usable Bluetooth adapter state. */
function unavailableMessage(state: State): string {
  switch (state) {
    case State.Unsupported:
      return 'Bluetooth isn’t available here — iOS/Android simulators don’t support BLE. Use a development build on a physical device.';
    case State.PoweredOff:
      return 'Bluetooth is turned off. Enable it to scan for your WHOOP.';
    case State.Unauthorized:
      return 'Bluetooth permission was denied. Allow Bluetooth access in Settings.';
    default:
      return `Bluetooth is unavailable (${state}).`;
  }
}
