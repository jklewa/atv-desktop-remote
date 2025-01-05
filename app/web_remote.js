var { ipcRenderer } = require('electron');
const path = require('path');
var { Menu, dialog, nativeTheme, app, getGlobal } = require('@electron/remote');
var { state, events, getCreds, setCreds } = require('./shared');
var {
    ws_connect,
    ws_finishPair1,
    ws_finishPair2,
    sendMessage,
    ws_sendCommand,
    ws_sendCommandAction,
    ws_server_started,
    ws_startPair,
    ws_startScan,
} = require("./ws_remote");

var mb = getGlobal('MB');

const ws_keymap = {
    "ArrowUp": "up",
    "ArrowDown": "down",
    "ArrowLeft": "left",
    "ArrowRight": "right",
    "t": "home",
    "l": "home_hold",
    "Backspace": "menu",
    "Escape": "menu",
    "Space": "play_pause",
    "Enter": "select",
    "Previous": "skip_backward",
    "Next": "skip_forward",
    "[": "skip_backward",
    "]": "skip_forward",
    "g": "top_menu",
    "+": "volume_up",
    "=": "volume_up",
    "-": "volume_down",
    "_": "volume_down",
    "p": "power"
}

const keymap = {
    'ArrowLeft': 'Left',
    'ArrowRight': 'Right',
    'ArrowUp': 'Up',
    'ArrowDown': 'Down',
    'Enter': 'Select',
    'Space': (latv) => {
        var v = latv.playing;
        latv.playing = !latv.playing;
        if (v) {
            return 'Pause';
        } else {
            return 'Play'
        }
    },
    'Backspace': 'Menu',
    'Escape': 'Menu',
    'Next': 'Next',
    'Previous': 'Previous',
    'n': 'Next',
    'p': 'Previous',
    ']': 'Next',
    '[': 'Previous',
    't': 'Tv',
    'l': 'LongTv'
}

const niceButtons = {
    "TV": "Tv",
    "play/pause": "play_pause",
    'Lower Volume': 'volume_down',
    'Raise Volume': 'volume_up',
    'Power': 'power'
}

const keyDesc = {
    'Space': 'Pause/Play',
    'ArrowLeft': 'left arrow',
    'ArrowRight': 'right arrow',
    'ArrowUp': 'up arrow',
    'ArrowDown': 'down arrow',
    'Backspace': 'Menu',
    'Escape': 'Menu',
    't': 'TV Button',
    'l': 'Long-press TV Button',
    'p': 'Power'
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

// ipcRenderer.on('mainLog', (event, txt) => {
//     console.log('[ main ] %s', txt.substring(0, txt.length - 1));
// })

ipcRenderer.on('powerResume', (event, arg) => {
    connectToATV();
})

ipcRenderer.on('sendCommand', (event, key) => {
    console.log(`sendCommand from main: ${key}`)
    sendCommand(key);
})

ipcRenderer.on('kbfocus', () => {
    sendMessage('kbfocus')
})

ipcRenderer.on('wsserver_started', () => {
    ws_server_started();
})

ipcRenderer.on('input-change', (event, data) => {
    sendMessage("settext", {text: data});
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

function toggleKeyboardShortcuts() {
    const shortcuts = $("#keyboardShortcuts");
    if (shortcuts.is(":visible")) {
        shortcuts.fadeOut(200);
    } else {
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
        sendMessage("gettext")
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

    // If shortcuts overlay is visible, only allow Escape key
    if ($("#keyboardShortcuts").is(":visible")) {
        if (key === 'Escape') {
            toggleKeyboardShortcuts();
        }
        e.preventDefault();
        return;
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

events.on('createDropdown', (ks) => {
    createDropdown(ks);
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

function _updatePlayState() {
    var label = (state.device.playing ? "Pause" : "Play")
    console.log(`Update play state: ${label}`)
    $(`[data-key="Pause"] .keyText`).html(label);
}

async function sendCommand(k, shifted) {
    if (typeof shifted === 'undefined') shifted = false;
    console.log(`sendCommand: ${k}`)
    if (k == 'Pause') k = 'Space';
    var rcmd = ws_keymap[k];
    if (Object.values(ws_keymap).indexOf(k) > -1) rcmd = k;
    if (typeof(rcmd) === 'function') rcmd = rcmd(state.device);

    var classkey = rcmd;
    if (classkey == 'Play') classkey = 'Pause';
    var el = $(`[data-key="${classkey}"]`)
    if (el.length > 0) {
        el.addClass('invert');
        setTimeout(() => {
            el.removeClass('invert');
        }, 500);
    }
    if (k == 'Space') {
        var pptxt = rcmd == "Pause" ? "Play" : "Pause";
        el.find('.keyText').html(pptxt);
    }
    if (rcmd === 'power') {
        sendMessage("power_toggle");
        showAndFade("Power");
        return;
    }
    console.log(`Keydown: ${k}, sending command: ${rcmd} (shifted: ${shifted})`)
    state.previousKeys.push(rcmd);
    if (state.previousKeys.length > 10) state.previousKeys.shift()
    var desc = rcmd;
    if (desc == 'volume_down') desc = 'Lower Volume'
    if (desc == 'volume_up') desc = 'Raise Volume'
    if (desc == 'play_pause') desc = "play/pause"
    if (desc == 'Tv') desc = 'TV'
    if (desc == 'LongTv') desc = 'TV long press'
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
            sendMessage("power_toggle");
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

function handleMessage(msg) {
    state.device.lastMessages.push(JSON.parse(JSON.stringify(msg)));
    while (state.device.lastMessages.length > 100) state.device.lastMessages.shift();
    if (msg.type == 4) {
        try {
            state.device.bundleIdentifier = msg.payload.playerPath.client.bundleIdentifier;
            var els = state.device.bundleIdentifier.split('.')
            var nm = els[els.length - 1];
        } catch (err) {}
        if (msg && msg.payload && msg.payload.playbackState) {
            state.device.playing = msg.payload.playbackState == 1;
            state.device.lastMessage = JSON.parse(JSON.stringify(msg))
            _updatePlayState();
        }
        if (msg && msg.payload && msg.payload.playbackQueue && msg.payload.playbackQueue.contentItems && msg.payload.playbackQueue.contentItems.length > 0) {
            console.log('got playback item');
            state.device.playbackItem = JSON.parse(JSON.stringify(msg.payload.playbackQueue.contentItems[0]));
        }
    }
}

events.on('connectToATV', () => {
    connectToATV();
})
async function connectToATV() {
    if (state.connecting) return;
    state.connecting = true;
    setStatus("Connecting to ATV...");
    $("#runningElements").show();
    atv_credentials = JSON.parse(localStorage.getItem('atvcreds'))

    $("#pairingElements").hide();

    await ws_connect(atv_credentials);
    createATVDropdown();
    showKeyMap();
    state.connecting = false;
}


events.on('saveRemote', (name, creds) => {
    saveRemote(name, creds);
})
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
    // It's not ideal to hardcode the shortcut. It would be better to get it from the main process.
    const shortcut = process.platform === 'darwin' ? 'Command+Shift+0' : 'Ctrl+Shift+0';
    await dialog.showMessageBox({ type: 'info', title: 'Howdy!', message: `Thanks for using this program!\nAfter pairing with an Apple TV (one time process), you will see the remote layout.\n\nClick the question mark icon to see all keyboard shortcuts.\n\n To open this program, press ${shortcut} (pressing this again will close it). Also right-clicking the icon in the menu will show additional options.` })
}


events.on('init', (callback) => {
    init().then(callback)
})
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
