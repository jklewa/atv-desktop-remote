// ATV Remote using Websockets

const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

var { ipcRenderer } = require('electron');

const {log} = require('./log');
// Override console.log/info/warn/error
Object.assign(console, log.functions);

/**
 * Common
 */

const state = {
    atv_credentials: false,
    pairDevice: "",
    device: false,
    playstate: false,
    connecting: false,
    online: true,
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
    ws_sendMessage('kbfocus')
})

ipcRenderer.on('wsserver_started', () => {
    ws_server_started();
})

ipcRenderer.on('input-change', (event, data) => {
    ws_sendMessage("settext", {text: data});
});

ipcRenderer.on('power_status', (event, isOn) => {
    console.log(`power_status: ${isOn}`)
    showAndFade(isOn ? 'Device On' : 'Device Off');
});

window.addEventListener('beforeunload', async e => {
    delete e['returnValue'];
    try {
        ipcRenderer.invoke('debug', 'beforeunload called')
        if (!state.device) return;
        state.device.removeAllListeners('message');
        ipcRenderer.invoke('debug', 'messages unregistered')
        await state.device.closeConnection()
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
    setTimeout(() => { // yes, this is done but it works
        ws_sendMessage("gettext")
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
    if (state.connection_failure) {
        setStatus("No Connection");
    } else {
        $("#statusText").hide();
    }
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
        ws_sendMessage("power_toggle");
        showAndFade("Power");
        return;
    }
    console.log(`Keydown: ${k}, sending command: ${rcmd} (shifted: ${shifted})`)
    state.previousKeys.push(rcmd);
    if (state.previousKeys.length > 10) state.previousKeys.shift()
    var desc = desc_rcmdmap[rcmd] || rcmd;
    showAndFade(desc);
    if (shifted) {
        ws_sendCommandAction(rcmd, "Hold")
    } else {
        ws_sendCommand(rcmd)
    }
}

function getWorkingPath() {
    return path.join(process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + "/.local/share"), "ATV Remote");
}

function isConnected() {
    return state.atv_connected
}

async function askQuestion(msg) {
    let options = {
        buttons: ["No", "Yes"],
        message: msg
    }
    var response = await dialog.showMessageBox(options)
    console.log(response)
    return response.response == 1
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
    ws_startPair(dev);
}

function submitCode() {
    var code = $("#pairCode").val();
    $("#pairCode").val("");
    if ($("#pairStepNum").text() == "1") {
        ws_finishPair1(code)
    } else {
        ws_finishPair2(code)
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
            ws_sendMessage("power_toggle");
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
    if (state.connecting) return;
    state.connecting = true;
    setStatus("Connecting to ATV...");
    $("#runningElements").show();
    atv_credentials = JSON.parse(localStorage.getItem('atvcreds'))

    $("#pairingElements").hide();

    const conn = ws_connect(atv_credentials);
    if (!conn) {
        // createATVDropdown();
        // showKeyMap();
        // state.connecting = false;
        return;
    }
    conn.catch(() => {
        state.connection_failure = true;
    }).finally(() => {
        createATVDropdown();
        showKeyMap();
        state.connecting = false;
    });
}


function saveRemote(name, creds) {
    var ar = JSON.parse(localStorage.getItem('remote_credentials') || "{}")
    if (typeof creds == 'string') creds = JSON.parse(creds);
    ar[name] = creds;
    localStorage.setItem('remote_credentials', JSON.stringify(ar));
}

function setStatus(txt) {
    $("#statusText").html(txt).show();
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
    ws_startScan();
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

function alwaysOnTopToggle() {
    var cd = $("#alwaysOnTopCheck").prop('checked')
    localStorage.setItem('alwaysOnTopChecked', cd);
    setAlwaysOnTop(cd);
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

async function helpMessage()
{
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

const WebSocket = require('ws').WebSocket;

var ws_url = 'ws://localhost:8765'
var ws_timeout_interval = 800;

function ws_sendMessage(command, data) {
    if (typeof data == "undefined") data = "";
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
        state.pending.push([command, data]);
        return;
    }
    while (state.pending.length > 0) {
        var cmd_ar = state.pending.shift();
        state.ws.send(JSON.stringify({ cmd: cmd_ar[0], data: cmd_ar[1] }))
    }
    if (command === "kbfocus") {
        console.debug("ws_sendMessage: {cmd:%s, data:%o}", command, data)
    } else {
        console.log("ws_sendMessage: {cmd:%s, data:%o}", command, data)
    }
    state.ws.send(JSON.stringify({ cmd: command, data: data }))
}

function ws_startWebsocket() {
    state.ws_connected = false;
    state.ws = new WebSocket(ws_url, {
        perMessageDeflate: false
    });

    state.ws.once('open', function open() {
        state.ws_connected = true;
        console.log('ws open');
        if (state.scanWhenOpen) ws_startScan();
        init().then(() => {
            console.log('init complete');
        });
    });

    state.ws.on('close', function close(code, reason) {
        state.ws_connected = false;
        switch (code) {
            case 1000: //  1000 indicates a normal closure, meaning that the purpose for which the connection was established has been fulfilled.
                console.log("WebSocket: closed");
                break;
            default: // Abnormal closure
                console.warn(`WebSocket: closed abnormally ${code} ${reason}`);
                break;
        }
    });

    state.ws.on('message', function message(data) {
        if (data.includes("kbfocus")) {
            console.debug('received: %o', data.toString());
        } else {
            console.log('received: %o', data.toString());
        }
        var j = JSON.parse(data);
        if (j.command == "scanResult") {
            console.log(`Results: ${j.data}`)
            createDropdown(j.data);
        }
        if (j.command == "pairCredentials") {
            console.log("pairCredentials", state.ws_pairDevice, j.data);
            saveRemote(state.ws_pairDevice, j.data);
            localStorage.setItem('atvcreds', JSON.stringify(getCreds(state.pairDevice)));
            connectToATV()
        }
        if (j.command == "connected") {
            state.atv_connected = !!j.data?.connected;
            state.connection_failure = j.data?.error != null;
            events.emit("connected", state.atv_connected);
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
    if (state.ws_connected) ws_sendMessage("scan");
    else {
        state.scanWhenOpen = true;
    }
}

function ws_sendCommand(cmd) {
    //console.log(`ws_sendCommand: ${cmd}`)
    ws_sendMessage("key", cmd)
}

function ws_sendCommandAction(cmd, taction) {
    // taction can be 'DoubleTap', 'Hold', 'SingleTap'
    //console.log(`ws_sendCommandAction: ${cmd} - ${taction}`)
    ws_sendMessage("key", { "key": cmd, "taction": taction })
}

function ws_connect(creds) {
    if (state.ws_connecting) return;
    state.ws_start_tm = Date.now();
    state.ws_connecting = true;
    console.log("ws_connect: %o", creds)
    return new Promise((resolve, reject) => {
        var timeout = setTimeout(() => {
            state.ws_connecting = false;
            state.ws_start_tm = false;
            reject();
        }, 15000)
        var repeatConnectMsg = setInterval(() => {
            if (state.ws.readyState === WebSocket.OPEN) {
                ws_sendMessage("connect", creds);
            } else if (state.ws.readyState === WebSocket.CLOSED || state.ws.readyState === WebSocket.CLOSING) {
                log.error('ws_connect: websocket is closed')
                clearInterval(repeatConnectMsg);
                reject();
            }
        }, 10000)
        ws_sendMessage("connect", creds);
        events.removeAllListeners("connected");
        events.once("connected", () => {
            clearTimeout(timeout);
            clearInterval(repeatConnectMsg);
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
    ws_sendMessage("startPair", dev);
}

function ws_finishPair1(code) {
    state.connection_failure = false;
    console.log(`ws_finishPair1: ${code}`)
    ws_sendMessage("finishPair1", code);
}

function ws_finishPair2(code) {
    state.connection_failure = false;
    console.log(`ws_finishPair2: ${code}`)
    ws_sendMessage("finishPair2", code);
}

function ws_checkWSConnection() {
    if (!state.ws_connected && !state.ws_connecting) {
        console.log('ws_checkWSConnection restarting websocket');
        ws_startWebsocket();
    }
}

function ws_init() {
    console.log('ws_init');
    ws_startWebsocket();
    setTimeout(() => {
        // not sure if needed, but server start now tries to install required python packages which can be slow
        state.ws_watchdog = setInterval(() => {
            ws_checkWSConnection()
        }, 5000);
    }, 15000)
    window.addEventListener('online', () => {
        state.online = true;
        console.log('online');
        connectToATV()
    });
    window.addEventListener('offline', () => {
        state.online = false;
        console.log('offline');
        connectToATV()
    });
}

function ws_incReady() {
    //console.log('incReady');
    ws_readyCount++;
    if (ws_readyCount == 2) ws_init();
}

function ws_server_started() {
    console.log(`ws_server_started`)
    ws_incReady();
}

var ws_readyCount = 0;

$(function() {
    ws_incReady();
});
