// ATV Remote using Websockets

const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const { WebSocket } = require('ws');

var { ipcRenderer } = require('electron');

const {log} = require('./log');
// Override console.log/info/warn/error
Object.assign(console, log.functions);

/**
 * Common
 */

var ws_url = 'ws://localhost:8765'

const ConnectionState = {
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    ERROR: 'error'
};

class ConnectionManager {
    constructor() {
        this.state = ConnectionState.DISCONNECTED;
        this.wsState = ConnectionState.DISCONNECTED;
        this.lastError = null;
        this.reconnectAttempts = 0;
        this.isOnline = navigator.onLine;
        this.alive = false;
        this.ws = null;
        this.pendingMessages = [];
        this.credentials = null;
        this.reconnectTimer = null;
        this.heartbeatInterval = null;
        this.events = new EventEmitter();
        
        this.setupEventListeners();
    }

    setupEventListeners() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.reconnectAttempts = 0;
            this.connect();
        });
        
        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.disconnect();
        });
    }

    async connect() {
        if (!this.isOnline) {
            this.lastError = new Error('System is offline');
            return;
        }
        
        if (this.state === ConnectionState.CONNECTING) {
            return; // Prevent multiple connection attempts
        }

        try {
            this.state = ConnectionState.CONNECTING;
            await this.connectWebsocket();
            await this.connectATV();
            
            this.state = ConnectionState.CONNECTED;
            this.reconnectAttempts = 0;
            this.startHeartbeat();
            this.events.emit('connected');
        } catch (error) {
            this.handleError(error);
            await this.scheduleReconnect();
        }
    }

    async connectWebsocket() {
        return new Promise((resolve, reject) => {
            if (this.ws) {
                if (this.ws.readyState === WebSocket.OPEN) {
                    resolve();
                    return
                } else if (this.ws.readyState === WebSocket.CONNECTING) {
                    reject(new Error('Websocket is already connecting'));
                    return;
                } else if (this.ws.readyState === WebSocket.CLOSING) {
                    this.ws.terminate();
                }
            }
            this.ws =  new WebSocket(ws_url);
            
            const timeout = setTimeout(() => {
                reject(new Error('Websocket connection timeout'));
            }, 15000);

            this.ws.on('open', (event) => {
                console.log('open', event);
                clearTimeout(timeout);
                this.wsState = ConnectionState.CONNECTED;
                setTimeout(() => {this.flushPendingMessages}, 2000);
                resolve();
            });

            this.ws.on('close', (event) => {
                console.log('close', event);
                this.wsState = ConnectionState.DISCONNECTED;
                this.handleWsDisconnect();
            });

            this.ws.on('error', (error) => {
                console.log('error', error);
                reject(error);
            });

            this.ws.on('message', (event) => {
                event = event.toString();
                this.handleMessage(event);
            });
        });
    }

    async connectATV() {
        if (!this.credentials) {
            throw new Error('No ATV credentials available');
        }

        return new Promise((resolve, reject) => {
            this.sendMessage('connect', this.credentials);
            
            const timeout = setTimeout(() => {
                reject(new Error('ATV connection timeout'));
            }, 15000);

            this.events.once('__connected', (connected) => {
                clearTimeout(timeout);
                if (connected) {
                    resolve();
                } else {
                    reject(new Error('ATV connection failed'));
                }
            });
        });
    }

    handleMessage(event) {
        const data = JSON.parse(event);
        if (event.includes("kbfocus")) {
            console.debug('Received:', data);
        } else {
            console.info('Received:', data);
        }

        switch (data.command) {
            case 'connected':
                const connected = !!data.data?.connected;
                this.events.emit('__connected', connected);
                if (!connected && data.data?.error) {
                    this.lastError = new Error(data.data.error);
                }
                break;
            case 'echo_reply':
                this.alive = true;
                break;
            default:
                this.events.emit(data.command, data.data);
        }
    }

    sendMessage(command, data = '') {
        if (this.wsState !== ConnectionState.CONNECTED) {
            if (command === "kbfocus") {
                return;
            }
            this.pendingMessages.push([command, data]);
            return;
        }

        if (command === "kbfocus") {
            console.debug('Sending:', { command, data });
        } else {
            console.log('Sending:', { command, data });
        }
        this.ws.send(JSON.stringify({ cmd: command, data }));
    }

    flushPendingMessages() {
        while (this.pendingMessages.length > 0) {
            const [command, data] = this.pendingMessages.shift();
            this.sendMessage(command, data);
        }
    }

    handleError(error) {
        this.lastError = error;
        this.state = ConnectionState.ERROR;
        this.events.emit('error', error);
    }

    async scheduleReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        this.reconnectAttempts++;

        this.reconnectTimer = setTimeout(() => {
            this.connect();
        }, delay);
    }

    startHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        this.alive = true;
        this.heartbeatInterval = setInterval(() => {
            if (this.wsState === ConnectionState.CONNECTED) {
                this.alive = false;
                this.sendMessage('echo');
            }
        }, 30000);
    }

    handleWsDisconnect() {
        if (this.state === ConnectionState.CONNECTED) {
            this.state = ConnectionState.DISCONNECTED;
            this.events.emit('disconnected');
        }

        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        
        if (this.isOnline) {
            this.scheduleReconnect();
        }
    }

    disconnect() {
        if (this.ws) {
            this.ws.close(1000, '');
            // this.ws = null;
        }
        
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        
        this.events.emit('disconnected');
        this.state = ConnectionState.DISCONNECTED;
        this.wsState = ConnectionState.DISCONNECTED;
    }
}

