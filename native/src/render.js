const { ipcRenderer } = require('electron');
const { SerialPort } = require('serialport');

let port;

async function list_ports() {
  for (let p of await SerialPort.list()) {
    // if (p.vendorId === 0x1999 && p.productId === 0x0514) {
      port = p;
      ipcRenderer.send('serial-target', port.path);
      break;
    // }
  }
}

// serial data received
ipcRenderer.on('serial-data', data => {

});

list_ports()
