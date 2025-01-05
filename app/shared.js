// Shared state and utilities between web_remote.js and ws_remote.js
const EventEmitter = require('events');

// Shared state
const state = {
    atv_credentials: false,
    pairDevice: "",
    device: false,
    playstate: false,
    connecting: false,
    ws: false,
    qPresses: 0,
    previousKeys: [],

    ws_timeout: false,
    ws_watchdog: false,
    scanWhenOpen: false,
    ws_connecting: false,
    ws_connected: false,
    ws_start_tm: false,
    connection_failure: false,
    atv_connected: false,
    ws_pairDevice: "",
    pending: [],
};

// Event emitter for cross-module communication
const events = new EventEmitter();

function _getCreds(nm) {
    var creds = JSON.parse(localStorage.getItem('remote_credentials') || "{}")
    var ks = Object.keys(creds);
    if (ks.length === 0) {
        return {};
    }
    if (typeof nm == 'undefined' && ks.length > 0) {
        return creds[ks[0]]
    } else {
        if (Object.keys(creds).indexOf(nm) > -1) {
            localStorage.setItem('currentDeviceID', nm)
            return creds[nm];
        }
    }
}

function getCreds(nm) {
    var r = _getCreds(nm);
    while (typeof r == 'string') r = JSON.parse(r);
    return r;
}

function setCreds(vl) {
    localStorage.setItem('atvcreds', JSON.stringify(getCreds(vl)));
}

module.exports = {
    state,
    events,
    getCreds,
    setCreds
};
