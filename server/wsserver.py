import os
from typing import Any, Union, Type

import sys
import json
import pyatv
import pyatv.const
import asyncio
import websockets
import websockets.asyncio.server

import logging
ws_logger = logging.getLogger('websockets')
ws_logger.setLevel(logging.DEBUG)
ws_logger.addHandler(logging.StreamHandler(sys.stdout))

logger = logging.getLogger('server')
logger.setLevel(logging.DEBUG)
logger.addHandler(logging.StreamHandler(sys.stderr))


interface = pyatv.interface
pair = pyatv.pair
Protocol = pyatv.const.Protocol
pyatv_short_version = (int(pyatv.const.MAJOR_VERSION), int(pyatv.const.MINOR_VERSION))


my_name = os.path.basename(sys.argv[0])

loop = asyncio.get_event_loop()
scan_lookup = {}
pairing_atv = False
active_pairing = False
active_device: Union[pyatv.interface.AppleTV, bool] = False
active_remote: Union[pyatv.interface.RemoteControl, bool] = False
active_ws: Union[websockets.asyncio.server.ServerConnection, bool] = False
default_port = 8765
pairing_creds = {}

class ATVKeyboardListener(interface.KeyboardListener):
    global active_ws
    def focusstate_update(self, old_state, new_state):
        logger.info('Focus state changed from {0:s} to {1:s}'.format(old_state, new_state))
        if active_ws:
            try:
                loop.run_until_complete(sendCommand(active_ws, "keyboard_changestate", [old_state, new_state]))
            except Exception as ex:
                logger.error(f"change state error: {ex}")
                


async def sendCommand (ws, command, data: Any = None):
    r = {"command": command, "data": data or []}
    await ws.send(json.dumps(r))

