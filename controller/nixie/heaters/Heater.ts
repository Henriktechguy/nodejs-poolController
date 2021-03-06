﻿import { EquipmentNotFoundError, InvalidEquipmentDataError, InvalidEquipmentIdError, ParameterOutOfRangeError } from '../../Errors';
import { utils, Timestamp } from '../../Constants';
import { logger } from '../../../logger/Logger';

import { NixieEquipment, NixieChildEquipment, NixieEquipmentCollection, INixieControlPanel } from "../NixieEquipment";
import { Heater, HeaterCollection, sys } from "../../../controller/Equipment";
import { HeaterState, state, } from "../../State";
import { setTimeout, clearTimeout } from 'timers';
import { NixieControlPanel } from '../Nixie';
import { webApp, InterfaceServerResponse } from "../../../web/Server";

export class NixieHeaterCollection extends NixieEquipmentCollection<NixieHeater> {
    public async deleteHeaterAsync(id: number) {
        try {
            for (let i = this.length - 1; i >= 0; i--) {
                let heater = this[i];
                if (heater.id === id) {
                    await heater.closeAsync();
                    this.splice(i, 1);
                }
            }
        } catch (err) { return Promise.reject(`Nixie Control Panel deleteHeaterAsync ${err.message}`); }
    }

    public async setHeaterStateAsync(hstate: HeaterState, val: boolean) {
        try {
            let h: NixieHeater = this.find(elem => elem.id === hstate.id) as NixieHeater;
            if (typeof h === 'undefined') {
                console.log(this);
                return Promise.reject(new Error(`NCP: Heater ${hstate.id}-${hstate.name} could not be found to set the state to ${val}.`));
            }
            await h.setHeaterStateAsync(hstate, val);
        }
        catch (err) { return logger.error(`NCP: setHeaterStateAsync ${hstate.id}-${hstate.name}: ${err.message}`); }
    }
    public async setHeaterAsync(heater: Heater, data: any) {
        // By the time we get here we know that we are in control and this is a Nixie heater.
        try {
            let h: NixieHeater = this.find(elem => elem.id === heater.id) as NixieHeater;
            if (typeof h === 'undefined') {
                heater.master = 1;
                h = new NixieHeater(this.controlPanel, heater);
                this.push(h);
                await h.setHeaterAsync(data);
                logger.info(`A Heater was not found for id #${heater.id} creating Heater`);
            }
            else {
                await h.setHeaterAsync(data);
            }
        }
        catch (err) { logger.error(`setHeaterAsync: ${err.message}`); return Promise.reject(err); }
    }
    public async initAsync(heaters: HeaterCollection) {
        try {
            this.length = 0;
            for (let i = 0; i < heaters.length; i++) {
                let heater = heaters.getItemByIndex(i);
                if (heater.master === 1) {
                    logger.info(`Initializing Heater ${heater.name}`);
                    let nHeater = new NixieHeater(this.controlPanel, heater);
                    this.push(nHeater);
                }
            }
        }
        catch (err) { logger.error(`Nixie Heater initAsync: ${err.message}`); return Promise.reject(err); }
    }
    public async closeAsync() {
        try {
            for (let i = this.length - 1; i >= 0; i--) {
                try {
                    await this[i].closeAsync();
                    this.splice(i, 1);
                } catch (err) { logger.error(`Error stopping Nixie Heater ${err}`); }
            }
        } catch (err) { } // Don't bail if we have an errror.
    }
    public async initHeaterAsync(heater: Heater): Promise<NixieHeater> {
        try {
            let c: NixieHeater = this.find(elem => elem.id === heater.id) as NixieHeater;
            if (typeof c === 'undefined') {
                c = new NixieHeater(this.controlPanel, heater);
                this.push(c);
            }
            return c;
        } catch (err) { logger.error(`initHeaterAsync: ${err.message}`); return Promise.reject(err); }
    }

}
export class NixieHeater extends NixieEquipment {
    public pollingInterval: number = 10000;
    private _pollTimer: NodeJS.Timeout = null;
    private _lastState;
    public heater: Heater;
    constructor(ncp: INixieControlPanel, heater: Heater) {
        super(ncp);
        this.heater = heater;
        this.pollEquipmentAsync();
    }
    public get id(): number { return typeof this.heater !== 'undefined' ? this.heater.id : -1; }
    public async setHeaterStateAsync(hstate: HeaterState, isOn: boolean) {
        try {
            // Here we go we need to set the valve state.
            if (hstate.isOn !== isOn) {
                logger.info(`Nixie: Set Heater ${hstate.id}-${hstate.name} to ${isOn}`);
            }
            if (utils.isNullOrEmpty(this.heater.connectionId) || utils.isNullOrEmpty(this.heater.deviceBinding)) {
                hstate.isOn = isOn;
                return new InterfaceServerResponse(200, 'Success');
            }
            if (typeof this._lastState === 'undefined' || isOn || this._lastState !== isOn) {
                let res = await NixieEquipment.putDeviceService(this.heater.connectionId, `/state/device/${this.heater.deviceBinding}`, { isOn: isOn, latch: isOn ? 10000 : undefined });
                if (res.status.code === 200) this._lastState = hstate.isOn = isOn;
                return res;
            }
            else {
                hstate.isOn = isOn;
                return new InterfaceServerResponse(200, 'Success');
            }


        } catch (err) { return logger.error(`Nixie Error setting heater state ${hstate.id}-${hstate.name}: ${err.message}`); }
    }
    public async setHeaterAsync(data: any) {
        try {
            let heater = this.heater;
        }
        catch (err) { logger.error(`Nixie setHeaterAsync: ${err.message}`); return Promise.reject(err); }
    }
    public async pollEquipmentAsync() {
        try {
            if (typeof this._pollTimer !== 'undefined' || this._pollTimer) clearTimeout(this._pollTimer);
            this._pollTimer = null;
            let success = false;
        }
        catch (err) { logger.error(`Nixie Error polling Heater - ${err}`); }
        finally { this._pollTimer = setTimeout(async () => await this.pollEquipmentAsync(), this.pollingInterval || 10000); }
    }
    private async checkHardwareStatusAsync(connectionId: string, deviceBinding: string) {
        try {
            let dev = await NixieEquipment.getDeviceService(connectionId, `/status/device/${deviceBinding}`);
            return dev;
        } catch (err) { logger.error(`Nixie Heater Error checkHardwareStatusAsync: ${err.message}`); return { hasFault: true } }
    }
    public async validateSetupAsync(heater: Heater, hstate: HeaterState) {
        try {
            if (typeof heater.connectionId !== 'undefined' && heater.connectionId !== ''
                && typeof heater.deviceBinding !== 'undefined' && heater.deviceBinding !== '') {
                try {
                    let stat = await this.checkHardwareStatusAsync(heater.connectionId, heater.deviceBinding);
                    // If we have a status check the return.
                    hstate.commStatus = stat.hasFault ? 1 : 0;
                } catch (err) { hstate.commStatus = 1; }
            }
            else
                hstate.commStatus = 0;
        } catch (err) { logger.error(`Nixie Error checking heater Hardware ${this.heater.name}: ${err.message}`); hstate.commStatus = 1; return Promise.reject(err); }
    }
    public async closeAsync() {
        try {
            if (typeof this._pollTimer !== 'undefined' || this._pollTimer) clearTimeout(this._pollTimer);
            this._pollTimer = null;
            let hstate = state.heaters.getItemById(this.heater.id);
            await this.setHeaterStateAsync(hstate, false);
            hstate.emitEquipmentChange();
        }
        catch (err) { logger.error(`Nixie Heater closeAsync: ${err.message}`); return Promise.reject(err); }
    }
    public logData(filename: string, data: any) { this.controlPanel.logData(filename, data); }
}
