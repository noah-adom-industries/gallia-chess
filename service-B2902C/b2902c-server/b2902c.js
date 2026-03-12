/**
 * Keysight B2902C Precision SMU driver.
 *
 * 2-channel source/measure unit. Each channel can independently
 * source voltage or current and measure voltage, current, and resistance.
 *
 * SCPI subsystems used:
 *   :SOURce[1|2]  — output configuration
 *   :SENSe[1|2]   — measurement configuration
 *   :OUTPut[1|2]  — output enable
 *   :MEASure      — spot measurements
 *   :SYSTem       — system queries
 *   :TRIGger      — trigger subsystem
 */
import { ScpiClient } from './scpi.js';

const CHANNELS = [1, 2];

function ch(n) {
  if (!CHANNELS.includes(n)) throw new Error(`Invalid channel: ${n}. Must be 1 or 2.`);
  return n;
}

export class B2902C {
  constructor(host, port = 5025) {
    this.scpi = new ScpiClient(host, port, 10000);
    this.host = host;
    this.port = port;
  }

  /* ═══════════════════════════════════════════════════
     Connection
     ═══════════════════════════════════════════════════ */

  async connect() { await this.scpi.connect(); }
  async disconnect() { await this.scpi.disconnect(); }
  get connected() { return this.scpi.connected; }

  /* ═══════════════════════════════════════════════════
     Identity / System
     ═══════════════════════════════════════════════════ */

  async identity() { return this.scpi.query('*IDN?'); }
  async reset() { await this.scpi.write('*RST'); }
  async clear() { await this.scpi.write('*CLS'); }
  async errorQuery() { return this.scpi.query(':SYST:ERR?'); }
  async selfTest() { return this.scpi.query('*TST?'); }

  /* ═══════════════════════════════════════════════════
     Remote Sense (4-wire Kelvin)
     ═══════════════════════════════════════════════════ */

  /**
   * Enable/disable 4-wire remote sense on a channel.
   * Uses :SENS<n>:REM ON|OFF (confirmed on B2902C firmware 6.0.516.0)
   */
  async setRemoteSense(channel, enable) {
    ch(channel);
    await this.scpi.write(`:SENS${channel}:REM ${enable ? 'ON' : 'OFF'}`);
  }

  async getRemoteSense(channel) {
    ch(channel);
    const r = await this.scpi.query(`:SENS${channel}:REM?`);
    return r === '1' || r.toUpperCase() === 'ON';
  }

  /* ═══════════════════════════════════════════════════
     Source Configuration
     ═══════════════════════════════════════════════════ */

  async setSourceFunction(channel, mode) {
    ch(channel);
    await this.scpi.write(`:SOUR${channel}:FUNC:MODE ${mode}`);
  }

  async getSourceFunction(channel) {
    ch(channel);
    return this.scpi.query(`:SOUR${channel}:FUNC:MODE?`);
  }

  async setVoltage(channel, volts) {
    ch(channel);
    await this.scpi.write(`:SOUR${channel}:VOLT ${volts}`);
  }

  async getVoltage(channel) {
    ch(channel);
    return parseFloat(await this.scpi.query(`:SOUR${channel}:VOLT?`));
  }

  async setCurrent(channel, amps) {
    ch(channel);
    await this.scpi.write(`:SOUR${channel}:CURR ${amps}`);
  }

  async getCurrent(channel) {
    ch(channel);
    return parseFloat(await this.scpi.query(`:SOUR${channel}:CURR?`));
  }

  async setVoltageRange(channel, range) {
    ch(channel);
    if (range === 'AUTO') {
      await this.scpi.write(`:SOUR${channel}:VOLT:RANG:AUTO ON`);
    } else {
      await this.scpi.write(`:SOUR${channel}:VOLT:RANG:AUTO OFF`);
      await this.scpi.write(`:SOUR${channel}:VOLT:RANG ${range}`);
    }
  }

  async setCurrentRange(channel, range) {
    ch(channel);
    if (range === 'AUTO') {
      await this.scpi.write(`:SOUR${channel}:CURR:RANG:AUTO ON`);
    } else {
      await this.scpi.write(`:SOUR${channel}:CURR:RANG:AUTO OFF`);
      await this.scpi.write(`:SOUR${channel}:CURR:RANG ${range}`);
    }
  }

  /* ═══════════════════════════════════════════════════
     Compliance (Protection) Limits
     ═══════════════════════════════════════════════════ */

  async setVoltageCompliance(channel, volts) {
    ch(channel);
    await this.scpi.write(`:SENS${channel}:VOLT:PROT ${volts}`);
  }