const connectionManager = new ConnectionManager();

const state = {
    atv_credentials: false,
    pairDevice: "",
    device: false,
    playstate: false,
    qPresses: 0,
    previousKeys: [],
    ws_pairDevice: "",
};

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

/**
 * Web
 */

var { Menu, dialog, nativeTheme, app, getGlobal } = require('@electron/remote');

var mb = getGlobal('MB');

const ws_keymap = {
    "ArrowUp": "up",
    "ArrowDown": "down",
    "ArrowLeft": "left",
    "ArrowRight": "right",
    "Tv": "home",
    "t": "home",
    "LongTv": "home_hold",
    "l": "home_hold",
    "Backspace": "menu",
    "Escape": "menu",
    "m": "menu",
    "Space": "play_pause",
    "Enter": "select",
    "Previous": "skip_backward",
    "p": "skip_backward",
    "Next": "skip_forward",
    "n": "skip_forward",
    "[": "skip_backward",
    "]": "skip_forward",
    "g": "top_menu",
    "+": "volume_up",
    "=": "volume_up",
    "-": "volume_down",
    "_": "volume_down",
    // "0": "volume_mute", //unsupported by pyatv
    "o": "power",
}

const desc_rcmdmap = {
    "skip_forward": "Next",
    "skip_backward": "Previous",
    "volume_down": "Lower Volume",
    "volume_up": "Raise Volume",
    // "volume_mute": "Mute/Unmute", //unsupported by pyatv
    "play_pause": "Play/Pause",
    "menu": "Menu",
    "home": "TV",
    "home_hold": "TV Long Press",
    // "power": null, // handled separately
    "left": "Left",
    "right": "Right",
    "up": "Up",
    "down": "Down",
}

ipcRenderer.on('scanDevicesResult', (event, ks) => {
    createDropdown(ks);
})

ipcRenderer.on('pairCredentials', (event, arg) => {
    saveRemote(state.pairDevice, arg);
    localStorage.setItem('atvcreds', JSON.stringify(getCreds(state.pairDevice)));
    connectToATV();
})

ipcRenderer.on('gotStartPair', () => {
    console.log('gotStartPair');
})

ipcRenderer.on('powerResume', (event, arg) => {
    connectToATV();
})

ipcRenderer.on('sendCommand', (event, key) => {
    console.log(`sendCommand from main: ${key}`)
    sendCommand(key);
})

ipcRenderer.on('kbfocus', () => {
    connectionManager.sendMessage('kbfocus')
})

ipcRenderer.on('wsserver_started', () => {
    ws_server_started();
})

ipcRenderer.on('input-change', (event, data) => {
    connectionManager.sendMessage("settext", {text: data});
});

ipcRenderer.on('power_status', (event, isOn) => {
    console.log(`power_status: ${isOn}`)
    showAndFade(isOn ? 'Device On' : 'Device Off');
});

