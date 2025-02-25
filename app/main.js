const {log} = require('./log');
// Override console.log/info/warn/error
Object.assign(console, log.functions);
const { app, BrowserWindow, powerMonitor, Tray, Menu, nativeImage, globalShortcut, dialog } = require('electron')
require('@electron/remote/main').initialize()
var win;
const { ipcMain } = require('electron')
const path = require('path');
const {menubar} = require('menubar');
const util = require('util');
var secondWindow;
process.env['MYPATH'] = path.join(process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + "/.local/share"), "ATV Remote");
const lodash = _ = require('./js/lodash.min');
const server_runner = require('./server_runner')
const fs = require('fs');

server_runner.startServer();
server_runner.server_events.on("stopped", (code, signal, errorLogs, maxRestartsReached) => {
    if (signal === "SIGINT" || signal === "SIGTERM") return;

    let errorMessage = `Server exited with error code ${code} ${signal ? `and signal ${signal}` : ''}`;
    if (errorLogs) {
        errorMessage += "\n\nError details:\n" + errorLogs.slice(-20).join("\n");
    }

    if (maxRestartsReached) {
        errorMessage = "Server failed to start after multiple attempts.\n\n" + errorMessage;
        dialog.showErrorBox("Server Error - Max Restarts Reached", errorMessage);
        setTimeout(() => app.exit(1), 100);
    }
});

// process.on("uncaughtException", server_runner.stopServer);
// process.on("SIGINT", server_runner.stopServer);
// process.on("SIGTERM", server_runner.stopServer);
global["server_runner"] = server_runner;

const preloadWindow = true;
const readyEvent = preloadWindow ? "ready" : "after-create-window";

const volumeButtons = ['VolumeUp', 'VolumeDown', 'VolumeMute']

var handleVolumeButtonsGlobal = false;

var mb;
var kbHasFocus;

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
    app.quit()
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        console.log('second instance tried to open');
        showWindow();
    })
}

function createHotkeyWindow() {
    hotkeyWindow = new BrowserWindow({
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        width: 400,
        height: 400,
    });
    require('@electron/remote/main').enable(hotkeyWindow.webContents)
    hotkeyWindow.loadFile('hotkey.html');
    hotkeyWindow.setMenu(null);
    hotkeyWindow.on('close', (event) => {
        event.preventDefault();
        if (!registerHotkeys()) {
            return false;
        }
        hotkeyWindow.hide();
    });
}

function createInputWindow() {
    secondWindow = new BrowserWindow({
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        hide: true,
        width: 600,
        height: 200,
        minimizable: false,
        maximizable: false
    });
    secondWindow.setAlwaysOnTop(true, "modal-panel");
    require('@electron/remote/main').enable(secondWindow.webContents)
    secondWindow.loadFile('input.html');
    secondWindow.on('close', (event) => {
        event.preventDefault();
        secondWindow.webContents.send('closeInputWindow');
        showWindowThrottle();
    });
    secondWindow.on("blur", () => {
        secondWindow.webContents.send('closeInputWindow');
        showWindowThrottle();
    })
    secondWindow.setMenu(null);
    secondWindow.hide();
}

function createWindow() {
    mb = menubar({
        index: `file://${__dirname}/index.html`,
        preloadWindow: preloadWindow,
        showDockIcon: true,
        browserWindow: {
            width: 300,
            height: 500,
            alwaysOnTop: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        },
        windowPosition: "center"
    });
    global['MB'] = mb;
    mb.on("before-load", () => {
        require('@electron/remote/main').enable(mb.window.webContents)
    })
    mb.on(readyEvent, () => {
        win = mb.window;
        createInputWindow()

        win.on('close', () => {
            console.log('window closed, quitting')
            app.exit();
        })
        win.on('show', () => {
            if (handleVolumeButtonsGlobal) handleVolume();
        })

        win.on('hide', () => {
            if (handleVolumeButtonsGlobal) unhandleVolume();
        })

        win.webContents.on('will-navigate', (e, url) => {
            console.log(`will-navigate`, url);
        })
        ipcMain.on('input-change', (event, data) => {
            console.log('Received input:', data);
            win.webContents.send('input-change', data);
        });
        ipcMain.handle("loadHotkeyWindow", (event) => {
            createHotkeyWindow();
        })
        ipcMain.handle('debug', (event, arg) => {
            console.log(`ipcDebug: ${arg}`)
        })
        ipcMain.handle('quit', async event => {
            await server_runner.stopServer();
            app.exit()
        });
        ipcMain.handle('alwaysOnTop', (event, arg) => {
            var tf = arg == "true";
            console.log(`setting alwaysOnTop: ${tf}`)
            mb.window.setAlwaysOnTop(tf);

        })
        ipcMain.handle('uimode', (event, arg) => {
            secondWindow.webContents.send('uimode', arg);
        });

        ipcMain.handle('hideWindow', (event) => {
            console.log('hiding window');
            mb.hideWindow();
        });
        ipcMain.handle('isProduction', (event) => {
            return (!process.defaultApp);
        });

        ipcMain.handle('closeInputOpenRemote', (event, arg) => {
            console.log('closeInputOpenRemote');
            showWindow();
        })
        ipcMain.handle('openInputWindow', (event, arg) => {
            secondWindow.show();
            secondWindow.webContents.send('openInputWindow');
        });
        ipcMain.handle('current-text', (event, arg) => {
            console.log('current-text', arg);
            secondWindow.webContents.send('current-text', arg);
        });
        ipcMain.handle('kbfocus-status', (event, arg) => {
            secondWindow.webContents.send('kbfocus-status', arg);
            kbHasFocus = arg;
        })
        ipcMain.handle('kbfocus', () => {
            win.webContents.send('kbfocus');
        })
        ipcMain.handle('power_status', (event, arg) => {
            console.log('power_status', arg);
            win.webContents.send('power_status', arg);
        })
        ipcMain.handle('power_error', (event, arg) => {
            console.error('power_error', arg);
        })

        powerMonitor.addListener('resume', event => {
            win.webContents.send('powerResume');
        })

        win.on('ready-to-show', () => {
            console.log('ready to show')
            if (server_runner.isServerRunning()) {
                win.webContents.send("wsserver_started")
            }
        })

        if (server_runner.isServerRunning()) {
            console.log(`server already running`)
            win.webContents.send("wsserver_started")
        } else {
            console.log(`server waiting for event`)
            server_runner.server_events.on("started", () => {
                win.webContents.send("wsserver_started")
            })
        }
    })
}

