const path = require('node:path');
const notifier = require('node-notifier');
const { fork } = require('child_process');
const { app, BrowserWindow, ipcMain } = require('electron');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // and load the index.html of the app.
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
let serial = {
  process: null,
  ready: false,
  open: false,
};

function create_serial_process(event) {
  if (!serial.process) {
    serial.process = fork('./src/serial.js');
    serial.process.on('message', data => {
      switch (data.key) {
        case 'serial-ready': {
          serial.ready = true;
          break;
        }

        case 'serial-open': {
          serial.open = true;
          event.sender.send('serial-open');
          break;
        }

        case 'serial-data': {
          event.sender.send('serial-data', data.data);
          break;
        }
      }
    });
  }
}

// pass target serial port to the serial handler
ipcMain.on('serial-target', (event, data) => {
  create_serial_process(event);

  // wait serial process spawns
  let timer = setInterval(() => {
    if (serial.ready) {
      serial.process.send({ key: 'serial-target', data: data });
      clearInterval(timer);
    }
  }, 100);
});

// pass serial transmit request to the serial handler
ipcMain.on('serial-request', (event, data) => {
  serial.process.send({ key: 'serial-request', data: data });
});

ipcMain.on('notify', (event, data) => {
  notifier.notify({
    title: data.title,
    message: data.message ? data.message : " ",
    icon: path.join(__dirname, '../resources/icons/icon.png'),
    appID: 'FSK traffic control'
  });
});

ipcMain.on('quit', event => {
  app.quit();
});