  async getVoltageCompliance(channel) {
    ch(channel);
    return parseFloat(await this.scpi.query(`:SENS${channel}:VOLT:PROT?`));
  }

  async setCurrentCompliance(channel, amps) {
    ch(channel);
    await this.scpi.write(`:SENS${channel}:CURR:PROT ${amps}`);
  }

  async getCurrentCompliance(channel) {
    ch(channel);
    return parseFloat(await this.scpi.query(`:SENS${channel}:CURR:PROT?`));
  }

  /* ═══════════════════════════════════════════════════
     Measurement (Sense) Configuration
     ═══════════════════════════════════════════════════ */

  async setSenseFunction(channel, func) {
    ch(channel);
    const map = { VOLT: '"VOLT"', CURR: '"CURR"', RES: '"RES"' };
    await this.scpi.write(`:SENS${channel}:FUNC ${map[func] || `"${func}"`}`);
  }

  async setSenseNPLC(channel, func, nplc) {
    ch(channel);
    await this.scpi.write(`:SENS${channel}:${func}:NPLC ${nplc}`);
  }

  async setSenseRange(channel, func, range) {
    ch(channel);
    if (range === 'AUTO') {
      await this.scpi.write(`:SENS${channel}:${func}:RANG:AUTO ON`);
    } else {
      await this.scpi.write(`:SENS${channel}:${func}:RANG:AUTO OFF`);
      await this.scpi.write(`:SENS${channel}:${func}:RANG ${range}`);
    }
  }

  /* ═══════════════════════════════════════════════════
     Output Control
     ═══════════════════════════════════════════════════ */

  async enableOutput(channel) {
    ch(channel);
    await this.scpi.write(`:OUTP${channel} ON`);
  }

  async disableOutput(channel) {
    ch(channel);
    await this.scpi.write(`:OUTP${channel} OFF`);
  }

  async getOutputState(channel) {
    ch(channel);
    const r = await this.scpi.query(`:OUTP${channel}?`);
    return r === '1' || r.toUpperCase() === 'ON';
  }

  async allOutputsOff() {
    await this.scpi.write(':OUTP1 OFF');
    await this.scpi.write(':OUTP2 OFF');
  }

  /* ═══════════════════════════════════════════════════
     Spot Measurements
     ═══════════════════════════════════════════════════ */

  async measureVoltage(channel) {
    ch(channel);
    return parseFloat(await this.scpi.query(`:MEAS:VOLT? (@${channel})`));
  }

  async measureCurrent(channel) {
    ch(channel);
    return parseFloat(await this.scpi.query(`:MEAS:CURR? (@${channel})`));
  }

  async measureResistance(channel) {
    ch(channel);
    return parseFloat(await this.scpi.query(`:MEAS:RES? (@${channel})`));
  }

  /**
   * Measure V and I, compute R from V/I ratio.
   * More reliable than :MEAS:RES? which needs specific sense config.
   */
  async measureAll(channel) {
    ch(channel);
    const voltage = await this.measureVoltage(channel);
    const current = await this.measureCurrent(channel);
    const resistance = (current !== 0) ? Math.abs(voltage / current) : null;
    return { voltage, current, resistance };
  }

  /* ═══════════════════════════════════════════════════
     Sweep Configuration
     ═══════════════════════════════════════════════════ */

  async configureVoltageSweep(channel, start, stop, points, compliance = 0.1) {
    ch(channel);
    await this.scpi.write(`:SOUR${channel}:FUNC:MODE VOLT`);
    await this.scpi.write(`:SOUR${channel}:VOLT:MODE SWE`);
    await this.scpi.write(`:SOUR${channel}:VOLT:STAR ${start}`);
    await this.scpi.write(`:SOUR${channel}:VOLT:STOP ${stop}`);
    await this.scpi.write(`:SOUR${channel}:VOLT:POIN ${points}`);
    await this.scpi.write(`:SENS${channel}:CURR:PROT ${compliance}`);
    await this.scpi.write(`:SENS${channel}:FUNC "CURR"`);
    await this.scpi.write(`:TRIG${channel}:COUN ${points}`);
  }

  async configureCurrentSweep(channel, start, stop, points, compliance = 21) {
    ch(channel);
    await this.scpi.write(`:SOUR${channel}:FUNC:MODE CURR`);
    await this.scpi.write(`:SOUR${channel}:CURR:MODE SWE`);
    await this.scpi.write(`:SOUR${channel}:CURR:STAR ${start}`);
    await this.scpi.write(`:SOUR${channel}:CURR:STOP ${stop}`);
    await this.scpi.write(`:SOUR${channel}:CURR:POIN ${points}`);
    await this.scpi.write(`:SENS${channel}:VOLT:PROT ${compliance}`);
    await this.scpi.write(`:SENS${channel}:FUNC "VOLT"`);
    await this.scpi.write(`:TRIG${channel}:COUN ${points}`);
  }