async def parseRequest(j: dict, websocket: websockets.asyncio.server.ServerConnection):
    global scan_lookup, pairing_atv, active_pairing, active_device, active_remote, active_ws, pairing_creds
    active_ws = websocket
    if "cmd" in j.keys():
        cmd = j["cmd"]
    else:
        return
    #logger.info(f"got command: {cmd}")
    
    data: Any = False
    if "data" in j.keys():
        data = j["data"]
    
    if cmd == "quit":
        logger.info("quit command")
        await asyncio.sleep(0.5)
        sys.exit(0)
    
    if cmd == "scan":
        atvs = await pyatv.scan(loop)
        ar = []
        scan_lookup = {}
        for atv in atvs:
            txt = f"{atv.name} ({atv.address})"
            ar.append(txt)
            scan_lookup[txt] = atv

        await sendCommand(websocket, "scanResult", ar)

    if cmd == "echo":
        await sendCommand(websocket, "echo_reply", data)

    if cmd == "startPair":
        logger.info("startPair")
        atv = scan_lookup[data]
        pairing_atv = atv
        logger.info("pairing atv %s" % (atv))
        pairing = await pair(atv, Protocol.AirPlay, loop)
        active_pairing = pairing
        await pairing.begin()

    if cmd == "finishPair1":
        logger.info("finishPair1 %s" % (data))
        pairing = active_pairing
        pairing.pin(data)
        try:
            await pairing.finish()
        except pyatv.exceptions.PairingError:
            logger.exception("Pairing error in finishPair1")
            await sendCommand(websocket, "pairError", "Bad PIN")
            await pairing.begin()
            return
        if pairing.has_paired:
            logger.info("Paired with device!")
            logger.info("Credentials: %s", pairing.service.credentials)
        else:
            logger.info("Did not pair with device!")
            return
        creds = pairing.service.credentials
        id = pairing_atv.identifier
        nj = {"credentials": creds, "identifier": id}
        pairing_creds = nj
        await sendCommand(websocket, "startPair2")
        #await sendCommand(websocket, "pairCredentials1", nj)
        atv = pairing_atv
        logger.info("pairing atv %s" % (atv))
        pairing = await pair(atv, Protocol.Companion, loop)
        active_pairing = pairing
        await pairing.begin()

    if cmd == "finishPair2":
        logger.info("finishPair2 %s" % (data))
        pairing = active_pairing
        pairing.pin(data)
        try:
            await pairing.finish()
        except pyatv.exceptions.PairingError:
            logger.exception("Pairing error in finishPair2")
            await sendCommand(websocket, "pairError", "Bad PIN")
            await pairing.close()
            pairing = await pair(pairing_atv, Protocol.Companion, loop)
            active_pairing = pairing
            await pairing.begin()
            return
        if pairing.has_paired:
            logger.info("Paired with device!")
            logger.info("Credentials: %s", pairing.service.credentials)
        else:
            logger.info("Did not pair with device!")
        pairing_creds["Companion"] = pairing.service.credentials
        await sendCommand(websocket, "pairCredentials", pairing_creds)
    
    
    if cmd == "finishPair":
        logger.info("finishPair %s" % (data))
        pairing = active_pairing
        pairing.pin(data)
        await pairing.finish()
        if pairing.has_paired:
            logger.info("Paired with device!")
            logger.info("Credentials: %s", pairing.service.credentials)
        else:
            logger.info("Did not pair with device!")
        creds = pairing.service.credentials
        id = pairing_atv.identifier
        nj = {"credentials": creds, "identifier": id}
        await sendCommand(websocket, "pairCredentials", nj)

    if cmd == "kbfocus":
        if not active_device:
            return
        kbfocus = "unknown"
        if active_device.keyboard.text_focus_state == pyatv.const.KeyboardFocusState.Focused:
            kbfocus = "focused"
        elif active_device.keyboard.text_focus_state == pyatv.const.KeyboardFocusState.Unfocused:
            kbfocus = "unfocused"
        await sendCommand(websocket, "kbfocus-status", kbfocus)
    
    if cmd == "settext":
        text = data["text"]
        if not active_device or active_device.keyboard.text_focus_state != pyatv.const.KeyboardFocusState.Focused:
            return
        await active_device.keyboard.text_set(text)
    
    if cmd == "gettext":
        logger.info(f"gettext focus compare {active_device and active_device.keyboard.text_focus_state} == {pyatv.const.KeyboardFocusState.Focused}")


        if not active_device or active_device.keyboard.text_focus_state != pyatv.const.KeyboardFocusState.Focused:
            return
        ctext = await active_device.keyboard.text_get()
        logger.info(f"Current text: {ctext}")
        await sendCommand(websocket, "current-text", ctext)
    
    if cmd == "connect":
        id = data["identifier"]
        creds = data["credentials"]
        stored_credentials = { Protocol.AirPlay: creds }
        if "Companion" in data.keys():
            companion_creds = data["Companion"]
            stored_credentials[Protocol.Companion] = companion_creds
        
        logger.info("stored_credentials %s" % (stored_credentials))
        atvs = await pyatv.scan(loop, identifier=id)
        if not atvs:
            logger.info("No device found with identifier %s" % (id))
            await sendCommand(websocket, "connected", {"connected": False, "error": "No device found with identifier %s" % (id)})
            return
        atv = atvs[0]
        for protocol, credentials in stored_credentials.items():
            logger.info("Setting protocol %s with credentials %s" % (str(protocol), credentials))
            atv.set_credentials(protocol, credentials)
        try:
            device = await pyatv.connect(atv, loop)
            remote = device.remote_control
            active_device = device
            active_remote = remote
            kblistener = ATVKeyboardListener()
            device.keyboard.listener = kblistener
            await sendCommand(websocket, "connected", {"connected": True})
            power_status = "on" if device.power.power_state == pyatv.const.PowerState.On else "off"
            await sendCommand(websocket, "power_status", power_status)  # Check power status after connecting
        except Exception as ex:
            logger.error(f"Failed to connect, error: {ex}")
            await sendCommand(websocket, "connected", {"connected": False, "error": str(ex)})
    
    if cmd == "key":
        if not active_remote:
            return
        valid_keys = ['play_pause', 'left', 'right', 'down', 'up', 'select', 'menu', 'top_menu', 'home', 'home_hold', 'skip_backward', 'skip_forward', 'volume_up', 'volume_down']
        no_action_keys = ['play_pause', 'home_hold']
        audio_keys = ['volume_up', 'volume_down']
        # pyatv 0.9.0 and later uses interface.Audio, scheduled for removal from interface.AppleTV in 1.0.0
        if pyatv_short_version < (0, 9):
            no_action_keys += audio_keys
            audio_keys = []
        taction: Union[Type[pyatv.const.InputAction], bool] = False
        key = data
        if not isinstance(data, str):
            key = data['key']
            taction = pyatv.const.InputAction[data['taction']]
        if key in valid_keys:
            if key in audio_keys:
                if active_device:
                    await getattr(active_device.audio, key)()
            elif key in no_action_keys or (not taction):
                await getattr(active_remote, key)()
            else:
                await getattr(active_remote, key)(taction)

    if cmd == "power_status":
        if active_device:
            try:
                power_status = "on" if active_device.power.power_state == pyatv.const.PowerState.On else "off"
                await sendCommand(websocket, "power_status", power_status)
            except Exception as ex:
                logger.error(f"Error getting power status: {ex}")
                await sendCommand(websocket, "power_error", str(ex))

    if cmd == "power_toggle":
        if active_device:
            try:
                target_power_state = "off" if active_device.power.power_state == pyatv.const.PowerState.On else "on"
                if target_power_state == "off":
                    await active_device.power.turn_off()
                else:
                    await active_device.power.turn_on()
                await sendCommand(websocket, "power_status", target_power_state)
            except Exception as ex:
                logger.error(f"Error toggling power: {ex}")
                await sendCommand(websocket, "power_error", str(ex))

