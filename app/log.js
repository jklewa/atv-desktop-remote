const path = require('path');
const log = require('electron-log/main');
log.initialize();
log.transports.file.level = 'info';
log.transports.file.fileName = 'main.log';
log.transports.file.resolvePathFn = (variables) => {
    return path.join(variables.userData, variables.fileName);
}
log.transports.console.useStyles = false;

const serverLog = log.create({logId: 'server'});
serverLog.initialize();
serverLog.transports.file.fileName = 'server.log';
serverLog.transports.file.resolvePathFn = (variables) => {
    return path.join(variables.userData, variables.fileName);
}
serverLog.transports.file.level = 'info';
serverLog.transports.console.useStyles = false;
serverLog.transports.console.level = 'error';

exports.log = log;
exports.serverLog = serverLog;