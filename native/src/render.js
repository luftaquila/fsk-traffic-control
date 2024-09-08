const { ipcRenderer } = require('electron');
const { SerialPort } = require('serialport');

let port;

ipcRenderer.on('serial-open', (evt, data) => {
  ipcRenderer.send('serial-request', '$HELLO');
});

// serial data received
ipcRenderer.on('serial-data', (evt, data) => {
  let str = String.fromCharCode(...data.data);
  console.log(str)

  // ignore non-protocol messages
  if (str[0] !== "$") {
    return;
  }

  if (str.includes("$HI")) {
    ipcRenderer.send('notify', { title: `${str.substring(4)}번 컨트롤러 연결 완료 (${port.path})` });
  }
});

function event_listeners() {
  document.getElementById("connect").addEventListener("click", () => {
    // TODO
    ipcRenderer.send('serial-request', '$SENSOR 002 001 002');
  });
}

async function list_ports() {
  for (let p of await SerialPort.list()) {
    switch (navigator.platform) {
      case 'Win32': {
        if (p.vendorId === "1999" && p.productId === "0514") {
          port = p;
          ipcRenderer.send('serial-target', port.path);
          return;
        }
      }

      // NOTE: not tested on other platforms
      default: {
        if (p.vendorId === 0x1999 && p.productId === 0x0514) {
          port = p;
          ipcRenderer.send('serial-target', port.path);
          return;
        }
      }
    }
  }

  ipcRenderer.send('notify', {
    title: `장치 연결 실패 (장치 없음)`,
    message: "먼저 장치를 컴퓨터에 연결한 후에 프로그램을 실행하세요."
  });

  ipcRenderer.send('quit');
}

event_listeners();
list_ports();