async def close_active_device():
    try:
        if active_device:
            active_device.close()
    except Exception as ex:
        logger.error("Error closing active_device: %s" %(ex))

async def reset_globals():
    global scan_lookup, pairing_atv, active_pairing, active_device, active_remote, active_ws
    logger.info("Resetting global variables")
    scan_lookup = {}
    
    pairing_atv = False
    active_pairing = False
    active_device = False
    active_remote = False
    active_ws = False

keep_running = True


async def check_exit_file():
    global keep_running
    if os.path.exists('stopserver'):
        os.unlink('stopserver')

    while keep_running:
        await asyncio.sleep(0.5)
        fe = os.path.exists('stopserver')
        txt = "found" if fe else "not found"
        #logger.info("stopserver %s" % (txt))
        if fe:
            logger.info("exiting")
            keep_running = False
            os.unlink('stopserver')
            sys.exit(0)


async def ws_main(websocket: websockets.asyncio.server.ServerConnection):
    #await reset_globals()
    await close_active_device()
    async for message in websocket:
        try:
            j = json.loads(message)
        except Exception as ex:
            logger.error("Error parsing message: %s\n%s" % (str(ex), message))
            continue
        
        try:
            await parseRequest(j, websocket)
        except Exception:
            logger.exception("Unhandled Exception in parseRequest:")
            raise

async def main(port: int):
    global keep_running
    width = 80
    txt = "%s WebSocket - ATV Server" % (my_name)
    logger.info("="*width)
    logger.info(txt.center(width))
    logger.info("="*width)
    task = asyncio.create_task(check_exit_file())

    async with websockets.serve(ws_main, "localhost", port):
        try:
            # while keep_running:
            #     await asyncio.sleep(1)
            await asyncio.Future()  # run forever
        except Exception as ex:
            logger.error(ex)
            sys.exit(0)



if __name__ == "__main__":
    args = sys.argv[1:]
    port = default_port
    if len(args) > 0:
        if args[0] in ["-h", "--help", "-?", "/?"]:
            logger.info("Usage: %s (port_number)\n\n Port number by default is %d" % (my_name, default_port))
        port = int(args[0])

    asyncio.set_event_loop(loop)
    loop.run_until_complete(main(port))