  async executeSweep(channel) {
    ch(channel);
    await this.scpi.write(`:OUTP${channel} ON`);
    await this.scpi.write(`:INIT (@${channel})`);
    await this.scpi.query('*OPC?');
    const voltRaw = await this.scpi.query(`:FETC:ARR:VOLT? (@${channel})`);
    const currRaw = await this.scpi.query(`:FETC:ARR:CURR? (@${channel})`);
    const voltage = voltRaw.split(',').map(Number);
    const current = currRaw.split(',').map(Number);
    return { voltage, current };
  }

  /* ═══════════════════════════════════════════════════
     List Sweep (arbitrary waveform)
     ═══════════════════════════════════════════════════ */

  async configureListSweep(channel, voltages, compliance = 0.1, delay = 0.001) {
    ch(channel);
    await this.scpi.write(`:SOUR${channel}:FUNC:MODE VOLT`);
    await this.scpi.write(`:SOUR${channel}:VOLT:MODE LIST`);
    await this.scpi.write(`:SOUR${channel}:LIST:VOLT ${voltages.join(',')}`);
    await this.scpi.write(`:SENS${channel}:CURR:PROT ${compliance}`);
    await this.scpi.write(`:SENS${channel}:FUNC "CURR"`);
    await this.scpi.write(`:TRIG${channel}:SOUR TIM`);
    await this.scpi.write(`:TRIG${channel}:TIM ${delay}`);
    await this.scpi.write(`:TRIG${channel}:COUN ${voltages.length}`);
  }

  /* ═══════════════════════════════════════════════════
     Pulsed Output
     ═══════════════════════════════════════════════════ */

  async configurePulse(channel, base, pulse, width, period, count = 1) {
    ch(channel);
    await this.scpi.write(`:SOUR${channel}:FUNC:MODE VOLT`);
    await this.scpi.write(`:SOUR${channel}:VOLT:MODE FIX`);
    await this.scpi.write(`:SOUR${channel}:VOLT ${base}`);
    await this.scpi.write(`:SOUR${channel}:PULS:WIDT ${width}`);
    await this.scpi.write(`:SOUR${channel}:PULS:DEL 0`);
    await this.scpi.write(`:SOUR${channel}:VOLT:TRIG ${pulse}`);
    await this.scpi.write(`:TRIG${channel}:SOUR TIM`);
    await this.scpi.write(`:TRIG${channel}:TIM ${period}`);
    await this.scpi.write(`:TRIG${channel}:COUN ${count}`);
  }

  /* ═══════════════════════════════════════════════════
     Full State Snapshot (for viewer / AI)
     ═══════════════════════════════════════════════════ */

  async getFullState() {
    const state = { channels: {}, identity: null, errors: [] };
    try {
      state.identity = await this.identity();
    } catch { state.identity = 'Unknown'; }

    for (const c of CHANNELS) {
      try {
        const srcFunc = (await this.getSourceFunction(c)).trim();
        const outputOn = await this.getOutputState(c);
        const srcV = await this.getVoltage(c);
        const srcI = await this.getCurrent(c);
        const complV = await this.getVoltageCompliance(c);
        const complI = await this.getCurrentCompliance(c);
        let remoteSense = false;
        try { remoteSense = await this.getRemoteSense(c); } catch {}

        let measV = null, measI = null, measR = null;
        if (outputOn) {
          try { measV = await this.measureVoltage(c); } catch {}
          try { measI = await this.measureCurrent(c); } catch {}
          if (measV !== null && measI !== null && measI !== 0) {
            measR = Math.abs(measV / measI);
          }
        }

        state.channels[c] = {
          sourceFunction: srcFunc,
          outputEnabled: outputOn,
          sourceVoltage: srcV,
          sourceCurrent: srcI,
          voltageCompliance: complV,
          currentCompliance: complI,
          remoteSense,
          measuredVoltage: measV,
          measuredCurrent: measI,
          measuredResistance: measR,
        };
      } catch (e) {
        state.channels[c] = { error: e.message };
      }
    }

    try {
      const err = await this.errorQuery();
      if (!err.startsWith('+0') && !err.startsWith('0,')) {
        state.errors.push(err);
      }
    } catch {}

    return state;
  }

  /* ═══════════════════════════════════════════════════
     Raw SCPI pass-through (for AI / advanced users)
     ═══════════════════════════════════════════════════ */

  async rawWrite(cmd) { return this.scpi.write(cmd); }
  async rawQuery(cmd) { return this.scpi.query(cmd); }
}