window.addEventListener('beforeunload', async e => {
    delete e['returnValue'];
    try {
        ipcRenderer.invoke('debug', 'beforeunload called')
        connectionManager.disconnect();
        ipcRenderer.invoke('debug', 'connection closed')
    } catch (err) {
        console.log(err);
    }
});

function loadWindowHotkey() {
    // It's not ideal to hardcode the hotkey. It would be better to get it from the main process.
    let hotkey = process.platform === 'darwin' ? 'Cmd+Shift+0' : 'Ctrl+Shift+0';
    const hotkeyPath = path.join(getWorkingPath(), 'hotkey.txt');
    if (fs.existsSync(hotkeyPath)) {
        hotkey = fs.readFileSync(hotkeyPath, 'utf8').trim();
    }
    hotkey = hotkey.replaceAll("+", "<wbr>+")
    $(`[data-shortcut="show"]`).html(hotkey);
}

function toggleKeyboardShortcuts() {
    const shortcuts = $("#keyboardShortcuts");
    if (shortcuts.is(":visible")) {
        shortcuts.fadeOut(200);
    } else {
        loadWindowHotkey();
        shortcuts.fadeIn(200);
    }
}

function openKeyboardClick(event) {
    event.preventDefault();
    openKeyboard();
}

function openKeyboard() {
    ipcRenderer.invoke('openInputWindow')
    setTimeout(() => {
        connectionManager.sendMessage("gettext")
    }, 10)
}

window.addEventListener('keyup', e => {
    // Close shortcuts overlay when Escape is pressed
    if (e.key === 'Escape' && $("#keyboardShortcuts").is(":visible")) {
        toggleKeyboardShortcuts();
        e.preventDefault();
        return;
    }
});

window.addEventListener('app-command', (e, cmd) => {
    console.log('app-command', e, cmd);
})

window.addEventListener('keydown', e => {
    var key = e.key;
    if (key == ' ') key = 'Space';
    var mods = ["Control", "Shift", "Alt", "Option", "Fn", "Hyper", "OS", "Super", "Meta", "Win"].filter(mod => { return e.getModifierState(mod) })

    // If shortcuts overlay is visible, escape key should close it
    if ($("#keyboardShortcuts").is(":visible")) {
        if (key === 'Escape') {
            toggleKeyboardShortcuts();
            return;
        }
    }

    var shifted = false;
    if (mods.length == 1 && mods[0] == "Shift") {
        shifted = true;
        mods = []
    }
    if (mods.length > 0) return;

    if (key == 'q') {
        state.qPresses++;
        console.log(`qPresses ${state.qPresses}`)
        if (state.qPresses == 3) ipcRenderer.invoke('quit');
    } else {
        state.qPresses = 0;
    }
    if (key == 'h') {
        ipcRenderer.invoke('hideWindow');
    }
    if (key == 'k') {
        openKeyboard();
        return;
    }
    if (!isConnected()) {
        if ($("#pairCode").is(':focus') && key == 'Enter') {
            submitCode();
        }
        return;
    }
    if ($("#cancelPairing").is(":visible")) return;
    var fnd = false;
    Object.keys(ws_keymap).forEach(k => {
        if (key == k) {
            fnd = true;
            sendCommand(k, shifted);
            e.preventDefault();
            return false;
        }
    })
})

function createDropdown(ks) {
    $("#loader").hide();
    var txt = "";
    $("#statusText").hide();
    $("#cmdWrapper").hide();
    $("#pairingLoader").html("")
    $("#pairStepNum").html("1");
    $("#pairProtocolName").html("AirPort");
    $("#pairingElements").show();
    var ar = ks.map(el => {
        return {
            id: el,
            text: el
        }
    })
    ar.unshift({
        id: '',
        text: 'Select a device to pair'
    })
    $("#atv_picker").select2({
        data: ar,
        placeholder: 'Select a device to pair',
        dropdownAutoWidth: true,
        minimumResultsForSearch: Infinity
    }).on('change', () => {
        var vl = $("#atv_picker").val();
        if (vl) {
            state.pairDevice = vl;
            startPairing(vl);
        }
    })
}

