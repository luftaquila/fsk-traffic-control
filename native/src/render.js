const { ipcRenderer } = require('electron');
const { SerialPort } = require('serialport');

// UI mode; settings, competitive, record
let mode = "settings";

let controller = {
  device: {},
  connected: false,
  time_synced: false,
  start: undefined,
};

let active_sensors = {
  competitive: [],
  record: {
    start: null,
    end: null,
  },
};

/*******************************************************************************
 * serial port opened
 ******************************************************************************/
ipcRenderer.on('serial-open', (evt, data) => {
  /*************************************************************************
   * protocol $HELLO: greetings!
   *   request : $HELLO
   *   response: $HI <%03d controller id>
   ************************************************************************/
  ipcRenderer.send('serial-request', '$HELLO'); // communication check
});

/*******************************************************************************
 * serial data received
 ******************************************************************************/
ipcRenderer.on('serial-data', (evt, data) => {
  let str = String.fromCharCode(...data.data);
  console.log(str)

  // ignore non-protocol messages
  if (str[0] !== "$") {
    return;
  }

  // $HELLO
  if (str.includes("$HI")) {
    controller.connected = true;
    document.getElementById('connect').classList.remove('red');
    document.getElementById('connect').classList.add('green');
    ipcRenderer.send('notify', { title: `${str.substr(4, 3)}번 컨트롤러 연결 완료 (${controller.device.path})` });
  }

  // $SENSOR
  else if (str.includes("$LSNTP")) {
    document.getElementById('controller-status').value = '센서 시간 동기화 중...';
  }

  // $SENSOR
  else if (str.includes("$READY-ALL")) {
    controller.time_synced = true;
    document.getElementById('controller-status').value = '센서 시간 동기화 완료';
  }

  // $GREEN
  else if (str.includes("$START")) {
    controller.start = new Date();
    document.getElementById('controller-status').value = '측정 시작';
  }
});

/*******************************************************************************
 * UI event handlers
 ******************************************************************************/
function handle_events() {
  document.querySelectorAll('.nav-mode').forEach(elem => {
    mode = elem.id;

    elem.addEventListener("click", () => {
      document.querySelectorAll('.container').forEach(elem => {
        elem.style.display = 'none';
      });
      document.getElementById(`container-${mode}`).style.display = 'block';
    });
  });

  document.getElementById("connect").addEventListener("click", async () => {
    for (let p of await SerialPort.list()) {
      switch (navigator.platform) {
        case 'Win32': {
          if (p.vendorId === "1999" && p.productId === "0514") {
            controller.device = p;
            ipcRenderer.send('serial-target', controller.device.path);
            return;
          }
        }

        // NOTE: not tested on other platforms
        default: {
          if (p.vendorId === 0x1999 && p.productId === 0x0514) {
            controller.device = p;
            ipcRenderer.send('serial-target', controller.device.path);
            return;
          }
        }
      }
    }

    ipcRenderer.send('notify', {
      title: `컨트롤러 연결 실패 (장치 없음)`,
      message: "먼저 장치를 컴퓨터에 연결한 후에 프로그램을 다시 실행하세요."
    });
  });

  document.getElementById("set-sensors").addEventListener("click", () => {
    /*************************************************************************
     * protocol $SENSOR: set sensors to use. $READY-ALL on all sensor LSNTP done
     *   request : $SENSOR <%03d sensor count> <...%03d sensor ids>
     *   response: $LSNTP on start, $READY-ALL on finish
     ************************************************************************/
    let cmd;

    switch (mode) {
      // competitive mode; variable lanes
      case 'competitive': {
        let cnt_sensor = document.getElementById('cnt-lane').value;
        active_sensors.competitive = [];

        if (!cnt_sensor) {
          return ipcRenderer.send('notify', { title: '경기 레인 수를 입력하세요.' });
        }

        cnt_sensor = Number(document.getElementById('cnt-lane').value);
        cmd = `${String(cnt_sensor).padStart(3, 0)} `;

        for (let i = 0; i < cnt_sensor; i++) {
          let sensor = document.getElementById(`id-sensor-${i + 1}`).value;

          if (!sensor) {
            return ipcRenderer.send('notify', { title: `${i + 1}번 레인 센서 ID를 입력하세요.` });
          } else {
            active_sensors.competitive.push({ id: Number(sensor) });
            cmd += `${String(Number(sensor)).padStart(3, 0)} `;
          }
        }

        cmd = cmd.slice(0, -1);
        break;
      }

      // record mode; start, end sensor
      case 'record': {
        let cnt_sensor = 2;
        let start = document.getElementById(`id-sensor-start`).value;
        let end = document.getElementById(`id-sensor-end`).value;

        if (!start || !end) {
          return ipcRenderer.send('notify', { title: `${(!start ? '시작' : '끝')} 지점 센서 ID를 입력하세요.` });
        }

        active_sensors.record.start = { id: Number(start) };
        active_sensors.record.end = { id: Number(end) };
        cmd = `${String(cnt_sensor).padStart(3, 0)} ${String(Number(start)).padStart(3, 0)} ${String(Number(end)).padStart(3, 0)}`;
        break;
      }

      default: {
        return;
      }
    }

    ipcRenderer.send('serial-request', `$SENSOR ${cmd}`);

    // TODO: draw sensor UI
  });

  document.getElementById("start").addEventListener("click", () => {
    /*************************************************************************
     * protocol $GREEN: GREEN ON, RED OFF. mark timestamp
     *   request : $GREEN
     *   response: $START <start timestamp>
     ************************************************************************/
    ipcRenderer.send('serial-request', `$GREEN`);
  });

  document.getElementById("red").addEventListener("click", () => {
    /*************************************************************************
     * protocol $RED: RED ON, GREEN OFF.
     *   request : $STOP
     *   response: $OK
     ************************************************************************/
    ipcRenderer.send('serial-request', `$RED`);
  });

  document.getElementById("off").addEventListener("click", () => {
    /*************************************************************************
     * protocol $OFF: RED OFF, GREEN OFF
     *   request : $OFF
     *   response: $OK
     ************************************************************************/
    ipcRenderer.send('serial-request', `$OFF`);
  });
}

handle_events();
