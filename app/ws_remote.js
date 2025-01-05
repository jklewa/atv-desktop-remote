const {log} = require('./log');
require('@electron/remote');
var { ipcRenderer } = require('electron');
// Override console.log/info/warn/error
Object.assign(console, log.functions);
const WebSocket = require('ws').WebSocket
const EventEmitter = require('events');
var { state, events, getCreds } = require('./shared');

// WebSocketClient.prototype.reconnect = function(e) {
//     console.log(`WebSocketClient: retry in ${this.autoReconnectInterval}ms`, e);
//     this.instance.removeAllListeners();
//     var that = this;
//     setTimeout(function() {
//         console.log("WebSocketClient: reconnecting...");
//         that.open(that.url);
//     }, this.autoReconnectInterval);
// }

var ws_url = 'ws://localhost:8765'

var atv_events = new EventEmitter();

var ws_timeout_interval = 800;

function sendMessage(command, data) {
    if (typeof data == "undefined") data = "";
    if (!state.ws) {
        state.pending.push([command, data]);
        return;
    }
    while (state.pending.length > 0) {
        var cmd_ar = state.pending.shift();
        state.ws.send(JSON.stringify({ cmd: cmd_ar[0], data: cmd_ar[1] }))
    }
    if (command === "kbfocus") {
        console.debug(`sendMessage: {cmd:${command}, data:${JSON.stringify(data)}}`)
    } else {
        console.log(`sendMessage: {cmd:${command}, data:${JSON.stringify(data)}}`)
    }
    state.ws.send(JSON.stringify({ cmd: command, data: data }))
}

function killServer() {
    var lws = new WebSocket(ws_url, {
        perMessageDeflate: false
    });

    lws.once('open', function open() {
        lws.send(JSON.stringify({ cmd: 'quit' }))
    });
}

function reconnect() {
    if (state.ws_timeout) return;
    state.ws_timeout = setTimeout(() => {
        state.ws_timeout = false;
        try {
            if (state.ws) state.ws.removeAllListeners();
        } catch (ex) {}

        startWebsocket();
    }, ws_timeout_interval)
}

function startWebsocket() {
    state.ws = new WebSocket(ws_url, {
        perMessageDeflate: false
    });

    state.ws.once('open', function open() {
        state.ws_connected = true;
        console.log('ws open');
        if (state.scanWhenOpen) ws_startScan();
        events.emit('init', () => {
            console.log('init complete');
        });
    });

    state.ws.on('close', function close(code, reason) {
        state.ws_connected = false;
        reconnect();
        switch (code) {
            case 1000: //  1000 indicates a normal closure, meaning that the purpose for which the connection was established has been fulfilled.
                console.log("WebSocket: closed");
                break;
            default: // Abnormal closure
                console.log("WebSocket: closed abnormally");
                break;
        }
    });

    state.ws.on('message', function message(data) {
        if (data.includes("kbfocus")) {
            console.debug('received: %s', data.toString());
        } else {
            console.log('received: %s', data.toString());
        }
        var j = JSON.parse(data);
        if (j.command == "scanResult") {
            console.log(`Results: ${j.data}`)
            events.emit('createDropdown', j.data);
        }
        if (j.command == "pairCredentials") {
            console.log("pairCredentials", state.ws_pairDevice, j.data);
            events.emit('saveRemote', state.ws_pairDevice, j.data);
            localStorage.setItem('atvcreds', JSON.stringify(getCreds(state.pairDevice)));
            events.emit('connectToATV')
        }
        if (j.command == "connected") {
            state.atv_connected = !!j.data?.connected;
            state.connection_failure = j.data?.error != null;
            atv_events.emit("connected", state.atv_connected);
        }
        if (j.command == "startPair2") {
            $("#pairStepNum").html("2");
            $("#pairProtocolName").html("Companion");
        }
        if (j.command == "current-text") {
            console.log(`current text: ${j.data}`)
            ipcRenderer.invoke('current-text', j.data);
        }
        if (j.command == "kbfocus-status") {
            ipcRenderer.invoke('kbfocus-status', j.data);
        }
        if (j.command == "power_status") {
            console.log(`power status: ${j.data}`)
            const isOn = j.data.toLowerCase() === "on";
            ipcRenderer.invoke("power_status", isOn);
        }
        if (j.command == "power_error") {
            console.log(`power error: ${j.data}`)
            ipcRenderer.invoke("power_error", j.data);
        }
    });
}

function ws_startScan() {
    state.connection_failure = false;
    if (state.ws_connected) sendMessage("scan");
    else {
        state.scanWhenOpen = true;
    }
}

function ws_sendCommand(cmd) {
    //console.log(`ws_sendCommand: ${cmd}`)
    sendMessage("key", cmd)
}

function ws_sendCommandAction(cmd, taction) {
    // taction can be 'DoubleTap', 'Hold', 'SingleTap'
    //console.log(`ws_sendCommandAction: ${cmd} - ${taction}`)
    sendMessage("key", { "key": cmd, "taction": taction })
}

function ws_connect(creds) {
    if (state.ws_connecting) return;
    state.ws_start_tm = Date.now();
    state.ws_connecting = true;
    return new Promise((resolve) => {
        console.log(`ws_connect: ${creds}`)
        sendMessage("connect", creds)
        atv_events.once("connected", () => {
            state.ws_connecting = false;
            state.ws_start_tm = false;
            resolve();
        });
    })
}

function ws_startPair(dev) {
    state.connection_failure = false;
    console.log(`ws_startPair: ${dev}`)
    state.ws_pairDevice = dev;
    sendMessage("startPair", dev);
}

function ws_finishPair(code) {
    state.connection_failure = false;
    console.log(`ws_finishPair: ${code}`)
    sendMessage("finishPair", code);
}

function ws_finishPair1(code) {
    state.connection_failure = false;
    console.log(`ws_finishPair: ${code}`)
    sendMessage("finishPair1", code);
}

function ws_finishPair2(code) {
    state.connection_failure = false;
    console.log(`ws_finishPair: ${code}`)
    sendMessage("finishPair2", code);
}

function checkWSConnection() {
    var timedOut = false;
    if (state.ws_start_tm) {
        var diff = Date.now() - state.ws_start_tm;
        if (diff > 3000) {
            console.log('ws connection timed out, retrying')
            state.ws_connecting = false;
            timedOut = true;
        }
    }
    if (!state.ws_connected) {
        console.log('restarting websocket');
        startWebsocket();
    }
}

function ws_init() {
    console.log('ws_init');
    startWebsocket();
    setTimeout(() => {
        // not sure if needed, but server start now tries to install required python packages which can be slow
        state.ws_watchdog = setInterval(() => {
            checkWSConnection()
        }, 5000);
    }, 15000)
}

function incReady() {
    //console.log('incReady');
    readyCount++;
    if (readyCount == 2) ws_init();
}

function ws_server_started() {
    console.log(`wsserver started`)
    incReady();
}

var readyCount = 0;

$(function() {
    incReady();
});

module.exports = {
    ws_startScan,
    ws_sendCommand,
    ws_sendCommandAction,
    ws_connect,
    ws_startPair,
    ws_finishPair1,
    ws_finishPair2,
    ws_server_started,
    sendMessage,
}