function createATVDropdown() {
    var creds = JSON.parse(localStorage.getItem('remote_credentials') || "{}")
    var ks = Object.keys(creds);
    var atvc = localStorage.getItem('atvcreds')
    var selindex = 0;
    ks.forEach((k, i) => {
        var v = creds[k]
        if (JSON.stringify(v) == atvc) selindex = i;
    })

    var ar = ks.map((el, i) => {
        var obj = {
            id: el,
            text: el
        }
        if (i == selindex) {
            obj.selected = true;
        }
        return obj;
    })
    ar.unshift({
        id: 'addnew',
        text: 'Pair another remote'
    })
    var txt = "";
    txt += `<span class='ctText'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>`
    txt += `<select id="remoteDropdown"></select>`
    $("#atvDropdownContainer").html(txt);
    $("#remoteDropdown").select2({
        data: ar,
        placeholder: 'Select a remote',
        dropdownAutoWidth: true,
        minimumResultsForSearch: Infinity
    })

    $("#remoteDropdown").on('change', () => {
        var vl = $("#remoteDropdown").val();
        if (vl) {
            if (vl == 'addnew') {
                startScan();
                return;
            } else {
                state.pairDevice = vl;
                setCreds(vl)
                connectToATV();
            }
        }
    })
}

function showAndFade(text) {
    $("#cmdFade").html(text)
    $("#cmdFade").stop(true).fadeOut(0).css({ "visibility": "visible" }).fadeIn(200).delay(800).fadeOut(function() {
        $(this).css({ "display": "flex", "visibility": "hidden" }).html('');
    });
}

async function sendCommand(k, shifted) {
    if (typeof shifted === 'undefined') shifted = false;
    console.log(`sendCommand: ${k}`)
    var rcmd = ws_keymap[k];
    if (Object.values(ws_keymap).indexOf(k) > -1) rcmd = k;
    if (typeof(rcmd) === 'function') rcmd = rcmd(state.device);

    var classkey = rcmd;
    if (classkey == 'home' || classkey == 'home_hold') classkey = 'Tv';
    var el = $(`[data-key="${classkey}"]`)
    if (el.length > 0) {
        el.addClass('invert');
        setTimeout(() => {
            el.removeClass('invert');
        }, 500);
    }
    if (rcmd === 'power') {
        connectionManager.sendMessage("power_toggle");
        showAndFade("Power");
        return;
    }
    console.log(`Keydown: ${k}, sending command: ${rcmd} (shifted: ${shifted})`)
    state.previousKeys.push(rcmd);
    if (state.previousKeys.length > 10) state.previousKeys.shift()
    var desc = desc_rcmdmap[rcmd] || rcmd;
    showAndFade(desc);
    if (shifted) {
        connectionManager.sendMessage("key", { "key": rcmd, "taction": "Hold" });
    } else {
        connectionManager.sendMessage("key", rcmd);
    }
}

function getWorkingPath() {
    return path.join(process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + "/.local/share"), "ATV Remote");
}

function isConnected() {
    return connectionManager.state === ConnectionState.CONNECTED;
}

function startPairing(dev) {
    $("#initText").hide();
    $("#results").hide();
    $("#cmdWrapper").hide();
    $("#pairButton").on('click', () => {
        submitCode();
        return false;
    });
    $("#pairCodeElements").show();
    connectionManager.sendMessage("startPair", dev);
}

function submitCode() {
    var code = $("#pairCode").val();
    $("#pairCode").val("");
    if ($("#pairStepNum").text() == "1") {
        connectionManager.sendMessage("finishPair1", code);
    } else {
        connectionManager.sendMessage("finishPair2", code);
    }
}

function showKeyMap() {
    $("#initText").hide();
    $("#cmdWrapper").show();
    $(".directionTable").fadeIn();
    var tvTimer;
    $("[data-key]").off('mousedown mouseup mouseleave');
    $("[data-key]").on('mousedown', function(e) {
        var key = $(this).data('key');
        if (key == "Tv") {
            tvTimer = setTimeout(() => {
                tvTimer = false;
                sendCommand('LongTv')
            }, 1000);
        } else if (key == "power") {
            connectionManager.sendMessage("power_toggle");
            showAndFade("Power");
        } else {
            sendCommand(key);
        }
    });
    $(`[data-key="Tv"]`).on('mouseup mouseleave', function(e) {
        var key = $(this).data('key');
        if (!tvTimer) return;  // already send long press
        clearTimeout(tvTimer);
        tvTimer = false;
        if (e.type == 'mouseleave') return;
        sendCommand('Tv');
    });

    var creds = getCreds();
    if (Object.keys(creds).indexOf("Companion") > -1) {
        $("#topTextHeader").hide();
        $("#topTextKBLink").show();
    } else {
        $("#topTextHeader").show();
        $("#topTextKBLink").hide();
    }

    // Initialize help icon and close button click handlers
    $("#helpIcon").off('click').on('click', toggleKeyboardShortcuts);
    $("#closeShortcuts").off('click').on('click', toggleKeyboardShortcuts);
}