function showWindow() {
    secondWindow.hide();
    if (process.platform === 'darwin') {
        app.show();
    }
    mb.showWindow();
    setTimeout(() => {
        mb.window.focus();
    }, 200);
}

var showWindowThrottle = lodash.throttle(showWindow, 100);

function hideWindow() {
    mb.hideWindow();
    if (process.platform === 'darwin') {
        app.hide();
    }
}

function getWorkingPath() {
    var rp = process.resourcesPath;
    if (!rp && process.argv.length > 1) rp = path.resolve(process.argv[1]);
    if (!app.isPackaged) {
        rp = path.resolve(`${path.dirname(process.argv[1])}/../atv_py_env`)
    }
    return rp
}

function unhandleVolume() {
    volumeButtons.forEach(btn => {
        console.log(`unregister: ${btn}`)
        globalShortcut.unregister(btn);
    })
}

function handleVolume() {
    volumeButtons.forEach(btn => {
        console.log(`register: ${btn}`)
        globalShortcut.register(btn, () => {
            var keys = {
                "VolumeUp": "volume_up",
                "VolumeDown": "volume_down",
                "VolumeMute": "volume_mute"
            }
            var key = keys[btn]
            console.log(`sending ${key} for ${btn}`)
            win.webContents.send('sendCommand', key);
        })
    })
}

function registerHotkeys() {
    let hotkeys = [process.platform === 'darwin' ? 'Cmd+Shift+0' : 'Ctrl+Shift+0']
    let hotkeyPath = path.join(process.env['MYPATH'], "hotkey.txt")
    try {
        globalShortcut.unregisterAll();
    } catch (err) {
        console.warn(`Error unregistering hotkeys: ${err}`)
    }
    if (fs.existsSync(hotkeyPath)) {
        const hotkeysContent = fs.readFileSync(hotkeyPath, {encoding: 'utf-8'}).trim();
        if (hotkeysContent.indexOf(",") > -1) {
            hotkeys = hotkeysContent.split(',').map(el => { return el.trim() });
        } else {
            hotkeys = [hotkeysContent];
        }
    }
    console.log(`Registering custom hotkeys: ${hotkeys}`)
    try {
        globalShortcut.registerAll(hotkeys, () => {
            if (mb.window.isVisible()) {
                hideWindow();
            } else {
                showWindow();
            }
        })
    } catch (err) {
        if (err instanceof TypeError) {
            console.error(`Error registering hotkeys: ${err.message}`)
            dialog.showErrorBox("Hotkey Error", "Invalid hotkey: " + hotkeys.join(", "));
        } else {
            console.error(`Error registering hotkeys: ${err}`)
        }
        return false;
    }
    return true;
}

app.whenReady().then(() => {
    server_runner.testPythonExists().then(r => {
        console.log(`python exists: ${r}`)
    }).catch(err => {
        console.log(`python does not exist: ${err}`)
    })

    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow()
        }
    })
    // did-become-active: show window via macOS App Switcher
    app.on('did-become-active', () => {
        if (!win || !secondWindow || win.isDestroyed() || secondWindow.isDestroyed()) return;
        if (win.isVisible() || secondWindow.isVisible() || win.isAlwaysOnTop()) return;
        showWindow();
    })

    registerHotkeys();

    var version = app.getVersion();
    app.setAboutPanelOptions({
        applicationName: "ATV Remote",
        applicationVersion: version,
        version: version,
        credits: "Brian Harper",
        copyright: "Copyright 2022",
        website: "https://github.com/bsharper",
        iconPath: "./images/full.png"
    });
})

app.on("before-quit", async () => {
    await server_runner.stopServer();
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})