async function connectToATV() {
    setStatus("Connecting to ATV...");
    $("#runningElements").show();
    $("#pairingElements").hide();

    const credentials = JSON.parse(localStorage.getItem('atvcreds'));
    if (!credentials) {
        setStatus("No credentials found");
        return;
    }

    connectionManager.credentials = credentials;
    
    await connectionManager.connect();
    createATVDropdown();
    showKeyMap();
}

function saveRemote(name, creds) {
    var ar = JSON.parse(localStorage.getItem('remote_credentials') || "{}")
    if (typeof creds == 'string') creds = JSON.parse(creds);
    ar[name] = creds;
    localStorage.setItem('remote_credentials', JSON.stringify(ar));
}

function setStatus(txt) {
    if (!txt) {
        $("#statusText").hide();
    } else {
        $("#statusText").html(txt).show();
    }
}

function startScan() {
    $("#initText").hide();
    $("#loader").fadeIn();
    $("#addNewElements").show();
    $("#runningElements").hide();
    mb.showWindow();
    $("#atvDropdownContainer").html("");
    setStatus("Please wait, scanning...")
    $("#pairingLoader").html(getLoader());
    connectionManager.sendMessage("scan");
}

function handleDarkMode() {
    var uimode = localStorage.getItem("uimode") || "systemmode";
    var alwaysUseDarkMode = (uimode == "darkmode");
    var neverUseDarkMode = (uimode == "lightmode");

    if ((nativeTheme.shouldUseDarkColors || alwaysUseDarkMode) && (!neverUseDarkMode)) {
        $("body").addClass("darkMode");
        $("#s2style-sheet").attr('href', 'css/select2-inverted.css')
        ipcRenderer.invoke('uimode', 'darkmode');
    } else {
        $("body").removeClass("darkMode");
        $("#s2style-sheet").attr('href', 'css/select2.min.css')
        ipcRenderer.invoke('uimode', 'lightmode');
    }
}

function setAlwaysOnTop(tf) {
    console.log(`setAlwaysOnTop(${tf})`)
    ipcRenderer.invoke('alwaysOnTop', String(tf));
}

var lastMenuEvent;

function subMenuClick(event) {
    var mode = event.id;
    localStorage.setItem('uimode', mode);
    lastMenuEvent = event;
    event.menu.items.forEach(el => {
        el.checked = el.id == mode;
    })
    setTimeout(() => {
        handleDarkMode();
    }, 1);

    console.log(event);
}

async function confirmExit() {
    app.quit();
}

function changeHotkeyClick (event) {
    ipcRenderer.invoke('loadHotkeyWindow');
}

function handleContextMenu() {
    let tray = mb.tray
    var mode = localStorage.getItem('uimode') || 'systemmode';

    const subMenu = Menu.buildFromTemplate([
        { type: 'checkbox', id: 'systemmode', click: subMenuClick, label: 'Follow system settings', checked: (mode == "systemmode") },
        { type: 'checkbox', id: 'darkmode', click: subMenuClick, label: 'Dark mode', checked: (mode == "darkmode") },
        { type: 'checkbox', id: 'lightmode', click: subMenuClick, label: 'Light mode', checked: (mode == "lightmode") }
    ])

    var topChecked = JSON.parse(localStorage.getItem('alwaysOnTopChecked') || "false")
    const contextMenu = Menu.buildFromTemplate([
        { type: 'checkbox', label: 'Always on-top', click: toggleAlwaysOnTop, checked: topChecked },
        { type: 'separator' },
        { role: 'about', label: 'About' },
        { type: 'separator' },
        { label: 'Appearance', submenu: subMenu, click: subMenuClick },
        { label: 'Change hotkey/accelerator', click: changeHotkeyClick },
        { type: 'separator' },
        { label: 'Quit', click: confirmExit }
    ]);
    tray.removeAllListeners('right-click');
    tray.on('right-click', () => {
        mb.tray.popUpContextMenu(contextMenu);
    })
}

function toggleAlwaysOnTop(event) {
    localStorage.setItem('alwaysOnTopChecked', String(event.checked));
    ipcRenderer.invoke('alwaysOnTop', String(event.checked));
}

async function helpMessage() {
    // It's not ideal to hardcode the hotkey. It would be better to get it from the main process.
    const hotkey = process.platform === 'darwin' ? 'Cmd+Shift+0' : 'Ctrl+Shift+0';
    await dialog.showMessageBox({ type: 'info', title: 'Howdy!', message: `Thanks for using this program!\nAfter pairing with an Apple TV (one time process), you will see the remote layout.\n\nClick the question mark icon to see all keyboard shortcuts.\n\n To open this program, press ${hotkey} (pressing this again will close it). Also right-clicking the icon in the menu will show additional options.` })
}

async function init() {
    handleDarkMode();
    handleContextMenu();
    $("#exitLink").on('click', () => {
        $("#exitLink").blur();
        setTimeout(() => {
                confirmExit();
            }, 1)
    })
    $("#cancelPairing").on('click', () => {
        console.log('cancelling');
        window.location.reload();
    })

    var checked = JSON.parse(localStorage.getItem('alwaysOnTopChecked') || "false")
    if (checked) setAlwaysOnTop(checked);

    var creds;
    try {
        creds = JSON.parse(localStorage.getItem('atvcreds') || "false")
    } catch {
        creds = getCreds();
        if (creds) setCreds(creds);
    }
    if (localStorage.getItem('firstRun') != 'false') {
        localStorage.setItem('firstRun', 'false');
        await helpMessage();
        mb.showWindow();
    }

    if (creds && creds.credentials && creds.identifier) {
        atv_credentials = creds;
        await connectToATV();
    } else {
        startScan();
    }
}

function themeUpdated() {
    console.log('theme style updated');
    handleDarkMode();
}

try {
    nativeTheme.removeAllListeners();
} catch (err) {}
nativeTheme.on('updated', themeUpdated);

$(function() {
    var wp = getWorkingPath();
    $("#workingPathSpan").html(`<strong>${wp}</strong>`)
})

/**
 * Websockets
 */

// Setup connection manager event handlers
connectionManager.events.on('scanResult', (data) => {
    console.log(`Results: ${data}`);
    createDropdown(data);
});

connectionManager.events.on('pairCredentials', (data) => {
    console.log("pairCredentials", state.ws_pairDevice, data);
    saveRemote(state.ws_pairDevice, data);
    localStorage.setItem('atvcreds', JSON.stringify(getCreds(state.pairDevice)));
    connectToATV();
});

connectionManager.events.on('startPair2', () => {
    $("#pairStepNum").html("2");
    $("#pairProtocolName").html("Companion");
});

connectionManager.events.on('current-text', (data) => {
    console.log(`current text: ${data}`);
    ipcRenderer.invoke('current-text', data);
});

connectionManager.events.on('kbfocus-status', (data) => {
    ipcRenderer.invoke('kbfocus-status', data);
});

connectionManager.events.on('power_status', (data) => {
    console.log(`power status: ${data}`);
    const isOn = data.toLowerCase() === "on";
    ipcRenderer.invoke("power_status", isOn);
});

connectionManager.events.on('power_error', (data) => {
    console.log(`power error: ${data}`);
    ipcRenderer.invoke("power_error", data);
});

connectionManager.events.on('disconnected', () => {
    console.log('disconnected');
    setStatus('Disconnected');
});

connectionManager.events.on('connected', () => {
    console.log('connected');
    setStatus(null);
    showAndFade("Connected");
});

connectionManager.events.on('error', (error) => {
    console.warn('connectionManager error', error);
    setStatus(error.message);
})

var ws_readyCount = 0;

function ws_incReady() {
    ws_readyCount++;
    if (ws_readyCount == 2) init();
}

function ws_server_started() {
    console.log(`ws_server_started`)
    ws_incReady();
}

$(function() {
    ws_incReady();
});
